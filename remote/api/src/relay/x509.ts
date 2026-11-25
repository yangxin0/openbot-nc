import { createHash, generateKeyPairSync, type KeyObject, randomBytes, sign, X509Certificate } from "node:crypto";
import { isIP } from "node:net";
import {
  certificateSubjectDer,
  derBitString,
  derBoolean,
  derConcat,
  derExplicit,
  derImplicit,
  derObjectIdentifier,
  derOctetString,
  derSequence,
  derSet,
  derSmallInteger,
  derTime,
  derUnsignedInteger,
  derUtf8String,
} from "./der";

const OID = {
  ecdsaWithSha256: "1.2.840.10045.4.3.2",
  organization: "2.5.4.10",
  organizationalUnit: "2.5.4.11",
  commonName: "2.5.4.3",
  subjectKeyIdentifier: "2.5.29.14",
  keyUsage: "2.5.29.15",
  subjectAltName: "2.5.29.17",
  basicConstraints: "2.5.29.19",
  authorityKeyIdentifier: "2.5.29.35",
  extendedKeyUsage: "2.5.29.37",
  serverAuth: "1.3.6.1.5.5.7.3.1",
  clientAuth: "1.3.6.1.5.5.7.3.2",
} as const;

export const CLIENT_AUTH_USAGE = OID.clientAuth;

const KEY_USAGE = {
  digitalSignature: { unusedBits: 7, bits: 0x80 },
  certificateAuthority: { unusedBits: 1, bits: 0x06 },
} as const;

const CLOCK_SKEW_MS = 5 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const SERIAL_BYTES = 16;
const KEY_IDENTIFIER_BYTES = 20;

interface SubjectNames {
  organization?: string | undefined;
  organizationalUnit?: string | undefined;
  commonName: string;
}

export interface IssuedCertificate {
  certificate: string;
  serial: string;
  expiresAt: number;
}

interface CertificateIssuer {
  certificate: string;
  privateKey: KeyObject;
}

type CertificateProfile =
  | { kind: "authority"; pathLength: number }
  | { kind: "member" }
  | { kind: "server"; dnsNames: readonly string[]; ipAddresses: readonly string[] };

export function generateSigningKey(): { privateKey: KeyObject; publicKey: KeyObject } {
  return generateKeyPairSync("ec", { namedCurve: "prime256v1" });
}

export function publicKeyId(publicKey: KeyObject): string {
  return createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("base64url");
}

export function issueCertificate(input: {
  subject: SubjectNames;
  publicKey: KeyObject;
  profile: CertificateProfile;
  days: number;
  issuer: CertificateIssuer | { selfSigned: KeyObject };
  now: number;
}): IssuedCertificate {
  const subjectDer = encodeSubject(input.subject);
  const issuerCertificate = "certificate" in input.issuer ? new X509Certificate(input.issuer.certificate) : null;
  const issuerDer = issuerCertificate ? certificateSubjectDer(new Uint8Array(issuerCertificate.raw)) : subjectDer;
  const issuerPublicKey = issuerCertificate ? issuerCertificate.publicKey : input.publicKey;
  const signingKey = "certificate" in input.issuer ? input.issuer.privateKey : input.issuer.selfSigned;
  const serial = positiveSerial();
  const notBefore = new Date(input.now - CLOCK_SKEW_MS);
  const notAfter = new Date(input.now + input.days * DAY_MS);
  if (issuerCertificate && notAfter.getTime() > Date.parse(issuerCertificate.validTo)) {
    throw new Error("The certificate cannot be valid for longer than its issuer.");
  }
  const signatureAlgorithm = derSequence([derObjectIdentifier(OID.ecdsaWithSha256)]);
  const toBeSigned = derSequence([
    derExplicit(0, derSmallInteger(2)),
    derUnsignedInteger(serial),
    signatureAlgorithm,
    issuerDer,
    derSequence([derTime(notBefore), derTime(notAfter)]),
    subjectDer,
    new Uint8Array(input.publicKey.export({ type: "spki", format: "der" })),
    derExplicit(3, derSequence(extensions(input.profile, input.publicKey, issuerPublicKey))),
  ]);
  const signature = new Uint8Array(sign("sha256", toBeSigned, signingKey));
  const certificate = pem(derSequence([toBeSigned, signatureAlgorithm, derBitString(signature)]));
  const parsed = new X509Certificate(certificate);
  if (!parsed.verify(issuerPublicKey)) throw new Error("The new certificate did not pass its signature check.");
  return { certificate, serial: Buffer.from(serial).toString("hex"), expiresAt: Date.parse(parsed.validTo) };
}

