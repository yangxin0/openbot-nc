import { EventEmitter } from "node:events";
import type { RelayPeer, RelayTeam, RelayTeamMember } from "@openbot/contracts/relay-protocol/messages";
import { Effect, Exit, Result, Scope, Semaphore } from "effect";
import type { RelayControlState } from "./relay/control";
import { relayOrigin } from "./relay/fetch";
import type { RemoteHostIdentity } from "./remote-server-client";
import { relayRefusalForSocketCode } from "./remote-server-connection-status";
import type { RemoteRelayRefusalCode } from "./remote-server-errors";
import type { StoredRemoteServerView } from "./remote-server-store";
import type { RemoteWorkflowError } from "./remote-service-effects";

export interface RelayHostRecord {
  serverId: string;
  serverName: string;
  fingerprint: string;
  publicKey: string;
  logoVersion: string | null;
  username: string;
  relayKeyId: string;
  relayTeamId: string;
  relayUser: string;
  relayDevice: string | null;
}

export interface RelayServerRecords {
  servers(): readonly StoredRemoteServerView[];
  isRemoved(serverId: string): boolean;
  discover(apiUrl: string): Effect.Effect<RemoteHostIdentity, RemoteWorkflowError>;
  save(host: RelayHostRecord): Effect.Effect<{ signInNeeded: boolean }, RemoteWorkflowError>;
  signIn(serverId: string): Effect.Effect<void, RemoteWorkflowError>;
  setReachable(serverId: string, reachable: boolean): Effect.Effect<void, RemoteWorkflowError>;
  refuse(serverId: string, code: RemoteRelayRefusalCode): Effect.Effect<void, RemoteWorkflowError>;
  clearRefusal(serverId: string): Effect.Effect<void, RemoteWorkflowError>;
  subscribe(listener: () => void): () => void;
}

export interface RelayRosterSnapshot {
  state: RelayControlState;
  self: RelayPeer | null;
  team: RelayTeam | null;
  members: readonly RelayTeamMember[];
}

export interface RelayDirectoryHost {
  keyId: string;
  user: string;
  device: string | null;
  label: string | null;
  serverId: string | null;
  removed: boolean;
}

interface RemoteRelayDirectoryEvents {
  changed: [hosts: readonly RelayDirectoryHost[]];
  failed: [keyId: string, error: RemoteWorkflowError];
}

interface Appearance {
  member: RelayTeamMember;
  self: RelayPeer;
  team: RelayTeam;
}

export class RemoteRelayDirectory extends EventEmitter<RemoteRelayDirectoryEvents> {
  readonly #records: RelayServerRecords;
  readonly #lock = Semaphore.makeUnsafe(1);
  #scope: Scope.Closeable = Scope.makeUnsafe();
  #hosting = new Map<string, RelayTeamMember>();
  readonly #verified = new Map<string, string>();
  readonly #removed = new Map<string, string>();
  readonly #attempts = new Map<string, number>();
  readonly #reachable = new Set<string>();
  readonly #identityRefused = new Map<string, RemoteRelayRefusalCode>();

  constructor(records: RelayServerRecords) {
    super();
    this.#records = records;
  }

