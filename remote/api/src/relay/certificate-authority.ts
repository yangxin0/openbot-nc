import { createHash, createPrivateKey, type KeyObject, X509Certificate } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { dirname, join } from "node:path";
import {
  RELAY_IDENTITY_BUNDLE_VERSION,
  type RelayIdentityBundle,
} from "@openbot/contracts/relay-protocol/identity-bundle";
import {
  RELAY_KEY_ID_PATTERN,
  RELAY_LABEL_LIMIT,
  RELAY_SUBJECT_NAME_PATTERN,
} from "@openbot/contracts/relay-protocol/messages";
import { Effect, Schema } from "effect";
import { z } from "zod";
import { withFileLock } from "./file-lock";
import { certificateFingerprint, type RelayTrust, trustedRoot } from "./identity";
import { checkServerIdentity } from "./server-identity";
import { generateSigningKey, type IssuedCertificate, issueCertificate, publicKeyId } from "./x509";

const REGISTRY_VERSION = 1;
const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIRECTORY_MODE = 0o700;
const DNS_NAME_PATTERN =
  /^(?=.{1,253}$)(?:\*\.)?(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/u;

export const CERTIFICATE_DAYS = {
  root: { default: 3650, maximum: 7300 },
  team: { default: 1825, maximum: 3650 },
  member: { default: 365, maximum: 1095 },
  server: { default: 397, maximum: 825 },
} as const;

const certificateRecordSchema = z.object({
  serial: z.string().regex(/^[0-9a-f]{2,64}$/u),
  keyId: z.string().regex(RELAY_KEY_ID_PATTERN),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
  kind: z.enum(["root", "team", "member", "server"]),
  team: z.string().nullable(),
  user: z.string().nullable(),
  device: z.string().nullable(),
  issuedAt: z.int().nonnegative(),
  expiresAt: z.int().nonnegative(),
  revokedAt: z.int().nonnegative().nullable(),
  label: z.string().max(RELAY_LABEL_LIMIT).nullable().optional(),
});
const registrySchema = z.object({
  version: z.literal(REGISTRY_VERSION),
  certificates: z.array(certificateRecordSchema),
  revokedKeys: z.array(z.string().regex(RELAY_KEY_ID_PATTERN)),
});

export type CertificateRecord = z.infer<typeof certificateRecordSchema>;
type Registry = z.infer<typeof registrySchema>;

export class CertificateAuthorityError extends Schema.TaggedError<CertificateAuthorityError>()(
  "CertificateAuthorityError",
  { message: Schema.String },
) {}

interface CertificateAuthorityOptions {
  dataDirectory: string;
  passphrase: string | null;
  publicUrl: string | null;
  now?: () => number;
}

interface SigningAuthority {
  certificate: string;
  privateKey: KeyObject;
}

interface MemberInput {
  team: string;
  user: string;
  device: string | null;
  days: number;
}

export interface IssuedMember {
  record: CertificateRecord;
  certificate: string;
  chain: string[];
  root: string;
}

const failure = (message: string) => new CertificateAuthorityError({ message });
const fileCall = <A>(message: string, operation: () => Promise<A>) =>
  Effect.tryPromise({ try: operation, catch: () => failure(message) });
const decode = <A>(message: string, operation: () => A) =>
  Effect.try({ try: operation, catch: () => failure(message) });
const isMissing = (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT";

export function tlsPaths(dataDirectory: string): { certificate: string; privateKey: string } {
  return {
    certificate: join(dataDirectory, "tls", "server.crt"),
    privateKey: join(dataDirectory, "tls", "server.key"),
  };
}

export class CertificateAuthority {
  readonly #directory: string;
  readonly #passphrase: string | null;
  readonly #publicUrl: string | null;
  readonly #now: () => number;

  constructor(options: CertificateAuthorityOptions) {
    this.#directory = options.dataDirectory;
    this.#passphrase = options.passphrase;
    this.#publicUrl = options.publicUrl;
    this.#now = options.now ?? Date.now;
  }

  get #rootCertificatePath(): string {
    return join(this.#directory, "ca", "root.crt");
  }

  get #rootKeyPath(): string {
    return join(this.#directory, "ca", "root.key");
  }

  get #teamsDirectory(): string {
    return join(this.#directory, "ca", "teams");
  }

  get #registryPath(): string {
    return join(this.#directory, "ca", "registry.json");
  }

  #teamPaths(team: string): { certificate: string; privateKey: string } {
    const file = createHash("sha256").update(team).digest("base64url");
    return {
      certificate: join(this.#teamsDirectory, `${file}.crt`),
      privateKey: join(this.#teamsDirectory, `${file}.key`),
    };
  }

  readonly initialize = Effect.fn("CertificateAuthority.initialize")((input: { name: string; days: number }) =>
    this.#locked(
      Effect.gen({ self: this }, function* () {
        yield* requireName(input.name, "The authority name");
        yield* requireDays(input.days, CERTIFICATE_DAYS.root.maximum);
        if ((yield* this.#readOptional(this.#rootCertificatePath)) !== null) {
          return yield* failure("A root certificate exists already. The command did not replace it.");
        }
        const key = generateSigningKey();
        const issued = yield* decode("The root certificate could not be made.", () =>
          issueCertificate({
            subject: { commonName: input.name },
            publicKey: key.publicKey,
            profile: { kind: "authority", pathLength: 1 },
            days: input.days,
            issuer: { selfSigned: key.privateKey },
            now: this.#now(),
          }),
        );
        yield* this.#writePrivate(this.#rootKeyPath, this.#exportKey(key.privateKey));
        yield* this.#writePublic(this.#rootCertificatePath, issued.certificate);
        return yield* this.#record(issued, key.publicKey, { kind: "root", team: null, user: null, device: null });
      }),
    ),
  );

  readonly addTeam = Effect.fn("CertificateAuthority.addTeam")((input: { team: string; days: number }) =>
    this.#locked(
      Effect.gen({ self: this }, function* () {
        yield* requireName(input.team, "The team name");
        yield* requireDays(input.days, CERTIFICATE_DAYS.team.maximum);
        const paths = this.#teamPaths(input.team);
        if ((yield* this.#readOptional(paths.certificate)) !== null) {
          return yield* failure(`The team "${input.team}" exists already.`);
        }
        const root = yield* this.#signingAuthority(this.#rootCertificatePath, this.#rootKeyPath, "the root");
        const key = generateSigningKey();
        const issued = yield* decode("The team certificate could not be made.", () =>
          issueCertificate({
            subject: { organization: input.team, commonName: input.team },
            publicKey: key.publicKey,
            profile: { kind: "authority", pathLength: 0 },
            days: input.days,
            issuer: root,
            now: this.#now(),
          }),
        );
        yield* this.#writePrivate(paths.privateKey, this.#exportKey(key.privateKey));
        yield* this.#writePublic(paths.certificate, issued.certificate);
        return yield* this.#record(issued, key.publicKey, {
          kind: "team",
          team: input.team,
          user: null,
          device: null,
        });
      }),
    ),
  );

  readonly issueMember = Effect.fn("CertificateAuthority.issueMember")((input: MemberInput) =>
    this.#locked(
      Effect.gen({ self: this }, function* () {
        const key = generateSigningKey();
        const issued = yield* this.#issueMember(input, key.publicKey, null);
        const bundle: RelayIdentityBundle = {
          version: RELAY_IDENTITY_BUNDLE_VERSION,
          relayUrl: this.#publicUrl,
          team: input.team,
          user: input.user,
          device: input.device,
          certificate: issued.certificate,
          chain: issued.chain,
          root: issued.root,
          privateKey: key.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
        };
        return { record: issued.record, bundle };
      }),
    ),
  );

  readonly issueForKey = Effect.fn("CertificateAuthority.issueForKey")(
    (input: MemberInput & { publicKey: KeyObject; label: string | null }) =>
      this.#locked(this.#issueMember(input, input.publicKey, input.label)),
  );

  readonly hasTeam = Effect.fn("CertificateAuthority.hasTeam")((team: string) =>
    Effect.gen({ self: this }, function* () {
      return (yield* this.#readOptional(this.#teamPaths(team).certificate)) !== null;
    }),
  );

  readonly issueServer = Effect.fn("CertificateAuthority.issueServer")(
    (input: { dnsNames: readonly string[]; ipAddresses: readonly string[]; days: number }) =>
      this.#locked(
        Effect.gen({ self: this }, function* () {
          yield* requireDays(input.days, CERTIFICATE_DAYS.server.maximum);
          const [firstName] = [...input.dnsNames, ...input.ipAddresses];
          if (firstName === undefined) return yield* failure("Give one DNS name or IP address at least.");
          if (input.dnsNames.some((name) => !DNS_NAME_PATTERN.test(name))) {
            return yield* failure("A DNS name is invalid.");
          }
          if (input.ipAddresses.some((address) => isIP(address) === 0)) {
            return yield* failure("An IP address is invalid.");
          }
          const root = yield* this.#signingAuthority(this.#rootCertificatePath, this.#rootKeyPath, "the root");
          const key = generateSigningKey();
          const issued = yield* decode("The server certificate could not be made.", () =>
            issueCertificate({
              subject: { commonName: firstName.replace(/^\*\./u, "") },
              publicKey: key.publicKey,
              profile: { kind: "server", dnsNames: input.dnsNames, ipAddresses: input.ipAddresses },
              days: input.days,
              issuer: root,
              now: this.#now(),
            }),
          );
          const paths = tlsPaths(this.#directory);
          yield* this.#writePrivate(
            paths.privateKey,
            key.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
          );
          yield* this.#writePublic(paths.certificate, issued.certificate);
          const record = yield* this.#record(issued, key.publicKey, {
            kind: "server",
            team: null,
            user: firstName,
            device: null,
          });
          return { record, paths };
        }),
      ),
  );

  readonly revoke = Effect.fn("CertificateAuthority.revoke")((reference: string) =>
    this.#locked(
      Effect.gen({ self: this }, function* () {
        const registry = yield* this.#readRegistry();
        const serial = reference.toLowerCase().replaceAll(":", "");
        const byKey = RELAY_KEY_ID_PATTERN.test(reference);
        const matches = registry.certificates.filter((record) =>
          byKey ? record.keyId === reference : record.serial === serial || record.fingerprint === serial,
        );
        if (matches.length === 0 && !byKey) {
          return yield* failure("No certificate has this serial number, fingerprint or key identifier.");
        }
        if (matches.some((record) => record.kind === "root")) {
          return yield* failure("The root certificate cannot be revoked. Make a new data directory instead.");
        }
        const now = this.#now();
        for (const record of matches) record.revokedAt ??= now;
        if (byKey && !registry.revokedKeys.includes(reference)) registry.revokedKeys.push(reference);
        yield* this.#writeRegistry(registry);
        return matches;
      }),
    ),
  );

  readonly list = Effect.fn("CertificateAuthority.list")(() =>
    Effect.gen({ self: this }, function* () {
      return (yield* this.#readRegistry()).certificates;
    }),
  );

  readonly rootCertificate = Effect.fn("CertificateAuthority.rootCertificate")(() =>
    this.#readRequired(this.#rootCertificatePath, "The root certificate does not exist. Run the init command first."),
  );

  readonly trust = Effect.fn("CertificateAuthority.trust")((audiences: ReadonlySet<string> | null) =>
    Effect.gen({ self: this }, function* () {
      const rootPem = yield* this.rootCertificate();
      const root = yield* decode("The root certificate cannot be read.", () => trustedRoot(rootPem));
      const teamFiles = yield* fileCall("The team certificates cannot be listed.", () =>
        readdir(this.#teamsDirectory).catch((error: unknown) => (isMissing(error) ? [] : Promise.reject(error))),
      );
      const intermediates: X509Certificate[] = [];
      for (const file of teamFiles.filter((name) => name.endsWith(".crt")).sort()) {
        const pem = yield* this.#readRequired(join(this.#teamsDirectory, file), "A team certificate cannot be read.");
        intermediates.push(yield* decode("A team certificate cannot be read.", () => new X509Certificate(pem)));
      }
      const registry = yield* this.#readRegistry();
      const revoked = new Set<string>(registry.revokedKeys);
      for (const record of registry.certificates) if (record.revokedAt !== null) revoked.add(record.fingerprint);
      const trust: RelayTrust = { roots: [root], intermediates, revoked, audiences };
      return trust;
    }),
  );

  readonly serverIdentity = Effect.fn("CertificateAuthority.serverIdentity")(() =>
    Effect.gen({ self: this }, function* () {
      const rootPem = yield* this.rootCertificate();
      const root = yield* decode("The root certificate cannot be read.", () => new X509Certificate(rootPem));
      const paths = tlsPaths(this.#directory);
      const missing = `No server identity certificate is at ${paths.certificate}. Run "ca server --dns <public host>" to make it.`;
      const certificatePem = yield* this.#readRequired(paths.certificate, missing);
      const privateKeyPem = yield* this.#readRequired(paths.privateKey, missing);
      const check = checkServerIdentity({
        certificatePem,
        privateKeyPem,
        root,
        publicUrl: this.#publicUrl,
        now: this.#now(),
      });
      if (!check.ok) return yield* failure(check.message);
      return check.identity;
    }),
  );

  readonly changeStamp = Effect.fn("CertificateAuthority.changeStamp")(() =>
    Effect.gen({ self: this }, function* () {
      const stamps: string[] = [];
      const serverPaths = tlsPaths(this.#directory);
      for (const path of [
        this.#rootCertificatePath,
        this.#registryPath,
        this.#teamsDirectory,
        serverPaths.certificate,
        serverPaths.privateKey,
      ]) {
        const status = yield* fileCall("The certificate store cannot be read.", () =>
          stat(path).catch((error: unknown) => (isMissing(error) ? null : Promise.reject(error))),
        );
        stamps.push(status ? `${status.mtimeMs}:${status.size}` : "missing");
      }
      return stamps.join("|");
    }),
  );

  #exportKey(privateKey: KeyObject): string {
    return this.#passphrase === null
      ? privateKey.export({ type: "pkcs8", format: "pem" }).toString()
      : privateKey
          .export({ type: "pkcs8", format: "pem", cipher: "aes-256-cbc", passphrase: this.#passphrase })
          .toString();
  }

  readonly #signingAuthority = (certificatePath: string, keyPath: string, owner: string) =>
    Effect.gen({ self: this }, function* () {
      const certificate = yield* this.#readRequired(certificatePath, `The certificate of ${owner} does not exist.`);
      const keyPem = yield* this.#readRequired(
        keyPath,
        `The private key of ${owner} is not on this server. Put it back to issue certificates.`,
      );
      const privateKey = yield* decode(`The private key of ${owner} cannot be read. Check RELAY_CA_PASSPHRASE.`, () =>
        createPrivateKey(this.#passphrase === null ? keyPem : { key: keyPem, passphrase: this.#passphrase }),
      );
      const authority: SigningAuthority = { certificate, privateKey };
      return authority;
    });

  readonly #issueMember = (input: MemberInput, publicKey: KeyObject, label: string | null) =>
    Effect.gen({ self: this }, function* () {
      yield* requireName(input.team, "The team name");
      yield* requireName(input.user, "The user name");
      if (input.device !== null) yield* requireName(input.device, "The device name");
      yield* requireDays(input.days, CERTIFICATE_DAYS.member.maximum);
      const paths = this.#teamPaths(input.team);
      const team = yield* this.#signingAuthority(paths.certificate, paths.privateKey, `the team "${input.team}"`);
      const root = yield* this.#readRequired(this.#rootCertificatePath, "The root certificate does not exist.");
      const issued = yield* decode("The member certificate could not be made.", () =>
        issueCertificate({
          subject: {
            organization: input.team,
            organizationalUnit: input.device ?? undefined,
            commonName: input.user,
          },
          publicKey,
          profile: { kind: "member" },
          days: input.days,
          issuer: team,
          now: this.#now(),
        }),
      );
      const record = yield* this.#record(issued, publicKey, {
        kind: "member",
        team: input.team,
        user: input.user,
        device: input.device,
        ...(label === null ? {} : { label }),
      });
      const member: IssuedMember = { record, certificate: issued.certificate, chain: [team.certificate], root };
      return member;
    });

  readonly #record = (
    issued: IssuedCertificate,
    publicKey: KeyObject,
    subject: Pick<CertificateRecord, "kind" | "team" | "user" | "device" | "label">,
  ) =>
    Effect.gen({ self: this }, function* () {
      const registry = yield* this.#readRegistry();
      const record: CertificateRecord = {
        serial: issued.serial,
        keyId: publicKeyId(publicKey),
        fingerprint: certificateFingerprint(new X509Certificate(issued.certificate)),
        ...subject,
        issuedAt: this.#now(),
        expiresAt: issued.expiresAt,
        revokedAt: null,
      };
      registry.certificates.push(record);
      yield* this.#writeRegistry(registry);
      return record;
    });

  readonly #readRegistry = () =>
    Effect.gen({ self: this }, function* () {
      const text = yield* this.#readOptional(this.#registryPath);
      if (text === null) {
        const empty: Registry = { version: REGISTRY_VERSION, certificates: [], revokedKeys: [] };
        return empty;
      }
      return yield* decode("The certificate registry is damaged.", () => registrySchema.parse(JSON.parse(text)));
    });

  readonly #writeRegistry = (registry: Registry) =>
    this.#writePublic(this.#registryPath, `${JSON.stringify(registry, null, 2)}\n`);

  readonly #readOptional = (path: string) =>
    fileCall("A file of the certificate store cannot be read.", () =>
      readFile(path, "utf8").catch((error: unknown) => (isMissing(error) ? null : Promise.reject(error))),
    );

  readonly #readRequired = (path: string, missingMessage: string) =>
    Effect.gen({ self: this }, function* () {
      const text = yield* this.#readOptional(path);
      if (text === null) return yield* failure(missingMessage);
      return text;
    });

  readonly #writePublic = (path: string, content: string) => this.#write(path, content, 0o644);

  readonly #writePrivate = (path: string, content: string) => this.#write(path, content, PRIVATE_FILE_MODE);

  readonly #write = (path: string, content: string, mode: number) =>
    fileCall("A file of the certificate store cannot be written.", async () => {
      await mkdir(dirname(path), { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
      const temporary = `${path}.${process.pid}.tmp`;
      await writeFile(temporary, content, { mode });
      await rename(temporary, path);
    });

  #locked<A, E>(operation: Effect.Effect<A, E>): Effect.Effect<A, E | CertificateAuthorityError> {
    return withFileLock(join(this.#directory, "ca", "lock"), operation, failure);
  }
}

export function requireName(value: string, label: string) {
  return RELAY_SUBJECT_NAME_PATTERN.test(value)
    ? Effect.void
    : Effect.fail(
        failure(
          `${label} must have 1 to 64 letters, digits, spaces, or the characters . _ @ - and no space at an end.`,
        ),
      );
}

export function requireDays(days: number, maximum: number) {
  return Number.isInteger(days) && days >= 1 && days <= maximum
    ? Effect.void
    : Effect.fail(failure(`The validity must be from 1 to ${maximum} days.`));
}
