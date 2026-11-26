import { Duplex } from "node:stream";
import type { RelayPeerCertificate } from "@openbot/contracts/relay-protocol/messages";
import type { RelaySession } from "@openbot/team-client/relay-sessions";
import { RelaySocketError as SharedRelaySocketError } from "@openbot/team-client/relay-socket";
import { RelaySocketError } from "./socket";

const RELAY_STREAM_QUEUE_BYTES = 256 * 1024;

type WriteCallback = (error?: Error | null) => void;

export interface RelaySendProgress {
  queuedBytes(): number;
  unacknowledgedBytes(): number;
  onProgress(listener: () => void): () => void;
}

export function desktopRelayError(error: unknown): RelaySocketError {
  if (error instanceof RelaySocketError) return error;
  if (error instanceof SharedRelaySocketError)
    return new RelaySocketError({ code: error.code, message: error.message });
  return new RelaySocketError({
    code: "closed",
    message: error instanceof Error ? error.message : "The relay session failed.",
  });
}

export class RelayStream extends Duplex implements RelaySendProgress {
  connecting = true;
  timeout = 0;
  #session: RelaySession | null = null;
  #waitingWrite: WriteCallback | null = null;
  #stopProgress: (() => void) | null = null;
  #idleTimer: ReturnType<typeof setTimeout> | null = null;
  #ending = false;

  constructor() {
    super({ allowHalfOpen: false });
  }

  get peer(): RelayPeerCertificate | null {
    return this.#session?.peer ?? null;
  }

  get connectionId(): string | null {
    return this.#session?.connectionId ?? null;
  }

  get remoteAddress(): string | undefined {
    return this.#session ? `relay:${this.#session.peer.keyId}` : undefined;
  }

  connect(session: RelaySession): void {
    if (this.destroyed || this.#session) {
      session.close();
      return;
    }
    this.#session = session;
    this.connecting = false;
    this.#stopProgress = session.onProgress(() => this.#progressed());
    session.listen({
      data: (data) => {
        this.#restartIdleTimer();
        if (!this.push(Buffer.from(data.buffer, data.byteOffset, data.byteLength))) session.holdCredits();
      },
      closed: (close) => {
        if (close.clean) this.push(null);
        else this.destroy(desktopRelayError(close.error));
      },
    });
    this.emit("connect");
  }

  queuedBytes(): number {
    return this.writableLength + (this.#session?.queuedBytes() ?? 0);
  }

  unacknowledgedBytes(): number {
    return this.#session?.unacknowledgedBytes() ?? 0;
  }

  onProgress(listener: () => void): () => void {
    const session = this.#session;
    return session ? session.onProgress(listener) : () => undefined;
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
    this.#session?.releaseCredits();
  }

  override _write(chunk: Buffer, encoding: BufferEncoding, callback: WriteCallback): void {
    const session = this.#session;
    if (!session) {
      this.once("connect", () => this._write(chunk, encoding, callback));
      return;
    }
    try {
      session.write(chunk);
    } catch (error) {
      callback(desktopRelayError(error));
      return;
    }
    this.#restartIdleTimer();
    if (session.queuedBytes() < RELAY_STREAM_QUEUE_BYTES) callback();
    else this.#waitingWrite = callback;
  }

  override _final(callback: WriteCallback): void {
    const session = this.#session;
    if (!session) {
      this.once("connect", () => this._final(callback));
      return;
    }
    this.#ending = true;
    session.end();
    callback();
  }

  override _destroy(error: Error | null, callback: WriteCallback): void {
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    this.#idleTimer = null;
    this.#stopProgress?.();
    this.#stopProgress = null;
    const waiting = this.#waitingWrite;
    this.#waitingWrite = null;
    waiting?.(error ?? new RelaySocketError({ code: "closed", message: "The relay session is closed." }));
    if (!this.#ending || error) this.#session?.close();
    callback(error);
  }

  #progressed(): void {
    const session = this.#session;
    const waiting = this.#waitingWrite;
    if (!session || !waiting || session.queuedBytes() >= RELAY_STREAM_QUEUE_BYTES) return;
    this.#waitingWrite = null;
    waiting();
  }

  #restartIdleTimer(): void {
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    this.#idleTimer = null;
    if (this.timeout <= 0 || this.destroyed) return;
    this.#idleTimer = setTimeout(() => this.emit("timeout"), this.timeout);
    this.#idleTimer.unref();
  }
}
