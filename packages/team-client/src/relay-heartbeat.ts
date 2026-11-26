import {
  RELAY_HEARTBEAT_INTERVAL_MS,
  RELAY_HEARTBEAT_TIMEOUT_MS,
  RELAY_PING_ID_MAX,
  RELAY_PROTOCOL_VERSION,
  type RelayClientMessage,
} from "@openbot/contracts/relay-protocol/messages";

const RTT_SAMPLES = 5;

export interface RelayHeartbeatTiming {
  intervalMs?: number;
  timeoutMs?: number;
}

export interface RelayHeartbeatOptions extends RelayHeartbeatTiming {
  now: () => number;
  send: (message: RelayClientMessage) => void;
  dead: () => void;
  answered?: () => void;
}

interface OutstandingPing {
  id: number;
  sentAt: number;
  deadlineAt: number;
  timer: ReturnType<typeof setTimeout>;
}

export class RelayHeartbeat {
  readonly intervalMs: number;
  readonly timeoutMs: number;
  readonly #now: () => number;
  readonly #send: (message: RelayClientMessage) => void;
  readonly #dead: () => void;
  readonly #answered: () => void;
  readonly #samples: number[] = [];
  #nextId = 1;
  #outstanding: OutstandingPing | null = null;
  #interval: ReturnType<typeof setInterval> | null = null;
  #lastAnswerAt: number | null;
  #running = false;
  #ended = false;

  constructor(options: RelayHeartbeatOptions, confirmedAt: number | null) {
    this.intervalMs = options.intervalMs ?? RELAY_HEARTBEAT_INTERVAL_MS;
    this.timeoutMs = options.timeoutMs ?? RELAY_HEARTBEAT_TIMEOUT_MS;
    this.#now = options.now;
    this.#send = options.send;
    this.#dead = options.dead;
    this.#answered = options.answered ?? (() => undefined);
    this.#lastAnswerAt = confirmedAt;
  }

  get running(): boolean {
    return this.#running;
  }

  get waiting(): boolean {
    return this.#outstanding !== null;
  }

  start(): void {
    if (this.#ended || this.#running) return;
    this.#running = true;
    this.#interval = setInterval(() => this.ping(this.timeoutMs), this.intervalMs);
  }

  pause(): void {
    this.#running = false;
    if (this.#interval !== null) clearInterval(this.#interval);
    this.#interval = null;
    this.#dropOutstanding();
  }

  resume(timeoutMs: number): void {
    if (this.#ended) return;
    this.#lastAnswerAt = null;
    this.start();
    this.ping(timeoutMs);
  }

  stop(): void {
    this.pause();
    this.#ended = true;
  }

  ping(timeoutMs: number): void {
    if (this.#ended) return;
    const now = this.#now();
    const outstanding = this.#outstanding;
    if (outstanding) {
      if (outstanding.deadlineAt <= now + timeoutMs) return;
      clearTimeout(outstanding.timer);
      outstanding.deadlineAt = now + timeoutMs;
      outstanding.timer = setTimeout(() => this.#expire(outstanding), timeoutMs);
      return;
    }
    const id = this.#nextId;
    this.#nextId = id >= RELAY_PING_ID_MAX ? 1 : id + 1;
    const ping: OutstandingPing = {
      id,
      sentAt: now,
      deadlineAt: now + timeoutMs,
      timer: setTimeout(() => this.#expire(ping), timeoutMs),
    };
    this.#outstanding = ping;
    this.#send({ type: "ping", version: RELAY_PROTOCOL_VERSION, id });
  }

  receive(id: number): void {
    const outstanding = this.#outstanding;
    if (!outstanding || outstanding.id !== id || this.#ended) return;
    const now = this.#now();
    clearTimeout(outstanding.timer);
    this.#outstanding = null;
    this.#samples.push(now - outstanding.sentAt);
    if (this.#samples.length > RTT_SAMPLES) this.#samples.shift();
    this.#lastAnswerAt = now;
    this.#answered();
  }

  confirmed(): boolean {
    const answeredAt = this.#lastAnswerAt;
    return !this.#ended && answeredAt !== null && this.#now() - answeredAt <= this.intervalMs;
  }

  rttMs(): number | null {
    if (this.#samples.length === 0) return null;
    const sorted = [...this.#samples].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 1 ? sorted[middle] : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
    return median === undefined ? null : Math.round(median);
  }

  samples(): number {
    return this.#samples.length;
  }

  #expire(ping: OutstandingPing): void {
    if (this.#outstanding !== ping || this.#ended) return;
    this.#outstanding = null;
    this.stop();
    this.#dead();
  }

  #dropOutstanding(): void {
    const outstanding = this.#outstanding;
    this.#outstanding = null;
    if (outstanding) clearTimeout(outstanding.timer);
  }
}
