import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash, createPrivateKey, generateKeyPairSync, randomBytes, sign, X509Certificate } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createNetServer, Socket } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { inspect } from "node:util";
import { decodeRelayHubServerMessage } from "@openbot/contracts/relay-protocol/decode";
import {
  type RelayHubHello,
  type RelayHubMember,
  relayHelloTranscript,
  relayMessageKeyTranscript,
} from "@openbot/contracts/relay-protocol/hub";
import { decodeRelayIdentityBundle, type RelayIdentityBundle } from "@openbot/contracts/relay-protocol/identity-bundle";
import { RELAY_PATH, RELAY_PROTOCOL_VERSION, relayAudience } from "@openbot/contracts/relay-protocol/messages";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  TEAM_APP_VERSION_HEADER,
  TEAM_CURRENT_CAPABILITIES,
  TEAM_PROTOCOL_V10,
  TEAM_PROTOCOL_VERSION_HEADER,
  TEAM_WEB_CLIENT_PROTOCOL,
  teamCapabilityHeaders,
} from "@openbot/contracts/team-protocol";
import {
  decodeTeamProtocolV2EventFrame,
  decodeTeamProtocolV2RpcFrame,
  encodeTeamProtocolV2Frame,
} from "@openbot/contracts/team-protocol/v2";
import { createRelayTeamPeer } from "@openbot/team-client/relay-client";
import { webRelayCrypto } from "@openbot/team-client/relay-crypto";
import { createNobleRelayCrypto } from "@openbot/team-client/relay-crypto-noble";
import { RelayHubClient, type RelayHubOptions } from "@openbot/team-client/relay-hub";
import { decodeRelayHubV2Plaintext, encodeRelayHubV2Plaintexts } from "@openbot/team-client/relay-hub-channels";
import { TeamV2PayloadDecoder } from "@openbot/team-client/v2-framing";
import { Effect } from "effect";
import WebSocket from "ws";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { LocalProfile } from "../src/main/local-profile-store";
import { RELAY_DESKTOP_HTTP_CAPABILITY, RelayControl } from "../src/main/relay/control";
import { createRelayFetch } from "../src/main/relay/fetch";
import { type RelayCipher, RelayIdentityStore } from "../src/main/relay/identity-store";
import type { TeamApiBrowser } from "../src/main/team-api/dependencies";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, ".openbot-build/relay-hub-e2e");
const MAIN = resolve(ROOT, "remote/api/src/relay/main.ts");
const WAIT_MS = 30_000;
const DELAY_MS = 67;
const ROUND_TRIP_MS = 2 * DELAY_MS;
const SILENT_TIMEOUT_MS = 3_000;
const SUSPENDED_TIMEOUT_MS = 8_000;
const FILE_BYTES = 4 * 1024 * 1024;
const LIVENESS = { idleMs: 1_000, answerMs: 2_000 };
const RECORD_LIMIT = 96 * 1024 * 1024;
const READY_LINE = "OpenBot relay is ready";
const APP_VERSION = "0.0.0-e2e";
const TEAM = "Acme";

interface Check {
  name: string;
  passed: boolean;
  detail?: string;
}

const checks: Check[] = [];
const measures: Record<string, number | number[] | string> = {};

async function check(name: string, run: () => void | Promise<void>): Promise<void> {
  try {
    await run();
    checks.push({ name, passed: true });
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : inspect(error);
    checks.push({ name, passed: false, detail });
    process.stdout.write(`FAIL ${name}\n     ${detail.split("\n").join("\n     ")}\n`);
  }
}

