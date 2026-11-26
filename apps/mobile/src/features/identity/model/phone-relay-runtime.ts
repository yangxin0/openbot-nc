import {
  RELAY_HUB_RESUME_ANSWER_MS,
  type RelayBrowserControl,
  type RelayControlSnapshot,
  RelaySocketError,
  type RelaySocketErrorCode,
} from "@openbot/team-client/relay-client";
import {
  type PhoneRelay,
  type PhoneRelayControlOptions,
  type PhoneRelayKeys,
  relayEndsIdentity,
  relayFinalCode,
  startPhoneRelayControl,
} from "./phone-relay";

const CONTROL_WAIT_MS = 15_000;

const STOPPED: RelayControlSnapshot = {
  state: { status: "offline", code: "stopped", message: "Not started.", retryInMs: null },
  roster: [],
  self: null,
  team: null,
};

export class PhoneRelayRuntime implements PhoneRelay {
  readonly identity: PhoneRelay["identity"];
  readonly crypto: PhoneRelay["crypto"];
  readonly #onEnded: (code: RelaySocketErrorCode) => void;
  readonly #options: PhoneRelayControlOptions;
  readonly #listeners = new Set<() => void>();
  readonly #started = new Set<(control: RelayBrowserControl) => void>();
  #control: RelayBrowserControl | null = null;
  #unsubscribe: (() => void) | null = null;
  #snapshot: RelayControlSnapshot = STOPPED;
  #paused = false;

  constructor(
    relay: PhoneRelayKeys,
    onEnded: (code: RelaySocketErrorCode) => void,
    reconnect?: { baseMs?: number; maxMs?: number },
    options: Omit<PhoneRelayControlOptions, "reconnect"> = {},
  ) {
    this.identity = relay.identity;
    this.crypto = relay.crypto;
    this.#onEnded = onEnded;
    this.#options = reconnect ? { ...options, reconnect } : options;
  }

  get running(): boolean {
    return this.#control !== null;
  }

  start(): void {
    if (this.#control) return;
    this.#paused = false;
    const control = startPhoneRelayControl(this, this.#options);
    this.#control = control;
    this.#unsubscribe = control.subscribe((snapshot) => {
      if (this.#control !== control) return;
      this.#publish(snapshot);
      const code = relayFinalCode(snapshot);
      if (code !== null && relayEndsIdentity(snapshot)) this.#onEnded(code);
    });
    for (const resolve of [...this.#started]) resolve(control);
  }

  resume(): void {
    if (!this.#paused) return;
    this.#paused = false;
    this.#control?.resume(RELAY_HUB_RESUME_ANSWER_MS);
  }

  pause(): void {
    if (!this.#control) return;
    this.#paused = true;
    this.#control.suspend();
  }

  async hub(signal: AbortSignal): Promise<RelayBrowserControl> {
    return this.#control ?? (await this.#nextControl(signal));
  }

  #nextControl(signal: AbortSignal | undefined): Promise<RelayBrowserControl> {
    return new Promise<RelayBrowserControl>((resolve, reject) => {
      const finish = (result: RelayBrowserControl | RelaySocketError) => {
        clearTimeout(timer);
        this.#started.delete(onStart);
        signal?.removeEventListener("abort", onAbort);
        if (result instanceof RelaySocketError) reject(result);
        else resolve(result);
      };
      const onStart = (control: RelayBrowserControl) => finish(control);
      const onAbort = () => finish(new RelaySocketError({ code: "closed", message: "The relay session was stopped." }));
      const timer = setTimeout(
        () => finish(new RelaySocketError({ code: "closed", message: "The relay connection is not running." })),
        CONTROL_WAIT_MS,
      );
      this.#started.add(onStart);
      if (signal?.aborted) onAbort();
      else signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  stop(): void {
    const control = this.#control;
    if (!control) return;
    this.#control = null;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    control.stop();
    this.#publish({ ...control.snapshot(), roster: [] });
  }

  readonly snapshot = (): RelayControlSnapshot => this.#snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  #publish(snapshot: RelayControlSnapshot): void {
    this.#snapshot = snapshot;
    for (const listener of [...this.#listeners]) listener();
  }
}
