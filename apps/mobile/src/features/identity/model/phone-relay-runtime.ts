import type {
  RelayBrowserControl,
  RelayControlSnapshot,
  RelaySocketErrorCode,
} from "@openbot/team-client/relay-client";
import { type PhoneRelay, relayEndsIdentity, relayFinalCode, startPhoneRelayControl } from "./phone-relay";

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
  readonly #reconnect: { baseMs?: number; maxMs?: number } | undefined;
  readonly #listeners = new Set<() => void>();
  #control: RelayBrowserControl | null = null;
  #unsubscribe: (() => void) | null = null;
  #snapshot: RelayControlSnapshot = STOPPED;

  constructor(
    relay: PhoneRelay,
    onEnded: (code: RelaySocketErrorCode) => void,
    reconnect?: { baseMs?: number; maxMs?: number },
  ) {
    this.identity = relay.identity;
    this.crypto = relay.crypto;
    this.#onEnded = onEnded;
    this.#reconnect = reconnect;
  }

  get running(): boolean {
    return this.#control !== null;
  }

  start(): void {
    if (this.#control) return;
    const control = startPhoneRelayControl(this, this.#reconnect ? { reconnect: this.#reconnect } : {});
    this.#control = control;
    this.#unsubscribe = control.subscribe((snapshot) => {
      if (this.#control !== control) return;
      this.#publish(snapshot);
      const code = relayFinalCode(snapshot);
      if (code !== null && relayEndsIdentity(snapshot)) this.#onEnded(code);
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
