import {
  RELAY_ACCEPT_DEADLINE_MS,
  RELAY_KEY_ID_PATTERN,
  RELAY_PROTOCOL_VERSION,
  RELAY_SESSION_FRAME_PAYLOAD_LIMIT,
  RELAY_SESSION_OPENER_ID_MAX,
  RELAY_SESSION_WINDOW_BYTES,
  type RelayClientMessage,
  type RelayPeerCertificate,
  type RelayServerMessage,
  type RelaySessionFailureCode,
  type RelaySessionRefusalCode,
} from "@openbot/contracts/relay-protocol/messages";
import {
  decodeRelaySessionFrame,
  encodeRelaySessionEnd,
  encodeRelaySessionFrame,
  isRelayAssignedSessionId,
} from "@openbot/contracts/relay-protocol/sessions";
import {
  createRelayTunnelOpening,
  RELAY_TUNNEL_CRYPTO_ERROR_MESSAGES,
  RELAY_TUNNEL_HANDSHAKE_DEADLINE_MS,
  type RelayPublicKey,
  type RelayTunnelCrypto,
  type RelayTunnelCryptoErrorCode,
  RelayTunnelHandshake,
  type RelayTunnelSession,
} from "@openbot/contracts/relay-protocol/tunnel-crypto";
import { base64UrlToBytes, bytesToBase64Url } from "./base64";
import { type RelaySocketClose, RelaySocketError, type RelaySocketErrorCode } from "./relay-socket";

const SOCKET_LOW_WATER_BYTES = 128 * 1024;
const DRAIN_CHECK_MS = 4;
const CREDIT_BATCH_BYTES = RELAY_SESSION_WINDOW_BYTES / 4;
const OPEN_DEADLINE_MS = RELAY_ACCEPT_DEADLINE_MS + 5_000;

type SessionServerMessage = Extract<
  RelayServerMessage,
  { type: "session-incoming" | "session-opened" | "session-failed" | "session-close" | "session-credit" }
>;
type SessionOpened = Extract<RelayServerMessage, { type: "session-opened" }>;
type SessionIncomingMessage = Extract<RelayServerMessage, { type: "session-incoming" }>;

export interface RelaySessionWire {
  sendMessage(message: RelayClientMessage): void;
  dataReady(): boolean;
  sendFrame(bytes: Uint8Array<ArrayBuffer>): boolean;
  bufferedAmount(): number;
  wantData(): void;
}

export interface RelaySessionSecurity {
  readonly crypto: RelayTunnelCrypto;
  readonly selfKeyId: string;
  sign(transcript: Uint8Array<ArrayBuffer>): Promise<Uint8Array | null>;
  peerKey(peer: RelayPeerCertificate): Promise<RelayPublicKey | string>;
}

export interface RelaySessionHandlers {
  data: (data: Uint8Array<ArrayBuffer>) => void;
  closed: (close: RelaySocketClose) => void;
}

export interface RelaySessionOpenOptions {
  signal?: AbortSignal | undefined;
  deadlineMs?: number | undefined;
}

export interface RelaySessionSource {
  openSession(target: string, options?: RelaySessionOpenOptions): Promise<RelaySession>;
}

export interface RelayIncomingSession {
  readonly connectionId: string;
  readonly peer: RelayPeerCertificate;
  readonly receivedAt: number;
  accept(): Promise<RelaySession>;
  refuse(code: RelaySessionRefusalCode): void;
}

interface RelaySessionOwner {
  send(message: RelayClientMessage): void;
  schedule(session: RelaySession): void;
  forget(session: RelaySession): void;
}

interface PendingOpen {
  resolve: (message: SessionOpened) => void;
  reject: (error: RelaySocketError) => void;
  closed: boolean;
}

export function relaySessionError(code: RelaySocketErrorCode, message: string): RelaySocketError {
  return new RelaySocketError({ code, message });
}

function tunnelError(code: RelayTunnelCryptoErrorCode): RelaySocketError {
  return relaySessionError(code, RELAY_TUNNEL_CRYPTO_ERROR_MESSAGES[code]);
}

function closedError(): RelaySocketError {
  return relaySessionError("closed", "The relay session is closed.");
}

