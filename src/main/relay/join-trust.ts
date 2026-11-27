import type { IncomingMessage } from "node:http";
import { request } from "node:https";
import { getCACertificates } from "node:tls";
import {
  RELAY_ROOT_RESPONSE_BYTES_LIMIT,
  type RelayJoinCode,
  relayRootOfCode,
  relayRootUrl,
} from "@openbot/contracts/relay-protocol/enrollment";
import { webRelayCrypto } from "@openbot/team-client/relay-crypto";
import { type RelayJoinFetch, relayJoinError } from "@openbot/team-client/relay-join";

const ENROLL_RESPONSE_BYTES_LIMIT = 64 * 1024;
const TLS_CERTIFICATE_ERRORS: ReadonlySet<string> = new Set([
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "CERT_UNTRUSTED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);

interface HttpsAnswer {
  status: number;
  text: string;
}

class ResponseTooLarge extends Error {}

export async function relayJoinFetch(code: RelayJoinCode, signal: AbortSignal): Promise<RelayJoinFetch> {
  const root = await codeRoot(code, signal);
  const authorities = root === null ? getCACertificates("default") : [...getCACertificates("default"), root];
  return async (url, init) => {
    const answer = await sendTrusted(url, init, authorities);
    return new Response(answer.text, { status: answer.status });
  };
}

async function codeRoot(code: RelayJoinCode, signal: AbortSignal): Promise<string | null> {
  let answer: HttpsAnswer;
  try {
    answer = await https(relayRootUrl(code), {
      method: "GET",
      headers: { accept: "application/x-pem-file" },
      body: null,
      authorities: null,
      limit: RELAY_ROOT_RESPONSE_BYTES_LIMIT,
      signal,
    });
  } catch {
    return null;
  }
  if (answer.status !== 200) return null;
  const root = await relayRootOfCode(answer.text, code, webRelayCrypto);
  if (root === null) throw relayJoinError("root_mismatch");
  return root;
}

async function sendTrusted(url: string, init: RequestInit, authorities: string[]): Promise<HttpsAnswer> {
  try {
    return await https(url, {
      method: init.method ?? "GET",
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body: typeof init.body === "string" ? init.body : null,
      authorities,
      limit: ENROLL_RESPONSE_BYTES_LIMIT,
      signal: init.signal ?? null,
    });
  } catch (error) {
    throw relayJoinError(isCertificateError(error) ? "server_untrusted" : "network");
  }
}

function isCertificateError(error: unknown): boolean {
  return error instanceof Error && "code" in error && TLS_CERTIFICATE_ERRORS.has(String(error.code));
}

function https(
  url: string,
  options: {
    method: string;
    headers: Record<string, string>;
    body: string | null;
    authorities: string[] | null;
    limit: number;
    signal: AbortSignal | null;
  },
): Promise<HttpsAnswer> {
  return new Promise((resolveAnswer, reject) => {
    const outgoing = request(url, {
      method: options.method,
      headers:
        options.body === null
          ? options.headers
          : { ...options.headers, "content-length": Buffer.byteLength(options.body) },
      ...(options.authorities === null ? { rejectUnauthorized: false } : { ca: options.authorities }),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    outgoing.on("error", reject);
    outgoing.on("response", (incoming: IncomingMessage) => {
      const chunks: Buffer[] = [];
      let size = 0;
      incoming.on("data", (chunk: Buffer) => {
        size += chunk.byteLength;
        if (size > options.limit) {
          incoming.destroy(new ResponseTooLarge("The answer is too large."));
          return;
        }
        chunks.push(chunk);
      });
      incoming.on("error", reject);
      incoming.on("end", () =>
        resolveAnswer({ status: incoming.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }),
      );
    });
    outgoing.end(options.body ?? undefined);
  });
}
