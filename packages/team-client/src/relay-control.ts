import {
  RELAY_LABEL_LIMIT,
  type RelayPeer,
  type RelayTeam,
  type RelayTeamMember,
} from "@openbot/contracts/relay-protocol/messages";
import type { RelayBrowserIdentity } from "./relay-identity";
import {
  openRelayControlSocket,
  type RelayBrowserSocket,
  type RelaySocketClose,
  type RelaySocketError,
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
  reconnect?: { baseMs?: number; maxMs?: number };
  connectDeadlineMs?: number;
  now?: () => number;
}

interface RelayControlRun {
  readonly abort: AbortController;
}

export class RelayBrowserControl {
  readonly #identity: RelayBrowserIdentity;
  readonly #label: string | null;
  readonly #baseMs: number;
  readonly #maxMs: number;
  readonly #connectDeadlineMs: number | undefined;
  readonly #now: () => number;
  readonly #listeners = new Set<(snapshot: RelayControlSnapshot) => void>();
  #run: RelayControlRun | null = null;
  #socket: RelayBrowserSocket | null = null;
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
          { signal: run.abort.signal, now: this.#now, connectDeadlineMs: this.#connectDeadlineMs },
        );
        if (run.abort.signal.aborted) {
          socket.close();
          return;
        }
        const onlineAt = this.#now();
        this.#socket = socket;
        this.#update({ state: { status: "online" }, roster: welcome.members, self: welcome.self, team: welcome.team });
        failure = (await this.#serve(socket)).error;
        failures = this.#now() - onlineAt >= HEALTHY_AFTER_MS ? 1 : failures + 1;
      } catch (error) {
        failure = relaySocketError(error);
        failures += 1;
      }
      if (run.abort.signal.aborted) return;
      this.#socket = null;
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

  #serve(socket: RelayBrowserSocket): Promise<RelaySocketClose> {
    return new Promise((resolve) => {
      socket.attach({
        message: (message) => {
          if (message.type === "members") this.#update({ roster: message.members });
          else if (message.type !== "incoming") {
            socket.fail("protocol_error", "The relay server sent a message that is not expected.");
          }
        },
        binary: () => socket.fail("protocol_error", "The relay server sent data on the control socket."),
        closed: resolve,
      });
    });
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
