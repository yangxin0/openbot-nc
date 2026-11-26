import { RELAY_KEY_ID_PATTERN } from "@openbot/contracts/relay-protocol/messages";
import type { RelaySession } from "@openbot/team-client/relay-sessions";
import { Effect, Fiber } from "effect";
import { type RelaySessionOpener, RelaySocketError } from "./socket";
import { RelayStream } from "./stream";

interface RelayDialerOptions {
  control: RelaySessionOpener;
}

export class RelayDialer {
  readonly #control: RelaySessionOpener;

  constructor(options: RelayDialerOptions) {
    this.#control = options.control;
  }

  readonly dial = Effect.fn("RelayDialer.dial")(function* (
    this: RelayDialer,
    target: string,
  ): Effect.fn.Return<RelayStream, RelaySocketError> {
    const stream = new RelayStream();
    stream.connect(yield* this.#open(target));
    return stream;
  }).bind(this);

  connect(target: string): RelayStream {
    const stream = new RelayStream();
    const dialing = Effect.runFork(
      this.#open(target).pipe(
        Effect.match({
          onFailure: (error) => {
            setImmediate(() => stream.destroy(error));
          },
          onSuccess: (session) => stream.connect(session),
        }),
      ),
    );
    stream.once("close", () => {
      Effect.runFork(Fiber.interrupt(dialing));
    });
    return stream;
  }

  #open(target: string): Effect.Effect<RelaySession, RelaySocketError> {
    if (!RELAY_KEY_ID_PATTERN.test(target)) {
      return Effect.fail(
        new RelaySocketError({ code: "invalid_message", message: "The target is not a key identifier." }),
      );
    }
    return this.#control.openSession(target);
  }
}
