import { EventEmitter } from "node:events";
import type { RelayHubMember } from "@openbot/contracts/relay-protocol/hub";
import {
  RELAY_LABEL_LIMIT,
  type RelayPeer,
  type RelayPeerCertificate,
} from "@openbot/contracts/relay-protocol/messages";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { decodeTeamProtocolV2RpcFrame, encodeTeamProtocolV2Frame } from "@openbot/contracts/team-protocol/v2";
import { sourceText } from "@openbot/i18n/source";
import type { RelayHubMessage } from "@openbot/team-client/relay-hub";
import { decodeRelayHubV2Plaintext } from "@openbot/team-client/relay-hub-channels";
import { Effect, Fiber, Result } from "effect";
import type { RemoteWorkflowError } from "../remote-service-effects";
import { type TeamStore, TeamStoreError } from "../team-store";
import { TeamV2HostPeer } from "../team-v2-host-peer";
import { RELAY_DESKTOP_HTTP_CAPABILITY, type RelayControl, type RelayControlState } from "./control";
import { RelayHubPeerTransport, relayHubDirection } from "./hub-transport";
import type { RelaySocketError } from "./socket";

const SENDERS_LIMIT = 64;
const PENDING_MESSAGES_LIMIT = 256;
const OFFLINE_SENDER_MS = 10 * 60_000;
const SWEEP_MS = 30_000;
const REFUSAL_RETRY_MS = 5_000;
const RAW_HTTP_OPERATION = "http.raw";

interface RelayHostedServer {
  readonly port: number | null;
  setRelayHosting(enabled: boolean, v2Tunnels: boolean): void;
  bindRelaySession(sessionId: string, peer: RelayPeerCertificate): void;
  releaseRelaySession(sessionId: string): void;
  setRelaySessionAway(sessionId: string, away: boolean): void;
}

interface HostRelayEvents {
  state: [state: RelayControlState];
  refused: [error: RelaySocketError];
}

interface HostRelayOptions {
  control: RelayControl;
  store: TeamStore;
  server: RelayHostedServer;
  label: string | null;
  appVersion: string;
  transferDirectory: string;
  closeSession?: (sessionId: string) => Effect.Effect<void, RemoteWorkflowError>;
  offlineSenderMs?: number;
}

interface Sender {
  readonly keyId: string;
  member: RelayHubMember;
  readonly transport: RelayHubPeerTransport;
  hostPeer: TeamV2HostPeer | null;
  pending: RelayHubMessage[] | null;
  refusal: { message: string; at: number } | null;
  offlineSince: number | null;
  closed: boolean;
}

export class HostRelay extends EventEmitter<HostRelayEvents> {
  readonly #options: HostRelayOptions;
  readonly #senders = new Map<string, Sender>();
  readonly #operations = new Set<Fiber.Fiber<void>>();
  #label: string | null;
  #started = false;
  #sweep: ReturnType<typeof setInterval> | null = null;

  constructor(options: HostRelayOptions) {
    super();
    this.#options = options;
    this.#label = relayLabel(options.label);
  }

