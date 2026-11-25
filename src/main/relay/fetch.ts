import { Agent, type ClientRequestArgs, request as httpRequest, type IncomingMessage } from "node:http";
import { type Duplex, pipeline, Readable } from "node:stream";
import type { RelayDialer } from "./dialer";

const DEFAULT_POOL_SIZE = 4;
const EMPTY_BODY_STATUSES = new Set([204, 205, 304]);
const RELAY_ADDRESS_SUFFIX = ".relay.invalid";
const KEY_ID_HEX_LENGTH = 64;
const KEY_ID_LABEL_LENGTH = 32;

interface RelayAgentOptions {
  dialer: Pick<RelayDialer, "connect">;
  target: string;
  poolSize?: number;
  idleTimeoutMs?: number;
}

export interface RelayFetch {
  readonly origin: string;
  readonly agent: RelayAgent;
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  close: () => void;
}

export class RelayAgent extends Agent {
  readonly #dialer: Pick<RelayDialer, "connect">;
  readonly #target: string;

  constructor(options: RelayAgentOptions) {
    const poolSize = options.poolSize ?? DEFAULT_POOL_SIZE;
    super({
      keepAlive: true,
      maxSockets: poolSize,
      maxFreeSockets: poolSize,
      ...(options.idleTimeoutMs === undefined ? {} : { timeout: options.idleTimeoutMs }),
    });
    this.#dialer = options.dialer;
    this.#target = options.target;
  }

  override createConnection(_options: ClientRequestArgs): Duplex {
    return this.#dialer.connect(this.#target);
  }
}

export function relayOrigin(target: string): string {
  const key = Buffer.from(target, "base64url").toString("hex");
  return `http://${key.slice(0, KEY_ID_LABEL_LENGTH)}.${key.slice(KEY_ID_LABEL_LENGTH)}${RELAY_ADDRESS_SUFFIX}`;
}

export function isRelayAddress(url: URL): boolean {
  return url.hostname.endsWith(RELAY_ADDRESS_SUFFIX);
}

export function relayTargetOf(url: URL): string | null {
  if (!isRelayAddress(url)) return null;
  const hex = url.hostname.slice(0, -RELAY_ADDRESS_SUFFIX.length).split(".").join("");
  if (hex.length !== KEY_ID_HEX_LENGTH || !/^[0-9a-f]+$/u.test(hex)) return null;
  const target = Buffer.from(hex, "hex").toString("base64url");
  return relayOrigin(target) === `http://${url.hostname}` ? target : null;
}

export function createRelayFetch(options: RelayAgentOptions): RelayFetch {
  const agent = new RelayAgent(options);
  const origin = relayOrigin(options.target);
  return {
    origin,
    agent,
    fetch: (input, init) => send(agent, origin, input, init),
    close: () => agent.destroy(),
  };
}

async function send(
  agent: RelayAgent,
  origin: string,
  input: string | URL | Request,
  init: RequestInit | undefined,
): Promise<Response> {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.origin !== origin) throw new TypeError("The address is not the address of this relay target.");
  request.signal.throwIfAborted();
  const headers: Record<string, string> = {};
  request.headers.forEach((value, name) => {
    headers[name] = value;
  });
  const length = input instanceof Request ? null : knownBodyLength(init?.body);
  if (length !== null) headers["content-length"] = String(length);
  return new Promise<Response>((resolve, reject) => {
    const outgoing = httpRequest({
      agent,
      method: request.method,
      host: url.hostname,
      path: `${url.pathname}${url.search}`,
      headers,
    });
    const abort = () => outgoing.destroy(abortCause(request.signal));
    const release = () => request.signal.removeEventListener("abort", abort);
    request.signal.addEventListener("abort", abort, { once: true });
    outgoing.on("error", (cause) => {
      release();
      reject(request.signal.aborted ? abortCause(request.signal) : new TypeError("fetch failed", { cause }));
    });
    outgoing.once("response", (incoming) => {
      incoming.once("close", release);
      try {
        resolve(toResponse(request.method, incoming, request.signal));
      } catch (cause) {
        outgoing.destroy();
        reject(new TypeError("fetch failed", { cause }));
      }
    });
    if (request.body === null) outgoing.end();
    else pipeline(Readable.from(request.body, { objectMode: false }), outgoing, () => undefined);
  });
}

function toResponse(method: string, incoming: IncomingMessage, signal: AbortSignal): Response {
  const status = incoming.statusCode ?? 0;
  const headers = new Headers();
  for (let index = 0; index + 1 < incoming.rawHeaders.length; index += 2) {
    const name = incoming.rawHeaders[index];
    const value = incoming.rawHeaders[index + 1];
    if (name !== undefined && value !== undefined) headers.append(name, value);
  }
  const empty = method === "HEAD" || EMPTY_BODY_STATUSES.has(status);
  if (empty) incoming.resume();
  return new Response(empty ? null : responseBody(incoming, signal), {
    status,
    statusText: incoming.statusMessage ?? "",
    headers,
  });
}

function responseBody(incoming: IncomingMessage, signal: AbortSignal): ReadableStream<Uint8Array> {
  let settled = false;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const fail = (cause: Error) => {
        if (settled) return;
        settled = true;
        controller.error(cause);
      };
      const abort = () => {
        fail(abortCause(signal));
        incoming.destroy();
      };
      signal.addEventListener("abort", abort, { once: true });
      incoming.on("data", (chunk: Buffer) => {
        if (settled) return;
        controller.enqueue(chunk);
        if ((controller.desiredSize ?? 0) <= 0) incoming.pause();
      });
      incoming.once("end", () => {
        if (settled) return;
        settled = true;
        controller.close();
      });
      incoming.once("error", fail);
      incoming.once("close", () => {
        signal.removeEventListener("abort", abort);
        fail(new Error("The response ended early."));
      });
      incoming.pause();
    },
    pull() {
      incoming.resume();
    },
    cancel() {
      settled = true;
      incoming.destroy();
    },
  });
}

function knownBodyLength(body: RequestInit["body"]): number | null {
  if (typeof body === "string") return Buffer.byteLength(body);
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return body.byteLength;
  if (body instanceof Blob) return body.size;
  if (body instanceof URLSearchParams) return Buffer.byteLength(body.toString());
  return null;
}

function abortCause(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("The request was aborted.");
}
