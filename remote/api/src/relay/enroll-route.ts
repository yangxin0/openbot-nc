import {
  decodeRelayEnrollRequest,
  RELAY_ENROLL_REQUEST_BYTES_LIMIT,
  type RelayEnrollError,
  type RelayEnrollErrorCode,
  type RelayEnrollRequest,
} from "@openbot/contracts/relay-protocol/enrollment";
import { Effect, Result } from "effect";
import type { RelayEnrollLimits } from "./config";
import type { Enrollment } from "./enrollment";
import { SlidingWindowLimit } from "./rate-limit";

const MINUTE_MS = 60_000;
const GLOBAL_KEY = "all";

const RESPONSE_HEADERS: Readonly<Record<string, string>> = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

const PREFLIGHT_HEADERS: Readonly<Record<string, string>> = {
  ...RESPONSE_HEADERS,
  "Access-Control-Allow-Methods": "POST",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Max-Age": "600",
};

const STATUS: Record<RelayEnrollErrorCode, number> = {
  invalid_request: 400,
  code_unknown: 403,
  proof_invalid: 403,
  rate_limited: 429,
  unavailable: 503,
};

export type EnrollHandler = (request: Request, address: string) => Promise<Response>;

export function createEnrollHandler(enrollment: Enrollment, limits: RelayEnrollLimits): EnrollHandler {
  const perAddress = new SlidingWindowLimit(limits.perAddressPerMinute, MINUTE_MS);
  const overall = new SlidingWindowLimit(limits.perMinute, MINUTE_MS);
  return async (request, address) => {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: PREFLIGHT_HEADERS });
    if (request.method !== "POST") {
      return refusal("invalid_request", "Use POST.", { status: 405, headers: { Allow: "POST, OPTIONS" } });
    }
    if (!perAddress.take(address) || !overall.take(GLOBAL_KEY)) {
      return refusal("rate_limited", "Too many join requests. Try again in a minute.");
    }
    if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      return refusal("invalid_request", "The request must be JSON.");
    }
    const body = await limitedText(request, RELAY_ENROLL_REQUEST_BYTES_LIMIT);
    if (body === null) return refusal("invalid_request", "The request is too large.", { status: 413 });
    const decoded = decodeRequest(body);
    if (decoded === null) return refusal("invalid_request", "The request is not valid.");
    const result = await Effect.runPromise(Effect.result(enrollment.enroll(decoded)));
    if (Result.isFailure(result)) {
      const error = result.failure;
      if (error.code === "unavailable") console.error(`A join request failed. ${error.message}`);
      return refusal(error.code, error.message);
    }
    const { response, record, codeId } = result.success;
    const subject = [response.team.name, response.user, response.device].filter((part) => part !== null).join(" / ");
    console.log(`Join code ${codeId} made a certificate for ${subject}. Key identifier: ${record.keyId}`);
    return Response.json(response, { headers: RESPONSE_HEADERS });
  };
}

function refusal(
  code: RelayEnrollErrorCode,
  message: string,
  init: { status?: number; headers?: Record<string, string> } = {},
) {
  const body: RelayEnrollError = { error: code, message };
  return Response.json(body, {
    status: init.status ?? STATUS[code],
    headers: { ...RESPONSE_HEADERS, ...init.headers },
  });
}

function decodeRequest(text: string): RelayEnrollRequest | null {
  try {
    return decodeRelayEnrollRequest(JSON.parse(text));
  } catch {
    return null;
  }
}

async function limitedText(request: Request, limit: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declared) || declared > limit) return null;
  if (request.body === null) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
}
