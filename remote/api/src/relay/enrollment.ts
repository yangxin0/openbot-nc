import { createHash, createPublicKey, type KeyObject, verify, X509Certificate } from "node:crypto";
import { join } from "node:path";
import {
  decodeRelayJoinSecret,
  formatRelayJoinCode,
  RELAY_ENROLL_VERSION,
  RELAY_JOIN_SECRET_BYTES,
  type RelayEnrollErrorCode,
  type RelayEnrollRequest,
  type RelayEnrollResponse,
  relayEnrollTranscript,
} from "@openbot/contracts/relay-protocol/enrollment";
import { RELAY_SUBJECT_NAME_PATTERN } from "@openbot/contracts/relay-protocol/messages";
import { Effect, Option, Schema } from "effect";
import { CERTIFICATE_DAYS, type CertificateAuthority, type CertificateRecord } from "./certificate-authority";
import { relayTeam } from "./identity";
import { OneTimeStore } from "./one-time-store";
import { publicKeyId } from "./x509";

export const JOIN_CODE_MINUTES = { default: 15, maximum: 1440 } as const;
const OPEN_JOIN_CODES_LIMIT = 100;
export const JOIN_CODE_ID_LENGTH = 12;

const JoinCodeEntry = Schema.Struct({
  version: Schema.Literal(1),
  team: Schema.String,
  user: Schema.String,
  device: Schema.NullOr(Schema.String),
  days: Schema.Int,
  createdAt: Schema.Int,
  expiresAt: Schema.Int,
  creator: Schema.Literals(["cli", "admin"]),
});
export type JoinCodeEntry = typeof JoinCodeEntry.Type;
export type JoinCodeCreator = JoinCodeEntry["creator"];

class EnrollmentError extends Schema.TaggedError<EnrollmentError>()("EnrollmentError", {
  code: Schema.Literals(["invalid_request", "code_unknown", "proof_invalid", "rate_limited", "unavailable"]),
  message: Schema.String,
}) {}

interface CreatedJoinCode {
  url: string;
  id: string;
  entry: JoinCodeEntry;
}

interface EnrolledMember {
  response: RelayEnrollResponse;
  record: CertificateRecord;
  codeId: string;
}

interface EnrollmentOptions {
  authority: CertificateAuthority;
  dataDirectory: string;
  publicUrl: string | null;
  now?: () => number;
}

const refused = (code: RelayEnrollErrorCode, message: string) => new EnrollmentError({ code, message });
const decodeEntry = Schema.decodeUnknownOption(JoinCodeEntry);

function joinCodesDirectory(dataDirectory: string): string {
  return join(dataDirectory, "ca", "codes");
}

export function rootFingerprint(rootPem: string): string {
  return createHash("sha256").update(new X509Certificate(rootPem).raw).digest("base64url");
}

export class Enrollment {
  readonly #authority: CertificateAuthority;
  readonly #codes: OneTimeStore<JoinCodeEntry>;
  readonly #target: { server: string; relayUrl: string } | null;
  readonly #now: () => number;

