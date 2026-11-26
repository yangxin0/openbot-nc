import { createHash, verify, X509Certificate } from "node:crypto";
import {
  type RelayHubHello,
  relayBase64UrlBytes,
  relayHelloTranscript,
  relayMessageKeyTranscript,
} from "@openbot/contracts/relay-protocol/hub";
import {
  RELAY_SUBJECT_FIELDS,
  RELAY_SUBJECT_NAME_PATTERN,
  type RelayErrorCode,
  type RelayPeer,
  type RelayPeerCertificate,
  type RelayTeam,
  relayTeamIdStatement,
} from "@openbot/contracts/relay-protocol/messages";
import { CLIENT_AUTH_USAGE, publicKeyId } from "./x509";

const SIGNING_KEY_TYPES = new Set(["ec", "ed25519", "rsa"]);

export interface RelayIdentity extends RelayPeer {
  team: RelayTeam;
  certificate: string;
  fingerprint: string;
  authorities: readonly string[];
  expiresAt: number;
}

interface TrustedRoot {
  certificate: X509Certificate;
  keyId: string;
}

export interface RelayTrust {
  roots: readonly TrustedRoot[];
  intermediates: readonly X509Certificate[];
  revoked: ReadonlySet<string>;
  audiences: ReadonlySet<string> | null;
}

type RelayProof = Pick<
  RelayHubHello,
  | "version"
  | "audience"
  | "timestamp"
  | "clientNonce"
  | "label"
  | "hosting"
  | "capabilities"
  | "suspendable"
  | "messageKey"
  | "messageKeySignature"
  | "certificate"
  | "chain"
  | "signature"
>;

type IdentityCheck = { ok: true; identity: RelayIdentity } | { ok: false; code: RelayErrorCode; message: string };

interface SubjectNames {
  team: string | null;
  user: string | null;
  device: string | null;
  valid: boolean;
}

const refused = (code: RelayErrorCode, message: string): IdentityCheck => ({ ok: false, code, message });

export function certificateFingerprint(certificate: X509Certificate): string {
  return createHash("sha256").update(certificate.raw).digest("hex");
}

export function trustedRoot(pem: string): TrustedRoot {
  const certificate = new X509Certificate(pem);
  if (!certificate.ca) throw new Error("The root certificate is not a certificate authority.");
  return { certificate, keyId: publicKeyId(certificate.publicKey) };
}

export function relayTeam(rootKeyId: string, teamName: string): RelayTeam {
  const id = createHash("sha256").update(relayTeamIdStatement({ rootKeyId, teamName })).digest("base64url");
  return { id, name: teamName };
}

export function peerCertificate(identity: RelayIdentity): RelayPeerCertificate {
  return { keyId: identity.keyId, user: identity.user, device: identity.device, certificate: identity.certificate };
}

export function isRevoked(identity: RelayIdentity, revoked: ReadonlySet<string>): boolean {
  return [identity.keyId, identity.fingerprint, ...identity.authorities].some((reference) => revoked.has(reference));
}

export function verifyRelayProof(proof: RelayProof, trust: RelayTrust, now: number): IdentityCheck {
  if (trust.audiences && !trust.audiences.has(proof.audience)) {
    return refused("authentication_failed", "The proof names a different server.");
  }
  const leaf = parseCertificate(proof.certificate);
  const offered = proof.chain.map(parseCertificate);
  if (!leaf || offered.some((certificate) => certificate === null)) {
    return refused("authentication_failed", "The certificate cannot be read.");
  }
  if (leaf.ca) return refused("authentication_failed", "A certificate authority cannot connect.");
  const usages = leaf.keyUsage ?? [];
  if (usages.length > 0 && !usages.includes(CLIENT_AUTH_USAGE)) {
    return refused("authentication_failed", "The certificate is not for client authentication.");
  }
  const keyType = leaf.publicKey.asymmetricKeyType ?? "";
  if (!SIGNING_KEY_TYPES.has(keyType)) return refused("authentication_failed", "The key type is not supported.");

  const path = trustPath(
    leaf,
    offered.filter((certificate) => certificate !== null),
    trust,
  );
  if (!path) return refused("authentication_failed", "No trusted authority issued the certificate.");
  const expiresAt = Math.min(...[leaf, ...path.authorities].map((certificate) => Date.parse(certificate.validTo)));
  const startsAt = Math.max(...[leaf, ...path.authorities].map((certificate) => Date.parse(certificate.validFrom)));
  if (!Number.isFinite(expiresAt) || !Number.isFinite(startsAt)) {
    return refused("authentication_failed", "The certificate dates cannot be read.");
  }
  if (now < startsAt) return refused("authentication_failed", "The certificate is not valid yet.");
  if (now >= expiresAt) return refused("certificate_expired", "The certificate is expired.");

  const names = subjectNames(leaf.subject);
  if (!names.valid || names.team === null || names.user === null) {
    return refused("authentication_failed", "The certificate must name one team (O) and one user (CN).");
  }
  for (const authority of path.authorities.slice(0, -1)) {
    const authorityNames = subjectNames(authority.subject);
    if (!authorityNames.valid) return refused("authentication_failed", "The team authority has an invalid name.");
    if (authorityNames.team !== null && authorityNames.team !== names.team) {
      return refused("authentication_failed", "The team authority cannot issue for a different team.");
    }
  }

  const identity: RelayIdentity = {
    keyId: publicKeyId(leaf.publicKey),
    user: names.user,
    device: names.device,
    team: relayTeam(path.root.keyId, names.team),
    certificate: leaf.toString(),
    fingerprint: certificateFingerprint(leaf),
    authorities: path.authorities.flatMap((authority) => [
      certificateFingerprint(authority),
      publicKeyId(authority.publicKey),
    ]),
    expiresAt,
  };
  if (isRevoked(identity, trust.revoked)) return refused("certificate_revoked", "The certificate is revoked.");
  if (!proofIsValid(proof, leaf, keyType, identity.keyId)) {
    return refused("authentication_failed", "The proof of the private key is invalid.");
  }
  return { ok: true, identity };
}

