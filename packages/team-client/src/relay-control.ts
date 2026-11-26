import {
  RELAY_DATA_IDLE_MS,
  RELAY_LABEL_LIMIT,
  RELAY_PROTOCOL_VERSION,
  RELAY_SESSIONS_FEATURE,
  type RelayPeer,
  type RelayPeerCertificate,
  type RelayTeam,
  type RelayTeamMember,
} from "@openbot/contracts/relay-protocol/messages";
import type { RelayPublicKey } from "@openbot/contracts/relay-protocol/tunnel-crypto";
import { readRelayCertificate, relayPeerCertificateRefusal } from "./relay-certificates";
import { type RelayCrypto, webRelayCrypto } from "./relay-crypto";
import type { RelayBrowserIdentity } from "./relay-identity";
import {
  type RelaySession,
  RelaySessionMux,
  type RelaySessionOpenOptions,
  type RelaySessionSecurity,
  type RelaySessionSource,
} from "./relay-sessions";
import {
  openRelayControlSocket,
  openRelayDataSocket,
  RELAY_CONNECT_DEADLINE_MS,
  type RelayBrowserSocket,
  type RelaySocketClose,
  RelaySocketError,
  type RelaySocketErrorCode,
  relaySocketError,
} from "./relay-socket";

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;
const RECONNECT_JITTER = 0.2;
const HEALTHY_AFTER_MS = 30_000;

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
  | { status: "online" }
  | { status: "offline"; code: RelaySocketErrorCode | "stopped"; message: string; retryInMs: number | null };

export interface RelayControlSnapshot {
  state: RelayControlState;
  roster: readonly RelayTeamMember[];
  self: RelayPeer | null;
  team: RelayTeam | null;
}

export interface RelayControlOptions {
  label?: string | null;
  dataIdleMs?: number;
  reconnect?: { baseMs?: number; maxMs?: number };
  connectDeadlineMs?: number;
  now?: () => number;
  crypto?: RelayCrypto;
}

interface RelayControlRun {
  readonly abort: AbortController;
}

interface RelayDataLink {
  readonly socket: RelayBrowserSocket;
  ticket: string | null;
  ready: boolean;
  closing: boolean;
}

