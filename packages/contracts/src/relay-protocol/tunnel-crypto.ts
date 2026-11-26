export const RELAY_TUNNEL_CRYPTO_VERSION = 1;
export const RELAY_TUNNEL_HANDSHAKE_DEADLINE_MS = 10_000;
export const RELAY_TUNNEL_RECORD_PLAINTEXT_BYTES = 16 * 1024;
export const RELAY_TUNNEL_RECORD_HEADER_BYTES = 4;
export const RELAY_TUNNEL_TAG_BYTES = 16;
export const RELAY_TUNNEL_EPHEMERAL_KEY_BYTES = 65;
export const RELAY_TUNNEL_NONCE_BYTES = 32;
export const RELAY_TUNNEL_SIGNATURE_BYTES = 64;
export const RELAY_TUNNEL_MESSAGE_TYPES = { hello: 1, reply: 2, finish: 3 } as const;

export const RELAY_TUNNEL_CRYPTO_ERROR_CODES = [
  "tunnel_handshake_failed",
  "tunnel_peer_unverified",
  "tunnel_integrity_failed",
  "tunnel_counter_exhausted",
  "tunnel_identity_unusable",
] as const;
export type RelayTunnelCryptoErrorCode = (typeof RELAY_TUNNEL_CRYPTO_ERROR_CODES)[number];

export const RELAY_TUNNEL_CRYPTO_ERROR_MESSAGES = {
  tunnel_handshake_failed: "The peer did not complete the encrypted connection.",
  tunnel_peer_unverified: "The peer did not prove the key of its certificate for this connection.",
  tunnel_integrity_failed: "An encrypted record of the connection was changed or is not valid.",
  tunnel_counter_exhausted: "The encrypted connection used all of its record numbers.",
  tunnel_identity_unusable: "The identity key cannot sign the encrypted connection.",
} as const satisfies Record<RelayTunnelCryptoErrorCode, string>;

const CONTEXT = "openbot-relay-e2e-v1";
const CLIENT_TO_HOST_INFO = `${CONTEXT} c2h`;
const HOST_TO_CLIENT_INFO = `${CONTEXT} h2c`;
const HANDSHAKE_BODY_LIMIT = 256;
const RECORD_SEALED_LIMIT = RELAY_TUNNEL_RECORD_PLAINTEXT_BYTES + RELAY_TUNNEL_TAG_BYTES;
const RECORD_NONCE_BYTES = 12;
const UNCOMPRESSED_POINT = 0x04;
const COUNTER_LIMIT = Number.MAX_SAFE_INTEGER;
const UINT32_SPAN = 2 ** 32;
const HELLO_BYTES = 2 + RELAY_TUNNEL_EPHEMERAL_KEY_BYTES + RELAY_TUNNEL_NONCE_BYTES;
const REPLY_BYTES = HELLO_BYTES + RELAY_TUNNEL_SIGNATURE_BYTES;
const FINISH_BYTES = 2 + RELAY_TUNNEL_SIGNATURE_BYTES;
const textEncoder = new TextEncoder();

export interface RelayMemoryKey {
  readonly kind: "relay-memory-key";
}

export type RelayKeyHandle = CryptoKey | RelayMemoryKey;

export interface RelayPublicKey {
  format: "spki" | "raw";
  bytes: Uint8Array;
}

export interface RelayAgreementKeyPair {
  publicKey: Uint8Array<ArrayBuffer>;
  privateKey: RelayKeyHandle;
}

