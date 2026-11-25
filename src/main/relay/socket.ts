import { decodeRelayServerMessage } from "@openbot/contracts/relay-protocol/decode";
import {
  RELAY_ACCEPT_DEADLINE_MS,
  RELAY_CLOSE_CODES,
  RELAY_CONTROL_MESSAGE_BYTES_LIMIT,
  RELAY_ERROR_CODES,
  RELAY_PROTOCOL_VERSION,
  RELAY_TUNNEL_MESSAGE_BYTES_LIMIT,
  type RelayClientMessage,
  type RelayProtocolVersion,
  type RelayServerMessage,
} from "@openbot/contracts/relay-protocol/messages";
import { Effect, Exit, Schema } from "effect";
import WebSocket from "ws";
import { rawDataBytes, rawDataSize, rawDataText } from "../ws-raw-data";
import type { RelayCredentialSource } from "./identity-store";

const RELAY_CONNECT_DEADLINE_MS = 15_000;

const RELAY_SOCKET_ERROR_CODES = [
  ...RELAY_ERROR_CODES,
  "identity_unavailable",
  "relay_url_missing",
  "insecure_relay_url",
  "connect_failed",
  "deadline_exceeded",
  "peer_refused",
  "closed",
] as const;
export type RelaySocketErrorCode = (typeof RELAY_SOCKET_ERROR_CODES)[number];

export class RelaySocketError extends Schema.TaggedError<RelaySocketError>()("RelaySocketError", {
  code: Schema.Literals(RELAY_SOCKET_ERROR_CODES),
  message: Schema.String,
}) {}

type RelayWelcome = Extract<RelayServerMessage, { type: "welcome" }>;
export type RelayOpen = Extract<RelayServerMessage, { type: "open" }>;

export interface RelaySocketOptions {
  connectDeadlineMs?: number | undefined;
}

export interface RelaySocketClose {
  clean: boolean;
  error: RelaySocketError;
}

interface RelaySocketHandlers {
  message: (message: RelayServerMessage) => void;
  binary: (data: Buffer) => void;
  closed: (close: RelaySocketClose) => void;
}

type RelayTunnelRequest =
  | { role: "client"; target: string; waitForTarget: boolean }
  | { role: "accept"; connectionId: string };

type RelayHello = { role: "member"; hosting: boolean; label: string | null } | RelayTunnelRequest;

interface HelloCredentials {
  version: RelayProtocolVersion;
  audience: string;
  certificate: string;
  chain: string[];
  signature: string;
}

type QueuedEvent =
  | { kind: "message"; message: RelayServerMessage }
  | { kind: "binary"; data: Buffer }
  | { kind: "closed"; close: RelaySocketClose };

export class RelaySocket {
  readonly #socket: WebSocket;
  readonly #queue: QueuedEvent[] = [];
  #handlers: RelaySocketHandlers | null = null;
  #failure: RelaySocketError | null = null;
  #opened = false;
  #closed = false;

  constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.on("open", () => {
      this.#opened = true;
    });
    socket.on("message", (data, isBinary) => this.#receive(data, isBinary));
    socket.on("error", (error) => {
      this.#failure ??= new RelaySocketError({
        code: this.#opened ? "closed" : "connect_failed",
        message: error.message,
      });
    });
    socket.on("close", (code, reason) => this.#finish(code, reason.toString("utf8")));
  }

  attach(handlers: RelaySocketHandlers): void {
    this.#handlers = handlers;
    this.#flush();
  }

  detach(): void {
    this.#handlers = null;
  }

  sendMessage(message: RelayClientMessage): void {
    if (this.#socket.readyState === WebSocket.OPEN) this.#socket.send(JSON.stringify(message));
  }

  sendBinary(data: Uint8Array, callback: (error?: Error) => void): void {
    if (this.#socket.readyState !== WebSocket.OPEN) {
      callback(this.#failure ?? new RelaySocketError({ code: "closed", message: "The relay socket is closed." }));
      return;
    }
    this.#socket.send(data, { binary: true }, callback);
  }

  pauseReading(): void {
    if (!this.#socket.isPaused) this.#socket.pause();
  }

  resumeReading(): void {
    if (this.#socket.isPaused) this.#socket.resume();
  }

  close(): void {
    if (this.#socket.readyState === WebSocket.OPEN) this.#socket.close(RELAY_CLOSE_CODES.normal);
    else this.terminate();
  }

  terminate(): void {
    if (this.#socket.readyState !== WebSocket.CLOSED) this.#socket.terminate();
  }

  fail(code: RelaySocketErrorCode, message: string): void {
    this.#failure ??= new RelaySocketError({ code, message });
    this.terminate();
  }

  #receive(data: WebSocket.RawData, isBinary: boolean): void {
    if (this.#failure) return;
    if (isBinary) {
      this.#dispatch({ kind: "binary", data: Buffer.isBuffer(data) ? data : Buffer.from(rawDataBytes(data)) });
      return;
    }
    const message = rawDataSize(data) > RELAY_CONTROL_MESSAGE_BYTES_LIMIT ? null : decodeText(rawDataText(data));
    if (!message) {
      this.fail("protocol_error", "The relay server sent a message that is not valid.");
      return;
    }
    if (message.type === "error") {
      this.#failure = new RelaySocketError({ code: message.code, message: message.message });
      this.close();
      return;
    }
    this.#dispatch({ kind: "message", message });
  }

  #finish(code: number, reason: string): void {
    if (this.#closed) return;
    this.#closed = true;
    const clean =
      this.#failure === null && (code === RELAY_CLOSE_CODES.normal || code === RELAY_CLOSE_CODES.peerClosed);
    const error =
      this.#failure ??
      new RelaySocketError({
        code: code === RELAY_CLOSE_CODES.replaced ? "replaced" : "closed",
        message: reason || `The relay socket closed with the code ${code}.`,
      });
    this.#dispatch({ kind: "closed", close: { clean, error } });
  }

  #dispatch(event: QueuedEvent): void {
    this.#queue.push(event);
    this.#flush();
  }

  #flush(): void {
    for (;;) {
      const handlers = this.#handlers;
      if (!handlers) return;
      const event = this.#queue.shift();
      if (!event) return;
      if (event.kind === "message") handlers.message(event.message);
      else if (event.kind === "binary") handlers.binary(event.data);
      else handlers.closed(event.close);
    }
  }
}

export const openRelayControlSocket = Effect.fn("RelaySocket.openControl")(function* (
  identity: RelayCredentialSource,
  presence: { hosting: boolean; label: string | null },
  options: RelaySocketOptions = {},
): Effect.fn.Return<{ socket: RelaySocket; welcome: RelayWelcome }, RelaySocketError> {
  return yield* withSocket(identity, (socket) =>
    authenticate(socket, identity, { role: "member", ...presence }).pipe(
      Effect.andThen(expectMessage(socket, isMessage("welcome"))),
      deadline(options.connectDeadlineMs ?? RELAY_CONNECT_DEADLINE_MS),
      Effect.map((welcome) => ({ socket, welcome })),
    ),
  );
});

export const openRelayTunnelSocket = Effect.fn("RelaySocket.openTunnel")(function* (
  identity: RelayCredentialSource,
  request: RelayTunnelRequest,
  options: RelaySocketOptions = {},
): Effect.fn.Return<{ socket: RelaySocket; open: RelayOpen }, RelaySocketError> {
  const connectDeadlineMs = options.connectDeadlineMs ?? RELAY_CONNECT_DEADLINE_MS;
  return yield* withSocket(identity, (socket) =>
    Effect.gen(function* () {
      const first = yield* authenticate(socket, identity, request).pipe(
        Effect.andThen(expectMessage(socket, isMessage("open", "waiting"))),
        deadline(request.role === "client" ? connectDeadlineMs + RELAY_ACCEPT_DEADLINE_MS : connectDeadlineMs),
      );
      if (first.type === "open") return { socket, open: first };
      if (request.role !== "client" || !request.waitForTarget) return yield* unexpectedMessage();
      return { socket, open: yield* expectMessage(socket, isMessage("open")) };
    }),
  );
});

function withSocket<A>(
  identity: RelayCredentialSource,
  use: (socket: RelaySocket) => Effect.Effect<A, RelaySocketError>,
): Effect.Effect<A, RelaySocketError> {
  return Effect.uninterruptibleMask((restore) =>
    connect(identity).pipe(
      Effect.flatMap((socket) =>
        restore(use(socket)).pipe(
          Effect.onExit((exit) => (Exit.isSuccess(exit) ? Effect.void : Effect.sync(() => socket.terminate()))),
        ),
      ),
    ),
  );
}

const connect = Effect.fn("RelaySocket.connect")(function* (
  identity: RelayCredentialSource,
): Effect.fn.Return<RelaySocket, RelaySocketError> {
  const current = identity.current();
  const tls = identity.tlsCredentials();
  if (!current || !tls) {
    return yield* new RelaySocketError({ code: "identity_unavailable", message: "No relay identity is imported." });
  }
  const { relayUrl } = current;
  if (relayUrl === null) {
    return yield* new RelaySocketError({
      code: "relay_url_missing",
      message: "The identity does not name a relay server.",
    });
  }
  const url = new URL(relayUrl);
  const secure = url.protocol === "wss:";
  if (!secure && !isLoopback(url.hostname)) {
    return yield* new RelaySocketError({
      code: "insecure_relay_url",
      message: "A relay server on a different computer must use TLS.",
    });
  }
  return yield* Effect.try({
    try: () =>
      new RelaySocket(
        new WebSocket(url, {
          ...(secure ? tls : {}),
          perMessageDeflate: false,
          maxPayload: RELAY_TUNNEL_MESSAGE_BYTES_LIMIT,
        }),
      ),
    catch: () => new RelaySocketError({ code: "connect_failed", message: "The relay socket cannot be opened." }),
  });
});

const authenticate = Effect.fn("RelaySocket.authenticate")(function* (
  socket: RelaySocket,
  identity: RelayCredentialSource,
  hello: RelayHello,
): Effect.fn.Return<void, RelaySocketError> {
  const challenge = yield* expectMessage(socket, isMessage("challenge"));
  const current = identity.current();
  const proof = identity.signHello({
    nonce: challenge.nonce,
    role: hello.role,
    target: hello.role === "client" ? hello.target : undefined,
    connectionId: hello.role === "accept" ? hello.connectionId : undefined,
  });
  if (!current || !proof) {
    return yield* new RelaySocketError({ code: "identity_unavailable", message: "The relay identity cannot sign." });
  }
  const credentials: HelloCredentials = {
    version: RELAY_PROTOCOL_VERSION,
    audience: proof.audience,
    certificate: current.certificate,
    chain: [...current.chain],
    signature: proof.signature,
  };
  if (hello.role === "member") {
    socket.sendMessage({
      type: "hello",
      ...credentials,
      role: "member",
      hosting: hello.hosting,
      ...(hello.label === null ? {} : { label: hello.label }),
    });
  } else if (hello.role === "client") {
    socket.sendMessage({
      type: "hello",
      ...credentials,
      role: "client",
      target: hello.target,
      waitForTarget: hello.waitForTarget,
    });
  } else {
    socket.sendMessage({ type: "hello", ...credentials, role: "accept", connectionId: hello.connectionId });
  }
});

function expectMessage<Message extends RelayServerMessage>(
  socket: RelaySocket,
  accepts: (message: RelayServerMessage) => message is Message,
): Effect.Effect<Message, RelaySocketError> {
  return Effect.callback<Message, RelaySocketError>((resume) => {
    socket.attach({
      message: (message) => {
        socket.detach();
        resume(accepts(message) ? Effect.succeed(message) : unexpectedMessage());
      },
      binary: () => {
        socket.detach();
        resume(unexpectedMessage());
      },
      closed: (close) => resume(Effect.fail(close.error)),
    });
    return Effect.sync(() => socket.detach());
  });
}

function isMessage<Type extends RelayServerMessage["type"]>(...types: Type[]) {
  return (message: RelayServerMessage): message is Extract<RelayServerMessage, { type: Type }> =>
    types.some((type) => type === message.type);
}

function unexpectedMessage(): Effect.Effect<never, RelaySocketError> {
  return Effect.fail(
    new RelaySocketError({ code: "protocol_error", message: "The relay server sent a message that is not expected." }),
  );
}

function deadline(milliseconds: number) {
  return <A>(operation: Effect.Effect<A, RelaySocketError>): Effect.Effect<A, RelaySocketError> =>
    operation.pipe(
      Effect.timeoutOrElse({
        duration: milliseconds,
        orElse: () =>
          Effect.fail(
            new RelaySocketError({ code: "deadline_exceeded", message: "The relay server did not answer in time." }),
          ),
      }),
    );
}

function decodeText(text: string): RelayServerMessage | null {
  try {
    return decodeRelayServerMessage(JSON.parse(text));
  } catch {
    return null;
  }
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}
