import { Duplex } from "node:stream";
import type { RelayPeerCertificate, RelayServerMessage } from "@openbot/contracts/relay-protocol/messages";
import type { RelayTunnelRole, RelayTunnelSession } from "@openbot/contracts/relay-protocol/tunnel-crypto";
import { Effect, Exit } from "effect";
import { peerRefusal } from "./certificates";
import type { RelayCredentialSource } from "./identity-store";
import { type RelayOpen, type RelaySocket, type RelaySocketClose, RelaySocketError } from "./socket";
import { encryptRelayTunnel, type RelayTunnelCipher, relayTunnelError } from "./tunnel-encryption";

const RELAY_STREAM_MESSAGE_BYTES = 256 * 1024;

type WriteCallback = (error?: Error | null) => void;

export class RelayStream extends Duplex {
  connecting = true;
  timeout = 0;
  #socket: RelaySocket | null = null;
  #open: RelayOpen | null = null;
  #session: RelayTunnelSession | null = null;
  #inbound: Promise<void> = Promise.resolve();
  #heldByPeer = false;
  #heldWrite: (() => void) | null = null;
  #sentInTurn = 0;
  #idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super({ allowHalfOpen: false });
  }

  get peer(): RelayPeerCertificate | null {
    return this.#open?.peer ?? null;
  }

  get connectionId(): string | null {
    return this.#open?.connectionId ?? null;
  }

  get remoteAddress(): string | undefined {
    return this.#open ? `relay:${this.#open.peer.keyId}` : undefined;
  }

  get heldByPeer(): boolean {
    return this.#heldByPeer;
  }

  connect(socket: RelaySocket, open: RelayOpen, cipher: RelayTunnelCipher): void {
    if (this.destroyed || this.#socket) {
      socket.terminate();
      return;
    }
    this.#socket = socket;
    this.#open = open;
    this.#session = cipher.session;
    this.#heldByPeer = cipher.heldByPeer;
    this.connecting = false;
    if (cipher.rest.byteLength > 0) this.#receive(socket, cipher.rest);
    socket.attach({
      message: (message) => this.#control(message),
      binary: (data) => this.#receive(socket, data),
      closed: (close) => this.#closed(close),
    });
    this.emit("connect");
  }

  setTimeout(milliseconds: number, listener?: () => void): this {
    this.timeout = milliseconds;
    if (listener) this.once("timeout", listener);
    this.#restartIdleTimer();
    return this;
  }

  setNoDelay(): this {
    return this;
  }

  setKeepAlive(): this {
    return this;
  }

  ref(): this {
    return this;
  }

  unref(): this {
    return this;
  }

  override _read(): void {
    this.#socket?.resumeReading();
  }

  override _write(chunk: Buffer, encoding: BufferEncoding, callback: WriteCallback): void {
    const socket = this.#socket;
    const session = this.#session;
    if (!socket || !session) {
      this.once("connect", () => this._write(chunk, encoding, callback));
      return;
    }
    void session.seal(chunk).then((sealed) => {
      if (!sealed.ok) callback(relayTunnelError(sealed.code));
      else if (sealed.bytes.byteLength === 0) callback();
      else this.#send(socket, sealed.bytes, 0, callback);
    });
  }

  override _final(callback: WriteCallback): void {
    const socket = this.#socket;
    if (!socket) {
      this.once("connect", () => this._final(callback));
      return;
    }
    socket.close();
    callback();
  }

  override _destroy(error: Error | null, callback: WriteCallback): void {
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    this.#idleTimer = null;
    this.#heldWrite = null;
    this.#session = null;
    this.#socket?.terminate();
    callback(error);
  }

  #send(socket: RelaySocket, chunk: Uint8Array, offset: number, callback: WriteCallback): void {
    if (this.#heldByPeer) {
      this.#heldWrite = () => this.#send(socket, chunk, offset, callback);
      return;
    }
    const end = Math.min(chunk.length, offset + RELAY_STREAM_MESSAGE_BYTES);
    socket.sendBinary(chunk.subarray(offset, end), (error) => {
      if (error) {
        callback(error);
        return;
      }
      this.#restartIdleTimer();
      this.#sentInTurn += end - offset;
      const proceed = end >= chunk.length ? () => callback() : () => this.#send(socket, chunk, end, callback);
      if (this.#sentInTurn < RELAY_STREAM_MESSAGE_BYTES) {
        proceed();
        return;
      }
      this.#sentInTurn = 0;
      setImmediate(proceed);
    });
  }

  #receive(socket: RelaySocket, data: Uint8Array): void {
    this.#restartIdleTimer();
    const session = this.#session;
    if (!session) return;
    const opened = session.open(data);
    this.#inbound = this.#inbound.then(async () => {
      const result = await opened;
      if (this.destroyed) return;
      for (const message of result.messages) {
        if (!this.push(Buffer.from(message.buffer, message.byteOffset, message.byteLength))) socket.pauseReading();
      }
      if (result.failure) this.destroy(relayTunnelError(result.failure));
    });
  }

  #control(message: RelayServerMessage): void {
    if (message.type === "pause") {
      this.#heldByPeer = true;
      this.emit("flow", "paused");
      return;
    }
    if (message.type === "resume") {
      this.#heldByPeer = false;
      this.emit("flow", "resumed");
      const heldWrite = this.#heldWrite;
      this.#heldWrite = null;
      heldWrite?.();
      return;
    }
    this.destroy(
      new RelaySocketError({
        code: "protocol_error",
        message: "The relay server sent a message that is not expected.",
      }),
    );
  }

  #closed(close: RelaySocketClose): void {
    this.#inbound = this.#inbound.then(() => {
      if (close.clean) this.push(null);
      else this.destroy(close.error);
    });
  }

  #restartIdleTimer(): void {
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    this.#idleTimer = null;
    if (this.timeout <= 0 || this.destroyed) return;
    this.#idleTimer = setTimeout(() => this.emit("timeout"), this.timeout);
    this.#idleTimer.unref();
  }
}

export function verifiedRelayStream(input: {
  credentials: RelayCredentialSource;
  role: RelayTunnelRole;
  socket: RelaySocket;
  open: RelayOpen;
  peerKeyId: string;
  connectionId: string | null;
  now: number;
  stream?: RelayStream | undefined;
}): Effect.Effect<RelayStream, RelaySocketError> {
  const { credentials, socket, open } = input;
  return Effect.gen(function* () {
    const identity = credentials.current();
    const refusal = !identity
      ? "no_identity"
      : open.peer.keyId !== input.peerKeyId
        ? "different_peer"
        : input.connectionId !== null && open.connectionId !== input.connectionId
          ? "different_connection"
          : peerRefusal(open.peer, identity, input.now);
    if (refusal !== null || !identity) {
      return yield* new RelaySocketError({
        code: "peer_refused",
        message: `The certificate of the peer was refused (${refusal ?? "no_identity"}).`,
      });
    }
    const cipher = yield* encryptRelayTunnel({
      socket,
      open,
      role: input.role,
      credentials,
      selfKeyId: identity.keyId,
    });
    const stream = input.stream ?? new RelayStream();
    stream.connect(socket, open, cipher);
    return stream;
  }).pipe(Effect.onExit((exit) => (Exit.isSuccess(exit) ? Effect.void : Effect.sync(() => socket.terminate()))));
}