function positiveSerial(): Uint8Array {
  const serial = new Uint8Array(randomBytes(SERIAL_BYTES));
  serial[0] = ((serial[0] ?? 0) & 0x7f) | 0x40;
  return serial;
}

function encodeSubject(subject: SubjectNames): Uint8Array {
  const attribute = (oid: string, value: string) =>
    derSet([derSequence([derObjectIdentifier(oid), derUtf8String(value)])]);
  return derSequence([
    ...(subject.organization === undefined ? [] : [attribute(OID.organization, subject.organization)]),
    ...(subject.organizationalUnit === undefined
      ? []
      : [attribute(OID.organizationalUnit, subject.organizationalUnit)]),
    attribute(OID.commonName, subject.commonName),
  ]);
}

function keyIdentifier(publicKey: KeyObject): Uint8Array {
  const digest = createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest();
  return new Uint8Array(digest.subarray(0, KEY_IDENTIFIER_BYTES));
}

function extension(oid: string, critical: boolean, value: Uint8Array): Uint8Array {
  return derSequence([derObjectIdentifier(oid), ...(critical ? [derBoolean(true)] : []), derOctetString(value)]);
}

function extensions(profile: CertificateProfile, publicKey: KeyObject, issuerPublicKey: KeyObject): Uint8Array[] {
  const authority = profile.kind === "authority";
  const usage = authority ? KEY_USAGE.certificateAuthority : KEY_USAGE.digitalSignature;
  const list = [
    extension(
      OID.basicConstraints,
      true,
      derSequence(authority ? [derBoolean(true), derSmallInteger(profile.pathLength)] : []),
    ),
    extension(OID.keyUsage, true, derBitString(Uint8Array.of(usage.bits), usage.unusedBits)),
    extension(OID.subjectKeyIdentifier, false, derOctetString(keyIdentifier(publicKey))),
    extension(OID.authorityKeyIdentifier, false, derSequence([derImplicit(0, keyIdentifier(issuerPublicKey))])),
  ];
  if (profile.kind === "member") {
    list.push(
      extension(
        OID.extendedKeyUsage,
        false,
        derSequence([derObjectIdentifier(OID.clientAuth), derObjectIdentifier(OID.serverAuth)]),
      ),
    );
  }
  if (profile.kind === "server") {
    list.push(extension(OID.extendedKeyUsage, false, derSequence([derObjectIdentifier(OID.serverAuth)])));
    list.push(
      extension(
        OID.subjectAltName,
        false,
        derSequence([
          ...profile.dnsNames.map((name) => derImplicit(2, new TextEncoder().encode(name))),
          ...profile.ipAddresses.map((address) => derImplicit(7, ipAddressBytes(address))),
        ]),
      ),
    );
  }
  return list;
}

function ipAddressBytes(address: string): Uint8Array {
  const family = isIP(address);
  if (family === 4) return Uint8Array.from(address.split(".").map((part) => Number(part)));
  if (family !== 6) throw new Error("The IP address is invalid.");
  const [head = "", tail] = address.split("::");
  const groups = (text: string) => (text === "" ? [] : text.split(":"));
  const left = groups(head);
  const right = tail === undefined ? [] : groups(tail);
  const zeros = tail === undefined ? 0 : 8 - left.length - right.length;
  const words = [...left, ...Array.from({ length: zeros }, () => "0"), ...right].map((group) =>
    Number.parseInt(group, 16),
  );
  if (words.length !== 8 || words.some((word) => !Number.isInteger(word) || word < 0 || word > 0xffff)) {
    throw new Error("The IP address is not supported.");
  }
  return derConcat(words.map((word) => Uint8Array.of(word >> 8, word & 0xff)));
}

function pem(der: Uint8Array): string {
  const base64 = Buffer.from(der).toString("base64");
  const lines = base64.match(/.{1,64}/gu) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----\n`;
}
