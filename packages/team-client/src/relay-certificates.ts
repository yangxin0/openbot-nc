import {
  type RelayPeerCertificate,
  type RelayServerProofTranscriptInput,
  relayServerProofTranscript,
} from "@openbot/contracts/relay-protocol/messages";
import {
  type RelayPeerRefusal,
  type RelaySubjectNames,
  relayPeerRefusal,
  relaySubjectNames,
} from "@openbot/contracts/relay-protocol/peer-rules";
import {
  type RelayServerProofRefusal,
  relayServerCertificateRefusal,
} from "@openbot/contracts/relay-protocol/server-proof";
import {
  RELAY_X509_OID,
  type RelayX509Certificate,
  readRelayX509Certificate,
  relayEcdsaSignatureToP1363,
  relayX509NamesEqual,
} from "@openbot/contracts/relay-protocol/x509";
import { base64ToBytes, base64UrlToBytes, bytesToBase64Url } from "./base64";

export const RELAY_ECDSA_P256 = { name: "ECDSA", namedCurve: "P-256" } as const;
export const RELAY_ECDSA_SHA256 = { name: "ECDSA", hash: "SHA-256" } as const;

const PEM_PATTERN = /^-----BEGIN ([A-Z0-9 ]{1,40})-----\s*([A-Za-z0-9+/=\s]+?)\s*-----END \1-----/u;
const textEncoder = new TextEncoder();

export interface RelayCertificate extends RelayX509Certificate {
  keyId: string;
}

export interface RelayTrustAnchors {
  team: string;
  root: string;
  chain: readonly string[];
}

export interface RelayServerProofCheck {
  certificate: string;
  signature: string;
  root: string;
  relayUrl: string;
  transcript: RelayServerProofTranscriptInput;
  now: number;
}

export interface RelayPem {
  label: string;
  der: Uint8Array<ArrayBuffer>;
}

export function readRelayPem(text: string): RelayPem | null {
  const match = PEM_PATTERN.exec(text.trim());
  const label = match?.[1];
  const body = match?.[2];
  if (label === undefined || body === undefined) return null;
  try {
    return { label, der: base64ToBytes(body.replace(/\s+/gu, "")) };
  } catch {
    return null;
  }
}

export async function readRelayCertificate(pem: string): Promise<RelayCertificate | null> {
  const block = readRelayPem(pem);
  const certificate = block?.label === "CERTIFICATE" ? readRelayX509Certificate(block.der) : null;
  if (!certificate) return null;
  return { ...certificate, keyId: await relaySpkiKeyId(certificate.spki) };
}

export async function relaySpkiKeyId(spki: Uint8Array): Promise<string> {
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", owned(spki))));
}

export function relayCertificateNames(certificate: RelayX509Certificate): RelaySubjectNames | null {
  return relaySubjectNames(certificate.subject.attributes);
}

export function isRelayP256Certificate(certificate: RelayX509Certificate): boolean {
  return (
    certificate.publicKeyAlgorithm === RELAY_X509_OID.ecPublicKey &&
    certificate.publicKeyCurve === RELAY_X509_OID.prime256v1
  );
}

export async function verifyRelayP256(spki: Uint8Array, data: Uint8Array, signature: Uint8Array): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey("spki", owned(spki), RELAY_ECDSA_P256, false, ["verify"]);
    return await crypto.subtle.verify(RELAY_ECDSA_SHA256, key, owned(signature), owned(data));
  } catch {
    return false;
  }
}

export async function relayCertificateIssuedBy(
  certificate: RelayX509Certificate,
  authority: RelayX509Certificate,
): Promise<boolean> {
  if (!authority.authority || !relayX509NamesEqual(certificate.issuer, authority.subject)) return false;
  if (certificate.signatureAlgorithm !== RELAY_X509_OID.ecdsaWithSha256 || !isRelayP256Certificate(authority)) {
    return false;
  }
  const signature = relayEcdsaSignatureToP1363(certificate.signature);
  return signature !== null && verifyRelayP256(authority.spki, certificate.tbs, signature);
}

export async function relayIssuance<Certificate extends RelayX509Certificate>(
  pairs: ReadonlyArray<readonly [Certificate, Certificate]>,
): Promise<(certificate: Certificate, authority: Certificate) => boolean> {
  const issued = new Map<Certificate, Set<Certificate>>();
  await Promise.all(
    pairs.map(async ([certificate, authority]) => {
      if (!(await relayCertificateIssuedBy(certificate, authority))) return;
      issued.set(certificate, new Set([...(issued.get(certificate) ?? []), authority]));
    }),
  );
  return (certificate, authority) => issued.get(certificate)?.has(authority) ?? false;
}

export function relayTrustPairs<Certificate>(
  leaf: Certificate,
  root: Certificate,
  chain: readonly Certificate[],
): Array<readonly [Certificate, Certificate]> {
  return [[leaf, root], ...chain.flatMap((authority) => [[leaf, authority] as const, [authority, root] as const])];
}

export async function relayPeerCertificateRefusal(
  peer: RelayPeerCertificate,
  trust: RelayTrustAnchors,
  now: number,
): Promise<RelayPeerRefusal | null> {
  const [leaf = null, root = null, ...authorities] = await Promise.all([
    readRelayCertificate(peer.certificate),
    readRelayCertificate(trust.root),
    ...trust.chain.map(readRelayCertificate),
  ]);
  const chain = authorities.filter((certificate) => certificate !== null);
  const issuedBy = leaf && root ? await relayIssuance(relayTrustPairs(leaf, root, chain)) : () => false;
  return relayPeerRefusal({
    peer,
    leaf,
    root,
    chain,
    team: trust.team,
    now,
    view: {
      authority: (certificate) => certificate.authority,
      keyId: (certificate) => certificate.keyId,
      names: relayCertificateNames,
      validity: (certificate) => ({ notBefore: certificate.notBefore, notAfter: certificate.notAfter }),
      issuedBy,
    },
  });
}

export async function relayServerProofRefusal(check: RelayServerProofCheck): Promise<RelayServerProofRefusal | null> {
  const [certificate, root] = await Promise.all([
    readRelayCertificate(check.certificate),
    readRelayCertificate(check.root),
  ]);
  if (!certificate || !root) return "unreadable";
  const refusal = relayServerCertificateRefusal(
    {
      issuedByRoot: await relayCertificateIssuedBy(certificate, root),
      authority: certificate.authority,
      extendedKeyUsages: certificate.extendedKeyUsages,
      notBefore: certificate.notBefore,
      notAfter: certificate.notAfter,
      dnsNames: certificate.dnsNames,
      ipAddresses: certificate.ipAddresses,
      p256Key: isRelayP256Certificate(certificate),
    },
    { relayUrl: check.relayUrl, now: check.now },
  );
  if (refusal !== null) return refusal;
  const signature = base64UrlBytes(check.signature);
  const transcript = textEncoder.encode(relayServerProofTranscript(check.transcript));
  return signature && (await verifyRelayP256(certificate.spki, transcript, signature)) ? null : "signature";
}

function base64UrlBytes(text: string): Uint8Array<ArrayBuffer> | null {
  try {
    return base64UrlToBytes(text);
  } catch {
    return null;
  }
}

function owned(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes);
}
