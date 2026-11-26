import { decodeRelayServerMessage } from "@openbot/contracts/relay-protocol/decode";
import {
  RELAY_CLOSE_CODES,
  RELAY_CONTROL_MESSAGE_BYTES_LIMIT,
  RELAY_ERROR_CODES,
  RELAY_HEARTBEAT_FEATURE,
  RELAY_PROTOCOL_VERSION,
  RELAY_SESSIONS_FEATURE,
  type RelayClientMessage,
  type RelayServerMessage,
  relayAudience,
  relayHelloTranscript,
} from "@openbot/contracts/relay-protocol/messages";
import { RELAY_TUNNEL_CRYPTO_ERROR_CODES } from "@openbot/contracts/relay-protocol/tunnel-crypto";
import { Schema } from "effect";
import { bytesToBase64Url } from "./base64";
import { relayServerProofRefusal } from "./relay-certificates";
import { type RelayCrypto, webRelayCrypto } from "./relay-crypto";
import type { RelayBrowserIdentity } from "./relay-identity";

export const RELAY_CONNECT_DEADLINE_MS = 15_000;

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

export type RelayWelcome = Extract<RelayServerMessage, { type: "welcome" }>;

export interface RelayConnectTiming {
  startedAt: number;
  openedAt: number;
  welcomedAt: number;
}

export interface RelaySocketClose {
  clean: boolean;
  error: RelaySocketError;
}

export interface RelaySocketHandlers {
  message: (message: RelayServerMessage) => void;
  binary: (data: Uint8Array) => void;
  closed: (close: RelaySocketClose) => void;
}

export interface RelaySocketOptions {
  connectDeadlineMs?: number;
  signal?: AbortSignal;
  now?: () => number;
  crypto?: RelayCrypto;
  onHello?: () => void;
}

interface RelayPresence {
  hosting: boolean;
  label: string | null;
}

type QueuedEvent =
  | { kind: "message"; message: RelayServerMessage }
  | { kind: "binary"; data: Uint8Array }
  | { kind: "closed"; close: RelaySocketClose };

const textEncoder = new TextEncoder();

export class RelayBrowserSocket {
  readonly #socket: WebSocket;
  readonly #queue: QueuedEvent[] = [];
  #handlers: RelaySocketHandlers | null = null;
  #failure: RelaySocketError | null = null;
  #opened = false;
  #openedAt: number | null = null;
  #closed = false;
  #onOpen: (() => void) | null = null;

  constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.binaryType = "arraybuffer";
    socket.addEventListener("open", () => {
      this.#opened = true;
      this.#openedAt = Date.now();
      const listener = this.#onOpen;
      this.#onOpen = null;
      listener?.();
    });
    socket.addEventListener("message", (event) => this.#receive(event.data));
    socket.addEventListener("error", () => {
      this.#failure ??= new RelaySocketError({
        code: this.#opened ? "closed" : "connect_failed",
        message: this.#opened ? "The relay socket failed." : "The relay socket cannot be opened.",
      });
    });
    socket.addEventListener("close", (event) => this.#finish(event.code, event.reason));
  }

  get bufferedAmount(): number {
    const amount = this.#socket.bufferedAmount;
    return Number.isFinite(amount) ? amount : 0;
  }

  get open(): boolean {
    return !this.#closed && this.#socket.readyState === WebSocket.OPEN;
  }

  get openedAt(): number | null {
    return this.#openedAt;
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

  sendBinary(data: Uint8Array<ArrayBuffer>): boolean {
    if (this.#socket.readyState !== WebSocket.OPEN) return false;
    this.#socket.send(data);
    return true;
  }

  close(): void {
    if (this.#socket.readyState === WebSocket.CONNECTING || this.#socket.readyState === WebSocket.OPEN) {
      this.#socket.close(RELAY_CLOSE_CODES.normal);
    }
  }

  fail(code: RelaySocketErrorCode, message: string): void {
    this.#failure ??= new RelaySocketError({ code, message });
    this.close();
  }

  abandon(code: RelaySocketErrorCode, message: string): void {
    this.fail(code, message);
    this.#finish(RELAY_CLOSE_CODES.normal, message);
  }

  #receive(data: unknown): void {
    if (this.#failure) return;
    if (data instanceof ArrayBuffer) {
      this.#dispatch({ kind: "binary", data: new Uint8Array(data) });
      return;
    }
    const message = typeof data === "string" ? decodeText(data) : null;
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
        code: code === RELAY_CLOSE_CODES.replaced ? "replaced" : this.#opened ? "closed" : "connect_failed",
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

export async function openRelayControlSocket(
  identity: RelayBrowserIdentity,
  presence: { hosting: boolean; label: string | null },
  options: RelaySocketOptions = {},
): Promise<{ socket: RelayBrowserSocket; welcome: RelayWelcome; timing: RelayConnectTiming }> {
  const startedAt = Date.now();
  return withSocket(identity, options, options.connectDeadlineMs ?? RELAY_CONNECT_DEADLINE_MS, async (socket) => {
    await authenticate(socket, identity, presence, options);
    const welcome = await expectMessage(socket, isMessage("welcome"));
    const welcomedAt = Date.now();
    return { socket, welcome, timing: { startedAt, openedAt: socket.openedAt ?? welcomedAt, welcomedAt } };
  });
}

export function openRelayDataSocket(identity: RelayBrowserIdentity): RelayBrowserSocket {
  return connect(identity);
}

async function withSocket<Result>(
  identity: RelayBrowserIdentity,
  options: RelaySocketOptions,
  deadlineMs: number,
  use: (socket: RelayBrowserSocket) => Promise<Result>,
): Promise<Result> {
  const socket = connect(identity);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort = () => {};
  const stopped = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      socket.fail("deadline_exceeded", "The relay server did not answer in time.");
      reject(new RelaySocketError({ code: "deadline_exceeded", message: "The relay server did not answer in time." }));
    }, deadlineMs);
    onAbort = () => {
      socket.fail("closed", "The relay connection was stopped.");
      reject(new RelaySocketError({ code: "closed", message: "The relay connection was stopped." }));
    };
    if (options.signal?.aborted) onAbort();
    else options.signal?.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([use(socket), stopped]);
  } catch (error) {
    socket.close();
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

function connect(identity: RelayBrowserIdentity): RelayBrowserSocket {
  const { relayUrl } = identity;
  if (relayUrl === null) {
    throw new RelaySocketError({ code: "relay_url_missing", message: "The identity does not name a relay server." });
  }
  let url: URL;
  try {
    url = new URL(relayUrl);
  } catch {
    throw new RelaySocketError({ code: "relay_url_missing", message: "The relay address is not valid." });
  }
  if (url.protocol !== "wss:" && !(url.protocol === "ws:" && isLoopback(url.hostname))) {
    throw new RelaySocketError({
      code: "insecure_relay_url",
      message: "A relay server on a different computer must use TLS.",
    });
  }
  try {
    return new RelayBrowserSocket(new WebSocket(url.href));
  } catch {
    throw new RelaySocketError({ code: "connect_failed", message: "The relay socket cannot be opened." });
  }
}

async function authenticate(
  socket: RelayBrowserSocket,
  identity: RelayBrowserIdentity,
  presence: RelayPresence,
  options: RelaySocketOptions,
): Promise<void> {
  const challenge = await expectMessage(socket, isMessage("challenge"));
  const relayUrl = identity.relayUrl;
  if (relayUrl === null) {
    throw new RelaySocketError({ code: "relay_url_missing", message: "The identity does not name a relay server." });
  }
  const audience = relayAudience(relayUrl);
  const crypto = options.crypto ?? webRelayCrypto;
  const clientNonce = bytesToBase64Url(crypto.randomBytes(32));
  const transcript = relayHelloTranscript({ nonce: challenge.nonce, clientNonce, audience, role: "member" });
  let signature: string;
  try {
    signature = bytesToBase64Url(await crypto.sign(identity.privateKey, textEncoder.encode(transcript)));
  } catch {
    throw new RelaySocketError({ code: "identity_unavailable", message: "The relay identity cannot sign." });
  }
  if (options.signal?.aborted || !socket.open) {
    throw new RelaySocketError({ code: "closed", message: "The relay connection was stopped." });
  }
  options.onHello?.();
  socket.sendMessage({
    type: "hello",
    version: RELAY_PROTOCOL_VERSION,
    audience,
    clientNonce,
    certificate: identity.certificate,
    chain: [...identity.chain],
    signature,
    role: "member",
    hosting: presence.hosting,
    ...(presence.label === null ? {} : { label: presence.label }),
    features: [RELAY_SESSIONS_FEATURE, RELAY_HEARTBEAT_FEATURE],
  });
  const answer = await expectMessage(socket, isMessage("server-proof", "welcome"));
  const refusal =
    answer.type !== "server-proof"
      ? "missing"
      : await relayServerProofRefusal({
          certificate: answer.certificate,
          signature: answer.signature,
          root: identity.root,
          relayUrl,
          transcript: {
            serverNonce: challenge.nonce,
            clientNonce,
            audience,
            role: "member",
            clientKeyId: identity.keyId,
          },
          now: (options.now ?? Date.now)(),
          crypto,
        });
  if (refusal !== null) {
    const message = `The relay server did not prove that it belongs to the team (${refusal}).`;
    socket.fail("server_refused", message);
    throw new RelaySocketError({ code: "server_refused", message });
  }
}

function expectMessage<Message extends RelayServerMessage>(
  socket: RelayBrowserSocket,
  accepts: (message: RelayServerMessage) => message is Message,
): Promise<Message> {
  return new Promise((resolve, reject) => {
    socket.attach({
      message: (message) => {
        socket.detach();
        if (accepts(message)) resolve(message);
        else reject(unexpectedMessage());
      },
      binary: () => {
        socket.detach();
        reject(unexpectedMessage());
      },
      closed: (close) => {
        socket.detach();
        reject(close.error);
      },
    });
  });
}

function isMessage<Type extends RelayServerMessage["type"]>(...types: Type[]) {
  return (message: RelayServerMessage): message is Extract<RelayServerMessage, { type: Type }> =>
    types.some((type) => type === message.type);
}

function unexpectedMessage(): RelaySocketError {
  return new RelaySocketError({
    code: "protocol_error",
    message: "The relay server sent a message that is not expected.",
  });
}

function decodeText(text: string): RelayServerMessage | null {
  if (text.length > RELAY_CONTROL_MESSAGE_BYTES_LIMIT) return null;
  try {
    return decodeRelayServerMessage(JSON.parse(text));
  } catch {
    return null;
  }
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function relaySocketError(error: unknown): RelaySocketError {
  if (error instanceof RelaySocketError) return error;
  return new RelaySocketError({
    code: "closed",
    message: error instanceof Error ? error.message : "The relay connection failed.",
  });
}