export class RelaySession {
  readonly id: number;
  readonly peer: RelayPeerCertificate;
  readonly connectionId: string;
  readonly #owner: RelaySessionOwner;
  readonly #queue: Uint8Array<ArrayBuffer>[] = [];
  readonly #received: Uint8Array<ArrayBuffer>[] = [];
  readonly #progress = new Set<() => void>();
  #tunnel: RelayTunnelSession | null;
  #handshake: RelayTunnelHandshake | null;
  #established: { resolve: () => void; reject: (error: RelaySocketError) => void } | null = null;
  #handlers: RelaySessionHandlers | null = null;
  #inbound: Promise<void> = Promise.resolve();
  #closed: RelaySocketClose | null = null;
  #ended = false;
  #credit = RELAY_SESSION_WINDOW_BYTES;
  #queuedBytes = 0;
  #sealingBytes = 0;
  #ungranted = 0;
  #creditHeld = false;
  #late = 0;
  #ending = false;
  #endPending = false;

  constructor(input: {
    id: number;
    peer: RelayPeerCertificate;
    connectionId: string;
    owner: RelaySessionOwner;
    tunnel: RelayTunnelSession | null;
    handshake: RelayTunnelHandshake | null;
  }) {
    this.id = input.id;
    this.peer = input.peer;
    this.connectionId = input.connectionId;
    this.#owner = input.owner;
    this.#tunnel = input.tunnel;
    this.#handshake = input.handshake;
  }

  get closed(): boolean {
    return this.#ended;
  }

  get bufferedAmount(): number {
    return this.queuedBytes() + this.unacknowledgedBytes();
  }

  queuedBytes(): number {
    return this.#sealingBytes + this.#queuedBytes;
  }

  unacknowledgedBytes(): number {
    return RELAY_SESSION_WINDOW_BYTES - this.#credit;
  }

  onProgress(listener: () => void): () => void {
    this.#progress.add(listener);
    return () => this.#progress.delete(listener);
  }

