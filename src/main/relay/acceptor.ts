import { RELAY_ACCEPT_DEADLINE_MS, type RelayPeerCertificate } from "@openbot/contracts/relay-protocol/messages";
import type { RelayIncomingSession } from "@openbot/team-client/relay-sessions";
import { Effect, Exit, Scope, Semaphore } from "effect";
import { RelaySocketError } from "./socket";
import { desktopRelayError, RelayStream } from "./stream";

const DEFAULT_CONCURRENT_ACCEPTS = 8;
const WAITING_ACCEPTS_LIMIT = 32;

interface RelaySessionEvents {
  on(event: "session", listener: (incoming: RelayIncomingSession) => void): unknown;
  off(event: "session", listener: (incoming: RelayIncomingSession) => void): unknown;
}

interface RelayAcceptorOptions {
  control: RelaySessionEvents;
  onStream: (stream: RelayStream, peer: RelayPeerCertificate) => void;
  onRefused?: (error: RelaySocketError, incoming: RelayIncomingSession) => void;
  maxConcurrent?: number;
  now?: () => number;
}

export class RelayAcceptor {
  readonly #options: RelayAcceptorOptions;
  readonly #permits: Semaphore.Semaphore;
  readonly #now: () => number;
  #scope: Scope.Closeable | null = null;
  #waiting = 0;

  constructor(options: RelayAcceptorOptions) {
    this.#options = options;
    this.#permits = Semaphore.makeUnsafe(options.maxConcurrent ?? DEFAULT_CONCURRENT_ACCEPTS);
    this.#now = options.now ?? Date.now;
  }

  readonly start = Effect.fn("RelayAcceptor.start")(function* (this: RelayAcceptor) {
    if (this.#scope) return;
    this.#scope = yield* Scope.make();
    this.#options.control.on("session", this.#onIncoming);
  }).bind(this);

  readonly stop = Effect.fn("RelayAcceptor.stop")(function* (this: RelayAcceptor) {
    const scope = this.#scope;
    this.#scope = null;
    if (!scope) return;
    this.#options.control.off("session", this.#onIncoming);
    yield* Scope.close(scope, Exit.void);
  }).bind(this);

  readonly #onIncoming = (incoming: RelayIncomingSession): void => {
    const scope = this.#scope;
    if (!scope) {
      incoming.refuse("refused");
      return;
    }
    if (this.#waiting >= WAITING_ACCEPTS_LIMIT) {
      incoming.refuse("rate_limited");
      this.#options.onRefused?.(
        new RelaySocketError({ code: "rate_limited", message: "Too many connections wait for this computer." }),
        incoming,
      );
      return;
    }
    this.#waiting += 1;
    let waits = true;
    const leaveQueue = () => {
      if (waits) this.#waiting -= 1;
      waits = false;
    };
    Effect.runFork(
      this.#permits
        .withPermit(
          Effect.suspend(() => {
            leaveQueue();
            return this.#accept(incoming);
          }),
        )
        .pipe(
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              leaveQueue();
              incoming.refuse("refused");
            }),
          ),
          Effect.catch((error) => Effect.sync(() => this.#options.onRefused?.(error, incoming))),
          Effect.forkIn(scope, { startImmediately: true }),
        ),
    );
  };

  readonly #accept = Effect.fn("RelayAcceptor.accept")(function* (
    this: RelayAcceptor,
    incoming: RelayIncomingSession,
  ): Effect.fn.Return<void, RelaySocketError> {
    if (RELAY_ACCEPT_DEADLINE_MS - (this.#now() - incoming.receivedAt) <= 0) {
      incoming.refuse("refused");
      return yield* new RelaySocketError({ code: "deadline_exceeded", message: "The connection waited too long." });
    }
    const session = yield* Effect.tryPromise({ try: () => incoming.accept(), catch: desktopRelayError });
    const stream = new RelayStream();
    stream.connect(session);
    yield* Effect.try({
      try: () => this.#options.onStream(stream, session.peer),
      catch: () => {
        stream.destroy();
        return new RelaySocketError({ code: "closed", message: "The connection was not taken." });
      },
    });
  });
}
