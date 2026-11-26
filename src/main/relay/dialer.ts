import { RELAY_KEY_ID_PATTERN } from "@openbot/contracts/relay-protocol/messages";
import { Effect, Fiber } from "effect";
import type { RelayCredentialSource } from "./identity-store";
import { openRelayTunnelSocket, RelaySocketError, type RelaySocketOptions } from "./socket";
import { RelayStream, verifiedRelayStream } from "./stream";

interface RelayDialerOptions {
  identity: RelayCredentialSource;
  socket?: RelaySocketOptions;
  now?: () => number;
}

export class RelayDialer {
  readonly #identity: RelayCredentialSource;
  readonly #socketOptions: RelaySocketOptions;
  readonly #now: () => number;

  constructor(options: RelayDialerOptions) {
    this.#identity = options.identity;
    this.#socketOptions = options.socket ?? {};
    this.#now = options.now ?? Date.now;
  }

  readonly dial = Effect.fn("RelayDialer.dial")(function* (
    this: RelayDialer,
    target: string,
    options: { waitForTarget?: boolean } = {},
  ): Effect.fn.Return<RelayStream, RelaySocketError> {
    return yield* this.#open(target, options.waitForTarget ?? false, new RelayStream());
  }).bind(this);

  connect(target: string): RelayStream {
    const stream = new RelayStream();
    const dialing = Effect.runFork(
      this.#open(target, false, stream).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            setImmediate(() => stream.destroy(error));
          }),
        ),
      ),
    );
    stream.once("close", () => {
      Effect.runFork(Fiber.interrupt(dialing));
    });
    return stream;
  }

  readonly #open = Effect.fn("RelayDialer.open")(function* (
    this: RelayDialer,
    target: string,
    waitForTarget: boolean,
    stream: RelayStream,
  ): Effect.fn.Return<RelayStream, RelaySocketError> {
    if (!RELAY_KEY_ID_PATTERN.test(target)) {
      return yield* new RelaySocketError({ code: "invalid_message", message: "The target is not a key identifier." });
    }
    return yield* Effect.uninterruptibleMask((restore) =>
      restore(
        openRelayTunnelSocket(this.#identity, { role: "client", target, waitForTarget }, this.#socketOptions),
      ).pipe(
        Effect.flatMap(({ socket, open }) =>
          restore(
            verifiedRelayStream({
              credentials: this.#identity,
              role: "client",
              socket,
              open,
              peerKeyId: target,
              connectionId: null,
              now: this.#now(),
              stream,
            }),
          ),
        ),
      ),
    );
  });
}
