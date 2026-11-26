import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { inspect } from "node:util";
import WsSocket from "ws";

interface PhoneConfig {
  mitmIdentityText: string;
  realIdentityText: string;
  hostKeyId: string;
  echoKeyId: string;
  serverRoot: string;
  transferBytes: number;
  waitMs: number;
  out: string;
}

interface PhoneCheck {
  name: string;
  passed: boolean;
  error?: string;
}

interface PhoneResult {
  subtleMissing: boolean;
  checks: PhoneCheck[];
  meStatus: number | null;
  meRole: string | null;
  throughput: { bytes: number; milliseconds: number; mebibytesPerSecond: number } | null;
}

const config: PhoneConfig = JSON.parse(readFileSync(process.argv[2] ?? "", "utf8"));
Object.defineProperty(globalThis, "crypto", {
  value: undefined,
  configurable: true,
  writable: true,
});

class ShimCloseEvent extends Event {
  constructor(
    readonly code: number,
    readonly reason: string,
  ) {
    super("close");
  }
}

class PhoneLikeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readyState = PhoneLikeWebSocket.CONNECTING;
  binaryType = "blob";
  readonly #socket: WsSocket;

  constructor(url: string) {
    super();
    this.#socket = new WsSocket(url, { ca: config.serverRoot });
    this.#socket.on("open", () => {
      this.readyState = PhoneLikeWebSocket.OPEN;
      this.dispatchEvent(new Event("open"));
    });
    this.#socket.on("message", (data, isBinary) => {
      const bytes = Buffer.concat(
        Array.isArray(data) ? data : [Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data)],
      );
      const payload = isBinary
        ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
        : bytes.toString("utf8");
      this.dispatchEvent(new MessageEvent("message", { data: payload }));
    });
    this.#socket.on("error", () => {
      this.readyState = PhoneLikeWebSocket.CLOSED;
      this.dispatchEvent(new Event("error"));
    });
    this.#socket.on("close", (code, reason) => {
      this.readyState = PhoneLikeWebSocket.CLOSED;
      this.dispatchEvent(new ShimCloseEvent(code, reason.toString("utf8")));
    });
  }

  get bufferedAmount(): number {
    return this.#socket.bufferedAmount;
  }

  send(data: string | ArrayBuffer | Uint8Array): void {
    this.#socket.send(
      typeof data === "string" ? data : Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data),
    );
  }

  close(code?: number): void {
    this.#socket.close(code ?? 1000);
  }
}
Object.defineProperty(globalThis, "WebSocket", { value: PhoneLikeWebSocket, configurable: true, writable: true });

const result: PhoneResult = {
  subtleMissing: typeof globalThis.crypto === "undefined",
  checks: [],
  meStatus: null,
  meRole: null,
  throughput: null,
};

async function check(name: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
    result.checks.push({ name, passed: true });
  } catch (error) {
    result.checks.push({ name, passed: false, error: error instanceof Error ? error.message : inspect(error) });
  }
}

