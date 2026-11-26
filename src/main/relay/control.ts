import { EventEmitter } from "node:events";
import { getCACertificates, TLSSocket } from "node:tls";
import {
  RELAY_SOCKET_MESSAGE_BYTES_LIMIT,
  type RelayHubKind,
  type RelayHubMember,
} from "@openbot/contracts/relay-protocol/hub";
import type { RelayPeer, RelayTeam } from "@openbot/contracts/relay-protocol/messages";
import type { Logger } from "@openbot/logging";
import { webRelayCrypto } from "@openbot/team-client/relay-crypto";
import {
  RelayHubClient,
  type RelayHubMessage,
  type RelayHubSocket,
  type RelayHubSocketEvents,
  type RelayHubState,
  type RelayHubUndeliverable,
  RelaySocketError,
} from "@openbot/team-client/relay-hub";
import { Effect } from "effect";
import WebSocket from "ws";
import type { RelayCredentialSource } from "./identity-store";

export const RELAY_DESKTOP_HTTP_CAPABILITY = "team-http-v1";
export const RELAY_RESUME_CHECK_TIMEOUT_MS = 1_500;

export type RelayControlState = RelayHubState;

interface RelayControlEvents {
  state: [state: RelayControlState];
  roster: [members: readonly RelayHubMember[]];
  message: [message: RelayHubMessage];
  undeliverable: [undeliverable: RelayHubUndeliverable];
}

interface RelayControlOptions {
  identity: RelayCredentialSource;
  hosting?: boolean;
  label?: string | null;
  reconnect?: { baseMs?: number; maxMs?: number };
  connectDeadlineMs?: number;
  liveness?: { idleMs?: number; answerMs?: number };
  logger?: Pick<Logger, "info" | "warn">;
}

const STOPPED: RelayControlState = { status: "offline", code: "stopped", message: "Not started.", retryInMs: null };

export class RelayControl extends EventEmitter<RelayControlEvents> {
  readonly #options: RelayControlOptions;
  #presence: { hosting: boolean; label: string | null };
  #hub: RelayHubClient | null = null;
  #unsubscribe: Array<() => void> = [];
  #tlsSession: Buffer | null = null;
  #roster: readonly RelayHubMember[] = [];

  constructor(options: RelayControlOptions) {
    super();
    this.#options = options;
    this.#presence = { hosting: options.hosting ?? false, label: options.label ?? null };
  }