  hosts(): RelayDirectoryHost[] {
    return [...this.#hosting.values()].map((member) => ({
      keyId: member.keyId,
      user: member.user,
      device: member.device,
      label: member.label,
      serverId: this.#verified.get(member.keyId) ?? this.#removed.get(member.keyId) ?? null,
      removed: this.#removed.has(member.keyId),
    }));
  }

  readonly apply = Effect.fn("RemoteRelayDirectory.apply")(function* (
    this: RemoteRelayDirectory,
    snapshot: RelayRosterSnapshot,
  ) {
    yield* this.#lock.withPermit(this.#applyLocked(snapshot));
    this.emit("changed", this.hosts());
  }).bind(this);

  readonly retryRemoved = Effect.fn("RemoteRelayDirectory.retryRemoved")(function* (
    this: RemoteRelayDirectory,
    serverId: string,
  ) {
    yield* this.#lock.withPermit(
      Effect.sync(() => {
        for (const [keyId, removedId] of [...this.#removed]) {
          if (removedId !== serverId) continue;
          this.#removed.delete(keyId);
          this.#attempts.delete(keyId);
        }
      }),
    );
  }).bind(this);

  readonly stop = Effect.fn("RemoteRelayDirectory.stop")(function* (this: RemoteRelayDirectory) {
    const scope = this.#scope;
    this.#scope = Scope.makeUnsafe();
    yield* Scope.close(scope, Exit.void);
    yield* this.#lock.withPermit(this.#forgetHosts());
    this.emit("changed", this.hosts());
  }).bind(this);

  readonly #applyLocked = Effect.fn("RemoteRelayDirectory.applyLocked")(function* (
    this: RemoteRelayDirectory,
    snapshot: RelayRosterSnapshot,
  ) {
    const { state, self, team } = snapshot;
    if (state.status !== "online" || !self || !team) {
      yield* this.#forgetHosts();
      const refusal =
        state.status === "offline" && state.retryInMs === null && state.code !== "stopped"
          ? relayRefusalForSocketCode(state.code)
          : null;
      if (refusal)
        yield* this.#setIdentityRefusals(new Map(this.#relayServers().map((server) => [server.id, refusal] as const)));
      return;
    }
    yield* this.#setIdentityRefusals(
      new Map(
        this.#relayServers()
          .filter((server) => server.relayTeamId !== team.id)
          .map((server) => [server.id, "other_team"] as const),
      ),
    );
    const next = new Map(
      snapshot.members
        .filter((member) => member.hosting && member.keyId !== self.keyId)
        .map((member) => [member.keyId, member] as const),
    );
    for (const [keyId, serverId] of [...this.#verified]) {
      if (next.get(keyId)?.connectedAt === this.#hosting.get(keyId)?.connectedAt) continue;
      this.#verified.delete(keyId);
      yield* this.#markUnreachable(serverId);
    }
    for (const [keyId, connectedAt] of [...this.#attempts]) {
      if (next.get(keyId)?.connectedAt === connectedAt) continue;
      this.#attempts.delete(keyId);
      this.#removed.delete(keyId);
    }
    this.#hosting = next;
    for (const member of next.values()) {
      if (this.#verified.has(member.keyId) || this.#attempts.get(member.keyId) === member.connectedAt) continue;
      this.#attempts.set(member.keyId, member.connectedAt);
      yield* Effect.forkIn(this.#probe({ member, self, team }), this.#scope, { startImmediately: true });
    }
  });

  readonly #probe = Effect.fn("RemoteRelayDirectory.probe")(function* (
    this: RemoteRelayDirectory,
    appearance: Appearance,
  ) {
    const { member } = appearance;
    const adopted = yield* this.#records.discover(relayOrigin(member.keyId)).pipe(
      Effect.flatMap((identity) => this.#lock.withPermit(this.#adopt(appearance, identity))),
      Effect.result,
    );
    if (Result.isFailure(adopted)) this.emit("failed", member.keyId, adopted.failure);
    else this.emit("changed", this.hosts());
  });

  readonly #adopt = Effect.fn("RemoteRelayDirectory.adopt")(function* (
    this: RemoteRelayDirectory,
    { member, self, team }: Appearance,
    identity: RemoteHostIdentity,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    if (this.#hosting.get(member.keyId)?.connectedAt !== member.connectedAt) return;
    if (this.#records.isRemoved(identity.serverId)) {
      this.#removed.set(member.keyId, identity.serverId);
      return;
    }
    const existing = this.#records.servers().find((server) => server.id === identity.serverId);
    if (existing && existing.fingerprint !== identity.fingerprint) {
      yield* this.#records.refuse(existing.id, "identity_changed");
      return;
    }
    const { signInNeeded } = yield* this.#records.save({
      serverId: identity.serverId,
      serverName: identity.serverName,
      fingerprint: identity.fingerprint,
      publicKey: identity.publicKey,
      logoVersion: identity.logoVersion,
      username: self.user,
      relayKeyId: member.keyId,
      relayTeamId: team.id,
      relayUser: member.user,
      relayDevice: member.device,
    });
    this.#verified.set(member.keyId, identity.serverId);
    const wasReachable = this.#reachable.has(identity.serverId);
    this.#reachable.add(identity.serverId);
    if (signInNeeded) yield* this.#records.signIn(identity.serverId).pipe(Effect.ignore);
    else if (!wasReachable) yield* this.#records.setReachable(identity.serverId, true);
  });

  readonly #markUnreachable = Effect.fn("RemoteRelayDirectory.markUnreachable")(function* (
    this: RemoteRelayDirectory,
    serverId: string,
  ) {
    if ([...this.#verified.values()].includes(serverId) || !this.#reachable.delete(serverId)) return;
    yield* this.#records.setReachable(serverId, false).pipe(Effect.ignore);
  });

  readonly #forgetHosts = Effect.fn("RemoteRelayDirectory.forgetHosts")(function* (this: RemoteRelayDirectory) {
    this.#hosting = new Map();
    this.#verified.clear();
    this.#attempts.clear();
    this.#removed.clear();
    const reachable = [...this.#reachable];
    this.#reachable.clear();
    for (const serverId of reachable) yield* this.#records.setReachable(serverId, false).pipe(Effect.ignore);
  });

  readonly #setIdentityRefusals = Effect.fn("RemoteRelayDirectory.setIdentityRefusals")(function* (
    this: RemoteRelayDirectory,
    wanted: ReadonlyMap<string, RemoteRelayRefusalCode>,
  ) {
    for (const [serverId, code] of [...this.#identityRefused]) {
      if (wanted.get(serverId) === code) continue;
      this.#identityRefused.delete(serverId);
      yield* this.#records.clearRefusal(serverId).pipe(Effect.ignore);
    }
    for (const [serverId, code] of wanted) {
      if (this.#identityRefused.get(serverId) === code) continue;
      this.#identityRefused.set(serverId, code);
      yield* this.#records.refuse(serverId, code).pipe(Effect.ignore);
    }
  });

  #relayServers(): StoredRemoteServerView[] {
    return this.#records.servers().filter((server) => server.transport === "relay");
  }
}
