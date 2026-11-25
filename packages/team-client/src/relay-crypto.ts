export interface RelayMemoryKey {
  readonly kind: "relay-memory-key";
}

export type RelayPrivateKey = CryptoKey | RelayMemoryKey;

export interface RelayPublicKey {
  format: "spki" | "raw";
  bytes: Uint8Array;
}

export interface RelayCrypto {
  importPrivateKey(pkcs8: Uint8Array<ArrayBuffer>): Promise<RelayPrivateKey>;
  sign(privateKey: RelayPrivateKey, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>>;
  verify(publicKey: RelayPublicKey, data: Uint8Array, signature: Uint8Array): Promise<boolean>;
  sha256(data: Uint8Array): Promise<Uint8Array<ArrayBuffer>>;
  randomBytes(size: number): Uint8Array<ArrayBuffer>;
}

export const RELAY_ECDSA_P256 = { name: "ECDSA", namedCurve: "P-256" } as const;
export const RELAY_ECDSA_SHA256 = { name: "ECDSA", hash: "SHA-256" } as const;

export const webRelayCrypto: RelayCrypto = {
  importPrivateKey: (pkcs8) => crypto.subtle.importKey("pkcs8", pkcs8, RELAY_ECDSA_P256, false, ["sign"]),
  async sign(privateKey, data) {
    if (!(privateKey instanceof CryptoKey)) throw new Error("This key cannot sign with WebCrypto.");
    return new Uint8Array(await crypto.subtle.sign(RELAY_ECDSA_SHA256, privateKey, data));
  },
  async verify(publicKey, data, signature) {
    const key = await crypto.subtle.importKey(publicKey.format, owned(publicKey.bytes), RELAY_ECDSA_P256, false, [
      "verify",
    ]);
    return crypto.subtle.verify(RELAY_ECDSA_SHA256, key, owned(signature), owned(data));
  },
  sha256: async (data) => new Uint8Array(await crypto.subtle.digest("SHA-256", owned(data))),
  randomBytes: (size) => crypto.getRandomValues(new Uint8Array(size)),
};

export function owned(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes);
}
