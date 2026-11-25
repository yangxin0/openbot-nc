import { type KeyObject, verify } from "node:crypto";
import {
  type RelayServerMessage,
  type RelayServerProofTranscriptInput,
  relayServerProofTranscript,
} from "@openbot/contracts/relay-protocol/messages";
import {
  parseRelaySubjectAltName,
  type RelayServerProofRefusal,
  relayServerCertificateRefusal,
} from "@openbot/contracts/relay-protocol/server-proof";
import { issuedBy, readCertificate } from "./certificates";

type RelayServerProof = Extract<RelayServerMessage, { type: "server-proof" }>;

export function relayServerProofRefusal(input: {
  proof: Pick<RelayServerProof, "certificate" | "signature">;
  root: string;
  relayUrl: string;
  transcript: RelayServerProofTranscriptInput;
  now: number;
}): RelayServerProofRefusal | null {
  const certificate = readCertificate(input.proof.certificate);
  const root = readCertificate(input.root);
  if (!certificate || !root) return "unreadable";
  const names = parseRelaySubjectAltName(certificate.subjectAltName);
  const refusal = relayServerCertificateRefusal(
    {
      issuedByRoot: issuedBy(certificate, root),
      authority: certificate.ca,
      extendedKeyUsages: certificate.keyUsage ?? [],
      notBefore: Date.parse(certificate.validFrom),
      notAfter: Date.parse(certificate.validTo),
      dnsNames: names.dnsNames,
      ipAddresses: names.ipAddresses,
      p256Key: isP256(certificate.publicKey),
    },
    { relayUrl: input.relayUrl, now: input.now },
  );
  if (refusal !== null) return refusal;
  return signatureIsValid(certificate.publicKey, relayServerProofTranscript(input.transcript), input.proof.signature)
    ? null
    : "signature";
}

function signatureIsValid(publicKey: KeyObject, transcript: string, signature: string): boolean {
  try {
    return verify(
      "sha256",
      Buffer.from(transcript),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(signature, "base64url"),
    );
  } catch {
    return false;
  }
}

function isP256(publicKey: KeyObject): boolean {
  return publicKey.asymmetricKeyType === "ec" && publicKey.asymmetricKeyDetails?.namedCurve === "prime256v1";
}
