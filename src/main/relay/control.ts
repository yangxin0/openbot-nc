import { EventEmitter } from "node:events";
import {
  RELAY_LABEL_LIMIT,
  RELAY_PROTOCOL_VERSION,
  type RelayPeer,
  type RelayPeerCertificate,
  type RelayTeam,
  type RelayTeamMember,
} from "@openbot/contracts/relay-protocol/messages";
import { Effect, Fiber, Result } from "effect";
import type { RelayCredentialSource } from "./identity-store";
import {
  openRelayControlSocket,
  type RelaySocket,
  type RelaySocketClose,
  RelaySocketError,
  type RelaySocketErrorCode,
  type RelaySocketOptions,
} from "./socket";

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

export interface RelayIncoming {
  connectionId: string;
  from: RelayPeerCertificate;
  receivedAt: number;
}

interface RelayControlEvents {
  state: [state: RelayControlState];
  roster: [members: readonly RelayTeamMember[]];
  incoming: [incoming: RelayIncoming];
}

interface RelayControlOptions {
  identity: RelayCredentialSource;
  hosting?: boolean;
  label?: string | null;
  reconnect?: { baseMs?: number; maxMs?: number };
  socket?: RelaySocketOptions;
  now?: () => number;
}

interface Presence {
  hosting: boolean;
  label: string | null;
}

export class RelayControl extends EventEmitter<RelayControlEvents> {
  readonly #identity: RelayCredentialSource;
  readonly #socketOptions: RelaySocketOptions;
  readonly #baseMs: number;
  readonly #maxMs: number;
  readonly #now: () => number;
  #presence: Presence;
  #sentPresence: Presence | null = null;
  #socket: RelaySocket | null = null;
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
      if (Result.isFailure(opened)) {
        failure = opened.failure;
        failures += 1;
      } else {
        const { socket, welcome } = opened.success;
        const onlineAt = this.#now();
        this.#self = welcome.self;
        this.#team = welcome.team;
        const close = yield* this.#serve(socket, presence, welcome.members);
        failure = close.error;
        failures = this.#now() - onlineAt >= HEALTHY_AFTER_MS ? 1 : failures + 1;
      }
      this.#setRoster([]);
      if (FINAL_CODES.has(failure.code)) {
        this.#setState({ status: "offline", code: failure.code, message: failure.message, retryInMs: null });
        return;
      }
      const retryInMs = this.#retryDelay(failures);
      this.#setState({ status: "offline", code: failure.code, message: failure.message, retryInMs });
      yield* Effect.sleep(retryInMs);
    }
  });

  #serve(
    socket: RelaySocket,
    presence: Presence,
    members: readonly RelayTeamMember[],
  ): Effect.Effect<RelaySocketClose> {
    return Effect.callback<RelaySocketClose>((resume) => {
      this.#sentPresence = presence;
      this.#setRoster(members);
      this.#setState({ status: "online" });
      this.#sendPresence();
      socket.attach({
        message: (message) => {
          if (message.type === "members") this.#setRoster(message.members);
          else if (message.type === "incoming") {
            this.emit("incoming", {
              connectionId: message.connectionId,
              from: message.from,
              receivedAt: this.#now(),
            });
          } else socket.fail("protocol_error", "The relay server sent a message that is not expected.");
        },
        binary: () => socket.fail("protocol_error", "The relay server sent data on the control socket."),
        closed: (close) => {
          this.#release(socket);
          resume(Effect.succeed(close));
        },
      });
      return Effect.sync(() => {
        this.#release(socket);
        socket.detach();
        socket.close();
      });
    });
  }

  #release(socket: RelaySocket): void {
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
  }

  #setRoster(members: readonly RelayTeamMember[]): void {
    if (members.length === 0 && this.#roster.length === 0) return;
    this.#roster = members;
    this.emit("roster", members);
  }
}
