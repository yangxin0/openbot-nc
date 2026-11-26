import type {
  RelayKeyHandle,
  RelayMemoryKey,
  RelayPublicKey,
  RelayTunnelCrypto,
} from "@openbot/contracts/relay-protocol/tunnel-crypto";

export type { RelayMemoryKey, RelayPublicKey };

export type RelayPrivateKey = RelayKeyHandle;

export interface RelaySigningKey {
  publicKey: Uint8Array<ArrayBuffer>;
  privateKey: RelayPrivateKey;
  pkcs8: Uint8Array<ArrayBuffer> | null;
}

export interface RelayCrypto extends RelayTunnelCrypto {
  importPrivateKey(pkcs8: Uint8Array<ArrayBuffer>): Promise<RelayPrivateKey>;
  generateSigningKey(): Promise<RelaySigningKey>;
  sign(privateKey: RelayPrivateKey, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>>;
}

export const RELAY_ECDSA_P256 = { name: "ECDSA", namedCurve: "P-256" } as const;
export const RELAY_ECDSA_SHA256 = { name: "ECDSA", hash: "SHA-256" } as const;
const RELAY_ECDH_P256 = { name: "ECDH", namedCurve: "P-256" } as const;
const RELAY_AES_GCM_256 = { name: "AES-GCM", length: 256 } as const;
const RELAY_SHARED_SECRET_BITS = 256;
const RELAY_TAG_BITS = 128;

export const webRelayCrypto: RelayCrypto = {
  importPrivateKey: (pkcs8) => crypto.subtle.importKey("pkcs8", pkcs8, RELAY_ECDSA_P256, false, ["sign"]),
  async generateSigningKey() {
    const pair = await crypto.subtle.generateKey(RELAY_ECDSA_P256, false, ["sign", "verify"]);
    const publicKey = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
    return { publicKey, privateKey: pair.privateKey, pkcs8: null };
  },
  async sign(privateKey, data) {
    return new Uint8Array(await crypto.subtle.sign(RELAY_ECDSA_SHA256, webKey(privateKey), data));
  },
  async verify(publicKey, data, signature) {
    const key = await crypto.subtle.importKey(publicKey.format, owned(publicKey.bytes), RELAY_ECDSA_P256, false, [
      "verify",
    ]);
    return crypto.subtle.verify(RELAY_ECDSA_SHA256, key, owned(signature), owned(data));
  },
  sha256: async (data) => new Uint8Array(await crypto.subtle.digest("SHA-256", owned(data))),
  randomBytes: (size) => crypto.getRandomValues(new Uint8Array(size)),
  async generateAgreementKeyPair() {
    const pair = await crypto.subtle.generateKey(RELAY_ECDH_P256, false, ["deriveBits"]);
    return {
      publicKey: new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)),
      privateKey: pair.privateKey,
    };
  },
  async agree(privateKey, peerPublicKey) {
    const peer = await crypto.subtle.importKey("raw", peerPublicKey, RELAY_ECDH_P256, false, []);
    const bits = await crypto.subtle.deriveBits(
      { name: "ECDH", public: peer },
      webKey(privateKey),
      RELAY_SHARED_SECRET_BITS,
    );
    return new Uint8Array(bits);
  },
  async deriveSealKey(secret, salt, info) {
    const base = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt, info }, base, RELAY_AES_GCM_256, false, [
      "encrypt",
      "decrypt",
    ]);
  },
  async seal(key, nonce, plaintext, additionalData) {
    const parameters = { name: "AES-GCM", iv: nonce, additionalData, tagLength: RELAY_TAG_BITS };
    return new Uint8Array(await crypto.subtle.encrypt(parameters, webKey(key), plaintext));
  },
  async open(key, nonce, sealed, additionalData) {
    const parameters = { name: "AES-GCM", iv: nonce, additionalData, tagLength: RELAY_TAG_BITS };
    try {
      return new Uint8Array(await crypto.subtle.decrypt(parameters, webKey(key), sealed));
    } catch {
      return null;
    }
  },
};

function webKey(key: RelayKeyHandle): CryptoKey {
  if (!(key instanceof CryptoKey)) throw new Error("This key cannot be used with WebCrypto.");
  return key;
}

export function owned(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes);
}
