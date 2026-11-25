import { decodeRelayIdentityBundle } from "@openbot/contracts/relay-protocol/identity-bundle";
import { RELAY_X509_OID, readRelayPrivateKeyAlgorithm } from "@openbot/contracts/relay-protocol/x509";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { Schema } from "effect";
import {
  isRelayP256Certificate,
  RELAY_ECDSA_P256,
  RELAY_ECDSA_SHA256,
  type RelayCertificate,
  readRelayCertificate,
  readRelayPem,
  relayCertificateNames,
  relayIssuance,
  relayTrustPairs,
  verifyRelayP256,
} from "./relay-certificates";

export const RELAY_IDENTITY_TEXT_LIMIT = 64 * 1024;
const STORED_IDENTITY_VERSION = 1;
const DATABASE_NAME = "openbot-relay-identity";
const OBJECT_STORE = "identity";
const RECORD_KEY = "current";
const KEY_CHECK_BYTES = 32;

const RELAY_IDENTITY_ERROR_CODES = [
  "invalid_bundle",
  "unsupported_key",
  "key_mismatch",
  "untrusted_chain",
  "expired",
  "not_yet_valid",
  "storage",
] as const;
export type RelayIdentityErrorCode = (typeof RELAY_IDENTITY_ERROR_CODES)[number];

export class RelayIdentityError extends Schema.TaggedError<RelayIdentityError>()("RelayIdentityError", {
  code: Schema.Literals(RELAY_IDENTITY_ERROR_CODES),
  message: Schema.String,
}) {}

export interface RelayBrowserIdentity {
  relayUrl: string | null;
  team: string;
  user: string;
  device: string | null;
  keyId: string;
  certificate: string;
  chain: readonly string[];
  root: string;
  startsAt: number;
  expiresAt: number;
  privateKey: CryptoKey;
}

export interface RelayIdentityKeyStore {
  load(): Promise<RelayBrowserIdentity | null>;
  save(identity: RelayBrowserIdentity): Promise<void>;
  remove(): Promise<void>;
}

export interface IndexedDbRelayIdentityOptions {
  databaseName?: string;
  factory?: IDBFactory;
}

const refused = (code: RelayIdentityErrorCode, message: string) => new RelayIdentityError({ code, message });

export async function readRelayIdentityText(text: string, now = Date.now()): Promise<RelayBrowserIdentity> {
  if (text.length > RELAY_IDENTITY_TEXT_LIMIT) throw refused("invalid_bundle", "The identity file is too large.");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw refused("invalid_bundle", "The identity file is not valid.");
  }
  const bundle = decodeRelayIdentityBundle(value);
  if (!bundle) throw refused("invalid_bundle", "The identity file is not valid.");
  const [leaf = null, root = null, ...authorities] = await Promise.all([
    readRelayCertificate(bundle.certificate),
    readRelayCertificate(bundle.root),
    ...bundle.chain.map(readRelayCertificate),
  ]);
  const chain = authorities.filter((certificate) => certificate !== null);
  if (!leaf || !root || leaf.authority || chain.length !== authorities.length) {
    throw refused("invalid_bundle", "A certificate in the identity file cannot be used.");
  }
  const names = relayCertificateNames(leaf);
  if (!names || names.team !== bundle.team || names.user !== bundle.user || names.device !== bundle.device) {
    throw refused("invalid_bundle", "The certificate does not name the team, user and device of the identity file.");
  }
  const privateKey = await importPrivateKey(bundle.privateKey);
  if (!isRelayP256Certificate(leaf) || !(await keyMatches(privateKey, leaf))) {
    throw refused("key_mismatch", "The private key is not the key of the certificate.");
  }
  const issuedBy = await relayIssuance([[root, root], ...relayTrustPairs(leaf, root, chain)]);
  const authority = chain.find((candidate) => issuedBy(leaf, candidate) && issuedBy(candidate, root));
  const path: RelayCertificate[] | null = issuedBy(leaf, root) ? [root] : authority ? [authority, root] : null;
  if (!issuedBy(root, root) || !path) {
    throw refused("untrusted_chain", "The root of the identity file did not issue the certificate.");
  }
  for (const issuer of path.slice(0, -1)) {
    const issuerNames = relayCertificateNames(issuer);
    if (!issuerNames || (issuerNames.team !== null && issuerNames.team !== bundle.team)) {
      throw refused("untrusted_chain", "The team authority is for a different team.");
    }
  }
  const startsAt = Math.max(leaf.notBefore, ...path.map((certificate) => certificate.notBefore));
  const expiresAt = Math.min(leaf.notAfter, ...path.map((certificate) => certificate.notAfter));
  if (!Number.isFinite(startsAt) || !Number.isFinite(expiresAt)) {
    throw refused("invalid_bundle", "The certificate dates cannot be read.");
  }
  if (now >= expiresAt) throw refused("expired", "The certificate is expired.");
  if (now < startsAt) throw refused("not_yet_valid", "The certificate is not valid yet.");
  return {
    relayUrl: bundle.relayUrl,
    team: bundle.team,
    user: bundle.user,
    device: bundle.device,
    keyId: leaf.keyId,
    certificate: bundle.certificate,
    chain: [...bundle.chain],
    root: bundle.root,
    startsAt,
    expiresAt,
    privateKey,
  };
}

