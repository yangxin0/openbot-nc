import { isDynamicRecord, isString } from "../runtime-values";
import { isRelayUrl } from "./identity-bundle";
import {
  RELAY_CERTIFICATE_PEM_LIMIT,
  RELAY_CHAIN_LIMIT,
  RELAY_LABEL_LIMIT,
  RELAY_SUBJECT_NAME_PATTERN,
  RELAY_TEAM_ID_PATTERN,
  relayTeamIdStatement,
} from "./messages";
import { relaySubjectNames, relayTrustPath, relayValidityWindow } from "./peer-rules";
import type { RelayTunnelCrypto } from "./tunnel-crypto";
import {
  RELAY_X509_OID,
  type RelayX509Certificate,
  readRelayX509Certificate,
  relayEcdsaSignatureToP1363,
  relayX509NamesEqual,
} from "./x509";

export const RELAY_ENROLL_VERSION = 1;
export const RELAY_ENROLL_PATH = "/v1/enroll";
export const RELAY_ENROLL_CONTEXT = "openbot-relay-enroll-v1";
export const RELAY_ENROLL_REQUEST_BYTES_LIMIT = 8 * 1024;
export const RELAY_JOIN_CODE_PREFIX = "openbot-nc://enroll?";
export const RELAY_JOIN_CODE_TEXT_LIMIT = 512;
export const RELAY_JOIN_SECRET_BYTES = 16;
export const RELAY_JOIN_SECRET_LENGTH = 26;
export const RELAY_ROOT_FINGERPRINT_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
export const RELAY_ENROLL_PUBLIC_KEY_PATTERN = /^[A-Za-z0-9_-]{122}$/u;
export const RELAY_ENROLL_PROOF_PATTERN = /^[A-Za-z0-9_-]{86}$/u;
export const RELAY_ENROLL_ERROR_CODES = [
  "invalid_request",
  "code_unknown",
  "proof_invalid",
  "rate_limited",
  "unavailable",
] as const;
export type RelayEnrollErrorCode = (typeof RELAY_ENROLL_ERROR_CODES)[number];

