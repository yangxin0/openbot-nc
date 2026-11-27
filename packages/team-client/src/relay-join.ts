import {
  decodeRelayEnrollError,
  decodeRelayEnrollResponse,
  isRelayEnrollLabel,
  parseRelayJoinCode,
  RELAY_ENROLL_ERROR_CODES,
  RELAY_ENROLL_VERSION,
  type RelayEnrollCrypto,
  type RelayEnrollRefusal,
  type RelayEnrollResponse,
  type RelayJoinCode,
  relayBase64Url,
  relayEnrollRefusal,
  relayEnrollTranscript,
  relayEnrollUrl,
} from "@openbot/contracts/relay-protocol/enrollment";
import {
  RELAY_IDENTITY_BUNDLE_VERSION,
  type RelayIdentityBundle,
} from "@openbot/contracts/relay-protocol/identity-bundle";
import type { SourceMessages } from "@openbot/i18n/source";
import { sourceText } from "@openbot/i18n/source";
import { Schema } from "effect";
import type { RelayCrypto, RelaySigningKey } from "./relay-crypto";
import {
  type RelayBrowserIdentity,
  RelayIdentityError,
  type RelayIdentityParts,
  verifyRelayIdentity,
} from "./relay-identity";

const RELAY_JOIN_REFUSALS = [
  "server_mismatch",
  "unreadable",
  "root_mismatch",
  "key_mismatch",
  "name_mismatch",
  "untrusted",
  "not_in_date",
] as const satisfies readonly RelayEnrollRefusal[];

export const RELAY_JOIN_ERROR_CODES = [
  "invalid_code",
  "other_server",
  "key_unavailable",
  "network",
  "server_untrusted",
  "invalid_response",
  ...RELAY_ENROLL_ERROR_CODES,
  ...RELAY_JOIN_REFUSALS,
] as const;
export type RelayJoinErrorCode = (typeof RELAY_JOIN_ERROR_CODES)[number];

export const RELAY_JOIN_ERROR_TEXT = {
  invalid_code: "error.remote.relayJoinInvalidCode",
  other_server: "error.remote.relayJoinOtherServer",
  key_unavailable: "error.remote.relayJoinKeyUnavailable",
  network: "error.remote.relayJoinUnreachable",
  server_untrusted: "error.remote.relayJoinServerUntrusted",
  invalid_response: "error.remote.relayJoinInvalidResponse",
  invalid_request: "error.remote.relayJoinRefused",
  code_unknown: "error.remote.relayJoinCodeUnknown",
  proof_invalid: "error.remote.relayJoinProofInvalid",
  rate_limited: "error.remote.relayJoinRateLimited",
  unavailable: "error.remote.relayJoinUnavailable",
  server_mismatch: "error.remote.relayJoinServerMismatch",
  root_mismatch: "error.remote.relayJoinRootMismatch",
  unreadable: "error.remote.relayJoinCertificateInvalid",
  key_mismatch: "error.remote.relayJoinCertificateInvalid",
  name_mismatch: "error.remote.relayJoinCertificateInvalid",
  untrusted: "error.remote.relayJoinCertificateInvalid",
  not_in_date: "error.remote.relayJoinNotInDate",
} as const satisfies Record<RelayJoinErrorCode, keyof SourceMessages>;
export type RelayJoinTextKey = (typeof RELAY_JOIN_ERROR_TEXT)[RelayJoinErrorCode];

export class RelayJoinError extends Schema.TaggedError<RelayJoinError>()("RelayJoinError", {
  code: Schema.Literals(RELAY_JOIN_ERROR_CODES),
  message: Schema.String,
}) {}