  listen(handlers: RelaySessionHandlers): void {
    this.#handlers = handlers;
    for (const data of this.#received.splice(0)) handlers.data(data);
    if (this.#closed) handlers.closed(this.#closed);
  }

  write(data: Uint8Array): void {
    if (this.#ended) throw this.#closed?.error ?? closedError();
    const tunnel = this.#tunnel;
    if (!tunnel) throw closedError();
    if (data.byteLength === 0) return;
    this.#sealingBytes += data.byteLength;
    void tunnel.seal(data).then((sealed) => {
      this.#sealingBytes -= data.byteLength;
      if (this.#ended) return;
      if (!sealed.ok) {
        this.fail(sealed.code, RELAY_TUNNEL_CRYPTO_ERROR_MESSAGES[sealed.code]);
        return;
      }
      this.#enqueue(sealed.bytes);
    });
  }

  holdCredits(): void {
    this.#creditHeld = true;
  }

  releaseCredits(): void {
    this.#creditHeld = false;
    this.#grant();
  }

  close(): void {
    if (this.#ended) return;
    this.#owner.send({ type: "session-close", version: RELAY_PROTOCOL_VERSION, session: this.id });
    this.#end({ clean: true, error: closedError() });
  }

  end(): void {
    if (this.#ended) return;
    this.#ending = true;
    if (this.queuedBytes() === 0) this.#requestEnd();
  }

  get endPending(): boolean {
    return this.#endPending && !this.#ended;
  }

  endSent(): void {
    if (this.#ended) return;
    this.#end({ clean: true, error: closedError() });
  }

  #requestEnd(): void {
    if (this.#endPending || this.#ended) return;
    this.#endPending = true;
    this.#owner.schedule(this);
  }

  fail(code: RelaySocketErrorCode, message: string): void {
    if (this.#ended) return;
    this.#owner.send({ type: "session-close", version: RELAY_PROTOCOL_VERSION, session: this.id });
    this.#end({ clean: false, error: relaySessionError(code, message) });
  }

  established(deadlineMs: number): Promise<void> {
    if (!this.#handshake) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail("deadline_exceeded", "The peer did not complete the encrypted connection in time.");
      }, deadlineMs);
      this.#established = {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
    });
  }

  sendRaw(bytes: Uint8Array<ArrayBuffer>): void {
    this.#enqueue(bytes);
  }

  hasSendable(): boolean {
    if (this.#ended) return false;
    return (this.#queuedBytes > 0 && this.#credit > 0) || (this.#endPending && this.queuedBytes() === 0);
  }

  takeFrame(): Uint8Array<ArrayBuffer> | null {
    const size = Math.min(this.#queuedBytes, this.#credit, RELAY_SESSION_FRAME_PAYLOAD_LIMIT);
    if (size <= 0 || this.#ended) return null;
    const frame = new Uint8Array(size);
    let offset = 0;
    while (offset < size) {
      const head = this.#queue[0];
      if (!head) break;
      const take = Math.min(head.byteLength, size - offset);
      frame.set(head.subarray(0, take), offset);
      offset += take;
      if (take === head.byteLength) this.#queue.shift();
      else this.#queue[0] = head.subarray(take);
    }
    this.#queuedBytes -= size;
    this.#credit -= size;
    return frame;
  }

  notifyProgress(): void {
    for (const listener of [...this.#progress]) listener();
    if (this.#ending && !this.#ended && this.queuedBytes() === 0) this.#requestEnd();
  }

  creditArrived(bytes: number): void {
    this.#credit = Math.min(RELAY_SESSION_WINDOW_BYTES, this.#credit + bytes);
    this.#owner.schedule(this);
    this.notifyProgress();
  }

  receive(payload: Uint8Array): void {
    if (this.#ended) return;
    const tunnel = this.#tunnel;
    if (tunnel && !this.#handshake && this.#late === 0) {
      const opened = tunnel.open(payload);
      this.#inbound = this.#inbound.then(() => this.#deliver(opened, payload.byteLength));
      return;
    }
    this.#late += 1;
    this.#inbound = this.#inbound.then(async () => {
      try {
        await this.#receiveLate(payload);
      } finally {
        this.#late -= 1;
      }
    });
  }

  async #receiveLate(payload: Uint8Array): Promise<void> {
    if (this.#ended) return;
    const handshake = this.#handshake;
    if (!handshake) {
      await this.#open(payload, payload.byteLength);
      return;
    }
    const result = await handshake.receive(payload);
    if (this.#ended) return;
    this.#consumed(payload.byteLength);
    if (result.kind === "failed") {
      this.#established?.reject(tunnelError(result.code));
      this.fail(result.code, RELAY_TUNNEL_CRYPTO_ERROR_MESSAGES[result.code]);
      return;
    }
    if (result.kind !== "done") return;
    this.#handshake = null;
    this.#tunnel = result.session;
    this.#established?.resolve();
    this.#established = null;
    if (result.rest.byteLength > 0) await this.#open(result.rest, 0);
  }

  remoteClosed(): void {
    if (this.#ended) return;
    this.#ended = true;
    this.#owner.forget(this);
    this.#established?.reject(closedError());
    this.#established = null;
    this.#inbound = this.#inbound.then(() => this.#finish({ clean: true, error: closedError() }));
  }

  socketClosed(error: RelaySocketError): void {
    if (this.#ended) return;
    this.#end({ clean: false, error });
  }

  async #open(bytes: Uint8Array, consumed: number): Promise<void> {
    const tunnel = this.#tunnel;
    if (!tunnel) return;
    await this.#deliver(tunnel.open(bytes), consumed);
  }

  async #deliver(
    opened: Promise<{ messages: Uint8Array<ArrayBuffer>[]; failure: RelayTunnelCryptoErrorCode | null }>,
    consumed: number,
  ): Promise<void> {
    const result = await opened;
    if (this.#ended) return;
    for (const message of result.messages) {
      if (this.#handlers) this.#handlers.data(message);
      else this.#received.push(message);
    }
    if (result.failure) {
      this.fail(result.failure, RELAY_TUNNEL_CRYPTO_ERROR_MESSAGES[result.failure]);
      return;
    }
    this.#consumed(consumed);
  }

  #consumed(bytes: number): void {
    this.#ungranted += bytes;
    this.#grant();
  }

  #grant(): void {
    if (this.#ended || this.#creditHeld || this.#ungranted < CREDIT_BATCH_BYTES) return;
    const bytes = Math.min(this.#ungranted, RELAY_SESSION_WINDOW_BYTES);
    this.#ungranted -= bytes;
    this.#owner.send({ type: "session-credit", version: RELAY_PROTOCOL_VERSION, session: this.id, bytes });
  }

  #enqueue(bytes: Uint8Array<ArrayBuffer>): void {
    if (this.#ended || bytes.byteLength === 0) return;
    this.#queue.push(bytes);
    this.#queuedBytes += bytes.byteLength;
    this.#owner.schedule(this);
  }

  #end(close: RelaySocketClose): void {
    this.#ended = true;
    this.#owner.forget(this);
    this.#established?.reject(close.error);
    this.#established = null;
    this.#finish(close);
  }

  #finish(close: RelaySocketClose): void {
    if (this.#closed) return;
    this.#closed = close;
    this.#queue.length = 0;
    this.#queuedBytes = 0;
    this.#handlers?.closed(close);
    this.notifyProgress();
    this.#progress.clear();
  }
}

export class RelaySessionMux {
  readonly #wire: RelaySessionWire;
  readonly #security: RelaySessionSecurity;
  readonly #now: () => number;
  readonly #sessions = new Map<number, RelaySession>();
  readonly #pending = new Map<number, PendingOpen>();
  readonly #ready: RelaySession[] = [];
  readonly #scheduled = new Set<RelaySession>();
  readonly #owner: RelaySessionOwner;
  #lastActivity: number;
  #onIncoming: ((incoming: RelayIncomingSession) => void) | null = null;
  #nextId = 1;
  #pumpQueued = false;
  #drainTimer: ReturnType<typeof setTimeout> | null = null;
  #closedWith: RelaySocketError | null = null;

  constructor(wire: RelaySessionWire, security: RelaySessionSecurity, now: () => number = Date.now) {
    this.#wire = wire;
    this.#security = security;
    this.#now = now;
    this.#lastActivity = now();
    this.#owner = {
      send: (message) => {
        if (!this.#closedWith) this.#wire.sendMessage(message);
      },
      schedule: (session) => this.#schedule(session),
      forget: (session) => {
        if (this.#sessions.get(session.id) === session) this.#sessions.delete(session.id);
        this.#scheduled.delete(session);
      },
    };
  }

  get size(): number {
    return this.#sessions.size;
  }

  get closedWith(): RelaySocketError | null {
    return this.#closedWith;
  }

  idleFor(): number {
    for (const session of this.#sessions.values()) if (session.queuedBytes() > 0 || session.endPending) return 0;
    return this.#now() - this.#lastActivity;
  }

  failSessions(error: RelaySocketError): void {
    for (const session of [...this.#sessions.values()]) {
      this.#owner.send({ type: "session-close", version: RELAY_PROTOCOL_VERSION, session: session.id });
      session.socketClosed(error);
    }
  }

  setIncoming(listener: ((incoming: RelayIncomingSession) => void) | null): void {
    this.#onIncoming = listener;
  }

  async open(target: string, options: RelaySessionOpenOptions = {}): Promise<RelaySession> {
    if (!RELAY_KEY_ID_PATTERN.test(target)) {
      throw relaySessionError("invalid_message", "The target is not a key identifier.");
    }
    if (target === this.#security.selfKeyId) {
      throw relaySessionError("invalid_message", "A member cannot connect to itself.");
    }
    if (this.#closedWith) throw this.#closedWith;
    const { crypto } = this.#security;
    const opening = await createRelayTunnelOpening(crypto);
    if (!opening) throw tunnelError("tunnel_handshake_failed");
    if (this.#closedWith) throw this.#closedWith;
    if (this.#nextId > RELAY_SESSION_OPENER_ID_MAX)
      throw relaySessionError("rate_limited", "No session numbers remain.");
    const id = this.#nextId;
    this.#nextId += 1;
    const pending: PendingOpen = { resolve: () => undefined, reject: () => undefined, closed: false };
    const opened = new Promise<SessionOpened>((resolve, reject) => {
      pending.resolve = resolve;
      pending.reject = reject;
    });
    this.#pending.set(id, pending);
    const cancel = () => {
      if (this.#pending.get(id) !== pending) return;
      this.#pending.delete(id);
      this.#owner.send({ type: "session-close", version: RELAY_PROTOCOL_VERSION, session: id });
    };
    const timer = setTimeout(() => {
      cancel();
      pending.reject(relaySessionError("deadline_exceeded", "The member did not accept the session in time."));
    }, options.deadlineMs ?? OPEN_DEADLINE_MS);
    const onAbort = () => {
      cancel();
      pending.reject(relaySessionError("closed", "The relay session was stopped."));
    };
    if (options.signal?.aborted) onAbort();
    else options.signal?.addEventListener("abort", onAbort, { once: true });
    this.#owner.send({
      type: "session-open",
      version: RELAY_PROTOCOL_VERSION,
      session: id,
      target,
      first: bytesToBase64Url(opening.hello),
    });
    this.#wire.wantData();
    try {
      const message = await opened;
      if (message.peer.keyId !== target) throw this.#refusePeer(id, "different_peer");
      const peerKey = await this.#security.peerKey(message.peer);
      if (typeof peerKey === "string") throw this.#refusePeer(id, peerKey);
      if (message.first === undefined) throw this.#failOpen(id, "tunnel_handshake_failed");
      const handshake = new RelayTunnelHandshake(
        {
          role: "client",
          crypto,
          binding: { connectionId: message.connectionId, clientKeyId: this.#security.selfKeyId, hostKeyId: target },
          peerPublicKey: peerKey,
          sign: (transcript) => this.#security.sign(transcript),
        },
        opening,
      );
      const step = await handshake.receive(base64UrlToBytes(message.first));
      if (step.kind === "failed") throw this.#failOpen(id, step.code);
      if (step.kind !== "done" || !step.send) throw this.#failOpen(id, "tunnel_handshake_failed");
      if (pending.closed || this.#closedWith) throw this.#closedWith ?? closedError();
      this.#pending.delete(id);
      const session = new RelaySession({
        id,
        peer: message.peer,
        connectionId: message.connectionId,
        owner: this.#owner,
        tunnel: step.session,
        handshake: null,
      });
      this.#sessions.set(id, session);
      session.sendRaw(step.send);
      return session;
    } catch (error) {
      cancel();
      throw error instanceof RelaySocketError ? error : relaySessionError("closed", "The relay session failed.");
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    }
  }

  receiveMessage(message: RelayServerMessage): boolean {
    if (!isSessionMessage(message)) return false;
    switch (message.type) {
      case "session-opened": {
        const pending = this.#pending.get(message.session);
        if (pending && !pending.closed) pending.resolve(message);
        else this.#owner.send({ type: "session-close", version: RELAY_PROTOCOL_VERSION, session: message.session });
        return true;
      }
      case "session-failed": {
        const pending = this.#pending.get(message.session);
        this.#pending.delete(message.session);
        pending?.reject(sessionFailure(message.code));
        return true;
      }
      case "session-incoming":
        this.#incoming(message);
        return true;
      case "session-close": {
        const pending = this.#pending.get(message.session);
        if (pending) {
          pending.closed = true;
          pending.reject(closedError());
        }
        this.#sessions.get(message.session)?.remoteClosed();
        return true;
      }
      case "session-credit":
        this.#sessions.get(message.session)?.creditArrived(message.bytes);
        return true;
    }
  }

  receiveFrame(bytes: Uint8Array): boolean {
    const frame = decodeRelaySessionFrame(bytes);
    if (!frame) return false;
    this.#lastActivity = this.#now();
    const session = this.#sessions.get(frame.session);
    if (frame.kind === "end") session?.remoteClosed();
    else session?.receive(frame.payload);
    return true;
  }

  drained(): void {
    this.#pump();
  }

  closeAll(error: RelaySocketError): void {
    if (this.#closedWith) return;
    this.#closedWith = error;
    if (this.#drainTimer !== null) clearTimeout(this.#drainTimer);
    this.#drainTimer = null;
    for (const pending of [...this.#pending.values()]) pending.reject(error);
    this.#pending.clear();
    for (const session of [...this.#sessions.values()]) session.socketClosed(error);
    this.#sessions.clear();
    this.#ready.length = 0;
    this.#scheduled.clear();
  }

  #refusePeer(id: number, reason: string): RelaySocketError {
    this.#owner.send({ type: "session-close", version: RELAY_PROTOCOL_VERSION, session: id });
    this.#pending.delete(id);
    return relaySessionError("peer_refused", `The certificate of the peer was refused (${reason}).`);
  }

  #failOpen(id: number, code: RelayTunnelCryptoErrorCode): RelaySocketError {
    this.#owner.send({ type: "session-close", version: RELAY_PROTOCOL_VERSION, session: id });
    this.#pending.delete(id);
    return tunnelError(code);
  }

  #incoming(message: SessionIncomingMessage): void {
    const id = message.session;
    const listener = this.#onIncoming;
    if (!isRelayAssignedSessionId(id) || this.#sessions.has(id) || !listener || message.first === undefined) {
      this.#owner.send({ type: "session-refuse", version: RELAY_PROTOCOL_VERSION, session: id, code: "refused" });
      return;
    }
    const first = message.first;
    this.#wire.wantData();
    let answered = false;
    const refuse = (code: RelaySessionRefusalCode) => {
      if (answered) return;
      answered = true;
      this.#owner.send({ type: "session-refuse", version: RELAY_PROTOCOL_VERSION, session: id, code });
    };
    listener({
      connectionId: message.connectionId,
      peer: message.from,
      receivedAt: this.#now(),
      refuse,
      accept: async () => {
        if (answered) throw closedError();
        const peerKey = await this.#security.peerKey(message.from);
        if (typeof peerKey === "string") {
          refuse("refused");
          throw relaySessionError("peer_refused", `The certificate of the peer was refused (${peerKey}).`);
        }
        const handshake = new RelayTunnelHandshake({
          role: "host",
          crypto: this.#security.crypto,
          binding: {
            connectionId: message.connectionId,
            clientKeyId: message.from.keyId,
            hostKeyId: this.#security.selfKeyId,
          },
          peerPublicKey: peerKey,
          sign: (transcript) => this.#security.sign(transcript),
        });
        await handshake.begin();
        const step = await handshake.receive(base64UrlToBytes(first));
        if (step.kind === "failed") {
          refuse("refused");
          throw tunnelError(step.code);
        }
        if (step.kind !== "wait" || !step.send || answered || this.#closedWith) {
          refuse("refused");
          throw this.#closedWith ?? tunnelError("tunnel_handshake_failed");
        }
        answered = true;
        const session = new RelaySession({
          id,
          peer: message.from,
          connectionId: message.connectionId,
          owner: this.#owner,
          tunnel: null,
          handshake,
        });
        this.#sessions.set(id, session);
        const established = session.established(RELAY_TUNNEL_HANDSHAKE_DEADLINE_MS);
        this.#owner.send({
          type: "session-accept",
          version: RELAY_PROTOCOL_VERSION,
          session: id,
          first: bytesToBase64Url(step.send),
        });
        await established;
        return session;
      },
    });
  }

  #schedule(session: RelaySession): void {
    if (this.#closedWith || this.#scheduled.has(session) || !session.hasSendable()) return;
    this.#scheduled.add(session);
    this.#ready.push(session);
    if (this.#pumpQueued) return;
    this.#pumpQueued = true;
    queueMicrotask(() => {
      this.#pumpQueued = false;
      this.#pump();
    });
  }

  #pump(): void {
    if (this.#drainTimer !== null) clearTimeout(this.#drainTimer);
    this.#drainTimer = null;
    if (this.#ready.length > 0 && !this.#closedWith && !this.#wire.dataReady()) {
      this.#wire.wantData();
      return;
    }
    const progressed = new Set<RelaySession>();
    while (this.#ready.length > 0 && !this.#closedWith && this.#wire.bufferedAmount() < SOCKET_LOW_WATER_BYTES) {
      const session = this.#ready.shift();
      if (!session) break;
      if (session.endPending) {
        this.#scheduled.delete(session);
        if (this.#wire.sendFrame(encodeRelaySessionEnd(session.id))) session.endSent();
        continue;
      }
      const frame = session.takeFrame();
      if (frame && !this.#wire.sendFrame(encodeRelaySessionFrame(session.id, frame))) {
        this.#ready.unshift(session);
        this.#wire.wantData();
        return;
      }
      if (frame) {
        progressed.add(session);
        this.#lastActivity = this.#now();
      }
      if (session.hasSendable()) this.#ready.push(session);
      else this.#scheduled.delete(session);
    }
    if (this.#ready.length > 0 && !this.#closedWith) {
      this.#drainTimer = setTimeout(() => this.#pump(), DRAIN_CHECK_MS);
    }
    for (const session of progressed) session.notifyProgress();
  }
}

function sessionFailure(code: RelaySessionFailureCode): RelaySocketError {
  if (code === "refused") return relaySessionError("peer_refused", "The member refused the session.");
  if (code === "rate_limited") return relaySessionError(code, "Too many sessions are open.");
  if (code === "invalid_message") return relaySessionError(code, "The relay server refused the session request.");
  return relaySessionError(code, "The member is offline or does not host.");
}

function isSessionMessage(message: RelayServerMessage): message is SessionServerMessage {
  return (
    message.type === "session-incoming" ||
    message.type === "session-opened" ||
    message.type === "session-failed" ||
    message.type === "session-close" ||
    message.type === "session-credit"
  );
}