function parseCertificate(pem: string): X509Certificate | null {
  try {
    return new X509Certificate(pem);
  } catch {
    return null;
  }
}

function issuedBy(certificate: X509Certificate, authority: X509Certificate): boolean {
  if (!authority.ca || certificate.issuer !== authority.subject) return false;
  try {
    return certificate.verify(authority.publicKey);
  } catch {
    return false;
  }
}

function trustPath(
  leaf: X509Certificate,
  offered: readonly X509Certificate[],
  trust: RelayTrust,
): { root: TrustedRoot; authorities: X509Certificate[] } | null {
  const direct = trust.roots.find((root) => issuedBy(leaf, root.certificate));
  if (direct) return { root: direct, authorities: [direct.certificate] };
  for (const intermediate of [...trust.intermediates, ...offered]) {
    if (!issuedBy(leaf, intermediate)) continue;
    const root = trust.roots.find((candidate) => issuedBy(intermediate, candidate.certificate));
    if (root) return { root, authorities: [intermediate, root.certificate] };
  }
  return null;
}

function subjectNames(subject: string): SubjectNames {
  const values = new Map<string, string[]>();
  let valid = true;
  for (const line of subject.split("\n")) {
    const separator = line.indexOf("=");
    if (separator <= 0) {
      valid = false;
      continue;
    }
    const field = line.slice(0, separator);
    values.set(field, [...(values.get(field) ?? []), line.slice(separator + 1)]);
  }
  const single = (field: string, required: boolean): string | null => {
    const list = values.get(field) ?? [];
    const [value] = list;
    if (list.length === 0 && !required) return null;
    if (list.length !== 1 || value === undefined || !RELAY_SUBJECT_NAME_PATTERN.test(value)) {
      valid = false;
      return null;
    }
    return value;
  };
  const team = single(RELAY_SUBJECT_FIELDS.team, false);
  const device = single(RELAY_SUBJECT_FIELDS.device, false);
  const user = single(RELAY_SUBJECT_FIELDS.user, true);
  return { team, user, device, valid };
}

function proofIsValid(proof: RelayProof, leaf: X509Certificate, keyType: string, keyId: string): boolean {
  const messageKey = relayBase64UrlBytes(proof.messageKey);
  if (!messageKey) return false;
  const keyTranscript = relayMessageKeyTranscript({ keyId, messageKey, timestamp: proof.timestamp });
  return (
    signatureIsValid(relayHelloTranscript(proof), proof.signature, leaf, keyType) &&
    signatureIsValid(keyTranscript, proof.messageKeySignature, leaf, keyType)
  );
}

function signatureIsValid(data: Uint8Array, encoded: string, leaf: X509Certificate, keyType: string): boolean {
  try {
    const signature = Buffer.from(encoded, "base64url");
    if (keyType === "ed25519") return verify(null, data, leaf.publicKey, signature);
    if (keyType === "ec") return verify("sha256", data, { key: leaf.publicKey, dsaEncoding: "ieee-p1363" }, signature);
    return verify("sha256", data, leaf.publicKey, signature);
  } catch {
    return false;
  }
}
