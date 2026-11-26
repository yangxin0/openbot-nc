import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RelayHubMember } from "@openbot/contracts/relay-protocol/hub";
import { createOpenBotLogger, type Logger, toLogValue } from "@openbot/logging";
import { Effect, Exit, Scope } from "effect";
import {
  type RelayDirectoryHost,
  type RelayRosterSnapshot,
  type RelayServerRecords,
  RemoteRelayDirectory,
} from "../remote-relay-directory";
import type { RemoteEventSocket } from "../remote-server-event-stream";
import type { RemoteFetch } from "../remote-server-http";
import { RelayControl, type RelayControlState } from "./control";
import { relayTargetOf } from "./fetch";
import { RelayHostClient } from "./hub-client";
import type { RelayCredentialSource } from "./identity-store";
import { RelaySocketError } from "./socket";

interface RelayClientEvents {
  state: [state: RelayControlState];
  roster: [members: readonly RelayHubMember[]];
  hosts: [hosts: readonly RelayDirectoryHost[]];
}

interface RelayClientCoordinatorOptions {
  identity: RelayCredentialSource;
  reconnect?: { baseMs?: number; maxMs?: number };
  connectDeadlineMs?: number;
  liveness?: { idleMs?: number; answerMs?: number };
  transferDirectory?: string;
  logger?: Pick<Logger, "info" | "warn">;
}

interface Running {
  records: RelayServerRecords;
  directory: RemoteRelayDirectory;
  scope: Scope.Closeable;
  unsubscribe: () => void;
}

export class RelayClientCoordinator extends EventEmitter<RelayClientEvents> {
  readonly control: RelayControl;
  readonly #logger: Pick<Logger, "info" | "warn">;
  readonly #transferDirectory: string;
  readonly #clients = new Map<string, RelayHostClient>();
  #running: Running | null = null;

  constructor(options: RelayClientCoordinatorOptions) {
    super();
    this.#logger = options.logger ?? createOpenBotLogger("relay-client");
    this.control = new RelayControl({
      identity: options.identity,
      logger: this.#logger,
      ...(options.reconnect ? { reconnect: options.reconnect } : {}),
      ...(options.connectDeadlineMs ? { connectDeadlineMs: options.connectDeadlineMs } : {}),
      ...(options.liveness ? { liveness: options.liveness } : {}),
    });
    this.#transferDirectory = options.transferDirectory ?? join(tmpdir(), "openbot-relay-client");
  }

  readonly start = Effect.fn("RelayClientCoordinator.start")(function* (
    this: RelayClientCoordinator,
    records: RelayServerRecords,
  ) {
    if (this.#running) return;
    const directory = new RemoteRelayDirectory(records);
    const running: Running = {
      records,
      directory,
      scope: yield* Scope.make(),
      unsubscribe: records.subscribe(() => this.#closeUnusedPools()),
    };
    this.#running = running;
    directory.on("changed", this.#onHosts);
    directory.on("failed", this.#onProbeFailed);
    this.control.on("state", this.#onState);
    this.control.on("roster", this.#onRoster);
    yield* this.control.start();
    this.#apply();
  }).bind(this);

  readonly stop = Effect.fn("RelayClientCoordinator.stop")(function* (this: RelayClientCoordinator) {
    const running = this.#running;
    if (!running) return;
    this.#running = null;
    this.control.off("state", this.#onState);
    this.control.off("roster", this.#onRoster);
    running.unsubscribe();
    yield* Scope.close(running.scope, Exit.void);
    yield* this.control.stop();
    yield* running.directory.stop();
    running.directory.off("changed", this.#onHosts);
    running.directory.off("failed", this.#onProbeFailed);
    this.#closeClients(() => true);
  }).bind(this);

  readonly resetIdentity = Effect.fn("RelayClientCoordinator.resetIdentity")(function* (this: RelayClientCoordinator) {
    const records = this.#running?.records;
    yield* this.stop();
    if (records) yield* this.start(records);
  }).bind(this);

  readonly retryHost = Effect.fn("RelayClientCoordinator.retryHost")(function* (
    this: RelayClientCoordinator,
    serverId: string,
  ) {
    const running = this.#running;
    if (!running) return;
    yield* running.directory.retryRemoved(serverId);
    this.#apply();
  }).bind(this);

  state(): RelayControlState {
    return this.control.state();
  }

  roster(): readonly RelayHubMember[] {
    return this.control.roster();
  }

  hosts(): readonly RelayDirectoryHost[] {
    return this.#running?.directory.hosts() ?? [];
  }

  fetchFor(url: URL): RemoteFetch | null {
    const target = relayTargetOf(url);
    if (target === null) return null;
    return (input, init) => {
      const client = this.#hostClient(target);
      return client instanceof RelaySocketError
        ? Promise.reject(new TypeError("fetch failed", { cause: client }))
        : client.fetch(input, init);
    };
  }

  openEventSocket(url: URL, _protocols: string[]): RemoteEventSocket | null {
    const target = relayTargetOf(url);
    if (target === null) return null;
    const client = this.#hostClient(target);
    if (client instanceof RelaySocketError) throw new TypeError("WebSocket failed", { cause: client });
    return client.openEventSocket();
  }

  hasActiveTransfers(): boolean {
    return [...this.#clients.values()].some((client) => client.hasActiveTransfers());
  }

  #hostClient(target: string): RelayHostClient | RelaySocketError {
    const state = this.control.state();
    if (!this.#running || state.status !== "online") {
      return new RelaySocketError(
        state.status === "offline" && state.code !== "stopped"
          ? { code: state.code, message: state.message }
          : { code: "connect_failed", message: "The relay server is not connected." },
      );
    }
    if (!this.control.roster().some((member) => member.keyId === target && member.hosting)) {
      return new RelaySocketError({ code: "target_unavailable", message: "The member is offline or does not host." });
    }
    const existing = this.#clients.get(target);
    if (existing) return existing;
    const client = new RelayHostClient(this.control, target, join(this.#transferDirectory, target));
    this.#clients.set(target, client);
    return client;
  }

  #apply(): void {
    const running = this.#running;
    if (!running) return;
    const snapshot: RelayRosterSnapshot = {
      state: this.control.state(),
      self: this.control.self(),
      team: this.control.team(),
      members: this.control.roster(),
    };
    Effect.runFork(Effect.forkIn(running.directory.apply(snapshot), running.scope, { startImmediately: true }));
  }

  #closeUnusedPools(): void {
    const running = this.#running;
    if (!running) return;
    const used = new Set(
      running.records
        .servers()
        .flatMap((server) => (server.transport === "relay" && server.relayKeyId ? [server.relayKeyId] : [])),
    );
    for (const host of running.directory.hosts()) if (host.serverId === null) used.add(host.keyId);
    this.#closeClients((target) => !used.has(target));
  }

  #closeClients(unused: (target: string) => boolean): void {
    for (const [target, client] of [...this.#clients]) {
      if (!unused(target)) continue;
      this.#clients.delete(target);
      void client.dispose();
    }
  }

  readonly #onState = (state: RelayControlState): void => {
    this.emit("state", state);
    this.#apply();
  };

  readonly #onRoster = (members: readonly RelayHubMember[]): void => {
    this.emit("roster", members);
    this.#apply();
  };

  readonly #onHosts = (hosts: readonly RelayDirectoryHost[]): void => {
    this.emit("hosts", hosts);
    this.#closeUnusedPools();
  };

  readonly #onProbeFailed = (keyId: string, error: unknown): void => {
    this.#logger.warn("A relay host could not be checked.", toLogValue({ keyId, error }));
  };
}