export class RelayBrowserControl implements RelaySessionSource {
  readonly #identity: RelayBrowserIdentity;
  readonly #label: string | null;
  readonly #baseMs: number;
  readonly #maxMs: number;
  readonly #connectDeadlineMs: number | undefined;
  readonly #now: () => number;
  readonly #crypto: RelayCrypto | undefined;
  readonly #listeners = new Set<(snapshot: RelayControlSnapshot) => void>();
  #run: RelayControlRun | null = null;
  #socket: RelayBrowserSocket | null = null;
  #mux: RelaySessionMux | null = null;
  #data: RelayDataLink | null = null;
  #idleTimer: ReturnType<typeof setInterval> | null = null;
  readonly #dataIdleMs: number;
  #snapshot: RelayControlSnapshot = {
    state: { status: "offline", code: "stopped", message: "Not started.", retryInMs: null },
    roster: [],
    self: null,
    team: null,
  };

  constructor(identity: RelayBrowserIdentity, options: RelayControlOptions = {}) {
    const label = options.label?.trim() || null;
    this.#identity = identity;
    this.#label = label !== null && label.length <= RELAY_LABEL_LIMIT ? label : null;
    this.#baseMs = options.reconnect?.baseMs ?? RECONNECT_BASE_MS;
    this.#maxMs = options.reconnect?.maxMs ?? RECONNECT_MAX_MS;
    this.#connectDeadlineMs = options.connectDeadlineMs;
    this.#now = options.now ?? Date.now;
    this.#crypto = options.crypto;
    this.#dataIdleMs = options.dataIdleMs ?? RELAY_DATA_IDLE_MS;
  }

  start(): void {
    if (this.#run) return;
    const run: RelayControlRun = { abort: new AbortController() };
    this.#run = run;
    void this.#loop(run).finally(() => {
      if (this.#run === run) this.#run = null;
    });
  }

  stop(): void {
    const run = this.#run;
    this.#run = null;
    if (!run) return;
    run.abort.abort();
    this.#mux?.closeAll(new RelaySocketError({ code: "closed", message: "The relay connection was stopped." }));
    this.#mux = null;
    this.#closeData();
    this.#socket?.close();
    this.#socket = null;
    this.#update({
      state: { status: "offline", code: "stopped", message: "Stopped.", retryInMs: null },
      roster: [],
    });
  }

  snapshot(): RelayControlSnapshot {
    return this.#snapshot;
  }

  hosts(): RelayTeamMember[] {
    const selfKeyId = this.#snapshot.self?.keyId ?? this.#identity.keyId;
    return this.#snapshot.roster.filter((member) => member.hosting && member.keyId !== selfKeyId);
  }

  async openSession(target: string, options: RelaySessionOpenOptions = {}): Promise<RelaySession> {
    const mux = await this.#onlineMux(options.signal);
    return mux.open(target, options);
  }

  #onlineMux(signal: AbortSignal | undefined): Promise<RelaySessionMux> {
    const ready = this.#mux;
    if (ready && this.#snapshot.state.status === "online") return Promise.resolve(ready);
    return new Promise<RelaySessionMux>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (result: RelaySessionMux | RelaySocketError) => {
        clearTimeout(timer);
        this.#listeners.delete(check);
        signal?.removeEventListener("abort", onAbort);
        if (result instanceof RelaySocketError) reject(result);
        else resolve(result);
      };
      const onAbort = () =>
        finish(new RelaySocketError({ code: "closed", message: "The relay connection was stopped." }));
      const check = () => {
        const mux = this.#mux;
        const { state } = this.#snapshot;
        if (mux && state.status === "online") finish(mux);
        else if (state.status === "offline" && (state.retryInMs === null || !this.#run)) {
          finish(
            new RelaySocketError(
              state.code === "stopped"
                ? { code: "closed", message: "The relay connection is not running." }
                : { code: state.code, message: state.message },
            ),
          );
        }
      };
      timer = setTimeout(
        () =>
          finish(
            new RelaySocketError({ code: "deadline_exceeded", message: "The relay server did not answer in time." }),
          ),
        (this.#connectDeadlineMs ?? RELAY_CONNECT_DEADLINE_MS) + RELAY_CONNECT_DEADLINE_MS,
      );
      this.#listeners.add(check);
      if (signal?.aborted) onAbort();
      else signal?.addEventListener("abort", onAbort, { once: true });
      check();
    });
  }

  subscribe(listener: (snapshot: RelayControlSnapshot) => void): () => void {
    this.#listeners.add(listener);
    listener(this.#snapshot);
    return () => this.#listeners.delete(listener);
  }

  async #loop(run: RelayControlRun): Promise<void> {
    let failures = 0;
    while (!run.abort.signal.aborted) {
      this.#update({ state: { status: "connecting" } });
      let failure: RelaySocketError;
      try {
        const { socket, welcome } = await openRelayControlSocket(
          this.#identity,
          { hosting: false, label: this.#label },
          {
            signal: run.abort.signal,
            now: this.#now,
            connectDeadlineMs: this.#connectDeadlineMs,
            ...(this.#crypto ? { crypto: this.#crypto } : {}),
          },
        );
        if (run.abort.signal.aborted) {
          socket.close();
          return;
        }
        if (!welcome.features.includes(RELAY_SESSIONS_FEATURE)) {
          socket.close();
          throw new RelaySocketError({ code: "protocol_error", message: "The relay server needs an update." });
        }
        const onlineAt = this.#now();
        const mux = new RelaySessionMux(this.#wire(socket), this.#security(), this.#now);
        this.#socket = socket;
        this.#mux = mux;
        this.#update({ state: { status: "online" }, roster: welcome.members, self: welcome.self, team: welcome.team });
        const close = await this.#serve(socket, mux);
        if (this.#mux === mux) this.#mux = null;
        mux.closeAll(close.error);
        this.#closeData();
        failure = close.error;
        failures = this.#now() - onlineAt >= HEALTHY_AFTER_MS ? 1 : failures + 1;
      } catch (error) {
        failure = relaySocketError(error);
        failures += 1;
      }
      if (run.abort.signal.aborted) return;
      this.#socket = null;
      this.#mux = null;
      if (FINAL_CODES.has(failure.code)) {
        this.#update({
          state: { status: "offline", code: failure.code, message: failure.message, retryInMs: null },
          roster: [],
        });
        return;
      }
      const retryInMs = this.#retryDelay(failures);
      this.#update({
        state: { status: "offline", code: failure.code, message: failure.message, retryInMs },
        roster: [],
      });
      await sleep(retryInMs, run.abort.signal);
    }
  }

  #serve(socket: RelayBrowserSocket, mux: RelaySessionMux): Promise<RelaySocketClose> {
    return new Promise((resolve) => {
      socket.attach({
        message: (message) => {
          if (message.type === "members") this.#update({ roster: message.members });
          else if (message.type === "data-ticket") this.#ticket(message.ticket);
          else if (message.type === "data-wanted") this.#wantData(socket);
          else if (!mux.receiveMessage(message)) {
            socket.fail("protocol_error", "The relay server sent a message that is not expected.");
          }
        },
        binary: () => socket.fail("protocol_error", "The relay server sent data on the control socket."),
        closed: resolve,
      });
    });
  }

  #wire(socket: RelayBrowserSocket) {
    return {
      sendMessage: socket.sendMessage.bind(socket),
      dataReady: () => this.#data?.ready === true,
      sendFrame: (bytes: Uint8Array<ArrayBuffer>) => this.#data?.socket.sendBinary(bytes) ?? false,
      bufferedAmount: () => this.#data?.socket.bufferedAmount ?? 0,
      wantData: () => this.#wantData(socket),
    };
  }

  #wantData(control: RelayBrowserSocket): void {
    if (this.#data || this.#socket !== control || !control.open) return;
    let socket: RelayBrowserSocket;
    try {
      socket = openRelayDataSocket(this.#identity);
    } catch {
      return;
    }
    const link: RelayDataLink = { socket, ticket: null, ready: false, closing: false };
    this.#data = link;
    control.sendMessage({ type: "data-ticket", version: RELAY_PROTOCOL_VERSION });
    socket.attach({
      message: (message) => {
        if (message.type !== "challenge")
          socket.fail("protocol_error", "The relay server sent a message on the data socket.");
      },
      binary: (data) => {
        if (!this.#mux?.receiveFrame(data))
          socket.fail("protocol_error", "The relay server sent a frame that is not valid.");
      },
      closed: (close) => this.#dataClosed(link, close.error),
    });
    socket.whenOpen(() => this.#helloData(link));
    this.#idleTimer ??= setInterval(() => this.#checkIdle(), Math.max(10, Math.min(this.#dataIdleMs / 4, 30_000)));
  }

  #ticket(ticket: string): void {
    const link = this.#data;
    if (!link || link.ticket !== null) return;
    link.ticket = ticket;
    this.#helloData(link);
  }

  #helloData(link: RelayDataLink): void {
    if (this.#data !== link || link.ready || link.ticket === null || !link.socket.open) return;
    link.socket.sendMessage({ type: "data-hello", version: RELAY_PROTOCOL_VERSION, ticket: link.ticket });
    link.ready = true;
    this.#mux?.drained();
  }

  #dataClosed(link: RelayDataLink, error: RelaySocketError): void {
    if (this.#data !== link) return;
    this.#data = null;
    if (!link.closing) this.#mux?.failSessions(error);
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
    link.socket.close();
  }

  #security(): RelaySessionSecurity {
    const identity = this.#identity;
    const crypto = this.#crypto ?? webRelayCrypto;
    const now = this.#now;
    return {
      crypto,
      selfKeyId: identity.keyId,
      sign: (transcript) => crypto.sign(identity.privateKey, transcript),
      peerKey: async (peer: RelayPeerCertificate): Promise<RelayPublicKey | string> => {
        const refusal = await relayPeerCertificateRefusal(peer, identity, now(), crypto);
        if (refusal !== null) return refusal;
        const certificate = await readRelayCertificate(peer.certificate, crypto);
        return certificate ? { format: "spki", bytes: certificate.spki } : "unreadable";
      },
    };
  }

  #retryDelay(failures: number): number {
    const exponential = Math.min(this.#maxMs, this.#baseMs * 2 ** Math.min(failures - 1, 20));
    const jitter = exponential * RECONNECT_JITTER * (Math.random() * 2 - 1);
    return Math.max(1, Math.round(exponential + jitter));
  }

  #update(change: Partial<RelayControlSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...change };
    for (const listener of [...this.#listeners]) listener(this.#snapshot);
  }
}

function sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, milliseconds);
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}