export interface RelayTunnelCrypto {
  verify(publicKey: RelayPublicKey, data: Uint8Array, signature: Uint8Array): Promise<boolean>;
  sha256(data: Uint8Array): Promise<Uint8Array<ArrayBuffer>>;
  randomBytes(size: number): Uint8Array<ArrayBuffer>;
  generateAgreementKeyPair(): Promise<RelayAgreementKeyPair>;
  agree(privateKey: RelayKeyHandle, peerPublicKey: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>>;
  deriveSealKey(
    secret: Uint8Array<ArrayBuffer>,
    salt: Uint8Array<ArrayBuffer>,
    info: Uint8Array<ArrayBuffer>,
  ): Promise<RelayKeyHandle>;
  seal(
    key: RelayKeyHandle,
    nonce: Uint8Array<ArrayBuffer>,
    plaintext: Uint8Array<ArrayBuffer>,
    additionalData: Uint8Array<ArrayBuffer>,
  ): Promise<Uint8Array<ArrayBuffer>>;
  open(
    key: RelayKeyHandle,
    nonce: Uint8Array<ArrayBuffer>,
    sealed: Uint8Array<ArrayBuffer>,
    additionalData: Uint8Array<ArrayBuffer>,
  ): Promise<Uint8Array<ArrayBuffer> | null>;
}

export type RelayTunnelRole = "client" | "host";

export interface RelayTunnelBinding {
  connectionId: string;
  clientKeyId: string;
  hostKeyId: string;
}

export interface RelayTunnelParty {
  role: RelayTunnelRole;
  crypto: RelayTunnelCrypto;
  binding: RelayTunnelBinding;
  peerPublicKey: RelayPublicKey;
  sign: (transcript: Uint8Array<ArrayBuffer>) => Promise<Uint8Array | null>;
}

export type RelayTunnelHandshakeStep =
  | { kind: "wait"; send: Uint8Array<ArrayBuffer> | null }
  | {
      kind: "done";
      send: Uint8Array<ArrayBuffer> | null;
      session: RelayTunnelSession;
      rest: Uint8Array<ArrayBuffer>;
    }
  | { kind: "failed"; code: RelayTunnelCryptoErrorCode };

export type RelayTunnelSealResult =
  | { ok: true; bytes: Uint8Array<ArrayBuffer> }
  | { ok: false; code: RelayTunnelCryptoErrorCode };

export interface RelayTunnelOpenResult {
  messages: Uint8Array<ArrayBuffer>[];
  failure: RelayTunnelCryptoErrorCode | null;
}

export interface RelayTunnelContribution {
  ephemeral: Uint8Array<ArrayBuffer>;
  nonce: Uint8Array<ArrayBuffer>;
}

interface SessionKeys {
  send: RelayKeyHandle;
  receive: RelayKeyHandle;
}

type Frame = { header: Uint8Array<ArrayBuffer>; body: Uint8Array<ArrayBuffer> } | "partial" | "invalid";

class RelayTunnelFrameReader {
  #pending: Uint8Array<ArrayBuffer> = new Uint8Array(0);

