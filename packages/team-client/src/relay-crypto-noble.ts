import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { readRelayP256PrivateKey, readRelaySpkiPublicKey } from "@openbot/contracts/relay-protocol/x509";
import { owned, type RelayCrypto, type RelayMemoryKey, type RelayPrivateKey } from "./relay-crypto";

export interface NobleRelayCryptoOptions {
  randomBytes: (size: number) => Uint8Array;
}

export function createNobleRelayCrypto(options: NobleRelayCryptoOptions): RelayCrypto {
  const secrets = new WeakMap<RelayPrivateKey, Uint8Array>();
  return {
    async importPrivateKey(pkcs8) {
      const secret = readRelayP256PrivateKey(pkcs8);
      if (!secret || !p256.utils.isValidSecretKey(secret)) throw new Error("The private key cannot be read.");
      const key: RelayMemoryKey = Object.freeze({ kind: "relay-memory-key" });
      secrets.set(key, secret);
      return key;
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
    randomBytes: (size) => {
      const bytes = options.randomBytes(size);
      if (bytes.byteLength !== size) throw new Error("The random source returned the wrong number of bytes.");
      return owned(bytes);
    },
  };
}