  constructor(options: EnrollmentOptions) {
    this.#authority = options.authority;
    this.#target = enrollmentTarget(options.publicUrl);
    this.#now = options.now ?? Date.now;
    this.#codes = new OneTimeStore({
      directory: joinCodesDirectory(options.dataDirectory),
      decode: (value) => Option.getOrNull(decodeEntry(value)),
      limit: OPEN_JOIN_CODES_LIMIT,
      noun: "join code",
      now: this.#now,
    });
  }

  get server(): string | null {
    return this.#target?.server ?? null;
  }

  readonly createCode = Effect.fn("Enrollment.createCode")(
    (input: {
      team: string;
      user: string;
      device: string | null;
      minutes: number;
      days: number;
      creator: JoinCodeCreator;
    }) =>
      Effect.gen({ self: this }, function* () {
        const server = this.server;
        if (server === null) {
          return yield* refused("invalid_request", "Set RELAY_PUBLIC_URL to a wss: address to make join codes.");
        }
        for (const [value, label] of [
          [input.team, "The team name"],
          [input.user, "The user name"],
          [input.device, "The device name"],
        ] as const) {
          if (value !== null && !RELAY_SUBJECT_NAME_PATTERN.test(value)) {
            return yield* refused(
              "invalid_request",
              `${label} must have 1 to 64 letters, digits, spaces, or the characters . _ @ - and no space at an end.`,
            );
          }
        }
        if (!Number.isInteger(input.minutes) || input.minutes < 1 || input.minutes > JOIN_CODE_MINUTES.maximum) {
          return yield* refused(
            "invalid_request",
            `The code life must be from 1 to ${JOIN_CODE_MINUTES.maximum} minutes.`,
          );
        }
        if (!Number.isInteger(input.days) || input.days < 1 || input.days > CERTIFICATE_DAYS.member.maximum) {
          return yield* refused(
            "invalid_request",
            `The certificate validity must be from 1 to ${CERTIFICATE_DAYS.member.maximum} days.`,
          );
        }
        const teamExists = yield* this.#authority.hasTeam(input.team).pipe(this.#unavailable);
        if (!teamExists) return yield* refused("invalid_request", `The team "${input.team}" does not exist.`);
        const rootPem = yield* this.#authority.rootCertificate().pipe(this.#unavailable);
        const createdAt = this.#now();
        const entry: JoinCodeEntry = {
          version: 1,
          team: input.team,
          user: input.user,
          device: input.device,
          days: input.days,
          createdAt,
          expiresAt: createdAt + input.minutes * 60_000,
          creator: input.creator,
        };
        const { secret, hash } = yield* this.#codes
          .create(entry, RELAY_JOIN_SECRET_BYTES)
          .pipe(Effect.mapError((error) => refused("invalid_request", error.message)));
        const url = formatRelayJoinCode({ server, secret, root: rootFingerprint(rootPem) });
        if (url === null) return yield* refused("invalid_request", "The public address cannot be put in a join code.");
        const created: CreatedJoinCode = { url, id: hash.slice(0, JOIN_CODE_ID_LENGTH), entry };
        return created;
      }),
  );

  readonly listCodes = Effect.fn("Enrollment.listCodes")(() => this.#codes.list().pipe(this.#unavailable));

  readonly cancelCode = Effect.fn("Enrollment.cancelCode")((prefix: string) =>
    this.#codes.cancel(prefix).pipe(Effect.mapError((error) => refused("invalid_request", error.message))),
  );

  readonly cleanup = Effect.fn("Enrollment.cleanup")(() => this.#codes.cleanup().pipe(this.#unavailable));

  readonly enroll = Effect.fn("Enrollment.enroll")((request: RelayEnrollRequest) =>
    Effect.gen({ self: this }, function* () {
      const target = this.#target;
      if (target === null) return yield* refused("unavailable", "This server does not take join codes.");
      const secret = decodeRelayJoinSecret(request.code);
      if (secret === null) return yield* refused("invalid_request", "The join code is not valid.");
      const spki = Buffer.from(request.publicKey, "base64url");
      const publicKey = yield* Effect.try({
        try: () => createPublicKey({ key: spki, format: "der", type: "spki" }),
        catch: () => refused("invalid_request", "The public key cannot be read."),
      });
      if (!isCanonicalP256(publicKey, spki)) {
        return yield* refused("invalid_request", "The public key must be an ECDSA P-256 key.");
      }
      const transcript = relayEnrollTranscript({
        secretHash: createHash("sha256").update(secret).digest(),
        server: target.server,
        publicKey: spki,
      });
      if (!proofIsValid(transcript, publicKey, request.proof)) {
        return yield* refused("proof_invalid", "The proof of the private key is invalid.");
      }
      yield* this.#codes.cleanup().pipe(this.#unavailable);
      const claimed = yield* this.#codes.claim(secret).pipe(this.#unavailable);
      if (claimed === null) return yield* refused("code_unknown", "The join code is unknown, expired or used.");
      const label = request.label?.trim() || null;
      const issued = yield* this.#authority
        .issueForKey({
          team: claimed.entry.team,
          user: claimed.entry.user,
          device: claimed.entry.device,
          days: claimed.entry.days,
          publicKey,
          label,
        })
        .pipe(
          Effect.ensuring(this.#codes.finish(claimed.hash)),
          Effect.mapError((error) =>
            refused("unavailable", `The certificate could not be made, and the join code is used. ${error.message}`),
          ),
        );
      const rootKeyId = publicKeyId(new X509Certificate(issued.root).publicKey);
      const response: RelayEnrollResponse = {
        version: RELAY_ENROLL_VERSION,
        relayUrl: target.relayUrl,
        team: relayTeam(rootKeyId, claimed.entry.team),
        user: claimed.entry.user,
        device: claimed.entry.device,
        certificate: issued.certificate,
        chain: issued.chain,
        root: issued.root,
      };
      const enrolled: EnrolledMember = {
        response,
        record: issued.record,
        codeId: claimed.hash.slice(0, JOIN_CODE_ID_LENGTH),
      };
      return enrolled;
    }),
  );

  readonly #unavailable = <A, E extends { message: string }, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(Effect.mapError((error) => refused("unavailable", error.message)));
}

function enrollmentTarget(publicUrl: string | null): { server: string; relayUrl: string } | null {
  if (publicUrl === null) return null;
  const url = new URL(publicUrl);
  return url.protocol === "wss:" ? { server: url.host.toLowerCase(), relayUrl: url.href } : null;
}

function isCanonicalP256(publicKey: KeyObject, spki: Buffer): boolean {
  if (publicKey.asymmetricKeyType !== "ec" || publicKey.asymmetricKeyDetails?.namedCurve !== "prime256v1") return false;
  return publicKey.export({ type: "spki", format: "der" }).equals(spki);
}

function proofIsValid(transcript: Uint8Array, publicKey: KeyObject, proof: string): boolean {
  try {
    return verify("sha256", transcript, { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(proof, "base64url"));
  } catch {
    return false;
  }
}
