import { createPrivateKey, createPublicKey, type KeyObject, sign, X509Certificate } from "node:crypto";
import {
  type RelayHubServerMessage,
  type RelayServerProofTranscriptInput,
  relayServerProofTranscript,
} from "@openbot/contracts/relay-protocol/hub";
import { RELAY_PROTOCOL_VERSION } from "@openbot/contracts/relay-protocol/messages";
import {
  parseRelaySubjectAltName,
  type RelayServerCertificateRefusal,
  relayServerCertificateRefusal,
} from "@openbot/contracts/relay-protocol/server-proof";
import { publicKeyId } from "./x509";

export interface RelayServerIdentity {
  certificate: string;
  privateKey: KeyObject;
  expiresAt: number;
}

type ServerIdentityCheck = { ok: true; identity: RelayServerIdentity } | { ok: false; message: string };

const MAKE_ONE = 'Run "ca server --dns <public host>" to make the server identity certificate.';

const REFUSAL_MESSAGES: Record<RelayServerCertificateRefusal, string> = {
  untrusted: "The root of this server did not issue the server identity certificate.",
  authority: "The server identity certificate is a certificate authority.",
  usage: "The server identity certificate is not for server authentication.",
  not_in_date: "The server identity certificate is expired or not valid yet.",
  host: "The server identity certificate does not name the host of RELAY_PUBLIC_URL.",
  key: "The server identity certificate does not have an ECDSA P-256 key.",
};

export function checkServerIdentity(input: {
  certificatePem: string;
  privateKeyPem: string;
  root: X509Certificate;
  publicUrl: string | null;
  now: number;
}): ServerIdentityCheck {
  let certificate: X509Certificate;
  let privateKey: KeyObject;
  try {
    certificate = new X509Certificate(input.certificatePem);
    privateKey = createPrivateKey(input.privateKeyPem);
  } catch {
    return { ok: false, message: `The server identity certificate or its key cannot be read. ${MAKE_ONE}` };
  }
  const names = parseRelaySubjectAltName(certificate.subjectAltName);
  const refusal = relayServerCertificateRefusal(
    {
      issuedByRoot: issuedBy(certificate, input.root),
      authority: certificate.ca,
      extendedKeyUsages: certificate.keyUsage ?? [],
      notBefore: Date.parse(certificate.validFrom),
      notAfter: Date.parse(certificate.validTo),
      dnsNames: names.dnsNames,
      ipAddresses: names.ipAddresses,
      p256Key: isP256(certificate.publicKey),
    },
    { relayUrl: input.publicUrl, now: input.now },
  );
  if (refusal !== null) return { ok: false, message: `${REFUSAL_MESSAGES[refusal]} ${MAKE_ONE}` };
  if (publicKeyId(createPublicKey(privateKey)) !== publicKeyId(certificate.publicKey)) {
    return { ok: false, message: `The private key is not the key of the server identity certificate. ${MAKE_ONE}` };
  }
  return {
    ok: true,
    identity: { certificate: certificate.toString(), privateKey, expiresAt: Date.parse(certificate.validTo) },
  };
}

export function serverProofMessage(
  identity: RelayServerIdentity,
  input: RelayServerProofTranscriptInput,
): RelayHubServerMessage {
  const signature = sign("sha256", Buffer.from(relayServerProofTranscript(input)), {
    key: identity.privateKey,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  return { type: "server-proof", version: RELAY_PROTOCOL_VERSION, certificate: identity.certificate, signature };
}

function issuedBy(certificate: X509Certificate, root: X509Certificate): boolean {
  if (!root.ca || certificate.issuer !== root.subject) return false;
  try {
    return certificate.verify(root.publicKey);
  } catch {
    return false;
  }
}

function isP256(publicKey: KeyObject): boolean {
  return publicKey.asymmetricKeyType === "ec" && publicKey.asymmetricKeyDetails?.namedCurve === "prime256v1";
}
