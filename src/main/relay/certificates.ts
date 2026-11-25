import { createHash, type KeyObject, X509Certificate } from "node:crypto";
import {
  RELAY_SUBJECT_FIELDS,
  RELAY_SUBJECT_NAME_PATTERN,
  type RelayPeerCertificate,
} from "@openbot/contracts/relay-protocol/messages";

interface RelaySubjectNames {
  team: string | null;
  user: string;
  device: string | null;
}

interface RelayTrustAnchors {
  team: string;
  root: string;
  chain: readonly string[];
}

type RelayPeerRefusal = "unreadable" | "key_mismatch" | "name_mismatch" | "untrusted" | "not_in_date";

export function publicKeyId(publicKey: KeyObject): string {
  return createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("base64url");
}

export function readCertificate(pem: string): X509Certificate | null {
  try {
    return new X509Certificate(pem);
  } catch {
    return null;
  }
}

export function issuedBy(certificate: X509Certificate, authority: X509Certificate): boolean {
  if (!authority.ca || certificate.issuer !== authority.subject) return false;
  try {
    return certificate.verify(authority.publicKey);
  } catch {
    return false;
  }
}

export function subjectNames(subject: string): RelaySubjectNames | null {
  const values = new Map<string, string[]>();
  for (const line of subject.split("\n")) {
    const separator = line.indexOf("=");
    if (separator <= 0) return null;
    const field = line.slice(0, separator);
    values.set(field, [...(values.get(field) ?? []), line.slice(separator + 1)]);
  }
  const single = (field: string): string | null | undefined => {
    const list = values.get(field) ?? [];
    const [value] = list;
    if (list.length === 0) return null;
    return list.length === 1 && value !== undefined && RELAY_SUBJECT_NAME_PATTERN.test(value) ? value : undefined;
  };
  const team = single(RELAY_SUBJECT_FIELDS.team);
  const user = single(RELAY_SUBJECT_FIELDS.user);
  const device = single(RELAY_SUBJECT_FIELDS.device);
  if (team === undefined || device === undefined || user === undefined || user === null) return null;
  return { team, user, device };
}

export function validityWindow(
  certificates: readonly X509Certificate[],
): { startsAt: number; expiresAt: number } | null {
  const startsAt = Math.max(...certificates.map((certificate) => Date.parse(certificate.validFrom)));
  const expiresAt = Math.min(...certificates.map((certificate) => Date.parse(certificate.validTo)));
  return Number.isFinite(startsAt) && Number.isFinite(expiresAt) ? { startsAt, expiresAt } : null;
}

export function trustPath(
  leaf: X509Certificate,
  root: X509Certificate,
  chain: readonly X509Certificate[],
): X509Certificate[] | null {
  if (issuedBy(leaf, root)) return [root];
  for (const authority of chain) {
    if (issuedBy(leaf, authority) && issuedBy(authority, root)) return [authority, root];
  }
  return null;
}

export function peerRefusal(
  peer: RelayPeerCertificate,
  trust: RelayTrustAnchors,
  now: number,
): RelayPeerRefusal | null {
  const leaf = readCertificate(peer.certificate);
  const root = readCertificate(trust.root);
  const chain = trust.chain.map(readCertificate).filter((certificate) => certificate !== null);
  if (!leaf || !root || leaf.ca) return "unreadable";
  if (publicKeyId(leaf.publicKey) !== peer.keyId) return "key_mismatch";
  const names = subjectNames(leaf.subject);
  if (!names || names.team !== trust.team || names.user !== peer.user || names.device !== peer.device) {
    return "name_mismatch";
  }
  const authorities = trustPath(leaf, root, chain);
  if (!authorities) return "untrusted";
  const window = validityWindow([leaf, ...authorities]);
  if (!window || now < window.startsAt || now >= window.expiresAt) return "not_in_date";
  return null;
}
