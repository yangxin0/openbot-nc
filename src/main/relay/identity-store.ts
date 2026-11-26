import { createPrivateKey, createPublicKey, type KeyObject, sign } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import {
  decodeRelayIdentityBundle,
  RELAY_IDENTITY_BUNDLE_VERSION,
  type RelayIdentityBundle,
} from "@openbot/contracts/relay-protocol/identity-bundle";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { Effect, Schema } from "effect";
import { writeJsonFileAtomically } from "../../backend/atomic-json-file";
import { issuedBy, publicKeyId, readCertificate, subjectNames, trustPath, validityWindow } from "./certificates";

const STORED_IDENTITY_VERSION = 1;
const SIGNING_KEY_TYPES = new Set(["ec", "ed25519", "rsa"]);
const P256_CURVE = "prime256v1";

const RELAY_IDENTITY_REFUSALS = [
  "invalid_bundle",
  "unsupported_key",
  "key_mismatch",
  "untrusted_chain",
  "expired",
  "already_imported",
  "locked",
  "storage",
] as const;
type RelayIdentityRefusal = (typeof RELAY_IDENTITY_REFUSALS)[number];

export class RelayIdentityError extends Schema.TaggedError<RelayIdentityError>()("RelayIdentityError", {
  reason: Schema.Literals(RELAY_IDENTITY_REFUSALS),
  message: Schema.String,
}) {}

export interface RelayCipher {
  encrypt: (value: string) => Buffer;
  decrypt: (value: Buffer) => string;
}

export interface RelayIdentity {
  relayUrl: string | null;
  team: string;
  user: string;
  device: string | null;
  keyId: string;
  certificate: string;
  chain: readonly string[];
  root: string;
  expiresAt: number;
}

interface RelayTlsCredentials {
  ca: string;
  cert: string;
  key: string;
}

export interface RelayCredentialSource {
  current(): RelayIdentity | null;
  tlsCredentials(): RelayTlsCredentials | null;
  signRelayData(data: Uint8Array): Uint8Array | null;
}

interface RelayIdentityStoreOptions {
  path: string;
  cipher: RelayCipher;
  now?: () => number;
}

interface StoredRelayIdentity {
  version: typeof STORED_IDENTITY_VERSION;
  relayUrl: string | null;
  team: string;
  user: string;
  device: string | null;
  certificate: string;
  chain: string[];
  root: string;
  encryptedPrivateKey: string;
}

interface LoadedIdentity {
  identity: RelayIdentity;
  privateKey: KeyObject;
}

type Inspection = { ok: true; loaded: LoadedIdentity } | { ok: false; reason: RelayIdentityRefusal; message: string };

const refused = (reason: RelayIdentityRefusal, message: string): Inspection => ({ ok: false, reason, message });

export class RelayIdentityStore implements RelayCredentialSource {
  readonly #path: string;
  readonly #cipher: RelayCipher;
  readonly #now: () => number;
  #loaded: LoadedIdentity | null = null;
  #read = false;

  constructor(options: RelayIdentityStoreOptions) {
    this.#path = options.path;
    this.#cipher = options.cipher;
    this.#now = options.now ?? Date.now;
  }