  readonly start = Effect.fn("HostRelay.start")(function* (this: HostRelay) {
    if (this.#started) return;
    this.#started = true;
    const { control, server } = this.#options;
    server.setRelayHosting(true, true);
    control.on("state", this.#onState);
    control.on("message", this.#onMessage);
    control.on("roster", this.#onRoster);
    this.#sweep = setInterval(() => this.#dropOfflineSenders(), SWEEP_MS);
    this.#sweep.unref();
    yield* control.setHosting(true, this.#label).pipe(Effect.ignore);
    yield* control.start();
  }).bind(this);

  readonly stop = Effect.fn("HostRelay.stop")(function* (this: HostRelay) {
    if (!this.#started) return;
    this.#started = false;
    const { control, server } = this.#options;
    control.off("state", this.#onState);
    control.off("message", this.#onMessage);
    control.off("roster", this.#onRoster);
    if (this.#sweep) clearInterval(this.#sweep);
    this.#sweep = null;
    yield* control.setHosting(false).pipe(Effect.ignore);
    server.setRelayHosting(false, false);
    for (const sender of [...this.#senders.values()]) this.#close(sender);
    yield* Fiber.awaitAll([...this.#operations]);
  }).bind(this);

  readonly setLabel = Effect.fn("HostRelay.setLabel")(function* (
    this: HostRelay,
    label: string | null,
  ): Effect.fn.Return<void, RelaySocketError> {
    this.#label = relayLabel(label);
    yield* this.#options.control.setHosting(true, this.#label);
  }).bind(this);

  state(): RelayControlState {
    return this.#options.control.state();
  }

  senderCount(): number {
    return this.#senders.size;
  }

  hasActiveTransfers(): boolean {
    return [...this.#senders.values()].some((sender) => sender.hostPeer?.hasActiveTransfers() ?? false);
  }

  revokeSession(sessionId: string): Effect.Effect<void> {
    return Effect.sync(() => {
      for (const sender of [...this.#senders.values()]) {
        if (sender.hostPeer?.sessionId === sessionId) this.#close(sender);
      }
    });
  }

  readonly #onState = (state: RelayControlState): void => {
    this.emit("state", state);
  };

  readonly #onRoster = (members: readonly RelayHubMember[]): void => {
    const online = new Map(members.map((member) => [member.keyId, member] as const));
    const now = Date.now();
    for (const sender of this.#senders.values()) {
      const member = online.get(sender.keyId);
      if (member && member.messageKey !== sender.member.messageKey) {
        sender.hostPeer?.setPeerOnline(false);
        sender.member = member;
      }
      sender.hostPeer?.setPeerOnline(member !== undefined);
      const sessionId = sender.hostPeer?.sessionId;
      if (sessionId) this.#options.server.setRelaySessionAway(sessionId, member === undefined);
      if (member) sender.offlineSince = null;
      else sender.offlineSince ??= now;
    }
  };

  readonly #onMessage = (message: RelayHubMessage): void => {
    if (!this.#started || relayHubDirection(message.plaintext) !== "to-host") return;
    const member = this.#options.control.member(message.from);
    if (!member) return;
    let sender = this.#senders.get(message.from);
    if (!sender) {
      if (this.#senders.size >= SENDERS_LIMIT) return;
      sender = {
        keyId: member.keyId,
        member,
        transport: new RelayHubPeerTransport(
          this.#options.control,
          member.keyId,
          "to-client",
          () => this.#options.control.member(member.keyId) !== null,
          () => {
            const current = this.#senders.get(member.keyId);
            if (current) this.#close(current);
          },
        ),
        hostPeer: null,
        pending: [],
        refusal: null,
        offlineSince: null,
        closed: false,
      };
      this.#senders.set(member.keyId, sender);
      const opening = sender;
      this.#run(this.#open(opening).pipe(Effect.catchCause(() => Effect.sync(() => this.#close(opening)))));
    }
    if (sender.refusal) {
      if (Date.now() - sender.refusal.at < REFUSAL_RETRY_MS) {
        this.#answerRefusal(sender, message, sender.refusal.message);
        return;
      }
      sender.refusal = null;
      sender.pending = [];
      const opening = sender;
      this.#run(this.#open(opening).pipe(Effect.catchCause(() => Effect.sync(() => this.#close(opening)))));
    }
    if (sender.pending) {
      if (sender.pending.length < PENDING_MESSAGES_LIMIT) sender.pending.push(message);
      return;
    }
    sender.transport.receive(message.kind, message.plaintext);
  };

  readonly #open = Effect.fn("HostRelay.open")(function* (this: HostRelay, sender: Sender) {
    const { store, server } = this.#options;
    const peer = { keyId: sender.member.keyId, user: sender.member.user, device: sender.member.device };
    const login = yield* Effect.result(store.loginWithRelayPeer(peer));
    const raw = sender.member.capabilities.includes(RELAY_DESKTOP_HTTP_CAPABILITY);
    if (Result.isFailure(login) && !sender.closed && raw && server.port !== null) {
      sender.hostPeer = this.#hostPeer(sender, server.port, peer);
      this.#flush(sender);
      return;
    }
    if (Result.isFailure(login) && !sender.closed) {
      const cause = login.failure.cause;
      const message = cause instanceof TeamStoreError && cause.message ? cause.message.slice(0, 500) : "";
      sender.refusal = { message, at: Date.now() };
      const pending = sender.pending ?? [];
      sender.pending = null;
      for (const refused of pending) this.#answerRefusal(sender, refused, message);
      return;
    }
    if (Result.isFailure(login) || sender.closed) {
      this.#close(sender);
      if (Result.isSuccess(login)) yield* store.logout(login.success.sessionToken).pipe(Effect.ignore);
      return;
    }
    const { member, sessionToken, sessionExpiresAt } = login.success;
    const sessionId = store.authenticateSession(sessionToken)?.sessionId ?? null;
    const port = server.port;
    if (sessionId === null || port === null) {
      yield* store.logout(sessionToken).pipe(Effect.ignore);
      this.#close(sender);
      return;
    }
    server.bindRelaySession(sessionId, { ...peer, certificate: sender.member.certificate });
    const hostPeer = this.#hostPeer(sender, port, peer);
    yield* hostPeer.adoptSession({
      sessionId,
      sessionToken,
      membershipId: member.id,
      expiresAt: Date.parse(sessionExpiresAt),
    });
    this.#flush(sender);
  });

  #hostPeer(sender: Sender, port: number, peer: RelayPeer): TeamV2HostPeer {
    const { store, server } = this.#options;
    const hostPeer = new TeamV2HostPeer(
      {
        store,
        appVersion: this.#options.appVersion,
        transferDirectory: this.#options.transferDirectory,
        closeSession: (closing) => this.#releaseSession(closing),
        bindSession: (bound) => server.bindRelaySession(bound, { ...peer, certificate: sender.member.certificate }),
      },
      {
        peerId: sender.keyId,
        localApiPort: port,
        transport: sender.transport,
        rawHttp: sender.member.capabilities.includes(RELAY_DESKTOP_HTTP_CAPABILITY),
        relayPeer: peer,
      },
    );
    sender.hostPeer = hostPeer;
    return hostPeer;
  }

  #flush(sender: Sender): void {
    const pending = sender.pending ?? [];
    sender.pending = null;
    if (sender.closed) return;
    for (const message of pending) sender.transport.receive(message.kind, message.plaintext);
  }

  #answerRefusal(sender: Sender, message: RelayHubMessage, refusal: string): void {
    if (message.kind !== "rpc") return;
    const decoded = decodeRelayHubV2Plaintext(message.plaintext);
    if (!decoded || typeof decoded.payload !== "string") return;
    let requestId: string;
    let raw: boolean;
    let signIn: boolean;
    try {
      const frame = decodeTeamProtocolV2RpcFrame(decoded.payload);
      if (frame.type !== "request") return;
      requestId = frame.requestId;
      raw = frame.operation === RAW_HTTP_OPERATION;
      const payload = frame.payload;
      signIn = isDynamicRecord(payload) && payload.method === "POST" && payload.path === TEAM_API_ROUTES.auth.relay;
    } catch {
      return;
    }
    const answer = raw
      ? encodeTeamProtocolV2Frame({
          version: 2,
          type: "response",
          requestId,
          result: {
            status: signIn ? 400 : 401,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ error: signIn ? refusal : sourceText("error.team.authenticationRequired") }),
          },
        })
      : encodeTeamProtocolV2Frame({
          version: 2,
          type: "response",
          requestId,
          error: { code: "sign_in_refused", message: refusal, retryable: false, status: 403 },
        });
    this.#run(Effect.ignore(sender.transport.send(sender.keyId, "rpc", answer)));
  }

  readonly #releaseSession = (sessionId: string): Effect.Effect<void, RemoteWorkflowError> =>
    Effect.gen({ self: this }, function* () {
      this.#options.server.releaseRelaySession(sessionId);
      if (this.#options.closeSession) yield* this.#options.closeSession(sessionId);
    });

  #dropOfflineSenders(): void {
    const limit = this.#options.offlineSenderMs ?? OFFLINE_SENDER_MS;
    const now = Date.now();
    for (const sender of [...this.#senders.values()]) {
      if (sender.offlineSince !== null && now - sender.offlineSince >= limit) this.#close(sender);
    }
  }

  #close(sender: Sender): void {
    if (sender.closed) return;
    sender.closed = true;
    sender.pending = null;
    if (this.#senders.get(sender.keyId) === sender) this.#senders.delete(sender.keyId);
    const hostPeer = sender.hostPeer;
    sender.hostPeer = null;
    if (!hostPeer) return;
    const sessionId = hostPeer.sessionId;
    sender.transport.disconnected();
    this.#run(
      Effect.gen({ self: this }, function* () {
        yield* hostPeer.dispose();
        if (sessionId) this.#options.server.releaseRelaySession(sessionId);
      }),
    );
  }

  #run(operation: Effect.Effect<void>): void {
    const fiber = Effect.runFork(operation);
    this.#operations.add(fiber);
    fiber.addObserver(() => this.#operations.delete(fiber));
  }
}

function relayLabel(label: string | null): string | null {
  const trimmed = label?.trim() ?? "";
  return trimmed ? trimmed.slice(0, RELAY_LABEL_LIMIT) : null;
}
