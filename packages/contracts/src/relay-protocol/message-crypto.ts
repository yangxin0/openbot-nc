import {
  RELAY_HUB_KINDS,
  type RelayHubKind,
  relayBase64UrlBytes,
  relayBase64UrlText,
  relayLengthPrefixed,
  relayMessageKeyTranscript,
  relayUint64,
} from "./hub";

export const RELAY_MESSAGE_KEY_BYTES = 65;
export const RELAY_MESSAGE_COUNTER_BYTES = 8;
export const RELAY_MESSAGE_TAG_BYTES = 16;

export const RELAY_MESSAGE_CRYPTO_ERROR_CODES = [
  "message_unverified",
  "message_integrity_failed",
  "message_replayed",
  "message_counter_exhausted",
] as const;
export type RelayMessageCryptoErrorCode = (typeof RELAY_MESSAGE_CRYPTO_ERROR_CODES)[number];

const PAIR_CONTEXT = "openbot-relay-message-v1";
const NONCE_BYTES = 12;
const UNCOMPRESSED_POINT = 0x04;
const COUNTER_LIMIT = Number.MAX_SAFE_INTEGER;
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

export interface RelayMessageCrypto {
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

export interface RelayMessageKey {
  publicKey: Uint8Array<ArrayBuffer>;
  privateKey: RelayKeyHandle;
  text: string;
  signature: string;
  timestamp: number;
}

export interface RelayPairKeys {
  send: RelayKeyHandle;
  receive: RelayKeyHandle;
}

export interface RelayMessageBinding {
  from: string;
  to: string;
  id: number;
  kind: RelayHubKind;
}

export async function createRelayMessageKey(
  crypto: RelayMessageCrypto,
  input: { keyId: string; timestamp: number; sign: (data: Uint8Array<ArrayBuffer>) => Promise<Uint8Array | null> },
): Promise<RelayMessageKey | null> {
  const pair = await crypto.generateAgreementKeyPair();
  if (!isMessageKeyPoint(pair.publicKey)) return null;
  const signature = await input.sign(
    relayMessageKeyTranscript({ keyId: input.keyId, messageKey: pair.publicKey, timestamp: input.timestamp }),
  );
  if (!signature) return null;
  return {
    publicKey: pair.publicKey,
    privateKey: pair.privateKey,
    text: relayBase64UrlText(pair.publicKey),
    signature: relayBase64UrlText(signature),
    timestamp: input.timestamp,
  };
}

export async function verifyRelayMessageKey(
  crypto: RelayMessageCrypto,
  input: { keyId: string; messageKey: string; signature: string; timestamp: number; spki: Uint8Array },
): Promise<Uint8Array<ArrayBuffer> | null> {
  const point = relayBase64UrlBytes(input.messageKey);
  const signature = relayBase64UrlBytes(input.signature);
  if (!point || !signature || !isMessageKeyPoint(point)) return null;
  const transcript = relayMessageKeyTranscript({ keyId: input.keyId, messageKey: point, timestamp: input.timestamp });
  try {
    return (await crypto.verify({ format: "spki", bytes: input.spki }, transcript, signature)) ? point : null;
  } catch {
    return null;
  }
}

export async function deriveRelayPairKeys(
  crypto: RelayMessageCrypto,
  input: {
    selfKeyId: string;
    selfMessageKey: RelayMessageKey;
    peerKeyId: string;
    peerMessageKey: Uint8Array<ArrayBuffer>;
  },
): Promise<RelayPairKeys | null> {
  if (input.selfKeyId === input.peerKeyId || !isMessageKeyPoint(input.peerMessageKey)) return null;
  let secret: Uint8Array<ArrayBuffer>;
  try {
    secret = await crypto.agree(input.selfMessageKey.privateKey, input.peerMessageKey);
  } catch {
    return null;
  }
  const self = { keyId: input.selfKeyId, messageKey: input.selfMessageKey.publicKey };
  const peer = { keyId: input.peerKeyId, messageKey: input.peerMessageKey };
  const [low, high] = self.keyId < peer.keyId ? [self, peer] : [peer, self];
  const salt = await crypto.sha256(
    relayLengthPrefixed([
      textEncoder.encode(PAIR_CONTEXT),
      textEncoder.encode(low.keyId),
      textEncoder.encode(high.keyId),
      low.messageKey,
      high.messageKey,
    ]),
  );
  const info = (from: string, to: string) =>
    relayLengthPrefixed([textEncoder.encode(PAIR_CONTEXT), textEncoder.encode(from), textEncoder.encode(to)]);
  const [send, receive] = await Promise.all([
    crypto.deriveSealKey(secret, salt, info(self.keyId, peer.keyId)),
    crypto.deriveSealKey(secret, salt, info(peer.keyId, self.keyId)),
  ]);
  secret.fill(0);
  return { send, receive };
}

export function relayMessageNonce(kind: RelayHubKind, counter: number): Uint8Array<ArrayBuffer> {
  const nonce = new Uint8Array(NONCE_BYTES);
  nonce[0] = RELAY_HUB_KINDS[kind];
  nonce.set(relayUint64(counter), NONCE_BYTES - RELAY_MESSAGE_COUNTER_BYTES);
  return nonce;
}

export function relayMessageAdditionalData(binding: RelayMessageBinding, counter: number): Uint8Array<ArrayBuffer> {
  const id = new Uint8Array(4);
  new DataView(id.buffer).setUint32(0, binding.id);
  return relayLengthPrefixed([
    textEncoder.encode(binding.from),
    textEncoder.encode(binding.to),
    id,
    Uint8Array.of(RELAY_HUB_KINDS[binding.kind]),
    relayUint64(counter),
  ]);
}

export async function sealRelayMessage(
  crypto: RelayMessageCrypto,
  key: RelayKeyHandle,
  binding: RelayMessageBinding,
  counter: number,
  plaintext: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const sealed = await crypto.seal(
    key,
    relayMessageNonce(binding.kind, counter),
    plaintext,
    relayMessageAdditionalData(binding, counter),
  );
  const payload = new Uint8Array(RELAY_MESSAGE_COUNTER_BYTES + sealed.byteLength);
  payload.set(relayUint64(counter));
  payload.set(sealed, RELAY_MESSAGE_COUNTER_BYTES);
  return payload;
}

export function relayMessageCounter(payload: Uint8Array): number | null {
  if (payload.byteLength < RELAY_MESSAGE_COUNTER_BYTES + RELAY_MESSAGE_TAG_BYTES) return null;
  const view = new DataView(payload.buffer, payload.byteOffset, RELAY_MESSAGE_COUNTER_BYTES);
  const counter = view.getUint32(0) * 2 ** 32 + view.getUint32(4);
  return counter >= 1 && counter <= COUNTER_LIMIT ? counter : null;
}

export async function openRelayMessage(
  crypto: RelayMessageCrypto,
  key: RelayKeyHandle,
  binding: RelayMessageBinding,
  payload: Uint8Array<ArrayBuffer>,
): Promise<{ counter: number; plaintext: Uint8Array<ArrayBuffer> } | null> {
  const counter = relayMessageCounter(payload);
  if (counter === null) return null;
  const plaintext = await crypto.open(
    key,
    relayMessageNonce(binding.kind, counter),
    new Uint8Array(payload.subarray(RELAY_MESSAGE_COUNTER_BYTES)),
    relayMessageAdditionalData(binding, counter),
  );
  return plaintext ? { counter, plaintext } : null;
}

export class RelayMessageCounters {
  readonly #sent = new Map<RelayHubKind, number>();
  readonly #received = new Map<RelayHubKind, number>();

  next(kind: RelayHubKind): number | null {
    const counter = (this.#sent.get(kind) ?? 0) + 1;
    if (counter > COUNTER_LIMIT) return null;
    this.#sent.set(kind, counter);
    return counter;
  }

  fresh(kind: RelayHubKind, counter: number): boolean {
    return counter > (this.#received.get(kind) ?? 0);
  }

  accept(kind: RelayHubKind, counter: number): boolean {
    if (!this.fresh(kind, counter)) return false;
    this.#received.set(kind, counter);
    return true;
  }
}

function isMessageKeyPoint(bytes: Uint8Array): boolean {
  return bytes.byteLength === RELAY_MESSAGE_KEY_BYTES && bytes[0] === UNCOMPRESSED_POINT;
}
