import { gcm } from "@noble/ciphers/aes.js";
import { p256 } from "@noble/curves/nist.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  encodeRelayP256PrivateKey,
  encodeRelayP256Spki,
  readRelayP256PrivateKey,
  readRelaySpkiPublicKey,
} from "@openbot/contracts/relay-protocol/x509";
import { owned, type RelayCrypto, type RelayMemoryKey, type RelayPrivateKey } from "./relay-crypto";

export interface NobleRelayCryptoOptions {
  randomBytes: (size: number) => Uint8Array;
}

const SEAL_KEY_BYTES = 32;
const P256_SEED_BYTES = 48;

export function createNobleRelayCrypto(options: NobleRelayCryptoOptions): RelayCrypto {
  const secrets = new WeakMap<RelayPrivateKey, Uint8Array>();
  const agreementSecrets = new WeakMap<RelayPrivateKey, Uint8Array>();
  const sealKeys = new WeakMap<RelayPrivateKey, Uint8Array>();
  const randomBytes = (size: number) => {
    const bytes = options.randomBytes(size);
    if (bytes.byteLength !== size) throw new Error("The random source returned the wrong number of bytes.");
    return owned(bytes);
  };
  const memoryKey = (store: WeakMap<RelayPrivateKey, Uint8Array>, secret: Uint8Array): RelayMemoryKey => {
    const key: RelayMemoryKey = Object.freeze({ kind: "relay-memory-key" });
    store.set(key, secret);
    return key;
  };
  const sealKey = (key: RelayPrivateKey) => {
    const bytes = sealKeys.get(key);
    if (!bytes) throw new Error("This key cannot seal in this client.");
    return bytes;
  };
  return {
    async importPrivateKey(pkcs8) {
      const secret = readRelayP256PrivateKey(pkcs8);
      if (!secret || !p256.utils.isValidSecretKey(secret)) throw new Error("The private key cannot be read.");
      return memoryKey(secrets, secret);
    },
    async generateSigningKey() {
      const secret = p256.utils.randomSecretKey(randomBytes(p256.lengths.seed ?? P256_SEED_BYTES));
      const point = p256.getPublicKey(secret, false);
      const publicKey = encodeRelayP256Spki(point);
      const pkcs8 = encodeRelayP256PrivateKey(secret, point);
      if (!publicKey || !pkcs8) throw new Error("The new key cannot be encoded.");
      return { publicKey, privateKey: memoryKey(secrets, secret), pkcs8 };
    },
    async sign(privateKey, data) {
      const secret = secrets.get(privateKey);
      if (!secret) throw new Error("This key cannot sign in this client.");
      return owned(p256.sign(data, secret, { prehash: true, format: "compact" }));
    },
    async verify(publicKey, data, signature) {
      const point = publicKey.format === "raw" ? publicKey.bytes : readRelaySpkiPublicKey(publicKey.bytes);
      if (!point) return false;
      try {
        return p256.verify(signature, data, point, { prehash: true, lowS: false, format: "compact" });
      } catch {
        return false;
      }
    },
    sha256: async (data) => owned(sha256(data)),
    randomBytes,
    async generateAgreementKeyPair() {
      const secret = p256.utils.randomSecretKey(randomBytes(p256.lengths.seed ?? P256_SEED_BYTES));
      return { publicKey: owned(p256.getPublicKey(secret, false)), privateKey: memoryKey(agreementSecrets, secret) };
    },
    async agree(privateKey, peerPublicKey) {
      const secret = agreementSecrets.get(privateKey);
      agreementSecrets.delete(privateKey);
      if (!secret) throw new Error("This agreement key is used or unknown.");
      try {
        return owned(p256.getSharedSecret(secret, peerPublicKey, true).subarray(1));
      } finally {
        secret.fill(0);
      }
    },
    async deriveSealKey(secret, salt, info) {
      return memoryKey(sealKeys, hkdf(sha256, secret, salt, info, SEAL_KEY_BYTES));
    },
    seal: async (key, nonce, plaintext, additionalData) =>
      owned(gcm(sealKey(key), nonce, additionalData).encrypt(plaintext)),
    async open(key, nonce, sealed, additionalData) {
      try {
        return owned(gcm(sealKey(key), nonce, additionalData).decrypt(sealed));
      } catch {
        return null;
      }
    },
  };
}