function deadline<T>(description: string, promise: Promise<T>, ms = WAIT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out: ${description}.`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function until(description: string, accepts: () => boolean, ms = WAIT_MS): Promise<void> {
  return deadline(
    description,
    new Promise<void>((resolveWait) => {
      const poll = () => (accepts() ? resolveWait() : setTimeout(poll, 10));
      poll();
    }),
    ms,
  );
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((first, second) => first - second);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

async function ok<A, E>(operation: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(operation);
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        address && typeof address === "object" ? resolvePort(address.port) : reject(new Error("No port.")),
      );
    });
  });
}

function command(environment: Record<string, string>, ...args: string[]): { status: number; output: string } {
  const result = spawnSync("bun", [MAIN, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...environment },
    encoding: "utf8",
  });
  return { status: result.status ?? -1, output: `${result.stdout}${result.stderr}` };
}

function issue(environment: Record<string, string>, directory: string, user: string, device: string, team = TEAM) {
  const out = join(directory, `${user}-${device}.json`);
  const result = command(environment, "ca", "issue", "--team", team, "--user", user, "--device", device, "--out", out);
  assert.equal(result.status, 0, result.output);
  const bundle = decodeRelayIdentityBundle(JSON.parse(readFileSync(out, "utf8")));
  assert.ok(bundle, "The identity file is not valid.");
  return bundle;
}

function keyIdOf(bundle: RelayIdentityBundle): string {
  const spki = new X509Certificate(bundle.certificate).publicKey.export({ type: "spki", format: "der" });
  return createHash("sha256").update(spki).digest("base64url");
}

const testCipher: RelayCipher = {
  encrypt: (value) => Buffer.from(value, "utf8").reverse(),
  decrypt: (value) => Buffer.from(value).reverse().toString("utf8"),
};

interface ProxyConnection {
  id: number;
  client: Socket;
  upstream: Socket;
  frozen: boolean;
  held: Array<() => void>;
  mitm: Mitm | null;
}

interface Mitm {
  pending: Buffer;
  tamperNext: boolean;
  replayNext: boolean;
  substitute: { keyId: string; messageKey: string; messageKeySignature: string; keyTimestamp: number } | null;
}

class DelayProxy {
  readonly connections: ProxyConnection[] = [];
  readonly recorded: Buffer[] = [];
  recordedBytes = 0;
  #server = createNetServer();
  port = 0;

  constructor(readonly targetPort: number) {}

  async start(): Promise<void> {
    this.#server.on("connection", (client) => this.#accept(client));
    await new Promise<void>((resolveListen) => this.#server.listen(0, "127.0.0.1", resolveListen));
    const address = this.#server.address();
    this.port = address && typeof address === "object" ? address.port : 0;
  }

  latest(): ProxyConnection {
    const connection = this.connections.at(-1);
    assert.ok(connection, "No proxy connection.");
    return connection;
  }

  freeze(connection: ProxyConnection): void {
    connection.frozen = true;
  }

  close(): void {
    for (const connection of this.connections) {
      connection.client.destroy();
      connection.upstream.destroy();
    }
    this.#server.close();
  }

  #record(chunk: Buffer): void {
    if (this.recordedBytes >= RECORD_LIMIT) return;
    this.recorded.push(Buffer.from(chunk));
    this.recordedBytes += chunk.byteLength;
  }

  #accept(client: Socket): void {
    const upstream = new Socket();
    const connection: ProxyConnection = {
      id: this.connections.length + 1,
      client,
      upstream,
      frozen: false,
      held: [],
      mitm: null,
    };
    this.connections.push(connection);
    client.setNoDelay(true);
    upstream.setNoDelay(true);
    upstream.connect(this.targetPort, "127.0.0.1");
    const pass = (to: Socket, chunk: Buffer) => {
      const deliver = () => {
        if (!to.destroyed) to.write(chunk);
      };
      setTimeout(() => (connection.frozen ? connection.held.push(deliver) : deliver()), DELAY_MS);
    };
    client.on("data", (chunk: Buffer) => {
      this.#record(chunk);
      pass(upstream, chunk);
    });
    upstream.on("data", (chunk: Buffer) => {
      this.#record(chunk);
      const mitm = connection.mitm;
      if (!mitm) {
        pass(client, chunk);
        return;
      }
      for (const frame of mitmFrames(mitm, chunk)) pass(client, frame);
    });
    const end = () => {
      setTimeout(() => {
        upstream.destroy();
        if (!connection.frozen) client.destroy();
      }, DELAY_MS);
    };
    client.on("close", end);
    upstream.on("close", end);
    client.on("error", () => undefined);
    upstream.on("error", () => undefined);
  }
}

function mitmFrames(mitm: Mitm, chunk: Buffer): Buffer[] {
  mitm.pending = Buffer.concat([mitm.pending, chunk]);
  const out: Buffer[] = [];
  for (;;) {
    const buffer = mitm.pending;
    if (buffer.byteLength < 2) break;
    const opcode = (buffer[0] ?? 0) & 0x0f;
    let length = (buffer[1] ?? 0) & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (buffer.byteLength < 4) break;
      length = buffer.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (buffer.byteLength < 10) break;
      length = Number(buffer.readBigUInt64BE(2));
      offset = 10;
    }
    if (buffer.byteLength < offset + length) break;
    const payload = Buffer.from(buffer.subarray(offset, offset + length));
    mitm.pending = buffer.subarray(offset + length);
    if (opcode === 2 && mitm.tamperNext) {
      mitm.tamperNext = false;
      payload[payload.byteLength - 1] = (payload[payload.byteLength - 1] ?? 0) ^ 0x01;
      out.push(wsFrame(2, payload));
    } else if (opcode === 2 && mitm.replayNext) {
      mitm.replayNext = false;
      out.push(wsFrame(2, payload), wsFrame(2, payload));
    } else if (opcode === 1 && mitm.substitute) {
      out.push(wsFrame(1, Buffer.from(substituteKey(payload.toString("utf8"), mitm.substitute))));
    } else out.push(wsFrame(opcode, payload));
  }
  return out;
}

function substituteKey(text: string, substitute: NonNullable<Mitm["substitute"]>): string {
  const value = decodeRelayHubServerMessage(JSON.parse(text));
  if (value?.type !== "online") return text;
  const member = value.member;
  if (member.keyId !== substitute.keyId) return text;
  return JSON.stringify({
    ...value,
    member: {
      ...member,
      messageKey: substitute.messageKey,
      messageKeySignature: substitute.messageKeySignature,
      keyTimestamp: substitute.keyTimestamp,
    },
  });
}

function wsFrame(opcode: number, payload: Buffer): Buffer {
  const head =
    payload.byteLength < 126
      ? Buffer.from([0x80 | opcode, payload.byteLength])
      : payload.byteLength < 65_536
        ? Buffer.concat([Buffer.from([0x80 | opcode, 126]), u16(payload.byteLength)])
        : Buffer.concat([Buffer.from([0x80 | opcode, 127]), u64(payload.byteLength)]);
  return Buffer.concat([head, payload]);
}

function u16(value: number): Buffer {
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16BE(value);
  return bytes;
}

function u64(value: number): Buffer {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64BE(BigInt(value));
  return bytes;
}

function hubClient(bundle: RelayIdentityBundle, options: Partial<RelayHubOptions> = {}): RelayHubClient {
  const key = createPrivateKey(bundle.privateKey);
  return new RelayHubClient({
    identity: {
      relayUrl: bundle.relayUrl,
      team: bundle.team,
      keyId: keyIdOf(bundle),
      certificate: bundle.certificate,
      chain: bundle.chain,
      root: bundle.root,
    },
    sign: async (data) => sign("sha256", data, { key, dsaEncoding: "ieee-p1363" }),
    crypto: webRelayCrypto,
    reconnect: { baseMs: 100, maxMs: 500 },
    liveness: LIVENESS,
    ...options,
  });
}

class V2Client {
  readonly frames: Array<{ kind: string; frame: string }> = [];
  readonly #decoders = {
    rpc: new TeamV2PayloadDecoder(),
    events: new TeamV2PayloadDecoder(),
    files: new TeamV2PayloadDecoder(),
  };
  #fragment = 0;

  constructor(
    readonly hub: RelayHubClient,
    readonly host: string,
  ) {
    hub.onMessage((message) => {
      if (message.from !== host) return;
      const decoded = decodeRelayHubV2Plaintext(message.plaintext);
      if (decoded?.direction !== "to-client") return;
      const payload = this.#decoders[message.kind].push(decoded.payload);
      if (typeof payload === "string") this.frames.push({ kind: message.kind, frame: payload });
    });
  }

  async send(kind: "rpc" | "events", frame: string): Promise<void> {
    this.#fragment += 1;
    for (const plaintext of encodeRelayHubV2Plaintexts(frame, this.#fragment, "to-host"))
      await this.hub.send(this.host, kind, plaintext);
  }

  async request(requestId: string, method: string, path: string, body: unknown = null): Promise<string> {
    await this.send(
      "rpc",
      encodeTeamProtocolV2Frame({
        version: 2,
        type: "request",
        requestId,
        operation: "http.raw",
        payload: {
          method,
          path,
          headers: teamHeaders(),
          body: body === null ? null : JSON.stringify(body),
        },
      }),
    );
    return this.answer(requestId);
  }

  async answer(requestId: string, index = 0): Promise<string> {
    let found: string | undefined;
    await until(`the answer to ${requestId}`, () => {
      found = this.frames.filter((entry) => entry.kind === "rpc" && entry.frame.includes(requestId))[index]?.frame;
      return found !== undefined;
    });
    return found ?? "";
  }

  events(): Array<{ sequence: number; text: string }> {
    return this.frames.flatMap((entry) => {
      if (entry.kind !== "events") return [];
      const frame = decodeTeamProtocolV2EventFrame(entry.frame);
      return frame.type === "event" ? [{ sequence: frame.sequence, text: entry.frame }] : [];
    });
  }

  resets(): number {
    return this.frames.filter((entry) => entry.kind === "events" && entry.frame.includes('"event-reset"')).length;
  }
}

function teamHeaders(): Record<string, string> {
  return {
    [TEAM_PROTOCOL_VERSION_HEADER]: String(TEAM_PROTOCOL_V10),
    [TEAM_APP_VERSION_HEADER]: APP_VERSION,
    ...teamCapabilityHeaders(TEAM_PROTOCOL_V10, TEAM_CURRENT_CAPABILITIES),
    "content-type": "application/json",
  };
}

function rawResult(frame: string): { status: number; body: string | null } {
  const decoded = decodeTeamProtocolV2RpcFrame(frame);
  assert.ok(decoded.type === "response" && "result" in decoded, frame.slice(0, 300));
  const result = decoded.result;
  assert.ok(typeof result === "object" && result !== null && !Array.isArray(result));
  const status = result.status;
  const body = result.body;
  assert.ok(typeof status === "number");
  return { status, body: typeof body === "string" ? body : null };
}

function rawHello(bundle: RelayIdentityBundle, timestamp: number, clientNonce: string) {
  const identity = createPrivateKey(bundle.privateKey);
  const agreement = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const point = agreement.publicKey.export({ type: "spki", format: "der" }).subarray(-65);
  const keyId = keyIdOf(bundle);
  const messageKeySignature = sign("sha256", relayMessageKeyTranscript({ keyId, messageKey: point, timestamp }), {
    key: identity,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  const fields: Omit<RelayHubHello, "type" | "certificate" | "chain" | "signature"> = {
    version: RELAY_PROTOCOL_VERSION,
    audience: relayAudience(bundle.relayUrl ?? ""),
    timestamp,
    clientNonce,
    label: null,
    hosting: false,
    capabilities: [],
    suspendable: false,
    messageKey: Buffer.from(point).toString("base64url"),
    messageKeySignature,
  };
  const signature = sign("sha256", relayHelloTranscript(fields), { key: identity, dsaEncoding: "ieee-p1363" });
  return JSON.stringify({
    type: "hello",
    ...fields,
    certificate: bundle.certificate,
    chain: bundle.chain,
    signature: signature.toString("base64url"),
  });
}

function helloAnswer(url: string, hello: string): Promise<string> {
  return deadline(
    "the answer to a raw hello",
    new Promise<string>((resolveAnswer) => {
      const socket = new WebSocket(url);
      const answers: string[] = [];
      socket.on("open", () => socket.send(hello));
      socket.on("message", (data) => {
        answers.push(String(data));
        if (answers.some((answer) => answer.includes('"welcome"') || answer.includes('"error"'))) {
          socket.close();
          resolveAnswer(answers.find((answer) => answer.includes('"welcome"') || answer.includes('"error"')) ?? "");
        }
      });
      socket.on("error", () => resolveAnswer("socket error"));
    }),
  );
}

const work = mkdtempSync(join(tmpdir(), "openbot-relay-hub-e2e-"));
const dataDirectory = join(work, "data");
const storeDirectory = join(work, "stores");
const userData = join(work, "user-data");
const fakeHome = join(work, "home");
const fakeCodex = join(work, "codex");
const fakeCodexLog = join(work, "codex.jsonl");
mkdirSync(storeDirectory);
mkdirSync(fakeHome);
process.env.HOME = fakeHome;
process.env.CODEX_HOME = join(fakeHome, ".codex");
process.env.OPENBOT_CODEX_PATH = fakeCodex;
writeFileSync(
  fakeCodex,
  `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
if (process.argv.includes("--version")) { process.stdout.write("codex-cli 0.160.1\\n"); process.exit(0); }
const LOG = ${JSON.stringify(fakeCodexLog)};
const config = { config: { mcp_servers: {} }, layers: [{ name: { type: "user", file: "/fake/.codex/config.toml", profile: null }, version: "1", config: { mcp_servers: {} } }] };
let buffer = ""; let threads = 0; let turns = 0;
process.stdout.on("error", (error) => { if (error.code === "EPIPE") process.exit(0); throw error; });
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const answer = (message) => {
  const params = message.params || {};
  switch (message.method) {
    case "initialize": return write({ id: message.id, result: {} });
    case "account/read": return write({ id: message.id, result: { account: { type: "chatgpt", email: "codex@example.com" } } });
    case "account/rateLimits/read": return write({ id: message.id, result: { rateLimits: { limitId: "codex", primary: null, secondary: null }, rateLimitsByLimitId: null } });
    case "model/list": return write({ id: message.id, result: { data: [{ model: "gpt-6-luna", displayName: "GPT-6 Luna" }] } });
    case "plugin/list": return write({ id: message.id, result: { marketplaces: [] } });
    case "config/read": return write({ id: message.id, result: config });
    case "config/batchWrite": return write({ id: message.id, result: {} });
    case "thread/start": return write({ id: message.id, result: { thread: { id: "thread-" + (++threads), turns: [] } } });
    case "thread/resume": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "thread/unsubscribe": return write({ id: message.id, result: { status: "Unsubscribed" } });
    case "thread/turns/list":
    case "thread/items/list": return write({ id: message.id, result: { data: [], nextCursor: null } });
    case "thread/read": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "turn/start": {
      const turnId = "turn-" + process.pid + "-" + (++turns);
      const text = (params.input || []).map((item) => item.text || "").join("\\n");
      appendFileSync(LOG, JSON.stringify({ turnId, text }) + "\\n");
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      const item = { type: "agentMessage", id: "message-" + turnId, text: "Reply " + text.split(" ").pop(), phase: "final_answer" };
      write({ method: "item/completed", params: { threadId: params.threadId, turnId, item } });
      return write({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: turnId, status: "completed" } } });
    }
    default: return write({ id: message.id, error: { code: -32601, message: "Method not found: " + message.method } });
  }
};
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line) { const message = JSON.parse(line); if (message.method && message.id !== undefined) answer(message); }
    newline = buffer.indexOf("\\n");
  }
});
`,
  { mode: 0o755 },
);

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");
const { SidebarLayoutStore } = await import("../src/backend/sidebar-layout-store");
const { HostService } = await import("../src/main/host-service");
const { TeamStore } = await import("../src/main/team-store");

const unused = () => Effect.die(new Error("Not used by this check."));
const agentBrowser: AgentBrowserHost = {
  listTabs: () => [],
  toolCanUseTab: () => false,
  beginTakeover: unused,
  endTakeover: () => {},
  userControlTabFor: () => null,
  awaitUserControlRelease: unused,
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
  onChanged: () => () => {},
  onControlChanged: () => () => {},
  onDocumentChanged: () => () => {},
  clearControls: () => {},
  endControl: () => {},
  close: () => Effect.void,
  clearAgentSession: () => Effect.void,
  shareTab: () => undefined,
  unshareThread: () => undefined,
  agentTab: () => null,
};
const teamBrowser: TeamApiBrowser = {
  listTabs: () => [],
  getControlState: () => ({ sessions: [] }),
  open: unused,
  activate: unused,
  navigate: unused,
  reload: unused,
  stop: unused,
  takeUserControl: unused,
  startTeach: unused,
  stopTeach: () => [],
  releaseUserControl: () => {},
  releaseUserControlHeldBy: () => {},
  releaseUserControlRefused: () => {},
  close: unused,
  capturePreview: unused,
  setVisible: unused,
  getDisplayState: () => ({ tabs: [], activeTabId: null }),
  loadUrl: unused,
  isPrivate: () => false,
  startView: unused,
  dispatchViewInput: unused,
  copyViewSelection: unused,
  importSignIn: unused,
  answerPermission: unused,
  answerHttpSignIn: unused,
  answerViewDialog: unused,
};
const localOwner: LocalProfile = { id: "local-profile-e2e", name: "Host Person", chatColor: null };

let relayChild: ChildProcess | null = null;
const relayLog: string[] = [];
const hubs: RelayHubClient[] = [];
const controls: RelayControl[] = [];
let proxy: DelayProxy | null = null;
let database: InstanceType<typeof OpenBotDatabase> | null = null;
let host: InstanceType<typeof HostService> | null = null;
let closeAlice: (() => void) | null = null;

try {
  const [relayPort, healthPort] = await Promise.all([freePort(), freePort()]);
  proxy = new DelayProxy(relayPort);
  await proxy.start();
  const delayed = proxy;
  const relayUrl = `ws://127.0.0.1:${delayed.port}${RELAY_PATH}`;
  const environment = {
    RELAY_DATA_DIR: dataDirectory,
    RELAY_HOST: "127.0.0.1",
    RELAY_PORT: String(relayPort),
    RELAY_HEALTH_PORT: String(healthPort),
    RELAY_PUBLIC_URL: relayUrl,
    RELAY_TLS_DISABLED: "true",
    RELAY_CLIENT_HEARTBEAT_TIMEOUT_MS: String(SILENT_TIMEOUT_MS),
    RELAY_SUSPENDED_TIMEOUT_MS: String(SUSPENDED_TIMEOUT_MS),
  };
  assert.equal(command(environment, "ca", "init").status, 0);
  assert.equal(command(environment, "ca", "server", "--ip", "127.0.0.1").status, 0);
  assert.equal(command(environment, "ca", "team", "add", TEAM).status, 0);
  const bundles = {
    host: issue(environment, work, "host-user", "server"),
    alice: issue(environment, work, "alice", "laptop"),
    bob: issue(environment, work, "bob", "laptop"),
    carol: issue(environment, work, "carol", "phone"),
    victor: issue(environment, work, "victor", "laptop"),
    sam: issue(environment, work, "sam", "laptop"),
    mallory: issue(environment, work, "mallory", "laptop"),
    lenny: issue(environment, work, "lenny", "laptop"),
    sue: issue(environment, work, "sue", "phone"),
    petra: issue(environment, work, "petra", "phone"),
    rita: issue(environment, work, "rita", "laptop"),
    raw: issue(environment, work, "raw", "laptop"),
  };
  const hostKeyId = keyIdOf(bundles.host);

  relayChild = spawn("bun", [MAIN, "serve"], {
    cwd: ROOT,
    env: { ...process.env, ...environment },
    stdio: ["ignore", "pipe", "pipe"],
  });
  relayChild.stdout?.on("data", (chunk: Buffer) => relayLog.push(chunk.toString()));
  relayChild.stderr?.on("data", (chunk: Buffer) => relayLog.push(chunk.toString()));
  await until("the relay server is ready", () => relayLog.join("").includes(READY_LINE));

  const store = async (name: string, bundle: RelayIdentityBundle) => {
    const identity = new RelayIdentityStore({ path: join(storeDirectory, `${name}.json`), cipher: testCipher });
    await ok(identity.importBundle(bundle));
    return identity;
  };
  database = new OpenBotDatabase(userData);
  const agentStore = new AgentStore(userData, join(work, "agents"), database);
  const mailbox = new MailboxStore(userData, agentStore.sharedRoot, agentStore.database);
  const sidebar = new SidebarLayoutStore(join(userData, "sidebar-layout.json"));
  const team = new TeamStore(join(userData, "openbot-team-server-v2.json"));
  await runCauseEffect(sidebar.initialize());
  await runCauseEffect(agentStore.initialize());
  await runCauseEffect(mailbox.initialize());
  await runCauseEffect(team.initialize());
  const fixture = await runCauseEffect(
    agentStore.createAgent({ name: "Hub fixture", description: "Synthetic agent", avatarSeed: "hub", avatarHue: null }),
  );
  const agentService = new AgentService({ store: agentStore, mailbox, browser: agentBrowser, sidebarLayout: sidebar });
  const hostService = new HostService({
    appVersion: APP_VERSION,
    store: team,
    agents: agentService,
    agentsReady: () => Effect.void,
    skills: { listInstalledForChatTags: () => Effect.succeed([]) },
    sidebarLayout: sidebar,
    mailbox,
    browser: teamBrowser,
    getLocalProfile: () => localOwner,
  });
  host = hostService;
  const connectLines: string[] = [];
  const logger = (name: string) => ({
    info: (line: string) => connectLines.push(`${name}: ${line}`),
    warn: (line: string) => connectLines.push(`${name}: ${line}`),
  });
  const hostControl = new RelayControl({
    identity: await store("host", bundles.host),
    logger: logger("host"),
    liveness: LIVENESS,
  });
  controls.push(hostControl);
  let hostDeliveries = 0;
  hostControl.on("message", () => {
    hostDeliveries += 1;
  });
  await ok(hostService.startRelayHosting(await store("host-relay", bundles.host), { control: hostControl }));
  await until("the host is online", () => hostControl.state().status === "online");

  const aliceControl = new RelayControl({
    identity: await store("alice", bundles.alice),
    logger: logger("alice"),
    liveness: LIVENESS,
  });
  controls.push(aliceControl);
  await ok(aliceControl.start());
  await until("alice sees the host hosting", () => aliceControl.member(hostKeyId)?.hosting === true);
  const aliceFetch = createRelayFetch({
    control: aliceControl,
    target: hostKeyId,
    transferDirectory: join(work, "alice-files"),
  });
  closeAlice = aliceFetch.close;
  const origin = aliceFetch.origin;
  const aliceCall = async (method: string, path: string, body?: unknown) => {
    const response = await deadline(
      `${method} ${path}`,
      aliceFetch.fetch(`${origin}${path}`, {
        method,
        headers: teamHeaders(),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
    const text = await response.text();
    return { status: response.status, text };
  };

  await check("An app signs in with one hello: welcome comes about one round trip after the socket opens", () => {
    const line = connectLines.find((entry) => entry.startsWith("alice: relay connected"));
    assert.ok(line, connectLines.join("\n"));
    const helloToWelcome = Number(/hello to welcome (\d+) ms/u.exec(line)?.[1]);
    measures.signInHelloToWelcomeMs = helloToWelcome;
    measures.signInTotalMs = Number(/connected in (\d+) ms/u.exec(line)?.[1]);
    assert.ok(helloToWelcome >= ROUND_TRIP_MS - 10 && helloToWelcome < ROUND_TRIP_MS * 2 + 60, line);
  });

  const marker = `hub-marker-${randomBytes(8).toString("hex")}`;
  await check(
    "A desktop client lists agents, sends a message and gets the agent's reply event through the hub",
    async () => {
      const signIn = await aliceCall("POST", TEAM_API_ROUTES.auth.relay);
      assert.equal(signIn.status, 200, signIn.text);
      const agents = await aliceCall("GET", TEAM_API_ROUTES.agents.all);
      assert.equal(agents.status, 200, agents.text);
      assert.ok(agents.text.includes(fixture.id));
      const socket = aliceFetch.client.openEventSocket();
      const events: string[] = [];
      socket.addEventListener("message", (event) => events.push(String(event.data)));
      await until("the event socket opens", () => socket.readyState === 1);
      const sent = await aliceCall("POST", TEAM_API_ROUTES.agent.messages(fixture.id), { text: `Hello ${marker}` });
      assert.equal(sent.status, 202, sent.text);
      await until("the reply event arrives", () => events.some((event) => event.includes(`Reply ${marker}`)));
      const times: number[] = [];
      for (let index = 0; index < 7; index += 1) {
        const started = performance.now();
        const answer = await aliceCall("GET", TEAM_API_ROUTES.compatibility);
        times.push(Math.round(performance.now() - started));
        assert.equal(answer.status, 200);
      }
      measures.requestRoundTripMs = times;
      assert.ok(median(times) < ROUND_TRIP_MS * 2 + 120, `requests took ${times.join(", ")} ms`);
    },
  );

  await check("The server answers a question about the host from its record, with no message to the host", async () => {
    const before = hostDeliveries;
    const started = performance.now();
    const member = await deadline("the info answer", aliceControl.info(hostKeyId));
    const elapsed = Math.round(performance.now() - started);
    measures.infoRoundTripMs = elapsed;
    assert.ok(member);
    assert.deepEqual(
      [member.hosting, member.label, member.capabilities],
      [true, "OpenBot-NC", [RELAY_DESKTOP_HTTP_CAPABILITY]],
    );
    assert.ok(elapsed < ROUND_TRIP_MS + 80, `info took ${elapsed} ms`);
    await new Promise((resolveWait) => setTimeout(resolveWait, ROUND_TRIP_MS));
    assert.equal(hostDeliveries, before);
  });

  const bob = hubClient(bundles.bob, { capabilities: [RELAY_DESKTOP_HTTP_CAPABILITY] });
  hubs.push(bob);
  bob.start();
  await until("bob sees the host", () => bob.member(hostKeyId) !== null);
  const bobV2 = new V2Client(bob, hostKeyId);

  await check("A repeated request id acts once and gets the same answer", async () => {
    const text = `Once ${randomBytes(6).toString("hex")}`;
    const requestId = `repeat-${randomBytes(6).toString("hex")}`;
    const frame = encodeTeamProtocolV2Frame({
      version: 2,
      type: "request",
      requestId,
      operation: "http.raw",
      payload: {
        method: "POST",
        path: TEAM_API_ROUTES.agent.messages(fixture.id),
        headers: teamHeaders(),
        body: JSON.stringify({ text }),
      },
    });
    await bobV2.send("rpc", frame);
    await bobV2.send("rpc", frame);
    const first = await bobV2.answer(requestId, 0);
    const second = await bobV2.answer(requestId, 1);
    await bobV2.send("rpc", frame);
    const third = await bobV2.answer(requestId, 2);
    assert.equal(rawResult(first).status, 202, first);
    assert.equal(second, first);
    assert.equal(third, first);
    await until("the provider gets the message", () => readFileSync(fakeCodexLog, "utf8").includes(text));
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    assert.equal(readFileSync(fakeCodexLog, "utf8").split(text).length - 1, 1);
  });

  await check(
    "A client that goes offline and comes back catches up the missed events from its last number",
    async () => {
      await bobV2.send("events", encodeTeamProtocolV2Frame({ version: 2, type: "event-ack", throughSequence: 0 }));
      const warm = `Warm ${randomBytes(4).toString("hex")}`;
      assert.equal((await aliceCall("POST", TEAM_API_ROUTES.agent.messages(fixture.id), { text: warm })).status, 202);
      await until("bob gets the warm reply", () =>
        bobV2.events().some((event) => event.text.includes(`Reply ${warm.split(" ")[1]}`)),
      );
      const last = Math.max(...bobV2.events().map((event) => event.sequence));
      await bobV2.send("events", encodeTeamProtocolV2Frame({ version: 2, type: "event-ack", throughSequence: last }));
      bob.stop();
      await until("alice sees bob offline", () => aliceControl.member(bob.keyId) === null);
      const missed = `Missed ${randomBytes(4).toString("hex")}`;
      assert.equal((await aliceCall("POST", TEAM_API_ROUTES.agent.messages(fixture.id), { text: missed })).status, 202);
      await until("the host provider answers", () => readFileSync(fakeCodexLog, "utf8").includes(missed));
      await new Promise((resolveWait) => setTimeout(resolveWait, 500));
      const resetsBefore = bobV2.resets();
      bob.start();
      await until(
        "bob is online again",
        () => bob.snapshot().state.status === "online" && bob.member(hostKeyId) !== null,
      );
      await bobV2.send("events", encodeTeamProtocolV2Frame({ version: 2, type: "event-ack", throughSequence: last }));
      await until("bob catches up the missed reply", () =>
        bobV2.events().some((event) => event.sequence > last && event.text.includes(`Reply ${missed.split(" ")[1]}`)),
      );
      const after = bobV2.events().filter((event) => event.sequence > last);
      assert.equal(Math.min(...after.map((event) => event.sequence)), last + 1);
      assert.equal(bobV2.resets(), resetsBefore);
      measures.caughtUpEvents = after.length;
    },
  );

  await check(
    "A phone client with noble crypto and no global crypto lists the agents through the shared peer",
    async () => {
      const noble = createNobleRelayCrypto({ randomBytes: (size) => randomBytes(size) });
      const carol = hubClient(bundles.carol, { crypto: noble });
      hubs.push(carol);
      carol.start();
      await until("carol sees the host", () => carol.member(hostKeyId) !== null);
      const peer = createRelayTeamPeer(
        carol,
        { current: { onConnectionUpdate: async () => undefined, onTeamEvent: async () => undefined } },
        { crypto: noble, clientProtocol: TEAM_WEB_CLIENT_PROTOCOL },
      );
      const connected = await deadline(
        "carol connects",
        peer.execute({ id: "c1", type: "connect", hostId: "relay:host", hostPublicKey: hostKeyId }),
      );
      assert.equal(connected.ok, true, inspect(connected));
      const agents = await deadline(
        "carol lists agents",
        peer.execute({ id: "c2", type: "request", method: "GET", path: TEAM_API_ROUTES.agents.all, body: null }),
      );
      assert.equal(agents.ok, true, inspect(agents));
      assert.ok(JSON.stringify(agents.body).includes(fixture.id));
      await peer.dispose();
      measures.phoneSocketsOpened = carol.socketsOpened();
    },
  );

  await check(
    "Phone return: a live connection is kept with no new sign-in, a dead one is replaced, and the host answers",
    async () => {
      const noble = createNobleRelayCrypto({ randomBytes: (size) => randomBytes(size) });
      const lines: string[] = [];
      const firstProxyConnection = delayed.connections.length;
      const petra = hubClient(bundles.petra, {
        crypto: noble,
        suspendable: true,
        liveness: { idleMs: 10_000, answerMs: 3_000 },
        log: (_level, line) => lines.push(line),
      });
      hubs.push(petra);
      petra.start();
      await until("petra sees the host", () => petra.member(hostKeyId) !== null);
      const phoneConnection = delayed.connections[firstProxyConnection];
      assert.ok(phoneConnection, "No proxy connection for the phone.");
      const updates: string[] = [];
      const peer = createRelayTeamPeer(
        petra,
        {
          current: {
            onConnectionUpdate: async (update) => {
              updates.push(update.state);
            },
            onTeamEvent: async () => undefined,
          },
        },
        { crypto: noble, clientProtocol: TEAM_WEB_CLIENT_PROTOCOL },
      );
      let commands = 0;
      const command = () => `petra-${++commands}`;
      const connect = () =>
        deadline(
          "petra connects",
          peer.execute({ id: command(), type: "connect", hostId: "relay:host", hostPublicKey: hostKeyId }),
        );
      const listAgents = () =>
        deadline(
          "petra lists agents",
          peer.execute({ id: command(), type: "request", method: "GET", path: TEAM_API_ROUTES.agents.all, body: null }),
        );
      assert.equal((await connect()).ok, true);
      assert.equal((await listAgents()).ok, true);

      petra.suspend();
      const generation = petra.connectionGeneration();
      const socketsBefore = petra.socketsOpened();
      const liveStarted = performance.now();
      petra.resume(1_500);
      const live = await listAgents();
      const liveMs = Math.round(performance.now() - liveStarted);
      assert.equal(live.ok, true, inspect(live));
      await until("the return log line", () => lines.some((line) => line.startsWith("relay return: connection kept")));
      assert.equal(petra.connectionGeneration(), generation, "The live connection was replaced.");
      assert.ok(petra.socketsOpened() - socketsBefore <= 1, "More than one candidate socket was opened.");
      assert.equal(updates.filter((state) => state === "offline").length, 0, "The host peer went offline.");

      petra.suspend();
      delayed.freeze(phoneConnection);
      const deadStarted = performance.now();
      petra.resume(1_500);
      let dead = await listAgents();
      if (!dead.ok) {
        assert.equal((await connect()).ok, true);
        dead = await listAgents();
      }
      const deadMs = Math.round(performance.now() - deadStarted);
      assert.equal(dead.ok, true, inspect(dead));
      assert.equal(petra.connectionGeneration(), generation + 1, "The dead connection was not replaced.");
      assert.ok(
        lines.some((line) => line.startsWith("relay return: new connection used")),
        lines.join("\n"),
      );
      await peer.dispose();
      petra.stop();
      measures.phoneReturnLiveMs = liveMs;
      measures.phoneReturnDeadMs = deadMs;
      measures.phoneReturnLines = lines.filter((line) => line.startsWith("relay ")).join(" | ");
      assert.ok(liveMs < 2 * DELAY_MS * 2 + 150, `The live return took ${liveMs} ms.`);
    },
  );

  await check("A 4 MiB file goes up and down while small requests are answered in about one round trip", async () => {
    const content = Buffer.concat([Buffer.from(marker), randomBytes(FILE_BYTES - marker.length)]);
    const small: number[] = [];
    let moving = true;
    const probe = (async () => {
      while (moving) {
        const started = performance.now();
        await aliceCall("GET", TEAM_API_ROUTES.compatibility);
        small.push(Math.round(performance.now() - started));
      }
    })();
    const uploadStarted = performance.now();
    const uploaded = await deadline(
      "the upload",
      aliceFetch.fetch(`${origin}${TEAM_API_ROUTES.attachments}?name=blob.bin&mime=application%2Foctet-stream`, {
        method: "POST",
        headers: { ...teamHeaders(), "content-type": "application/octet-stream" },
        body: content,
      }),
      120_000,
    );
    measures.uploadMs = Math.round(performance.now() - uploadStarted);
    assert.equal(uploaded.status, 201);
    const id = /"id":"([^"]+)"/u.exec(await uploaded.text())?.[1] ?? "";
    const downloadStarted = performance.now();
    const downloaded = await deadline(
      "the download",
      aliceFetch.fetch(`${origin}${TEAM_API_ROUTES.attachment(id)}`, { headers: teamHeaders() }),
      120_000,
    );
    const bytes = Buffer.from(await downloaded.arrayBuffer());
    measures.downloadMs = Math.round(performance.now() - downloadStarted);
    moving = false;
    await probe;
    assert.equal(createHash("sha256").update(bytes).digest("hex"), createHash("sha256").update(content).digest("hex"));
    measures.smallRequestsDuringTransferMs = small;
    assert.ok(small.length >= 3, `only ${small.length} small requests`);
    assert.ok(median(small) < ROUND_TRIP_MS * 2 + 200, `small requests took ${small.join(", ")} ms`);
  });

  await check(
    "The host goes offline: a request fails at once, and the online notice comes when the host is back",
    async () => {
      await ok(hostControl.stop());
      await until("alice sees the host offline", () => aliceControl.member(hostKeyId) === null);
      const started = performance.now();
      const failure = await aliceFetch
        .fetch(`${origin}${TEAM_API_ROUTES.compatibility}`, { headers: teamHeaders() })
        .then(
          () => null,
          (error: unknown) => error,
        );
      measures.offlineAnswerMs = Math.round(performance.now() - started);
      assert.ok(failure instanceof TypeError);
      assert.match(inspect(failure.cause), /target_unavailable/u);
      assert.ok(Number(measures.offlineAnswerMs) < 50);
      const restarted = performance.now();
      await ok(hostControl.start());
      await until("alice gets the online notice of the host", () => aliceControl.member(hostKeyId)?.hosting === true);
      measures.onlineNoticeAfterHostStartMs = Math.round(performance.now() - restarted);
      const answer = await aliceCall("GET", TEAM_API_ROUTES.compatibility);
      assert.equal(answer.status, 200);
    },
  );

  const victor = hubClient(bundles.victor);
  const sam = hubClient(bundles.sam);
  const mallory = hubClient(bundles.mallory);
  hubs.push(victor, sam, mallory);
  const connectionsBeforeVictor = delayed.connections.length;
  victor.start();
  await until("victor is online", () => victor.snapshot().state.status === "online");
  const victorConnection = delayed.connections[connectionsBeforeVictor];
  assert.ok(victorConnection, "No proxy connection for victor.");
  victorConnection.mitm = { pending: Buffer.alloc(0), tamperNext: false, replayNext: false, substitute: null };
  sam.start();
  mallory.start();
  await until(
    "victor sees sam and mallory",
    () => victor.member(sam.keyId) !== null && victor.member(mallory.keyId) !== null,
  );
  const received: string[] = [];
  victor.onMessage((message) => {
    if (message.from === sam.keyId) received.push(Buffer.from(message.plaintext).toString("utf8"));
  });
  const samSends = async (text: string) => {
    await until("sam sees victor", () => sam.member(victor.keyId) !== null);
    await sam.send(victor.keyId, "rpc", new Uint8Array(Buffer.from(text)));
  };

  await check("A changed byte, a replayed message and a substituted message key are refused", async () => {
    await samSends("plain-one");
    await until("victor gets the first message", () => received.includes("plain-one"));
    const refusals = (code: "message_integrity_failed" | "message_replayed" | "message_unverified") =>
      victor.refusals().get(code) ?? 0;
    const mitm = victorConnection.mitm;
    assert.ok(mitm);
    mitm.tamperNext = true;
    await samSends("tampered");
    await until("victor refuses the changed message", () => refusals("message_integrity_failed") === 1).catch(
      (error: unknown) => {
        throw new Error(`${String(error)} ${inspect([...victor.refusals()])} ${inspect(received)}`);
      },
    );
    mitm.replayNext = true;
    await samSends("replayed");
    await until("victor refuses the replayed copy", () => refusals("message_replayed") === 1);
    assert.equal(received.filter((text) => text === "replayed").length, 1);
    assert.equal(received.includes("tampered"), false);
    const malloryRecord = victor.member(mallory.keyId);
    assert.ok(malloryRecord);
    mitm.substitute = {
      keyId: sam.keyId,
      messageKey: malloryRecord.messageKey,
      messageKeySignature: malloryRecord.messageKeySignature,
      keyTimestamp: malloryRecord.keyTimestamp,
    };
    const samKey = victor.member(sam.keyId)?.messageKey;
    sam.stop();
    await until("victor sees sam leave", () => victor.member(sam.keyId) === null);
    sam.start();
    await until("victor gets the substituted record of sam", () => {
      const record: RelayHubMember | null = victor.member(sam.keyId);
      return record !== null && record.messageKey === malloryRecord.messageKey && record.messageKey !== samKey;
    });
    await samSends("substituted-signed-by-other");
    await until("victor refuses the key of another member", () => refusals("message_unverified") === 1);
    const unsigned = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({
      type: "spki",
      format: "der",
    });
    mitm.substitute = { ...mitm.substitute, messageKey: Buffer.from(unsigned.subarray(-65)).toString("base64url") };
    sam.stop();
    await until("victor sees sam leave again", () => victor.member(sam.keyId) === null);
    sam.start();
    await until(
      "victor gets an unsigned key for sam",
      () => victor.member(sam.keyId)?.messageKey === mitm.substitute?.messageKey,
    );
    await samSends("substituted-unsigned");
    await until("victor refuses the unsigned key", () => refusals("message_unverified") === 2);
    assert.deepEqual(
      received.filter((text) => text.startsWith("substituted")),
      [],
    );
    mitm.substitute = null;
  });

  await check("A hello with an old time or a used nonce is refused", async () => {
    const old = await helloAnswer(
      relayUrl,
      rawHello(bundles.raw, Date.now() - 120_000, randomBytes(32).toString("base64url")),
    );
    assert.match(old, /"error".*authentication_failed/u);
    const hello = rawHello(bundles.raw, Date.now(), randomBytes(32).toString("base64url"));
    assert.match(await helloAnswer(relayUrl, hello), /"welcome"/u);
    assert.match(await helloAnswer(relayUrl, hello), /"error".*used before/u);
  });

  await check(
    "The server closes a silent app and shows it offline; a suspendable app gets the longer time",
    async () => {
      const lenny = hubClient(bundles.lenny, { liveness: { idleMs: 60_000, answerMs: 60_000 } });
      hubs.push(lenny);
      lenny.start();
      const lennyConnection = delayed.connections.length;
      await until("alice sees lenny", () => aliceControl.member(lenny.keyId) !== null);
      lenny.checkLiveness(60_000);
      await new Promise((resolveWait) => setTimeout(resolveWait, DELAY_MS + 20));
      const silentFrom = performance.now();
      const lennySocket = delayed.connections[lennyConnection];
      assert.ok(lennySocket);
      delayed.freeze(lennySocket);
      await until("alice sees lenny offline", () => aliceControl.member(lenny.keyId) === null, 15_000);
      measures.silentAppOfflineAfterMs = Math.round(performance.now() - silentFrom);
      lenny.stop();
      assert.ok(
        Number(measures.silentAppOfflineAfterMs) >= SILENT_TIMEOUT_MS - 300,
        `${measures.silentAppOfflineAfterMs} ms`,
      );
      assert.ok(Number(measures.silentAppOfflineAfterMs) < SILENT_TIMEOUT_MS + 2_500);
      const sue = hubClient(bundles.sue, { suspendable: true, liveness: { idleMs: 60_000, answerMs: 60_000 } });
      hubs.push(sue);
      sue.start();
      const sueConnection = delayed.connections.length;
      await until("alice sees sue", () => aliceControl.member(sue.keyId)?.suspendable === true);
      sue.checkLiveness(60_000);
      await new Promise((resolveWait) => setTimeout(resolveWait, DELAY_MS + 20));
      const suspendedFrom = performance.now();
      const sueSocket = delayed.connections[sueConnection];
      assert.ok(sueSocket);
      delayed.freeze(sueSocket);
      await new Promise((resolveWait) => setTimeout(resolveWait, SILENT_TIMEOUT_MS + 1_500));
      assert.ok(aliceControl.member(sue.keyId) !== null, "The suspendable app went offline too early.");
      await until("alice sees sue offline", () => aliceControl.member(sue.keyId) === null, 20_000);
      measures.suspendedAppOfflineAfterMs = Math.round(performance.now() - suspendedFrom);
      sue.stop();
      assert.ok(
        Number(measures.suspendedAppOfflineAfterMs) >= SUSPENDED_TIMEOUT_MS - 300,
        `${measures.suspendedAppOfflineAfterMs} ms`,
      );
    },
  );

  await check("A revoked app is closed and the others see it offline within 5 seconds", async () => {
    const rita = hubClient(bundles.rita);
    hubs.push(rita);
    rita.start();
    await until("alice sees rita", () => aliceControl.member(rita.keyId) !== null);
    const started = performance.now();
    assert.equal(command(environment, "ca", "revoke", rita.keyId).status, 0);
    await until("alice sees rita offline", () => aliceControl.member(rita.keyId) === null, 10_000);
    measures.revokedOfflineAfterMs = Math.round(performance.now() - started);
    await until("rita has the final state", () => {
      const state = rita.snapshot().state;
      return state.status === "offline" && state.code === "certificate_revoked";
    });
    assert.ok(Number(measures.revokedOfflineAfterMs) < 5_000, `${measures.revokedOfflineAfterMs} ms`);
  });

  await check(
    "The server cannot read the payloads: the recorded bytes hold no plaintext of requests, replies or files",
    () => {
      const all = Buffer.concat(delayed.recorded);
      assert.ok(
        all.includes(Buffer.from('"type":"welcome"')),
        "The proxy did not record the cleartext WebSocket frames.",
      );
      for (const secret of [
        marker,
        `Reply ${marker}`,
        "Hub fixture",
        fixture.id,
        TEAM_API_ROUTES.agents.all,
        "plain-one",
      ]) {
        assert.equal(all.includes(Buffer.from(secret)), false, `The server saw ${secret}.`);
      }
      measures.recordedBytes = all.byteLength;
    },
  );

  await check("Each app keeps exactly one WebSocket for the whole run", () => {
    measures.socketsOpened = JSON.stringify({
      alice: aliceControl.socketsOpened(),
      host: hostControl.socketsOpened(),
      bob: bob.socketsOpened(),
      victor: victor.socketsOpened(),
    });
    assert.equal(aliceControl.socketsOpened(), 1);
    assert.equal(victor.socketsOpened(), 1);
    assert.equal(measures.phoneSocketsOpened, 1);
    assert.equal(hostControl.socketsOpened(), 1, "The host has one socket since its deliberate restart.");
    assert.equal(bob.socketsOpened(), 2, "Bob has one socket and one deliberate restart.");
  });
} finally {
  closeAlice?.();
  for (const hub of hubs) hub.stop();
  for (const control of controls) await ok(control.stop()).catch(() => undefined);
  if (host) await ok(host.stopRelayHosting()).catch(() => undefined);
  database?.close();
  proxy?.close();
  relayChild?.kill("SIGKILL");
  mkdirSync(OUT, { recursive: true });
  const passed = checks.length > 0 && checks.every((entry) => entry.passed);
  writeFileSync(
    join(OUT, "report.json"),
    `${JSON.stringify({ passed, delayEachWayMs: DELAY_MS, measures, checks, relayLog: relayLog.join("").slice(-4000) }, null, 2)}\n`,
  );
  rmSync(work, { recursive: true, force: true });
  process.stdout.write(`Report: ${join(OUT, "report.json")}\n`);
  process.exit(passed ? 0 : 1);
}
