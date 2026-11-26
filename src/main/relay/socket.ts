import { randomBytes } from "node:crypto";
import { getCACertificates, TLSSocket } from "node:tls";
import { decodeRelayServerMessage } from "@openbot/contracts/relay-protocol/decode";
import {
  RELAY_CLOSE_CODES,
  RELAY_CONTROL_MESSAGE_BYTES_LIMIT,
  RELAY_ERROR_CODES,
  RELAY_HEARTBEAT_FEATURE,
  RELAY_PROTOCOL_VERSION,
  RELAY_SESSIONS_FEATURE,
  RELAY_SOCKET_MESSAGE_BYTES_LIMIT,
  type RelayClientMessage,
  type RelayServerMessage,
} from "@openbot/contracts/relay-protocol/messages";
import { RELAY_TUNNEL_CRYPTO_ERROR_CODES } from "@openbot/contracts/relay-protocol/tunnel-crypto";
import type { RelaySession } from "@openbot/team-client/relay-sessions";
import { Effect, Exit, Schema } from "effect";
import WebSocket from "ws";
import { rawDataBytes, rawDataSize, rawDataText } from "../ws-raw-data";
import type { RelayCredentialSource } from "./identity-store";
import { relayServerProofRefusal } from "./server-proof";

const RELAY_CONNECT_DEADLINE_MS = 15_000;

const RELAY_SOCKET_ERROR_CODES = [
  ...RELAY_ERROR_CODES,
  "identity_unavailable",
  "relay_url_missing",
  "insecure_relay_url",
  "connect_failed",
  "deadline_exceeded",
  "peer_refused",
  "server_refused",
  "closed",
  ...RELAY_TUNNEL_CRYPTO_ERROR_CODES,
] as const;
export type RelaySocketErrorCode = (typeof RELAY_SOCKET_ERROR_CODES)[number];

export class RelaySocketError extends Schema.TaggedError<RelaySocketError>()("RelaySocketError", {
  code: Schema.Literals(RELAY_SOCKET_ERROR_CODES),
  message: Schema.String,
}) {}

type RelayWelcome = Extract<RelayServerMessage, { type: "welcome" }>;

export interface RelayConnectTiming {
  startedAt: number;
  openedAt: number;
  welcomedAt: number;
}

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

export interface RelaySessionOpener {
  openSession(target: string): Effect.Effect<RelaySession, RelaySocketError>;
}

interface RelayPresence {
  hosting: boolean;
  label: string | null;
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
  #openedAt: number | null = null;
  #closed = false;

  #onOpen: (() => void) | null = null;
  #tlsSession: Buffer | null = null;

  constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.on("open", () => {
      this.#opened = true;
      this.#openedAt = Date.now();
      const listener = this.#onOpen;
      this.#onOpen = null;
      listener?.();
    });
    socket.on("upgrade", (response) => {
      const tlsSocket = response.socket;
      if (!(tlsSocket instanceof TLSSocket)) return;
      this.#tlsSession = tlsSocket.getSession() ?? null;
      tlsSocket.on("session", (session: Buffer) => {
        this.#tlsSession = session;
      });
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

  get tlsSession(): Buffer | null {
    return this.#tlsSession;
  }

  get openedAt(): number | null {
    return this.#openedAt;
  }

  get open(): boolean {
    return this.#opened && !this.#closed && this.#socket.readyState === WebSocket.OPEN;
  }

  whenOpen(listener: () => void): void {
    if (this.open) listener();
    else this.#onOpen = listener;
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

  sendBinary(data: Uint8Array, callback: (error?: Error) => void): boolean {
    if (this.#socket.readyState !== WebSocket.OPEN) return false;
    this.#socket.send(data, { binary: true }, callback);
    return true;
  }

  bufferedAmount(): number {
    return this.#socket.bufferedAmount;
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
    const clean = this.#failure === null && code === RELAY_CLOSE_CODES.normal;
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
  presence: RelayPresence,
  options: RelaySocketOptions = {},
): Effect.fn.Return<{ socket: RelaySocket; welcome: RelayWelcome; timing: RelayConnectTiming }, RelaySocketError> {
  const startedAt = Date.now();
  return yield* withSocket(identity, (socket) =>
    authenticate(socket, identity, presence).pipe(
      Effect.andThen(expectMessage(socket, isMessage("welcome"))),
      deadline(options.connectDeadlineMs ?? RELAY_CONNECT_DEADLINE_MS),
      Effect.map((welcome) => {
        const welcomedAt = Date.now();
        return { socket, welcome, timing: { startedAt, openedAt: socket.openedAt ?? welcomedAt, welcomedAt } };
      }),
    ),
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

export const openRelayDataSocket = Effect.fn("RelaySocket.openData")(function* (
  identity: RelayCredentialSource,
  tlsSession: Buffer | null,
): Effect.fn.Return<RelaySocket, RelaySocketError> {
  return yield* connect(identity, tlsSession);
});

const connect = Effect.fn("RelaySocket.connect")(function* (
  identity: RelayCredentialSource,
  tlsSession: Buffer | null = null,
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
          ...(secure ? { ...tls, ca: [...getCACertificates("default"), tls.ca] } : {}),
          ...(secure && tlsSession ? { session: tlsSession } : {}),
          perMessageDeflate: false,
          maxPayload: RELAY_SOCKET_MESSAGE_BYTES_LIMIT,
        }),
      ),
    catch: () => new RelaySocketError({ code: "connect_failed", message: "The relay socket cannot be opened." }),
  });
});

const authenticate = Effect.fn("RelaySocket.authenticate")(function* (
  socket: RelaySocket,
  identity: RelayCredentialSource,
  presence: RelayPresence,
): Effect.fn.Return<void, RelaySocketError> {
  const challenge = yield* expectMessage(socket, isMessage("challenge"));
  const current = identity.current();
  const clientNonce = randomBytes(32).toString("base64url");
  const proof = identity.signHello({ nonce: challenge.nonce, clientNonce, role: "member" });
  if (!current || current.relayUrl === null || !proof) {
    return yield* new RelaySocketError({ code: "identity_unavailable", message: "The relay identity cannot sign." });
  }
  socket.sendMessage({
    type: "hello",
    version: RELAY_PROTOCOL_VERSION,
    audience: proof.audience,
    clientNonce,
    certificate: current.certificate,
    chain: [...current.chain],
    signature: proof.signature,
    role: "member",
    hosting: presence.hosting,
    ...(presence.label === null ? {} : { label: presence.label }),
    features: [RELAY_SESSIONS_FEATURE, RELAY_HEARTBEAT_FEATURE],
  });
  const answer = yield* expectMessage(socket, isMessage("server-proof", "welcome"));
  const refusal =
    answer.type !== "server-proof"
      ? "missing"
      : relayServerProofRefusal({
          proof: answer,
          root: current.root,
          relayUrl: current.relayUrl,
          transcript: {
            serverNonce: challenge.nonce,
            clientNonce,
            audience: proof.audience,
            role: "member",
            clientKeyId: current.keyId,
          },
          now: Date.now(),
        });
  if (refusal !== null) {
    const message = `The relay server did not prove that it belongs to the team (${refusal}).`;
    socket.fail("server_refused", message);
    return yield* new RelaySocketError({ code: "server_refused", message });
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
