import { EventEmitter } from "node:events";
import {
  RELAY_DATA_IDLE_MS,
  RELAY_HEARTBEAT_FEATURE,
  RELAY_LABEL_LIMIT,
  RELAY_PROTOCOL_VERSION,
  RELAY_RESUME_CHECK_TIMEOUT_MS,
  RELAY_SESSIONS_FEATURE,
  type RelayPeer,
  type RelayPeerCertificate,
  type RelayTeam,
  type RelayTeamMember,
} from "@openbot/contracts/relay-protocol/messages";
import type { RelayPublicKey } from "@openbot/contracts/relay-protocol/tunnel-crypto";
import type { Logger } from "@openbot/logging";
import { webRelayCrypto } from "@openbot/team-client/relay-crypto";
import { RelayHeartbeat, type RelayHeartbeatTiming } from "@openbot/team-client/relay-heartbeat";
import {
  type RelayIncomingSession,
  type RelaySession,
  RelaySessionMux,
  type RelaySessionSecurity,
} from "@openbot/team-client/relay-sessions";
import { RelaySocketError as SharedRelaySocketError } from "@openbot/team-client/relay-socket";
import { Effect, Exit, Fiber, Result } from "effect";
import { peerRefusal, readCertificate } from "./certificates";
import type { RelayCredentialSource } from "./identity-store";
import {
  openRelayControlSocket,
  openRelayDataSocket,
  type RelayConnectTiming,
  type RelaySocket,
  type RelaySocketClose,
  RelaySocketError,
  type RelaySocketErrorCode,
  type RelaySocketOptions,
} from "./socket";
import { desktopRelayError } from "./stream";

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;
const RECONNECT_JITTER = 0.2;
const HEALTHY_AFTER_MS = 30_000;
const RTT_REPORT_MS = 60_000;

const FINAL_CODES: ReadonlySet<RelaySocketErrorCode> = new Set([
  "replaced",
  "certificate_revoked",
  "certificate_expired",
  "authentication_failed",
  "identity_unavailable",
  "relay_url_missing",
  "insecure_relay_url",
  "server_refused",
]);

export type RelayControlState =
  | { status: "connecting" }
  | { status: "online"; rttMs?: number }
  | { status: "offline"; code: RelaySocketErrorCode | "stopped"; message: string; retryInMs: number | null };

interface RelayControlEvents {
  state: [state: RelayControlState];
  roster: [members: readonly RelayTeamMember[]];
  session: [incoming: RelayIncomingSession];
}

interface RelayControlOptions {
  identity: RelayCredentialSource;
  dataIdleMs?: number;
  hosting?: boolean;
  label?: string | null;
  reconnect?: { baseMs?: number; maxMs?: number };
  socket?: RelaySocketOptions;
  heartbeat?: RelayHeartbeatTiming;
  logger?: Pick<Logger, "info" | "warn">;
  now?: () => number;
}

interface Presence {
  hosting: boolean;
  label: string | null;
}

interface RelayDataLink {
  readonly socket: RelaySocket;
  readonly requestedAt: number;
  ticket: string | null;
  ready: boolean;
  closing: boolean;
  heartbeat: RelayHeartbeat | null;
}

export class RelayControl extends EventEmitter<RelayControlEvents> {
  readonly #identity: RelayCredentialSource;
  readonly #socketOptions: RelaySocketOptions;
  readonly #baseMs: number;
  readonly #maxMs: number;
  readonly #now: () => number;
  readonly #heartbeatTiming: RelayHeartbeatTiming;
  readonly #logger: Pick<Logger, "info" | "warn"> | null;
  readonly #waiters = new Set<() => void>();
  #heartbeat: RelayHeartbeat | null = null;
  #heartbeatsSupported = false;
  #rttTimer: ReturnType<typeof setInterval> | null = null;
  #reconnectAtOnce = false;
  #wake: (() => void) | null = null;
  #presence: Presence;
  #sentPresence: Presence | null = null;
  #socket: RelaySocket | null = null;
  #mux: RelaySessionMux | null = null;
  #data: RelayDataLink | null = null;
  #idleTimer: ReturnType<typeof setInterval> | null = null;
  readonly #dataIdleMs: number;
  #fiber: Fiber.Fiber<void> | null = null;
  #state: RelayControlState = { status: "offline", code: "stopped", message: "Not started.", retryInMs: null };
  #roster: readonly RelayTeamMember[] = [];
  #self: RelayPeer | null = null;
  #team: RelayTeam | null = null;

