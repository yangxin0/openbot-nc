import { RELAY_ACCEPT_DEADLINE_MS, type RelayPeerCertificate } from "@openbot/contracts/relay-protocol/messages";
import { Effect, Exit, Scope, Semaphore } from "effect";
import type { RelayIncoming } from "./control";
import type { RelayCredentialSource } from "./identity-store";
import { openRelayTunnelSocket, RelaySocketError } from "./socket";
import { type RelayStream, verifiedRelayStream } from "./stream";

const DEFAULT_CONCURRENT_ACCEPTS = 8;
const WAITING_ACCEPTS_LIMIT = 32;

interface RelayIncomingSource {
  on(event: "incoming", listener: (incoming: RelayIncoming) => void): unknown;
  off(event: "incoming", listener: (incoming: RelayIncoming) => void): unknown;
}

interface RelayAcceptorOptions {
  identity: RelayCredentialSource;
  control: RelayIncomingSource;
  onStream: (stream: RelayStream, peer: RelayPeerCertificate) => void;
  onRefused?: (error: RelaySocketError, incoming: RelayIncoming) => void;
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
    this.#options.control.on("incoming", this.#onIncoming);
  }).bind(this);

  readonly stop = Effect.fn("RelayAcceptor.stop")(function* (this: RelayAcceptor) {
    const scope = this.#scope;
    this.#scope = null;
    if (!scope) return;
    this.#options.control.off("incoming", this.#onIncoming);
    yield* Scope.close(scope, Exit.void);
  }).bind(this);

  readonly #onIncoming = (incoming: RelayIncoming): void => {
    const scope = this.#scope;
    if (!scope) return;
    if (this.#waiting >= WAITING_ACCEPTS_LIMIT) {
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
          Effect.onInterrupt(() => Effect.sync(leaveQueue)),
          Effect.catch((error) => Effect.sync(() => this.#options.onRefused?.(error, incoming))),
          Effect.forkIn(scope, { startImmediately: true }),
        ),
    );
  };

  readonly #accept = Effect.fn("RelayAcceptor.accept")(function* (
    this: RelayAcceptor,
    incoming: RelayIncoming,
  ): Effect.fn.Return<void, RelaySocketError> {
    const remainingMs = RELAY_ACCEPT_DEADLINE_MS - (this.#now() - incoming.receivedAt);
    if (remainingMs <= 0) {
      return yield* new RelaySocketError({ code: "deadline_exceeded", message: "The connection waited too long." });
    }
    yield* Effect.uninterruptibleMask((restore) =>
      restore(
        openRelayTunnelSocket(
          this.#options.identity,
          { role: "accept", connectionId: incoming.connectionId },
          { connectDeadlineMs: remainingMs },
        ),
      ).pipe(
        Effect.flatMap(({ socket, open }) =>
          restore(
            verifiedRelayStream({
              credentials: this.#options.identity,
              role: "host",
              socket,
              open,
              peerKeyId: incoming.from.keyId,
              connectionId: incoming.connectionId,
              now: this.#now(),
            }),
          ).pipe(
            Effect.flatMap((stream) =>
              Effect.try({
                try: () => this.#options.onStream(stream, open.peer),
                catch: () => {
                  stream.destroy();
                  return new RelaySocketError({ code: "closed", message: "The connection was not taken." });
                },
              }),
            ),
          ),
        ),
      ),
    );
  });
}
