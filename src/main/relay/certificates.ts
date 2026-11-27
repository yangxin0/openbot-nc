import { createHash, type KeyObject, X509Certificate } from "node:crypto";
import {
  type RelayCertificateView,
  type RelaySubjectNames,
  type RelayValidityWindow,
  relaySubjectNames,
  relayTrustPath,
  relayValidityWindow,
} from "@openbot/contracts/relay-protocol/peer-rules";

const NODE_CERTIFICATE_VIEW: RelayCertificateView<X509Certificate> = {
  authority: (certificate) => certificate.ca,
  keyId: (certificate) => publicKeyId(certificate.publicKey),
  names: (certificate) => subjectNames(certificate.subject),
  validity: (certificate) => ({
    notBefore: Date.parse(certificate.validFrom),
    notAfter: Date.parse(certificate.validTo),
  }),
  issuedBy: (certificate, authority) => issuedBy(certificate, authority),
};

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
  const attributes: Array<readonly [string, string]> = [];
  for (const line of subject.split("\n")) {
    const separator = line.indexOf("=");
    if (separator <= 0) return null;
    attributes.push([line.slice(0, separator), line.slice(separator + 1)]);
  }
  return relaySubjectNames(attributes);
}

export function validityWindow(certificates: readonly X509Certificate[]): RelayValidityWindow | null {
  return relayValidityWindow(certificates.map(NODE_CERTIFICATE_VIEW.validity));
}

export function trustPath(
  leaf: X509Certificate,
  root: X509Certificate,
  chain: readonly X509Certificate[],
): X509Certificate[] | null {
  return relayTrustPath(leaf, root, chain, issuedBy);
}