  constructor(options: RelayControlOptions) {
    super();
    this.#identity = options.identity;
    this.#socketOptions = options.socket ?? {};
    this.#baseMs = options.reconnect?.baseMs ?? RECONNECT_BASE_MS;
    this.#maxMs = options.reconnect?.maxMs ?? RECONNECT_MAX_MS;
    this.#now = options.now ?? Date.now;
    this.#dataIdleMs = options.dataIdleMs ?? RELAY_DATA_IDLE_MS;
    this.#heartbeatTiming = options.heartbeat ?? {};
    this.#logger = options.logger ?? null;
    this.#presence = { hosting: options.hosting ?? false, label: options.label ?? null };
  }

  readonly start = Effect.fn("RelayControl.start")(function* (this: RelayControl) {
    if (this.#fiber) return;
    const fiber = yield* Effect.forkDetach(this.#run());
    this.#fiber = fiber;
    fiber.addObserver(() => {
      if (this.#fiber === fiber) this.#fiber = null;
    });
  }).bind(this);

  readonly stop = Effect.fn("RelayControl.stop")(function* (this: RelayControl) {
    const fiber = this.#fiber;
    this.#fiber = null;
    if (!fiber) return;
    yield* Fiber.interrupt(fiber);
    this.#endHeartbeat();
    const socket = this.#socket;
    this.#socket = null;
    this.#sentPresence = null;
    socket?.close();
    this.#setRoster([]);
    this.#setState({ status: "offline", code: "stopped", message: "Stopped.", retryInMs: null });
  }).bind(this);

  readonly setHosting = Effect.fn("RelayControl.setHosting")(function* (
    this: RelayControl,
    hosting: boolean,
    label: string | null = null,
  ): Effect.fn.Return<void, RelaySocketError> {
    const trimmed = label?.trim() || null;
    if (trimmed !== null && trimmed.length > RELAY_LABEL_LIMIT) {
      return yield* new RelaySocketError({ code: "invalid_message", message: "The label is too long." });
    }
    this.#presence = { hosting, label: trimmed };
    this.#sendPresence();
  }).bind(this);

  state(): RelayControlState {
    return this.#state;
  }

  roster(): readonly RelayTeamMember[] {
    return this.#roster;
  }

  self(): RelayPeer | null {
    return this.#self;
  }

  team(): RelayTeam | null {
    return this.#team;
  }

  heartbeatRttMs(): number | null {
    return this.#heartbeat?.rttMs() ?? null;
  }

  resume(timeoutMs: number = RELAY_RESUME_CHECK_TIMEOUT_MS): void {
    if (!this.#fiber) return;
    const heartbeat = this.#heartbeat;
    if (heartbeat && this.#state.status === "online") {
      this.#info("relay resume check");
      this.#reconnectAtOnce = true;
      heartbeat.resume(timeoutMs);
      this.#data?.heartbeat?.resume(timeoutMs);
      this.#notifyWaiters();
      return;
    }
    if (this.#state.status === "offline") {
      this.#reconnectAtOnce = true;
      this.#wake?.();
    }
  }

  readonly openSession = Effect.fn("RelayControl.openSession")(function* (
    this: RelayControl,
    target: string,
    deadlineMs?: number,
  ): Effect.fn.Return<RelaySession, RelaySocketError> {
    const mux = yield* this.#onlineMux();
    const first = yield* Effect.result(this.#openOn(mux, target, deadlineMs));
    if (Result.isSuccess(first)) return first.success;
    if (mux.closedWith === null || !this.#fiber) return yield* first.failure;
    return yield* this.#openOn(yield* this.#onlineMux(), target, deadlineMs);
  }).bind(this);

  #openOn(mux: RelaySessionMux, target: string, deadlineMs: number | undefined) {
    return Effect.tryPromise({
      try: (signal) => mux.open(target, { signal, deadlineMs }),
      catch: desktopRelayError,
    });
  }

  #confirmedMux(): RelaySessionMux | null {
    const mux = this.#mux;
    if (!mux || this.#state.status !== "online") return null;
    const heartbeat = this.#heartbeat;
    if (!heartbeat || heartbeat.confirmed()) return mux;
    heartbeat.ping(heartbeat.timeoutMs);
    return null;
  }

  #onlineMux(): Effect.Effect<RelaySessionMux, RelaySocketError> {
    return Effect.callback<RelaySessionMux, RelaySocketError>((resume) => {
      const check = () => {
        const mux = this.#confirmedMux();
        const state = this.#state;
        if (mux) {
          release();
          resume(Effect.succeed(mux));
        } else if (state.status === "offline" && (state.retryInMs === null || !this.#fiber)) {
          release();
          resume(
            Effect.fail(
              new RelaySocketError(
                state.code === "stopped"
                  ? { code: "closed", message: "The relay connection is not running." }
                  : { code: state.code, message: state.message },
              ),
            ),
          );
        }
      };
      const release = () => this.#waiters.delete(check);
      this.#waiters.add(check);
      check();
      return Effect.sync(release);
    }).pipe(
      Effect.timeoutOrElse({
        duration: (this.#socketOptions.connectDeadlineMs ?? 15_000) * 2,
        orElse: () =>
          Effect.fail(
            new RelaySocketError({ code: "deadline_exceeded", message: "The relay server did not answer in time." }),
          ),
      }),
    );
  }

  readonly #run = Effect.fn("RelayControl.run")(function* (this: RelayControl) {
    let failures = 0;
    for (;;) {
      this.#setState({ status: "connecting" });
      const presence = this.#presence;
      const opened = yield* Effect.uninterruptibleMask((restore) =>
        restore(openRelayControlSocket(this.#identity, presence, this.#socketOptions)).pipe(
          Effect.tap(({ socket }) =>
            Effect.sync(() => {
              this.#socket = socket;
            }),
          ),
          Effect.result,
        ),
      );
      let failure: RelaySocketError;
      let online = false;
      if (Result.isFailure(opened)) {
        failure = opened.failure;
        failures += 1;
        this.#warn(`relay connect failed (${failure.code})`);
      } else if (!opened.success.welcome.features.includes(RELAY_SESSIONS_FEATURE)) {
        opened.success.socket.close();
        this.#socket = null;
        failure = new RelaySocketError({ code: "protocol_error", message: "The relay server needs an update." });
        failures += 1;
      } else {
        const { socket, welcome, timing } = opened.success;
        online = true;
        this.#reconnectAtOnce = false;
        this.#logConnected(timing);
        const onlineAt = this.#now();
        this.#self = welcome.self;
        this.#team = welcome.team;
        this.#heartbeatsSupported = welcome.features.includes(RELAY_HEARTBEAT_FEATURE);
        const close = yield* this.#serve(socket, presence, welcome.members);
        failure = close.error;
        failures = this.#now() - onlineAt >= HEALTHY_AFTER_MS ? 0 : failures + 1;
        this.#warn(`relay control closed (${failure.code}) after ${this.#now() - onlineAt} ms`);
      }
      this.#setRoster([]);
      if (FINAL_CODES.has(failure.code)) {
        this.#setState({ status: "offline", code: failure.code, message: failure.message, retryInMs: null });
        return;
      }
      if (this.#reconnectAtOnce || (online && failure.code === "heartbeat_timeout")) failures = 0;
      this.#reconnectAtOnce = false;
      const retryInMs = failures === 0 ? 0 : this.#retryDelay(failures);
      this.#setState({ status: "offline", code: failure.code, message: failure.message, retryInMs });
      if (retryInMs > 0) yield* this.#sleep(retryInMs);
    }
  });

  #sleep(milliseconds: number): Effect.Effect<void> {
    return Effect.callback<void>((resume) => {
      const done = () => {
        clearTimeout(timer);
        if (this.#wake === done) this.#wake = null;
        resume(Effect.void);
      };
      const timer = setTimeout(done, milliseconds);
      this.#wake = done;
      return Effect.sync(() => {
        clearTimeout(timer);
        if (this.#wake === done) this.#wake = null;
      });
    });
  }

  #logConnected(timing: RelayConnectTiming): void {
    const open = timing.openedAt - timing.startedAt;
    const welcome = timing.welcomedAt - timing.openedAt;
    this.#info(
      `relay connected in ${open + welcome} ms (TCP+TLS+WebSocket open ${open} ms, challenge to welcome ${welcome} ms)`,
    );
  }

  #info(line: string): void {
    this.#logger?.info(line);
  }

  #warn(line: string): void {
    this.#logger?.warn(line);
  }

  #serve(
    socket: RelaySocket,
    presence: Presence,
    members: readonly RelayTeamMember[],
  ): Effect.Effect<RelaySocketClose> {
    return Effect.callback<RelaySocketClose>((resume) => {
      const mux: RelaySessionMux = new RelaySessionMux(
        {
          sendMessage: (message) => socket.sendMessage(message),
          dataReady: () => this.#data?.ready === true,
          sendFrame: (bytes) => this.#data?.socket.sendBinary(bytes, () => mux.drained()) ?? false,
          bufferedAmount: () => this.#data?.socket.bufferedAmount() ?? 0,
          wantData: () => this.#wantData(socket, mux),
        },
        this.#security(),
        this.#now,
      );
      mux.setIncoming((incoming) => {
        if (this.listenerCount("session") > 0) this.emit("session", incoming);
        else incoming.refuse("refused");
      });
      this.#mux = mux;
      this.#sentPresence = presence;
      this.#setRoster(members);
      this.#setState({ status: "online" });
      this.#sendPresence();
      socket.attach({
        message: (message) => {
          if (message.type === "pong") this.#heartbeat?.receive(message.id);
          else if (message.type === "members") this.#setRoster(message.members);
          else if (message.type === "data-ticket") this.#ticket(message.ticket, mux);
          else if (message.type === "data-wanted") this.#wantData(socket, mux);
          else if (!mux.receiveMessage(message)) {
            socket.fail("protocol_error", "The relay server sent a message that is not expected.");
          }
        },
        binary: () => socket.fail("protocol_error", "The relay server sent data on the control socket."),
        closed: (close) => {
          this.#release(socket, mux, close.error);
          resume(Effect.succeed(close));
        },
      });
      if (this.#heartbeatsSupported) this.#startHeartbeat(socket);
      return Effect.sync(() => {
        this.#release(socket, mux, new RelaySocketError({ code: "closed", message: "The relay connection stopped." }));
        socket.detach();
        socket.close();
      });
    });
  }

  #startHeartbeat(socket: RelaySocket): void {
    const heartbeat = new RelayHeartbeat(
      {
        ...this.#heartbeatTiming,
        now: this.#now,
        send: (message) => socket.sendMessage(message),
        dead: () => {
          this.#warn("relay heartbeat missed; closing the control socket");
          socket.fail("heartbeat_timeout", "The relay server stopped answering.");
        },
        answered: () => this.#heartbeatAnswered(heartbeat),
      },
      this.#now(),
    );
    this.#heartbeat = heartbeat;
    heartbeat.start();
    heartbeat.ping(heartbeat.timeoutMs);
    this.#rttTimer = setInterval(() => this.#reportRtt(heartbeat), RTT_REPORT_MS);
    this.#rttTimer.unref();
  }

  #heartbeatAnswered(heartbeat: RelayHeartbeat): void {
    if (this.#heartbeat !== heartbeat) return;
    this.#reconnectAtOnce = false;
    const state = this.#state;
    if (state.status === "online" && state.rttMs === undefined) this.#reportRtt(heartbeat);
    this.#notifyWaiters();
  }

  #reportRtt(heartbeat: RelayHeartbeat): void {
    const rttMs = heartbeat.rttMs();
    if (this.#heartbeat !== heartbeat || rttMs === null || this.#state.status !== "online") return;
    this.#info(`relay heartbeat rtt median ${rttMs} ms (${heartbeat.samples()} samples)`);
    if (this.#state.rttMs !== rttMs) this.#setState({ status: "online", rttMs });
  }

  #endHeartbeat(): void {
    this.#heartbeat?.stop();
    this.#heartbeat = null;
    if (this.#rttTimer !== null) clearInterval(this.#rttTimer);
    this.#rttTimer = null;
  }

  #security(): RelaySessionSecurity {
    const identity = this.#identity;
    return {
      crypto: webRelayCrypto,
      selfKeyId: identity.current()?.keyId ?? "",
      sign: async (transcript) => identity.signTunnelTranscript(transcript),
      peerKey: async (peer: RelayPeerCertificate): Promise<RelayPublicKey | string> => {
        const current = identity.current();
        if (!current) return "no_identity";
        const refusal = peerRefusal(peer, current, this.#now());
        if (refusal !== null) return refusal;
        const key = readCertificate(peer.certificate)?.publicKey.export({ type: "spki", format: "der" });
        return key ? { format: "spki", bytes: new Uint8Array(key) } : "unreadable";
      },
    };
  }

  #wantData(control: RelaySocket, mux: RelaySessionMux): void {
    if (this.#data || this.#socket !== control || this.#mux !== mux) return;
    const opened = Effect.runSyncExit(openRelayDataSocket(this.#identity, control.tlsSession));
    if (Exit.isFailure(opened)) return;
    const socket = opened.value;
    const link: RelayDataLink = {
      socket,
      requestedAt: this.#now(),
      ticket: null,
      ready: false,
      closing: false,
      heartbeat: null,
    };
    this.#data = link;
    control.sendMessage({ type: "data-ticket", version: RELAY_PROTOCOL_VERSION });
    socket.attach({
      message: (message) => {
        if (message.type === "pong") link.heartbeat?.receive(message.id);
        else if (message.type !== "challenge")
          socket.fail("protocol_error", "The relay server sent a message on the data socket.");
      },
      binary: (data) => {
        if (!mux.receiveFrame(data)) socket.fail("protocol_error", "The relay server sent a frame that is not valid.");
      },
      closed: (close) => this.#dataClosed(link, mux, close.error),
    });
    socket.whenOpen(() => this.#helloData(link, mux));
    this.#idleTimer ??= setInterval(() => this.#checkIdle(), Math.max(10, Math.min(this.#dataIdleMs / 4, 30_000)));
    this.#idleTimer.unref();
  }

  #ticket(ticket: string, mux: RelaySessionMux): void {
    const link = this.#data;
    if (!link || link.ticket !== null) return;
    link.ticket = ticket;
    this.#helloData(link, mux);
  }

  #helloData(link: RelayDataLink, mux: RelaySessionMux): void {
    if (this.#data !== link || link.ready || link.ticket === null || !link.socket.open) return;
    link.socket.sendMessage({ type: "data-hello", version: RELAY_PROTOCOL_VERSION, ticket: link.ticket });
    link.ready = true;
    this.#info(`relay data socket bound in ${this.#now() - link.requestedAt} ms`);
    if (this.#heartbeatsSupported) link.heartbeat = this.#dataHeartbeat(link.socket);
    mux.drained();
  }

  #dataHeartbeat(socket: RelaySocket): RelayHeartbeat {
    const heartbeat = new RelayHeartbeat(
      {
        ...this.#heartbeatTiming,
        now: this.#now,
        send: (message) => socket.sendMessage(message),
        dead: () => {
          this.#warn("relay data heartbeat missed; closing the data socket");
          socket.fail("heartbeat_timeout", "The relay data socket stopped answering.");
        },
      },
      this.#now(),
    );
    heartbeat.start();
    return heartbeat;
  }

  #dataClosed(link: RelayDataLink, mux: RelaySessionMux, error: RelaySocketError): void {
    link.heartbeat?.stop();
    if (this.#data !== link) return;
    this.#data = null;
    if (!link.closing) mux.failSessions(new SharedRelaySocketError({ code: error.code, message: error.message }));
  }

  #checkIdle(): void {
    const link = this.#data;
    const mux = this.#mux;
    if (!link) {
      if (this.#idleTimer !== null) clearInterval(this.#idleTimer);
      this.#idleTimer = null;
      return;
    }
    if (!link.ready || !mux || mux.idleFor() < this.#dataIdleMs) return;
    link.closing = true;
    link.heartbeat?.stop();
    this.#data = null;
    link.socket.close();
  }

  #closeData(): void {
    const link = this.#data;
    this.#data = null;
    if (this.#idleTimer !== null) clearInterval(this.#idleTimer);
    this.#idleTimer = null;
    if (!link) return;
    link.closing = true;
    link.heartbeat?.stop();
    link.socket.close();
  }

  #release(socket: RelaySocket, mux: RelaySessionMux, error: RelaySocketError): void {
    if (this.#socket === socket) this.#endHeartbeat();
    mux.closeAll(new SharedRelaySocketError({ code: error.code, message: error.message }));
    if (this.#mux === mux) {
      this.#mux = null;
      this.#closeData();
    }
    if (this.#socket !== socket) return;
    this.#socket = null;
    this.#sentPresence = null;
  }

  #sendPresence(): void {
    const socket = this.#socket;
    const sent = this.#sentPresence;
    const { hosting, label } = this.#presence;
    if (!socket || !sent || (sent.hosting === hosting && sent.label === label)) return;
    this.#sentPresence = { hosting, label };
    socket.sendMessage({
      type: "presence",
      version: RELAY_PROTOCOL_VERSION,
      hosting,
      ...(label === null ? {} : { label }),
    });
  }

  #retryDelay(failures: number): number {
    const exponential = Math.min(this.#maxMs, this.#baseMs * 2 ** Math.min(failures - 1, 20));
    const jitter = exponential * RECONNECT_JITTER * (Math.random() * 2 - 1);
    return Math.max(1, Math.round(exponential + jitter));
  }

  #setState(state: RelayControlState): void {
    this.#state = state;
    this.emit("state", state);
    this.#notifyWaiters();
  }

  #notifyWaiters(): void {
    for (const waiter of [...this.#waiters]) waiter();
  }

  #setRoster(members: readonly RelayTeamMember[]): void {
    if (members.length === 0 && this.#roster.length === 0) return;
    this.#roster = members;
    this.emit("roster", members);
  }
}