  readonly start = Effect.fn("RelayControl.start")(function* (this: RelayControl) {
    if (this.#hub?.running) return;
    for (const unsubscribe of this.#unsubscribe.splice(0)) unsubscribe();
    this.#hub = null;
    const identity = this.#options.identity.current();
    if (!identity) {
      this.emit("state", {
        status: "offline",
        code: "identity_unavailable",
        message: "No relay identity is imported.",
        retryInMs: null,
      });
      return;
    }
    const logger = this.#options.logger;
    const hub = new RelayHubClient({
      identity,
      sign: async (data) => this.#options.identity.signRelayData(data),
      crypto: webRelayCrypto,
      openSocket: (url, events) => this.#openSocket(url, events),
      label: this.#presence.label,
      hosting: this.#presence.hosting,
      capabilities: [RELAY_DESKTOP_HTTP_CAPABILITY],
      ...(this.#options.reconnect ? { reconnect: this.#options.reconnect } : {}),
      ...(this.#options.connectDeadlineMs ? { connectDeadlineMs: this.#options.connectDeadlineMs } : {}),
      ...(this.#options.liveness ? { liveness: this.#options.liveness } : {}),
      ...(logger ? { log: (level: "info" | "warn", line: string) => logger[level](line) } : {}),
    });
    this.#hub = hub;
    let state = hub.snapshot().state;
    this.#unsubscribe = [
      hub.subscribe((snapshot) => {
        if (snapshot.state !== state) {
          state = snapshot.state;
          this.emit("state", snapshot.state);
        }
        if (snapshot.roster !== this.#roster) {
          this.#roster = snapshot.roster;
          this.emit("roster", snapshot.roster);
        }
      }),
      hub.onMessage((message) => this.emit("message", message)),
      hub.onUndeliverable((undeliverable) => this.emit("undeliverable", undeliverable)),
    ];
    hub.start();
  }).bind(this);

  readonly stop = Effect.fn("RelayControl.stop")(function* (this: RelayControl) {
    yield* Effect.sync(() => this.#stopHub());
  }).bind(this);

  readonly setHosting = Effect.fn("RelayControl.setHosting")(function* (
    this: RelayControl,
    hosting: boolean,
    label?: string | null,
  ): Effect.fn.Return<void, RelaySocketError> {
    yield* Effect.sync(() => {
      this.#presence = { hosting, label: label === undefined ? this.#presence.label : label };
      this.#hub?.setPresence(this.#presence);
    });
  }).bind(this);

  state(): RelayControlState {
    return this.#hub?.snapshot().state ?? STOPPED;
  }

  roster(): readonly RelayHubMember[] {
    return this.#hub?.snapshot().roster ?? [];
  }

  self(): RelayPeer | null {
    const self = this.#hub?.snapshot().self;
    return self ? { keyId: self.keyId, user: self.user, device: self.device } : null;
  }

  team(): RelayTeam | null {
    return this.#hub?.snapshot().team ?? null;
  }

  heartbeatRttMs(): number | null {
    return this.#hub?.heartbeatRttMs() ?? null;
  }

  socketsOpened(): number {
    return this.#hub?.socketsOpened() ?? 0;
  }

  resume(timeoutMs: number = RELAY_RESUME_CHECK_TIMEOUT_MS): void {
    this.#hub?.checkLiveness(timeoutMs);
  }

  member(keyId: string): RelayHubMember | null {
    return this.#hub?.member(keyId) ?? null;
  }

  send(to: string, kind: RelayHubKind, plaintext: Uint8Array<ArrayBuffer>): Promise<number> {
    const hub = this.#hub;
    if (!hub) return Promise.reject(new RelaySocketError({ code: "closed", message: "The relay is stopped." }));
    return hub.send(to, kind, plaintext);
  }

  info(keyId: string): Promise<RelayHubMember | null> {
    const hub = this.#hub;
    if (!hub) return Promise.resolve(null);
    return hub.info(keyId);
  }

  #stopHub(): void {
    const hub = this.#hub;
    if (!hub) return;
    this.#hub = null;
    hub.stop();
    for (const unsubscribe of this.#unsubscribe.splice(0)) unsubscribe();
    this.#roster = [];
    this.emit("roster", []);
    this.emit("state", STOPPED);
  }

  #openSocket(url: string, events: RelayHubSocketEvents): RelayHubSocket {
    const tls = this.#options.identity.tlsCredentials();
    const target = new URL(url);
    const secure = target.protocol === "wss:";
    const socket = new WebSocket(target, {
      ...(secure && tls ? { ...tls, ca: [...getCACertificates("default"), tls.ca] } : {}),
      ...(secure && this.#tlsSession ? { session: this.#tlsSession } : {}),
      perMessageDeflate: false,
      maxPayload: Math.max(RELAY_SOCKET_MESSAGE_BYTES_LIMIT, 8 * 1024 * 1024),
    });
    socket.on("upgrade", (response) => {
      const tlsSocket = response.socket;
      if (!(tlsSocket instanceof TLSSocket)) return;
      this.#tlsSession = tlsSocket.getSession() ?? this.#tlsSession;
      tlsSocket.on("session", (session: Buffer) => {
        this.#tlsSession = session;
      });
    });
    socket.on("open", () => events.open());
    socket.on("message", (data, binary) => {
      const bytes = Array.isArray(data)
        ? Buffer.concat(data)
        : Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
      if (binary) events.binary(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
      else events.text(bytes.toString("utf8"));
    });
    socket.on("error", () => undefined);
    socket.on("close", (code, reason) => events.closed(code, reason.toString("utf8")));
    return {
      get bufferedAmount() {
        return socket.bufferedAmount;
      },
      send: (data) => socket.send(data),
      close: (code, reason) => {
        if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
        else socket.close(code, reason);
        setTimeout(() => {
          if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
        }, 1_000).unref();
      },
    };
  }
}