  readonly load = Effect.fn("RelayIdentityStore.load")(function* (
    this: RelayIdentityStore,
  ): Effect.fn.Return<RelayIdentity | null, RelayIdentityError> {
    const text = yield* Effect.tryPromise({
      try: () =>
        readFile(this.#path, "utf8").catch((cause: unknown) => {
          if (isMissingFile(cause)) return null;
          throw cause;
        }),
      catch: () => new RelayIdentityError({ reason: "storage", message: "The identity file cannot be read." }),
    });
    if (text === null) {
      this.#loaded = null;
      this.#read = true;
      return null;
    }
    const inspection = this.#openStored(text);
    if (!inspection.ok) {
      return yield* new RelayIdentityError({ reason: inspection.reason, message: inspection.message });
    }
    this.#loaded = inspection.loaded;
    this.#read = true;
    return inspection.loaded.identity;
  }).bind(this);

  readonly importBundle = Effect.fn("RelayIdentityStore.importBundle")(function* (
    this: RelayIdentityStore,
    bundle: unknown,
  ): Effect.fn.Return<RelayIdentity, RelayIdentityError> {
    if (!this.#read) yield* this.load();
    if (this.#loaded) {
      return yield* new RelayIdentityError({
        reason: "already_imported",
        message: "An identity is imported already. Replace it with an explicit call.",
      });
    }
    return yield* this.#save(bundle);
  }).bind(this);

  readonly replaceBundle = Effect.fn("RelayIdentityStore.replaceBundle")(function* (
    this: RelayIdentityStore,
    bundle: unknown,
  ): Effect.fn.Return<RelayIdentity, RelayIdentityError> {
    return yield* this.#save(bundle);
  }).bind(this);

  readonly remove = Effect.fn("RelayIdentityStore.remove")(function* (
    this: RelayIdentityStore,
  ): Effect.fn.Return<void, RelayIdentityError> {
    yield* Effect.tryPromise({
      try: () => rm(this.#path, { force: true }),
      catch: () => new RelayIdentityError({ reason: "storage", message: "The identity file cannot be removed." }),
    });
    this.#loaded = null;
    this.#read = true;
  }).bind(this);

  current(): RelayIdentity | null {
    return this.#loaded?.identity ?? null;
  }

  tlsCredentials(): RelayTlsCredentials | null {
    const loaded = this.#loaded;
    if (!loaded) return null;
    const { certificate, chain, root } = loaded.identity;
    return {
      ca: root,
      cert: `${[certificate, ...chain].map((pem) => pem.trimEnd()).join("\n")}\n`,
      key: loaded.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    };
  }

  signRelayData(data: Uint8Array): Uint8Array | null {
    const privateKey = this.#loaded?.privateKey;
    if (privateKey?.asymmetricKeyType !== "ec" || privateKey.asymmetricKeyDetails?.namedCurve !== P256_CURVE) {
      return null;
    }
    return sign("sha256", data, { key: privateKey, dsaEncoding: "ieee-p1363" });
  }

  readonly #save = Effect.fn("RelayIdentityStore.save")(function* (
    this: RelayIdentityStore,
    value: unknown,
  ): Effect.fn.Return<RelayIdentity, RelayIdentityError> {
    const bundle = decodeRelayIdentityBundle(value);
    if (!bundle) {
      return yield* new RelayIdentityError({ reason: "invalid_bundle", message: "The identity file is not valid." });
    }
    const inspection = inspectBundle(bundle);
    if (!inspection.ok) {
      return yield* new RelayIdentityError({ reason: inspection.reason, message: inspection.message });
    }
    const { loaded } = inspection;
    if (this.#now() >= loaded.identity.expiresAt) {
      return yield* new RelayIdentityError({ reason: "expired", message: "The certificate is expired." });
    }
    const encryptedPrivateKey = yield* Effect.try({
      try: () => this.#cipher.encrypt(bundle.privateKey).toString("base64"),
      catch: () => new RelayIdentityError({ reason: "locked", message: "The private key cannot be encrypted." }),
    });
    const stored: StoredRelayIdentity = {
      version: STORED_IDENTITY_VERSION,
      relayUrl: bundle.relayUrl,
      team: bundle.team,
      user: bundle.user,
      device: bundle.device,
      certificate: bundle.certificate,
      chain: bundle.chain,
      root: bundle.root,
      encryptedPrivateKey,
    };
    yield* writeJsonFileAtomically(this.#path, stored, { createDirectory: true }).pipe(
      Effect.mapError(
        () => new RelayIdentityError({ reason: "storage", message: "The identity file cannot be written." }),
      ),
    );
    this.#loaded = loaded;
    this.#read = true;
    return loaded.identity;
  });

  #openStored(text: string): Inspection {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return refused("storage", "The identity file is damaged.");
    }
    if (!isDynamicRecord(value) || value.version !== STORED_IDENTITY_VERSION || !isString(value.encryptedPrivateKey)) {
      return refused("storage", "The identity file is damaged.");
    }
    let privateKey: string;
    try {
      privateKey = this.#cipher.decrypt(Buffer.from(value.encryptedPrivateKey, "base64"));
    } catch {
      return refused("locked", "The private key cannot be decrypted.");
    }
    const bundle = decodeRelayIdentityBundle({ ...value, version: RELAY_IDENTITY_BUNDLE_VERSION, privateKey });
    return bundle ? inspectBundle(bundle) : refused("storage", "The identity file is damaged.");
  }
}

function inspectBundle(bundle: RelayIdentityBundle): Inspection {
  const leaf = readCertificate(bundle.certificate);
  const root = readCertificate(bundle.root);
  const chain = bundle.chain.map(readCertificate);
  if (!leaf || !root || leaf.ca || chain.some((certificate) => certificate === null)) {
    return refused("invalid_bundle", "A certificate in the identity file cannot be used.");
  }
  const names = subjectNames(leaf.subject);
  if (!names || names.team !== bundle.team || names.user !== bundle.user || names.device !== bundle.device) {
    return refused("invalid_bundle", "The certificate does not name the team, user and device of the identity file.");
  }
  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey(bundle.privateKey);
  } catch {
    return refused("invalid_bundle", "The private key cannot be read.");
  }
  if (!SIGNING_KEY_TYPES.has(privateKey.asymmetricKeyType ?? "")) {
    return refused("unsupported_key", "The type of the private key is not supported.");
  }
  const keyId = publicKeyId(leaf.publicKey);
  if (publicKeyId(createPublicKey(privateKey)) !== keyId) {
    return refused("key_mismatch", "The private key is not the key of the certificate.");
  }
  const authorities = trustPath(
    leaf,
    root,
    chain.filter((certificate) => certificate !== null),
  );
  if (!issuedBy(root, root) || !authorities) {
    return refused("untrusted_chain", "The root of the identity file did not issue the certificate.");
  }
  for (const authority of authorities.slice(0, -1)) {
    const authorityNames = subjectNames(authority.subject);
    if (!authorityNames || (authorityNames.team !== null && authorityNames.team !== bundle.team)) {
      return refused("untrusted_chain", "The team authority is for a different team.");
    }
  }
  const window = validityWindow([leaf, ...authorities]);
  if (!window) return refused("invalid_bundle", "The certificate dates cannot be read.");
  return {
    ok: true,
    loaded: {
      privateKey,
      identity: {
        relayUrl: bundle.relayUrl,
        team: bundle.team,
        user: bundle.user,
        device: bundle.device,
        keyId,
        certificate: bundle.certificate,
        chain: bundle.chain,
        root: bundle.root,
        expiresAt: window.expiresAt,
      },
    },
  };
}

function isMissingFile(cause: unknown): boolean {
  return cause instanceof Error && "code" in cause && cause.code === "ENOENT";
}