  push(bytes: Uint8Array): void {
    const joined = new Uint8Array(this.#pending.byteLength + bytes.byteLength);
    joined.set(this.#pending);
    joined.set(bytes, this.#pending.byteLength);
    this.#pending = joined;
  }

  take(minimum: number, limit: number): Frame {
    const pending = this.#pending;
    if (pending.byteLength < RELAY_TUNNEL_RECORD_HEADER_BYTES) return "partial";
    const length = new DataView(pending.buffer, pending.byteOffset, pending.byteLength).getUint32(0);
    if (length < minimum || length > limit) return "invalid";
    const end = RELAY_TUNNEL_RECORD_HEADER_BYTES + length;
    if (pending.byteLength < end) return "partial";
    this.#pending = pending.subarray(end);
    return {
      header: pending.subarray(0, RELAY_TUNNEL_RECORD_HEADER_BYTES),
      body: pending.subarray(RELAY_TUNNEL_RECORD_HEADER_BYTES, end),
    };
  }

  rest(): Uint8Array<ArrayBuffer> {
    const rest = this.#pending;
    this.#pending = new Uint8Array(0);
    return rest;
  }
}

export function encodeRelayTunnelFrame(body: Uint8Array): Uint8Array<ArrayBuffer> {
  const frame = new Uint8Array(RELAY_TUNNEL_RECORD_HEADER_BYTES + body.byteLength);
  new DataView(frame.buffer).setUint32(0, body.byteLength);
  frame.set(body, RELAY_TUNNEL_RECORD_HEADER_BYTES);
  return frame;
}

export function relayTunnelTranscript(
  binding: RelayTunnelBinding,
  client: RelayTunnelContribution,
  host: RelayTunnelContribution,
  label: "client" | "host" | null,
): Uint8Array<ArrayBuffer> {
  const items = [
    textEncoder.encode(CONTEXT),
    ...(label === null ? [] : [textEncoder.encode(label)]),
    textEncoder.encode(binding.connectionId),
    textEncoder.encode(binding.clientKeyId),
    textEncoder.encode(binding.hostKeyId),
    client.ephemeral,
    client.nonce,
    host.ephemeral,
    host.nonce,
  ];
  const sequence = new Uint8Array(items.reduce((total, item) => total + 4 + item.byteLength, 0));
  const view = new DataView(sequence.buffer);
  let offset = 0;
  for (const item of items) {
    view.setUint32(offset, item.byteLength);
    sequence.set(item, offset + 4);
    offset += 4 + item.byteLength;
  }
  return sequence;
}

export function relayTunnelRecordNonce(counter: number): Uint8Array<ArrayBuffer> {
  const nonce = new Uint8Array(RECORD_NONCE_BYTES);
  const view = new DataView(nonce.buffer);
  view.setUint32(4, Math.floor(counter / UINT32_SPAN));
  view.setUint32(8, counter >>> 0);
  return nonce;
}

function handshakeMessage(type: number, ...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const body = new Uint8Array(2 + parts.reduce((total, part) => total + part.byteLength, 0));
  body[0] = RELAY_TUNNEL_CRYPTO_VERSION;
  body[1] = type;
  let offset = 2;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.byteLength;
  }
  return encodeRelayTunnelFrame(body);
}

function readContribution(body: Uint8Array<ArrayBuffer>, type: number, size: number): RelayTunnelContribution | null {
  if (body.byteLength !== size || body[0] !== RELAY_TUNNEL_CRYPTO_VERSION || body[1] !== type) return null;
  const ephemeral = body.slice(2, 2 + RELAY_TUNNEL_EPHEMERAL_KEY_BYTES);
  if (ephemeral[0] !== UNCOMPRESSED_POINT) return null;
  const nonceEnd = 2 + RELAY_TUNNEL_EPHEMERAL_KEY_BYTES + RELAY_TUNNEL_NONCE_BYTES;
  return { ephemeral, nonce: body.slice(2 + RELAY_TUNNEL_EPHEMERAL_KEY_BYTES, nonceEnd) };
}

function readFinish(body: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> | null {
  if (body.byteLength !== FINISH_BYTES || body[0] !== RELAY_TUNNEL_CRYPTO_VERSION) return null;
  return body[1] === RELAY_TUNNEL_MESSAGE_TYPES.finish ? body.slice(2) : null;
}

class HandshakeFailure {
  constructor(readonly code: RelayTunnelCryptoErrorCode) {}
}

async function attempt<Result>(code: RelayTunnelCryptoErrorCode, run: () => Promise<Result>): Promise<Result> {
  try {
    return await run();
  } catch {
    throw new HandshakeFailure(code);
  }
}

export class RelayTunnelHandshake {
  readonly #party: RelayTunnelParty;
  readonly #frames = new RelayTunnelFrameReader();
  #agreement: RelayAgreementKeyPair | null = null;
  #own: RelayTunnelContribution | null = null;
  #keys: SessionKeys | null = null;
  #peer: RelayTunnelContribution | null = null;
  #phase: "new" | "waiting-reply" | "waiting-hello" | "waiting-finish" | "ended" = "new";
  #turn: Promise<unknown> = Promise.resolve();

  constructor(party: RelayTunnelParty) {
    this.#party = party;
  }

  begin(): Promise<RelayTunnelHandshakeStep> {
    return this.#serialized(async () => {
      if (this.#phase !== "new") throw new HandshakeFailure("tunnel_handshake_failed");
      if (this.#party.role === "host") {
        this.#phase = "waiting-hello";
        return { kind: "wait", send: null };
      }
      const own = await this.#contribute();
      this.#phase = "waiting-reply";
      return { kind: "wait", send: handshakeMessage(RELAY_TUNNEL_MESSAGE_TYPES.hello, own.ephemeral, own.nonce) };
    });
  }

  receive(bytes: Uint8Array): Promise<RelayTunnelHandshakeStep> {
    return this.#serialized(async () => {
      this.#frames.push(bytes);
      let send: Uint8Array<ArrayBuffer> | null = null;
      for (;;) {
        const frame = this.#frames.take(1, HANDSHAKE_BODY_LIMIT);
        if (frame === "partial") return { kind: "wait", send };
        if (frame === "invalid") throw new HandshakeFailure("tunnel_handshake_failed");
        if (this.#phase === "waiting-reply") return this.#clientFinishes(frame.body);
        if (this.#phase === "waiting-finish") return this.#hostFinishes(frame.body, send);
        if (this.#phase !== "waiting-hello") throw new HandshakeFailure("tunnel_handshake_failed");
        send = await this.#hostReplies(frame.body);
      }
    });
  }

  async #serialized(run: () => Promise<RelayTunnelHandshakeStep>): Promise<RelayTunnelHandshakeStep> {
    const turn = this.#turn.then(async (): Promise<RelayTunnelHandshakeStep> => {
      if (this.#phase === "ended") return { kind: "failed", code: "tunnel_handshake_failed" };
      try {
        const step = await run();
        if (step.kind === "done") this.#end();
        return step;
      } catch (error) {
        this.#end();
        return { kind: "failed", code: error instanceof HandshakeFailure ? error.code : "tunnel_handshake_failed" };
      }
    });
    this.#turn = turn;
    return turn;
  }

  async #contribute(): Promise<RelayTunnelContribution> {
    const { crypto } = this.#party;
    const agreement = await attempt("tunnel_handshake_failed", () => crypto.generateAgreementKeyPair());
    if (agreement.publicKey.byteLength !== RELAY_TUNNEL_EPHEMERAL_KEY_BYTES) {
      throw new HandshakeFailure("tunnel_handshake_failed");
    }
    this.#agreement = agreement;
    const own = { ephemeral: agreement.publicKey, nonce: crypto.randomBytes(RELAY_TUNNEL_NONCE_BYTES) };
    this.#own = own;
    return own;
  }