export type RelayJoinFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface RelayEnrollSigner {
  publicKey: Uint8Array<ArrayBuffer>;
  sign(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>>;
}

export interface RelayEnrollOptions {
  crypto: RelayEnrollCrypto;
  fetch?: RelayJoinFetch;
  label?: string;
  now?: number;
  signal?: AbortSignal;
}

export interface RelayJoinOptions extends Omit<RelayEnrollOptions, "crypto"> {
  crypto: RelayCrypto;
  server?: string;
}

export interface RelayJoined {
  identity: RelayBrowserIdentity;
  bundleText: string | null;
}

const JSON_HEADERS = { "content-type": "application/json", accept: "application/json" };
const PEM_LINE_LENGTH = 64;

export function relayJoinError(code: RelayJoinErrorCode): RelayJoinError {
  return new RelayJoinError({ code, message: sourceText(RELAY_JOIN_ERROR_TEXT[code]) });
}

export function readRelayJoinCode(text: string, server?: string): RelayJoinCode {
  const code = parseRelayJoinCode(text);
  if (!code) throw relayJoinError("invalid_code");
  if (server !== undefined && code.server !== server.toLowerCase()) throw relayJoinError("other_server");
  return code;
}

export async function enrollRelayKey(
  code: RelayJoinCode,
  signer: RelayEnrollSigner,
  options: RelayEnrollOptions,
): Promise<RelayEnrollResponse> {
  const { crypto } = options;
  const secretHash = await crypto.sha256(code.secret);
  const transcript = relayEnrollTranscript({ secretHash, server: code.server, publicKey: signer.publicKey });
  const proof = relayBase64Url(await signer.sign(transcript));
  const label = options.label !== undefined && isRelayEnrollLabel(options.label) ? options.label.trim() : "";
  const body = JSON.stringify({
    version: RELAY_ENROLL_VERSION,
    code: code.code,
    publicKey: relayBase64Url(signer.publicKey),
    ...(label === "" ? {} : { label }),
    proof,
  });
  const send = options.fetch ?? globalThis.fetch;
  let status: number;
  let text: string;
  try {
    const response = await send(relayEnrollUrl(code), {
      method: "POST",
      headers: JSON_HEADERS,
      body,
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      ...(options.signal ? { signal: options.signal } : {}),
    });
    status = response.status;
    text = await response.text();
  } catch (error) {
    throw error instanceof RelayJoinError ? error : relayJoinError("network");
  }
  if (status < 200 || status > 299) {
    const refusal = decodeJsonText(text, decodeRelayEnrollError);
    throw relayJoinError(refusal ? refusal.error : "invalid_response");
  }
  const response = decodeJsonText(text, decodeRelayEnrollResponse);
  if (!response) throw relayJoinError("invalid_response");
  const refusal = await relayEnrollRefusal({
    code,
    response,
    publicKey: signer.publicKey,
    now: options.now ?? Date.now(),
    crypto,
  });
  if (refusal) throw relayJoinError(refusal);
  return response;
}

export async function joinRelayWithCode(text: string, options: RelayJoinOptions): Promise<RelayJoined> {
  const code = readRelayJoinCode(text, options.server);
  const { crypto } = options;
  let key: RelaySigningKey;
  try {
    key = await crypto.generateSigningKey();
  } catch {
    throw relayJoinError("key_unavailable");
  }
  const response = await enrollRelayKey(
    code,
    { publicKey: key.publicKey, sign: (data) => crypto.sign(key.privateKey, data) },
    options,
  );
  const parts = relayIdentityParts(response);
  let identity: RelayBrowserIdentity;
  try {
    identity = await verifyRelayIdentity(parts, key.privateKey, {
      crypto,
      ...(options.now === undefined ? {} : { now: options.now }),
    });
  } catch (error) {
    if (error instanceof RelayIdentityError) throw relayJoinError(identityRefusal(error));
    throw error;
  }
  const bundle: RelayIdentityBundle | null =
    key.pkcs8 === null
      ? null
      : {
          version: RELAY_IDENTITY_BUNDLE_VERSION,
          ...parts,
          privateKey: relayPem("PRIVATE KEY", key.pkcs8),
        };
  return { identity, bundleText: bundle === null ? null : JSON.stringify(bundle) };
}

export function relayIdentityParts(response: RelayEnrollResponse): RelayIdentityParts & { chain: string[] } {
  return {
    relayUrl: response.relayUrl,
    team: response.team.name,
    user: response.user,
    device: response.device,
    certificate: response.certificate,
    chain: [...response.chain],
    root: response.root,
  };
}

export function relayJoinErrorKey(error: unknown): RelayJoinTextKey | null {
  return error instanceof RelayJoinError ? RELAY_JOIN_ERROR_TEXT[error.code] : null;
}

function identityRefusal(error: RelayIdentityError): RelayJoinErrorCode {
  if (error.code === "expired" || error.code === "not_yet_valid") return "not_in_date";
  if (error.code === "untrusted_chain") return "untrusted";
  if (error.code === "key_mismatch" || error.code === "unsupported_key") return "key_mismatch";
  return "unreadable";
}

function relayPem(label: string, der: Uint8Array): string {
  let binary = "";
  for (const byte of der) binary += String.fromCharCode(byte);
  const body = btoa(binary);
  const lines: string[] = [];
  for (let start = 0; start < body.length; start += PEM_LINE_LENGTH)
    lines.push(body.slice(start, start + PEM_LINE_LENGTH));
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

function decodeJsonText<Value>(text: string, decode: (value: unknown) => Value | null): Value | null {
  try {
    return decode(JSON.parse(text));
  } catch {
    return null;
  }
}