const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const JOIN_CODE_FIELDS = ["v", "server", "code", "root"] as const;
const REQUEST_FIELDS = new Set(["version", "code", "publicKey", "label", "proof"]);
const ERROR_MESSAGE_LIMIT = 512;
const DNS_LABEL = "[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?";
const SERVER_PATTERN = new RegExp(
  `^(?:\\[[0-9A-Fa-f:.]{2,45}\\]|${DNS_LABEL}(?:\\.${DNS_LABEL})*)(?::(\\d{1,5}))?$`,
  "u",
);
const PEM_CERTIFICATE_PATTERN = /^-----BEGIN CERTIFICATE-----([A-Za-z0-9+/=\s]+)-----END CERTIFICATE-----$/u;
const RELAY_URL_HOST_PATTERN = /^wss:\/\/([^/?#@\s]+)(?:[/?#]|$)/iu;
const CONTROL_CHARACTER = /\p{Cc}/u;
const textEncoder = new TextEncoder();

export interface RelayJoinCode {
  version: typeof RELAY_ENROLL_VERSION;
  server: string;
  code: string;
  secret: Uint8Array<ArrayBuffer>;
  root: string;
}

export interface RelayEnrollRequest {
  version: typeof RELAY_ENROLL_VERSION;
  code: string;
  publicKey: string;
  label?: string;
  proof: string;
}

export interface RelayEnrollResponse {
  version: typeof RELAY_ENROLL_VERSION;
  relayUrl: string;
  team: { id: string; name: string };
  user: string;
  device: string | null;
  certificate: string;
  chain: string[];
  root: string;
}

export interface RelayEnrollError {
  error: RelayEnrollErrorCode;
  message: string;
}

export type RelayEnrollCrypto = Pick<RelayTunnelCrypto, "sha256" | "verify">;

export type RelayEnrollRefusal =
  | "server_mismatch"
  | "unreadable"
  | "root_mismatch"
  | "key_mismatch"
  | "name_mismatch"
  | "untrusted"
  | "not_in_date";

export interface RelayEnrollCheck {
  code: RelayJoinCode;
  response: RelayEnrollResponse;
  publicKey: Uint8Array;
  now: number;
  crypto: RelayEnrollCrypto;
}

export function encodeRelayJoinSecret(bytes: Uint8Array): string {
  let text = "";
  let value = 0;
  let bits = 0;
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xfff;
    bits += 8;
    while (bits >= 5) {
      text += CROCKFORD_ALPHABET.charAt((value >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  if (bits > 0) text += CROCKFORD_ALPHABET.charAt((value << (5 - bits)) & 31);
  return text;
}

export function decodeRelayJoinSecret(text: string): Uint8Array<ArrayBuffer> | null {
  if (text.length !== RELAY_JOIN_SECRET_LENGTH) return null;
  const secret = new Uint8Array(RELAY_JOIN_SECRET_BYTES);
  let value = 0;
  let bits = 0;
  let index = 0;
  for (const character of text.toUpperCase()) {
    const digit = CROCKFORD_ALPHABET.indexOf(character);
    if (digit < 0) return null;
    value = ((value << 5) | digit) & 0xfff;
    bits += 5;
    if (bits >= 8) {
      if (index >= RELAY_JOIN_SECRET_BYTES) return null;
      secret[index] = (value >>> (bits - 8)) & 0xff;
      index += 1;
      bits -= 8;
    }
  }
  const padding = value & ((1 << bits) - 1);
  return index === RELAY_JOIN_SECRET_BYTES && padding === 0 ? secret : null;
}

export function isRelayJoinServer(text: string): boolean {
  const match = SERVER_PATTERN.exec(text);
  if (!match || text.length > 260) return false;
  const port = match[1];
  return port === undefined || (Number(port) >= 1 && Number(port) <= 65_535);
}

export function formatRelayJoinCode(input: { server: string; secret: Uint8Array; root: string }): string | null {
  const server = input.server.toLowerCase();
  if (!isRelayJoinServer(server) || input.secret.byteLength !== RELAY_JOIN_SECRET_BYTES) return null;
  if (!RELAY_ROOT_FINGERPRINT_PATTERN.test(input.root)) return null;
  const code = encodeRelayJoinSecret(input.secret);
  return `${RELAY_JOIN_CODE_PREFIX}v=${RELAY_ENROLL_VERSION}&server=${server}&code=${code}&root=${input.root}`;
}

export function parseRelayJoinCode(text: string): RelayJoinCode | null {
  const trimmed = text.trim();
  if (trimmed.length > RELAY_JOIN_CODE_TEXT_LIMIT) return null;
  if (trimmed.slice(0, RELAY_JOIN_CODE_PREFIX.length).toLowerCase() !== RELAY_JOIN_CODE_PREFIX) return null;
  const values = new Map<string, string>();
  for (const part of trimmed.slice(RELAY_JOIN_CODE_PREFIX.length).split("&")) {
    const separator = part.indexOf("=");
    const key = part.slice(0, separator);
    const value = part.slice(separator + 1);
    if (separator <= 0 || value.includes("=") || values.has(key)) return null;
    if (!JOIN_CODE_FIELDS.some((field) => field === key)) return null;
    values.set(key, value);
  }
  const version = values.get("v");
  const server = values.get("server")?.toLowerCase();
  const code = values.get("code")?.toUpperCase();
  const root = values.get("root");
  if (version !== String(RELAY_ENROLL_VERSION) || server === undefined || code === undefined || root === undefined) {
    return null;
  }
  const secret = decodeRelayJoinSecret(code);
  if (!isRelayJoinServer(server) || secret === null || !RELAY_ROOT_FINGERPRINT_PATTERN.test(root)) return null;
  return { version: RELAY_ENROLL_VERSION, server, code, secret, root };
}

export function relayEnrollUrl(code: Pick<RelayJoinCode, "server">): string {
  return `https://${code.server}${RELAY_ENROLL_PATH}`;
}

export function relayEnrollTranscript(input: {
  secretHash: Uint8Array;
  server: string;
  publicKey: Uint8Array;
}): Uint8Array<ArrayBuffer> {
  const parts = [
    textEncoder.encode(RELAY_ENROLL_CONTEXT),
    input.secretHash,
    textEncoder.encode(input.server.toLowerCase()),
    input.publicKey,
  ];
  const transcript = new Uint8Array(parts.reduce((total, part) => total + 4 + part.byteLength, 0));
  const view = new DataView(transcript.buffer);
  let offset = 0;
  for (const part of parts) {
    view.setUint32(offset, part.byteLength);
    transcript.set(part, offset + 4);
    offset += 4 + part.byteLength;
  }
  return transcript;
}

export function isRelayEnrollLabel(value: unknown): value is string {
  return isString(value) && value.length <= RELAY_LABEL_LIMIT && !CONTROL_CHARACTER.test(value);
}

export function decodeRelayEnrollRequest(value: unknown): RelayEnrollRequest | null {
  if (!isDynamicRecord(value) || value.version !== RELAY_ENROLL_VERSION) return null;
  if (Object.keys(value).some((key) => !REQUEST_FIELDS.has(key))) return null;
  const { code, publicKey, label, proof } = value;
  if (!isString(code) || decodeRelayJoinSecret(code) === null) return null;
  if (!isString(publicKey) || !RELAY_ENROLL_PUBLIC_KEY_PATTERN.test(publicKey)) return null;
  if (!isString(proof) || !RELAY_ENROLL_PROOF_PATTERN.test(proof)) return null;
  if (label !== undefined && !isRelayEnrollLabel(label)) return null;
  return {
    version: RELAY_ENROLL_VERSION,
    code: code.toUpperCase(),
    publicKey,
    proof,
    ...(label === undefined ? {} : { label }),
  };
}

export function decodeRelayEnrollResponse(value: unknown): RelayEnrollResponse | null {
  if (!isDynamicRecord(value) || value.version !== RELAY_ENROLL_VERSION) return null;
  const { relayUrl, team, user, device, certificate, chain, root } = value;
  if (!isRelayUrl(relayUrl) || !isDynamicRecord(team)) return null;
  if (!isString(team.id) || !RELAY_TEAM_ID_PATTERN.test(team.id) || !isSubjectName(team.name)) return null;
  if (!isSubjectName(user) || (device !== null && !isSubjectName(device))) return null;
  if (!isPem(certificate) || !isPem(root)) return null;
  if (!Array.isArray(chain) || chain.length > RELAY_CHAIN_LIMIT || !chain.every(isPem)) return null;
  return {
    version: RELAY_ENROLL_VERSION,
    relayUrl,
    team: { id: team.id, name: team.name },
    user,
    device,
    certificate,
    chain: [...chain],
    root,
  };
}

export function decodeRelayEnrollError(value: unknown): RelayEnrollError | null {
  if (!isDynamicRecord(value) || !isString(value.message) || value.message.length > ERROR_MESSAGE_LIMIT) return null;
  const code = RELAY_ENROLL_ERROR_CODES.find((candidate) => candidate === value.error);
  return code === undefined ? null : { error: code, message: value.message };
}

export function readRelayPemCertificate(pem: string): RelayX509Certificate | null {
  const body = PEM_CERTIFICATE_PATTERN.exec(pem.trim())?.[1];
  const der = body === undefined ? null : bytesFromBase64(body.replace(/\s+/gu, ""));
  return der === null ? null : readRelayX509Certificate(der);
}

export function relayBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export async function relayEnrollRefusal(check: RelayEnrollCheck): Promise<RelayEnrollRefusal | null> {
  const { code, response, crypto } = check;
  if (relayUrlHost(response.relayUrl) !== code.server) return "server_mismatch";
  const leaf = readRelayPemCertificate(response.certificate);
  const root = readRelayPemCertificate(response.root);
  const offered = response.chain.map(readRelayPemCertificate);
  const chain = offered.filter((certificate) => certificate !== null);
  if (!leaf || !root || leaf.authority || chain.length !== offered.length) return "unreadable";
  if (relayBase64Url(await crypto.sha256(root.der)) !== code.root) return "root_mismatch";
  if (!isP256(leaf) || !sameBytes(leaf.spki, check.publicKey)) return "key_mismatch";
  const names = relaySubjectNames(leaf.subject.attributes);
  const rootKeyId = relayBase64Url(await crypto.sha256(root.spki));
  const teamStatement = textEncoder.encode(relayTeamIdStatement({ rootKeyId, teamName: response.team.name }));
  const teamId = relayBase64Url(await crypto.sha256(teamStatement));
  if (
    !names ||
    names.team !== response.team.name ||
    names.user !== response.user ||
    names.device !== response.device ||
    teamId !== response.team.id
  ) {
    return "name_mismatch";
  }
  const issuedBy = await issuance(
    [
      [root, root],
      [leaf, root],
      ...chain.flatMap((authority) => [[leaf, authority] as const, [authority, root] as const]),
    ],
    crypto,
  );
  const path = issuedBy(root, root) ? relayTrustPath(leaf, root, chain, issuedBy) : null;
  if (!path) return "untrusted";
  for (const authority of path.slice(0, -1)) {
    const authorityNames = relaySubjectNames(authority.subject.attributes);
    if (!authorityNames || (authorityNames.team !== null && authorityNames.team !== response.team.name)) {
      return "untrusted";
    }
  }
  const window = relayValidityWindow([leaf, ...path]);
  if (!window || check.now < window.startsAt || check.now >= window.expiresAt) return "not_in_date";
  return null;
}

function relayUrlHost(relayUrl: string): string | null {
  const host = RELAY_URL_HOST_PATTERN.exec(relayUrl)?.[1]?.toLowerCase();
  return host === undefined ? null : host.replace(/:443$/u, "");
}

function isSubjectName(value: unknown): value is string {
  return isString(value) && RELAY_SUBJECT_NAME_PATTERN.test(value);
}

function isPem(value: unknown): value is string {
  return isString(value) && value.length > 0 && value.length <= RELAY_CERTIFICATE_PEM_LIMIT;
}

function isP256(certificate: RelayX509Certificate): boolean {
  return (
    certificate.publicKeyAlgorithm === RELAY_X509_OID.ecPublicKey &&
    certificate.publicKeyCurve === RELAY_X509_OID.prime256v1
  );
}

function sameBytes(first: Uint8Array, second: Uint8Array): boolean {
  return first.byteLength === second.byteLength && first.every((byte, index) => byte === second[index]);
}

function bytesFromBase64(text: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

async function issuance(
  pairs: ReadonlyArray<readonly [RelayX509Certificate, RelayX509Certificate]>,
  crypto: RelayEnrollCrypto,
): Promise<(certificate: RelayX509Certificate, authority: RelayX509Certificate) => boolean> {
  const verified = await Promise.all(pairs.map(([certificate, authority]) => issued(certificate, authority, crypto)));
  const issuedPairs = pairs.filter((_, index) => verified[index] === true);
  return (certificate, authority) =>
    issuedPairs.some(([candidate, issuer]) => candidate === certificate && issuer === authority);
}

async function issued(
  certificate: RelayX509Certificate,
  authority: RelayX509Certificate,
  crypto: RelayEnrollCrypto,
): Promise<boolean> {
  if (!authority.authority || !relayX509NamesEqual(certificate.issuer, authority.subject)) return false;
  if (certificate.signatureAlgorithm !== RELAY_X509_OID.ecdsaWithSha256 || !isP256(authority)) return false;
  const signature = relayEcdsaSignatureToP1363(certificate.signature);
  if (signature === null) return false;
  try {
    return await crypto.verify({ format: "spki", bytes: authority.spki }, certificate.tbs, signature);
  } catch {
    return false;
  }
}