  async #clientFinishes(body: Uint8Array<ArrayBuffer>): Promise<RelayTunnelHandshakeStep> {
    const client = this.#own;
    const host = readContribution(body, RELAY_TUNNEL_MESSAGE_TYPES.reply, REPLY_BYTES);
    if (!client || !host) throw new HandshakeFailure("tunnel_handshake_failed");
    await this.#verifyPeer(client, host, "host", body.subarray(HELLO_BYTES));
    const keys = await this.#deriveKeys(client, host, host.ephemeral);
    const signature = await this.#sign(client, host, "client");
    const session = new RelayTunnelSession(this.#party.crypto, keys);
    return {
      kind: "done",
      send: handshakeMessage(RELAY_TUNNEL_MESSAGE_TYPES.finish, signature),
      session,
      rest: this.#frames.rest(),
    };
  }

  async #hostReplies(body: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
    const client = readContribution(body, RELAY_TUNNEL_MESSAGE_TYPES.hello, HELLO_BYTES);
    if (!client) throw new HandshakeFailure("tunnel_handshake_failed");
    const host = await this.#contribute();
    this.#peer = client;
    const signature = await this.#sign(client, host, "host");
    this.#keys = await this.#deriveKeys(client, host, client.ephemeral);
    this.#phase = "waiting-finish";
    return handshakeMessage(RELAY_TUNNEL_MESSAGE_TYPES.reply, host.ephemeral, host.nonce, signature);
  }