function deadline<T>(description: string, promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolveValue, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out: ${description}.`)), config.waitMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolveValue(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

const { createNobleRelayCrypto } = await import("@openbot/team-client/relay-crypto-noble");
const { createRelayIdentityFromText, openRelayV2Tunnels } = await import("@openbot/team-client/relay-client");
const { dialRelayPeer } = await import("@openbot/team-client/relay-socket");
const { encodeTeamV2Payload, TeamV2PayloadDecoder } = await import("@openbot/team-client/v2-framing");
const { decodeTeamProtocolV2RpcFrame, encodeTeamProtocolV2Frame } = await import("@openbot/contracts/team-protocol/v2");
const { encodeTeamCapabilitiesV10, TEAM_CURRENT_CAPABILITIES } = await import("@openbot/contracts/team-protocol");
const { TEAM_API_ROUTES } = await import("@openbot/contracts/team-api-routes");
const { isDynamicRecord, isNumber, isString } = await import("@openbot/contracts/runtime-values");

const crypto = createNobleRelayCrypto({ randomBytes: (size) => new Uint8Array(randomBytes(size)) });

await check("The phone opens V2 tunnels through the relay with noble crypto and reads /v1/me", async () => {
  if (!result.subtleMissing) throw new Error("The global crypto must be missing in this process.");
  const identity = await createRelayIdentityFromText(config.mitmIdentityText, { crypto });
  const tunnels = await deadline("the V2 tunnels", openRelayV2Tunnels(identity, config.hostKeyId, { crypto }));
  try {
    const decoder = new TeamV2PayloadDecoder();
    const requestId = `phone-${randomBytes(6).toString("hex")}`;
    const answer = new Promise<unknown>((resolveAnswer, reject) => {
      tunnels.rpc.listen({
        open: () => {},
        error: () => {},
        message: (message) => {
          if (!isString(message) && !(message instanceof ArrayBuffer)) return;
          const payload = decoder.push(message);
          if (!isString(payload)) return;
          const frame = decodeTeamProtocolV2RpcFrame(payload);
          if (frame.type === "response" && frame.requestId === requestId) {
            resolveAnswer("result" in frame ? frame.result : frame.error);
          }
        },
        close: (reason) => reject(reason ?? new Error("The RPC tunnel closed.")),
      });
    });
    for (const frame of encodeTeamV2Payload(
      encodeTeamProtocolV2Frame({ version: 2, type: "event-ack", throughSequence: 0 }),
      Number.POSITIVE_INFINITY,
      randomBytes(4).readUInt32BE(0),
    )) {
      tunnels.events.send(frame);
    }
    const request = encodeTeamProtocolV2Frame({
      version: 2,
      type: "request",
      requestId,
      operation: "http.request",
      payload: {
        method: "GET",
        path: TEAM_API_ROUTES.me,
        body: null,
        ...encodeTeamCapabilitiesV10(TEAM_CURRENT_CAPABILITIES),
      },
    });
    for (const frame of encodeTeamV2Payload(request, Number.POSITIVE_INFINITY, randomBytes(4).readUInt32BE(0))) {
      tunnels.rpc.send(frame);
    }
    const value = await deadline("the answer to /v1/me", answer);
    if (!isDynamicRecord(value) || !isNumber(value.status)) throw new Error(inspect(value));
    result.meStatus = value.status;
    result.meRole = isDynamicRecord(value.body) && isString(value.body.role) ? value.body.role : null;
    if (value.status !== 200) throw new Error(`/v1/me answered ${value.status}.`);
  } finally {
    tunnels.close();
  }
});

await check("The phone sends 8 MiB over an encrypted tunnel of the real relay and gets the hash back", async () => {
  const identity = await createRelayIdentityFromText(config.realIdentityText, { crypto });
  const tunnel = await deadline("the dial to the echo host", dialRelayPeer(identity, config.echoKeyId, { crypto }));
  const payload = randomBytes(config.transferBytes);
  const expected = createHash("sha256").update(payload).digest("hex");
  const started = performance.now();
  const reply = new Promise<string>((resolveReply, reject) => {
    let text = "";
    tunnel.listen({
      data: (data) => {
        text += Buffer.from(data).toString("utf8");
        if (text.endsWith("\n")) resolveReply(text.trim());
      },
      closed: (close) => reject(close.error),
    });
  });
  const chunkBytes = 64 * 1024;
  for (let offset = 0; offset < payload.byteLength; offset += chunkBytes) {
    tunnel.write(new Uint8Array(payload.subarray(offset, Math.min(payload.byteLength, offset + chunkBytes))));
  }
  const hash = await deadline("the hash of the echo host", reply);
  const milliseconds = performance.now() - started;
  tunnel.close();
  if (hash !== expected) throw new Error("The echo host got different bytes.");
  result.throughput = {
    bytes: payload.byteLength,
    milliseconds: Math.round(milliseconds),
    mebibytesPerSecond: Number((payload.byteLength / 1024 / 1024 / (milliseconds / 1000)).toFixed(2)),
  };
});

writeFileSync(config.out, JSON.stringify(result, null, 2));
process.exit(0);