export async function readRelayIdentityFile(file: Blob, now = Date.now()): Promise<RelayBrowserIdentity> {
  if (file.size > RELAY_IDENTITY_TEXT_LIMIT) throw refused("invalid_bundle", "The identity file is too large.");
  let text: string;
  try {
    text = await file.text();
  } catch {
    throw refused("invalid_bundle", "The identity file cannot be read.");
  }
  return readRelayIdentityText(text, now);
}

export function createIndexedDbRelayIdentityKeyStore(
  options: IndexedDbRelayIdentityOptions = {},
): RelayIdentityKeyStore {
  const databaseName = options.databaseName ?? DATABASE_NAME;
  const factory = () => options.factory ?? indexedDB;
  const transact = async <Result>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<Result>,
  ): Promise<Result> => {
    const database = await openDatabase(factory(), databaseName);
    try {
      return await new Promise<Result>((resolve, reject) => {
        const transaction = database.transaction(OBJECT_STORE, mode);
        const request = operation(transaction.objectStore(OBJECT_STORE));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  };
  return {
    async load() {
      const stored = await transact("readonly", (store) => store.get(RECORD_KEY)).catch(() => {
        throw refused("storage", "The saved identity cannot be read.");
      });
      if (stored === undefined) return null;
      const identity = decodeStoredIdentity(stored);
      if (!identity) throw refused("storage", "The saved identity is damaged.");
      return identity;
    },
    async save(identity) {
      if (identity.privateKey.extractable)
        throw refused("unsupported_key", "Only a key that cannot be exported is saved.");
      const stored = { version: STORED_IDENTITY_VERSION, ...identity, chain: [...identity.chain] };
      await transact("readwrite", (store) => store.put(stored, RECORD_KEY)).catch(() => {
        throw refused("storage", "The identity cannot be saved.");
      });
    },
    async remove() {
      await transact("readwrite", (store) => store.delete(RECORD_KEY)).catch(() => {
        throw refused("storage", "The saved identity cannot be removed.");
      });
    },
  };
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const block = readRelayPem(pem);
  if (!block) throw refused("invalid_bundle", "The private key cannot be read.");
  if (block.label !== "PRIVATE KEY")
    throw refused("unsupported_key", "The private key must be an unencrypted PKCS #8 key.");
  const algorithm = readRelayPrivateKeyAlgorithm(block.der);
  if (!algorithm) throw refused("invalid_bundle", "The private key cannot be read.");
  if (algorithm.algorithm !== RELAY_X509_OID.ecPublicKey || algorithm.curve !== RELAY_X509_OID.prime256v1) {
    throw refused("unsupported_key", "This client supports only an ECDSA P-256 private key.");
  }
  try {
    return await crypto.subtle.importKey("pkcs8", block.der, RELAY_ECDSA_P256, false, ["sign"]);
  } catch {
    throw refused("invalid_bundle", "The private key cannot be read.");
  }
}

async function keyMatches(privateKey: CryptoKey, certificate: RelayCertificate): Promise<boolean> {
  const sample = crypto.getRandomValues(new Uint8Array(KEY_CHECK_BYTES));
  try {
    const signature = new Uint8Array(await crypto.subtle.sign(RELAY_ECDSA_SHA256, privateKey, sample));
    return await verifyRelayP256(certificate.spki, sample, signature);
  } catch {
    return false;
  }
}

function openDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(OBJECT_STORE)) request.result.createObjectStore(OBJECT_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("The identity database is blocked."));
  });
}

function decodeStoredIdentity(value: unknown): RelayBrowserIdentity | null {
  if (!isDynamicRecord(value) || value.version !== STORED_IDENTITY_VERSION) return null;
  const { privateKey, chain } = value;
  const nullableString = (field: unknown): field is string | null => field === null || isString(field);
  if (!(privateKey instanceof CryptoKey) || privateKey.extractable || privateKey.type !== "private") return null;
  if (!Array.isArray(chain) || !chain.every(isString)) return null;
  if (!nullableString(value.relayUrl) || !nullableString(value.device)) return null;
  if (!isString(value.team) || !isString(value.user) || !isString(value.keyId)) return null;
  if (!isString(value.certificate) || !isString(value.root)) return null;
  if (typeof value.startsAt !== "number" || typeof value.expiresAt !== "number") return null;
  return {
    relayUrl: value.relayUrl,
    team: value.team,
    user: value.user,
    device: value.device,
    keyId: value.keyId,
    certificate: value.certificate,
    chain,
    root: value.root,
    startsAt: value.startsAt,
    expiresAt: value.expiresAt,
    privateKey,
  };
}