  async #hostFinishes(
    body: Uint8Array<ArrayBuffer>,
    send: Uint8Array<ArrayBuffer> | null,
  ): Promise<RelayTunnelHandshakeStep> {
    const signature = readFinish(body);
    const client = this.#peer;
    const host = this.#own;
    const keys = this.#keys;
    if (!signature || !client || !host || !keys) throw new HandshakeFailure("tunnel_handshake_failed");
    await this.#verifyPeer(client, host, "client", signature);
    return { kind: "done", send, session: new RelayTunnelSession(this.#party.crypto, keys), rest: this.#frames.rest() };
  }

  async #verifyPeer(
    client: RelayTunnelContribution,
    host: RelayTunnelContribution,
    label: "client" | "host",
    signature: Uint8Array<ArrayBuffer>,
  ): Promise<void> {
    const { crypto, binding, peerPublicKey } = this.#party;
    const verified = await attempt("tunnel_peer_unverified", async () => {
      const transcript = await crypto.sha256(relayTunnelTranscript(binding, client, host, label));
      return crypto.verify(peerPublicKey, transcript, signature);
    });
    if (!verified) throw new HandshakeFailure("tunnel_peer_unverified");
  }

  async #sign(
    client: RelayTunnelContribution,
    host: RelayTunnelContribution,
    label: "client" | "host",
  ): Promise<Uint8Array> {
    const { crypto, binding } = this.#party;
    const transcript = await crypto.sha256(relayTunnelTranscript(binding, client, host, label));
    const signature = await attempt("tunnel_identity_unusable", () => this.#party.sign(transcript));
    if (!signature || signature.byteLength !== RELAY_TUNNEL_SIGNATURE_BYTES) {
      throw new HandshakeFailure("tunnel_identity_unusable");
    }
    return signature;
  }

  async #deriveKeys(
    client: RelayTunnelContribution,
    host: RelayTunnelContribution,
    peerEphemeral: Uint8Array<ArrayBuffer>,
  ): Promise<SessionKeys> {
    const { crypto, binding, role } = this.#party;
    const agreement = this.#agreement;
    this.#agreement = null;
    if (!agreement) throw new HandshakeFailure("tunnel_handshake_failed");
    const secret = await attempt("tunnel_handshake_failed", () => crypto.agree(agreement.privateKey, peerEphemeral));
    try {
      const salt = await crypto.sha256(relayTunnelTranscript(binding, client, host, null));
      const [clientToHost, hostToClient] = await attempt("tunnel_handshake_failed", () =>
        Promise.all([
          crypto.deriveSealKey(secret, salt, textEncoder.encode(CLIENT_TO_HOST_INFO)),
          crypto.deriveSealKey(secret, salt, textEncoder.encode(HOST_TO_CLIENT_INFO)),
        ]),
      );
      return role === "client"
        ? { send: clientToHost, receive: hostToClient }
        : { send: hostToClient, receive: clientToHost };
    } finally {
      secret.fill(0);
    }
  }

  #end(): void {
    this.#phase = "ended";
    this.#agreement = null;
    this.#keys = null;
    this.#own = null;
    this.#peer = null;
  }
}

export class RelayTunnelSession {
  readonly #crypto: RelayTunnelCrypto;
  readonly #keys: SessionKeys;
  readonly #records = new RelayTunnelFrameReader();
  #sendCounter = 0;
  #receiveCounter = 0;
  #sealing: Promise<unknown> = Promise.resolve();
  #opening: Promise<unknown> = Promise.resolve();
  #sealFailure: RelayTunnelCryptoErrorCode | null = null;
  #decodeFailure: RelayTunnelCryptoErrorCode | null = null;
  #openFailure: RelayTunnelCryptoErrorCode | null = null;

  constructor(crypto: RelayTunnelCrypto, keys: SessionKeys) {
    this.#crypto = crypto;
    this.#keys = keys;
  }

  seal(plaintext: Uint8Array): Promise<RelayTunnelSealResult> {
    const pieces: Array<{ counter: number; piece: Uint8Array<ArrayBuffer> }> = [];
    let failure: RelayTunnelCryptoErrorCode | null = null;
    for (let offset = 0; offset < plaintext.byteLength && failure === null; ) {
      const end = Math.min(plaintext.byteLength, offset + RELAY_TUNNEL_RECORD_PLAINTEXT_BYTES);
      if (this.#sendCounter > COUNTER_LIMIT) failure = "tunnel_counter_exhausted";
      else pieces.push({ counter: this.#sendCounter++, piece: plaintext.slice(offset, end) });
      offset = end;
    }
    const sealed = Promise.all(pieces.map((entry) => this.#sealRecord(entry))).then(
      (records) => joined(records),
      () => null,
    );
    const result = this.#sealing.then(async (): Promise<RelayTunnelSealResult> => {
      if (this.#sealFailure !== null) return { ok: false, code: this.#sealFailure };
      const bytes = await sealed;
      this.#sealFailure = bytes === null ? "tunnel_integrity_failed" : failure;
      return this.#sealFailure === null && bytes !== null
        ? { ok: true, bytes }
        : { ok: false, code: this.#sealFailure ?? "tunnel_integrity_failed" };
    });
    this.#sealing = result;
    return result;
  }

  open(bytes: Uint8Array): Promise<RelayTunnelOpenResult> {
    const records: Array<Promise<Uint8Array<ArrayBuffer> | null>> = [];
    let failure = this.#decodeFailure;
    if (failure === null) this.#records.push(bytes);
    while (failure === null) {
      const frame = this.#records.take(RELAY_TUNNEL_TAG_BYTES + 1, RECORD_SEALED_LIMIT);
      if (frame === "partial") break;
      if (frame === "invalid") failure = "tunnel_integrity_failed";
      else if (this.#receiveCounter > COUNTER_LIMIT) failure = "tunnel_counter_exhausted";
      else records.push(this.#openRecord(this.#receiveCounter++, frame.header, frame.body));
    }
    this.#decodeFailure = failure;
    const result = this.#opening.then(async (): Promise<RelayTunnelOpenResult> => {
      if (this.#openFailure !== null) return { messages: [], failure: this.#openFailure };
      const messages: Uint8Array<ArrayBuffer>[] = [];
      for (const message of await Promise.all(records)) {
        if (message === null) {
          this.#openFailure = "tunnel_integrity_failed";
          return { messages, failure: this.#openFailure };
        }
        messages.push(message);
      }
      this.#openFailure = failure;
      return { messages, failure };
    });
    this.#opening = result;
    return result;
  }

  async #sealRecord(entry: { counter: number; piece: Uint8Array<ArrayBuffer> }): Promise<Uint8Array<ArrayBuffer>> {
    const header = new Uint8Array(RELAY_TUNNEL_RECORD_HEADER_BYTES);
    new DataView(header.buffer).setUint32(0, entry.piece.byteLength + RELAY_TUNNEL_TAG_BYTES);
    const sealed = await this.#crypto.seal(this.#keys.send, relayTunnelRecordNonce(entry.counter), entry.piece, header);
    if (sealed.byteLength !== entry.piece.byteLength + RELAY_TUNNEL_TAG_BYTES) {
      throw new HandshakeFailure("tunnel_integrity_failed");
    }
    return joined([header, sealed]);
  }

  #openRecord(
    counter: number,
    header: Uint8Array<ArrayBuffer>,
    sealed: Uint8Array<ArrayBuffer>,
  ): Promise<Uint8Array<ArrayBuffer> | null> {
    return this.#crypto.open(this.#keys.receive, relayTunnelRecordNonce(counter), sealed, header).catch(() => null);
  }
}

function joined(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}
