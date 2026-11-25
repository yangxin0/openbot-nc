import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes, X509Certificate } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { inspect } from "node:util";
import { AGENT_PROVIDERS, type TeamPresenceSnapshot } from "@openbot/contracts/ipc";
import { decodeRelayIdentityBundle, type RelayIdentityBundle } from "@openbot/contracts/relay-protocol/identity-bundle";
import { RELAY_PATH } from "@openbot/contracts/relay-protocol/messages";
import {
  decodeRelayV2TunnelControl,
  encodeRelayV2TunnelMarker,
  encodeRelayV2TunnelRecord,
  RELAY_V2_TUNNEL_CHANNELS,
  RELAY_V2_TUNNEL_PREFIX,
  RELAY_V2_TUNNEL_VERSION,
  type RelayV2TunnelChannel,
  type RelayV2TunnelControl,
  type RelayV2TunnelMessage,
  RelayV2TunnelRecordDecoder,
} from "@openbot/contracts/relay-protocol/v2-tunnel";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  encodeTeamCapabilitiesV10,
  TEAM_APP_VERSION_HEADER,
  TEAM_CURRENT_CAPABILITIES,
  TEAM_PROTOCOL_V10,
  TEAM_PROTOCOL_VERSION_HEADER,
  TEAM_RELAY_AUTH_CAPABILITY,
  TEAM_RELAY_V2_TUNNELS_CAPABILITY,
  teamCapabilityHeaders,
} from "@openbot/contracts/team-protocol";
import {
  decodeTeamProtocolV2EventFrame,
  decodeTeamProtocolV2FileChunk,
  decodeTeamProtocolV2FileControlFrame,
  decodeTeamProtocolV2RpcFrame,
  encodeTeamProtocolV2FileChunk,
  encodeTeamProtocolV2Frame,
  type TeamProtocolV2Json,
  type TeamProtocolV2RpcFrame,
} from "@openbot/contracts/team-protocol/v2";
import { encodeTeamWebRtcPayload, TeamWebRtcPayloadDecoder } from "@openbot/team-client/webrtc-framing";
import { Effect, Result } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { AgentService as AgentServiceInstance } from "../src/backend/agent-service";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { OpenBotDatabase as OpenBotDatabaseInstance } from "../src/backend/openbot-database";
import type { HostService as HostServiceInstance } from "../src/main/host-service";
import type { LocalProfile } from "../src/main/local-profile-store";
import { RelayDialer } from "../src/main/relay/dialer";
import { createRelayFetch } from "../src/main/relay/fetch";
import { type RelayCipher, RelayIdentityStore } from "../src/main/relay/identity-store";
import type { RelayStream } from "../src/main/relay/stream";
import type { TeamApiBrowser } from "../src/main/team-api/dependencies";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, ".openbot-build/relay-v2-tunnel-e2e");
const MAIN = resolve(ROOT, "remote/api/src/relay/main.ts");
const WAIT_MS = 30_000;
const FIRST_BYTES_DEADLINE_MS = 1_500;
const CONNECTION_DEADLINE_MS = 2_000;
const TRANSFER_BYTES = 3 * 1024 * 1024 + 4_321;
const FILE_CHUNK_BYTES = 60 * 1024;
const READY_LINE = "OpenBot relay is ready";
const APP_VERSION = "0.0.0-e2e";
const TEAM = "Acme";
const HOST_USER = "host-user";
const MEMBER_DISABLED = "This team member is disabled.";
const RELAY_SIGN_IN_ONLY = "A relay connection signs in only with its certificate.";

interface Check {
  name: string;
  passed: boolean;
  error?: string;
}

const checks: Check[] = [];

async function check(name: string, run: () => void | Promise<void>): Promise<void> {
  try {
    await run();
    checks.push({ name, passed: true });
  } catch (error) {
    checks.push({ name, passed: false, error: error instanceof Error ? error.message : inspect(error) });
  }
}

process.on("unhandledRejection", (reason) => {
  checks.push({ name: "No promise fails without a handler", passed: false, error: inspect(reason) });
});

function deadline<T>(description: string, promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolveValue, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out: ${description}.`)), WAIT_MS);
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

function until<T>(description: string, subscribe: (done: (value: T) => void) => () => void): Promise<T> {
  const state: { unsubscribe: (() => void) | null; finished: boolean } = { unsubscribe: null, finished: false };
  const found = new Promise<T>((resolveValue) => {
    state.unsubscribe = subscribe((value) => {
      state.finished = true;
      state.unsubscribe?.();
      resolveValue(value);
    });
    if (state.finished) state.unsubscribe();
  });
  return deadline(description, found).finally(() => state.unsubscribe?.());
}

async function ok<A, E>(operation: Effect.Effect<A, E>): Promise<A> {
  const result = await Effect.runPromise(Effect.result(operation));
  if (Result.isFailure(result)) throw new Error(`The operation failed: ${inspect(result.failure)}`);
  return result.success;
}

async function failureOf<A, E>(operation: Effect.Effect<A, E>): Promise<E> {
  const result = await Effect.runPromise(Effect.result(operation));
  if (Result.isSuccess(result)) throw new Error("The operation did not fail.");
  return result.failure;
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
  return { status: result.status ?? 1, output: `${result.stdout}${result.stderr}` };
}

function issue(
  environment: Record<string, string>,
  directory: string,
  team: string,
  user: string,
  device: string,
): RelayIdentityBundle {
  const file = join(directory, `${randomBytes(6).toString("hex")}.json`);
  const result = command(environment, "ca", "issue", "--team", team, "--user", user, "--device", device, "--out", file);
  assert.equal(result.status, 0, result.output);
  const bundle = decodeRelayIdentityBundle(JSON.parse(readFileSync(file, "utf8")));
  assert.ok(bundle, "The identity file must decode.");
  return bundle;
}

function keyIdOf(bundle: RelayIdentityBundle): string {
  const spki = new X509Certificate(bundle.certificate).publicKey.export({ type: "spki", format: "der" });
  return createHash("sha256").update(spki).digest("base64url");
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function connectionKey(): string {
  return randomBytes(16).toString("hex");
}

const testCipher: RelayCipher = {
  encrypt: (value) => Buffer.from(value, "utf8").reverse(),
  decrypt: (value) => Buffer.from(value).reverse().toString("utf8"),
};

interface Relay {
  child: ChildProcess;
  log: string[];
  exited: Promise<void>;
}

async function startRelay(environment: Record<string, string>): Promise<Relay> {
  const log: string[] = [];
  const child = spawn("bun", [MAIN, "serve"], {
    cwd: ROOT,
    env: { ...process.env, ...environment },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = new Promise<void>((resolveExit) => {
    child.once("exit", (code, signal) => {
      log.push(`[exit ${code ?? "none"} ${signal ?? "none"}]\n`);
      resolveExit();
    });
  });
  child.stderr.on("data", (chunk: Buffer) => log.push(chunk.toString()));
  child.stdout.on("data", (chunk: Buffer) => log.push(chunk.toString()));
  await until<void>("the relay server is ready", (done) => {
    const onData = () => {
      if (log.join("").includes(READY_LINE)) done();
    };
    child.stdout.on("data", onData);
    return () => child.stdout.off("data", onData);
  }).catch((error: unknown) => {
    child.kill("SIGKILL");
    throw new Error(`${error instanceof Error ? error.message : inspect(error)} Log: ${log.join("")}`);
  });
  return { child, log, exited };
}

class TestTunnel {
  readonly messages: RelayV2TunnelMessage[] = [];
  readonly errors: string[] = [];
  closed = false;
  onMessage: ((message: RelayV2TunnelMessage) => void) | null = null;
  readonly #records = new RelayV2TunnelRecordDecoder();
  readonly #payloads = new TeamWebRtcPayloadDecoder();
  readonly #waiters = new Set<() => void>();

  constructor(
    readonly channel: RelayV2TunnelChannel,
    readonly stream: RelayStream,
  ) {
    stream.on("data", (chunk: Buffer) => {
      for (const record of this.#records.push(chunk)) {
        const payload = this.#payloads.push(record);
        if (payload === undefined) continue;
        this.messages.push(payload);
        try {
          this.onMessage?.(payload);
        } catch (error) {
          this.errors.push(error instanceof Error ? error.message : inspect(error));
        }
      }
      this.#wake();
    });
    stream.on("close", () => {
      this.closed = true;
      this.#wake();
    });
    stream.on("error", () => stream.destroy());
  }

  send(data: RelayV2TunnelMessage): void {
    for (const frame of encodeTeamWebRtcPayload(data, Number.POSITIVE_INFINITY)) {
      this.stream.write(encodeRelayV2TunnelRecord(frame));
    }
  }

  async next<T>(description: string, pick: (message: RelayV2TunnelMessage) => T | null, from = 0): Promise<T> {
    const found = await until<{ value: T } | { closed: true }>(`${this.channel}: ${description}`, (done) => {
      const look = () => {
        for (const message of this.messages.slice(from)) {
          const value = safePick(pick, message);
          if (value !== null) {
            done({ value });
            return;
          }
        }
        if (this.closed) done({ closed: true });
      };
      this.#waiters.add(look);
      look();
      return () => this.#waiters.delete(look);
    });
    if ("closed" in found)
      throw new Error(`${this.channel}: ${description}: the tunnel closed. ${this.errors.join(" ")}`);
    return found.value;
  }

  untilClosed(description: string): Promise<void> {
    return until<void>(`${this.channel}: ${description}`, (done) => {
      const look = () => {
        if (this.closed) done();
      };
      this.#waiters.add(look);
      look();
      return () => this.#waiters.delete(look);
    });
  }

  #wake(): void {
    for (const waiter of [...this.#waiters]) waiter();
  }
}

function capabilitiesOf(text: string): string[] {
  const body = JSON.parse(text);
  assert.ok(isDynamicRecord(body) && Array.isArray(body.capabilities) && body.capabilities.every(isString), text);
  return body.capabilities;
}

function safePick<T>(pick: (message: RelayV2TunnelMessage) => T | null, message: RelayV2TunnelMessage): T | null {
  try {
    return pick(message);
  } catch {
    return null;
  }
}

function control(message: RelayV2TunnelMessage): RelayV2TunnelControl | null {
  return isString(message) ? decodeRelayV2TunnelControl(message) : null;
}

type RpcResponse = Extract<TeamProtocolV2RpcFrame, { type: "response" }>;

interface ReceivedFile {
  size: number;
  sha256: string;
  bytes: Uint8Array;
  received: number;
  done: boolean;
}

class V2Client {
  readonly downloads = new Map<string, ReceivedFile>();

  constructor(readonly tunnels: Record<RelayV2TunnelChannel, TestTunnel>) {
    tunnels.files.onMessage = (message) => this.#receiveFile(message);
  }

  get rpc(): TestTunnel {
    return this.tunnels.rpc;
  }

  async request(
    method: "GET" | "POST" | "PATCH",
    path: string,
    body: TeamProtocolV2Json,
    extra: { bodyTransferId?: string; contentType?: string } = {},
  ): Promise<RpcResponse> {
    const requestId = `request-${randomBytes(8).toString("hex")}`;
    const from = this.rpc.messages.length;
    this.rpc.send(
      encodeTeamProtocolV2Frame({
        version: 2,
        type: "request",
        requestId,
        operation: "http.request",
        payload: { method, path, body, ...extra, ...encodeTeamCapabilitiesV10(TEAM_CURRENT_CAPABILITIES) },
      }),
    );
    return this.rpc.next(
      `the answer to ${method} ${path}`,
      (message) => {
        if (!isString(message) || control(message)) return null;
        const frame = decodeTeamProtocolV2RpcFrame(message);
        return frame.type === "response" && frame.requestId === requestId ? frame : null;
      },
      from,
    );
  }

  async upload(bytes: Uint8Array, name: string, mimeType: string): Promise<string> {
    const transferId = `upload-${randomBytes(8).toString("hex")}`;
    const files = this.tunnels.files;
    const from = files.messages.length;
    const acknowledged = (through: number) => (message: RelayV2TunnelMessage) => {
      if (!isString(message)) return null;
      const frame = decodeTeamProtocolV2FileControlFrame(message);
      if (frame.transferId !== transferId) return null;
      if (frame.type === "file-cancel") throw new Error(`The host cancelled the upload: ${frame.reason}`);
      return frame.type === "file-ack" && frame.receivedThrough === through ? true : null;
    };
    files.send(
      encodeTeamProtocolV2Frame({
        version: 2,
        type: "file-open",
        transferId,
        name,
        size: bytes.byteLength,
        mimeType,
        sha256: sha256(bytes),
      }),
    );
    await files.next("the host accepts the upload", acknowledged(0), from);
    for (let offset = 0; offset < bytes.byteLength; offset += FILE_CHUNK_BYTES) {
      const chunk = encodeTeamProtocolV2FileChunk({
        transferId,
        offset,
        bytes: bytes.subarray(offset, Math.min(bytes.byteLength, offset + FILE_CHUNK_BYTES)),
      });
      files.send(chunk.slice().buffer);
    }
    files.send(encodeTeamProtocolV2Frame({ version: 2, type: "file-complete", transferId }));
    await files.next("the host has the whole upload", acknowledged(bytes.byteLength), from);
    return transferId;
  }

  download(transferId: string): Promise<ReceivedFile> {
    return this.tunnels.files.next(`the download ${transferId} completes`, () => {
      const file = this.downloads.get(transferId);
      return file?.done ? file : null;
    });
  }

  close(): void {
    for (const tunnel of Object.values(this.tunnels)) tunnel.stream.destroy();
  }

  #receiveFile(message: RelayV2TunnelMessage): void {
    const files = this.tunnels.files;
    if (!isString(message)) {
      const chunk = decodeTeamProtocolV2FileChunk(message);
      const file = this.downloads.get(chunk.transferId);
      if (!file) return;
      file.bytes.set(chunk.bytes, chunk.offset);
      file.received = Math.max(file.received, chunk.offset + chunk.bytes.byteLength);
      return;
    }
    const frame = decodeTeamProtocolV2FileControlFrame(message);
    if (frame.type === "file-open") {
      this.downloads.set(frame.transferId, {
        size: frame.size,
        sha256: frame.sha256,
        bytes: new Uint8Array(frame.size),
        received: 0,
        done: false,
      });
      files.send(
        encodeTeamProtocolV2Frame({ version: 2, type: "file-ack", transferId: frame.transferId, receivedThrough: 0 }),
      );
      return;
    }
    const file = this.downloads.get(frame.transferId);
    if (frame.type !== "file-complete" || !file) return;
    file.done = true;
    files.send(
      encodeTeamProtocolV2Frame({
        version: 2,
        type: "file-ack",
        transferId: frame.transferId,
        receivedThrough: file.size,
      }),
    );
  }
}

function resultOf(response: RpcResponse): { status: number; body: unknown; file: unknown } {
  if ("error" in response) throw new Error(`The host answered an error: ${inspect(response.error)}`);
  const result = response.result;
  assert.ok(isDynamicRecord(result) && isNumber(result.status), inspect(result));
  return { status: result.status, body: result.body, file: result.file };
}

function errorOf(response: RpcResponse): { status: number | null; message: string } {
  assert.ok("error" in response, inspect(response));
  return { status: response.error.status ?? null, message: response.error.message };
}

const work = mkdtempSync(join(tmpdir(), "openbot-relay-v2-tunnel-e2e-"));
const dataDirectory = join(work, "data");
const storeDirectory = join(work, "stores");
const hostData = join(work, "host");
const fakeHome = join(work, "home");
const fakeCodex = join(work, "codex");
const fakeCodexLog = join(work, "codex.jsonl");
mkdirSync(storeDirectory);
mkdirSync(fakeHome);

process.env.HOME = fakeHome;
process.env.CODEX_HOME = join(fakeHome, ".codex");
process.env.OPENBOT_CODEX_PATH = fakeCodex;

const FAKE_CODEX = `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.160.1\\n");
  process.exit(0);
}
const LOG = ${JSON.stringify(fakeCodexLog)};
const config = { config: { mcp_servers: {} }, layers: [{ name: { type: "user", file: "/fake/.codex/config.toml", profile: null }, version: "1", config: { mcp_servers: {} } }] };
let buffer = "";
let threads = 0;
let turns = 0;
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
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
      const item = { type: "agentMessage", id: "message-" + turnId, text: "Done.", phase: "final_answer" };
      write({ method: "item/completed", params: { threadId: params.threadId, turnId, item } });
      return write({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: turnId, status: "completed" } } });
    }
    case "turn/interrupt": {
      write({ id: message.id, result: {} });
      return write({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: params.turnId, status: "interrupted" } } });
    }
    default:
      return write({ id: message.id, error: { code: -32601, message: "Method not found: " + message.method } });
  }
};
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line) {
      const message = JSON.parse(line);
      if (message.method && message.id !== undefined) answer(message);
    }
    newline = buffer.indexOf("\\n");
  }
});
`;
writeFileSync(fakeCodex, FAKE_CODEX, { mode: 0o755 });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");
const { SidebarLayoutStore } = await import("../src/backend/sidebar-layout-store");
const { HostService } = await import("../src/main/host-service");
const { TeamStore } = await import("../src/main/team-store");

const [relayPort, healthPort] = await Promise.all([freePort(), freePort()]);
const relayUrl = `wss://127.0.0.1:${relayPort}${RELAY_PATH}`;
const environment = {
  RELAY_DATA_DIR: dataDirectory,
  RELAY_HOST: "127.0.0.1",
  RELAY_PORT: String(relayPort),
  RELAY_HEALTH_PORT: String(healthPort),
  RELAY_PUBLIC_URL: relayUrl,
};
const reconnect = { baseMs: 100, maxMs: 500 };

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
};
const localOwner: LocalProfile = { id: "local-profile-e2e", name: "Host Person", chatColor: null };

let relay: Relay | null = null;
const relayLogs: string[][] = [];
const closers: Array<() => void> = [];
let database: OpenBotDatabaseInstance | null = null;
let agents: AgentServiceInstance | null = null;
let host: HostServiceInstance | null = null;

try {
  await check("The certificate commands make a root, a server certificate and two teams", () => {
    assert.equal(command(environment, "ca", "init").status, 0);
    assert.equal(command(environment, "ca", "server", "--dns", "localhost", "--ip", "127.0.0.1").status, 0);
    assert.equal(command(environment, "ca", "team", "add", TEAM).status, 0);
    assert.equal(command(environment, "ca", "team", "add", "Other").status, 0);
  });

  const hostBundle = issue(environment, work, TEAM, HOST_USER, "server");
  const ownerBundle = issue(environment, work, TEAM, HOST_USER, "laptop");
  const aliceBundle = issue(environment, work, TEAM, "alice", "browser");
  const bobBundle = issue(environment, work, TEAM, "bob", "phone");
  const eveBundle = issue(environment, work, "Other", "eve", "browser");
  const hostKeyId = keyIdOf(hostBundle);
  const identityStore = async (name: string, bundle: RelayIdentityBundle) => {
    const identity = new RelayIdentityStore({ path: join(storeDirectory, `${name}.json`), cipher: testCipher });
    await ok(identity.importBundle(bundle));
    return identity;
  };
  const hostStore = await identityStore("host", hostBundle);
  const aliceDialer = new RelayDialer({ identity: await identityStore("alice", aliceBundle) });
  const bobDialer = new RelayDialer({ identity: await identityStore("bob", bobBundle) });
  const eveDialer = new RelayDialer({ identity: await identityStore("eve", eveBundle) });
  const ownerDialer = new RelayDialer({ identity: await identityStore("owner", ownerBundle) });

  relay = await startRelay(environment);
  relayLogs.push(relay.log);

  database = new OpenBotDatabase(hostData);
  const agentStore = new AgentStore(hostData, join(work, "home"), database);
  const mailbox = new MailboxStore(hostData, agentStore.sharedRoot, agentStore.database);
  const sidebar = new SidebarLayoutStore(join(hostData, "sidebar-layout.json"));
  const team = new TeamStore(join(hostData, "openbot-team-server-v2.json"));
  await runCauseEffect(sidebar.initialize());
  await runCauseEffect(agentStore.initialize());
  await runCauseEffect(mailbox.initialize());
  await runCauseEffect(team.initialize());
  const fixture = await runCauseEffect(
    agentStore.createAgent({
      name: "Relay V2 fixture",
      description: "Synthetic agent for the relay V2 tunnel check",
      avatarSeed: "relay-v2-tunnel",
      avatarHue: null,
    }),
  );
  const agentService = new AgentService({
    store: agentStore,
    mailbox,
    browser: agentBrowser,
    sidebarLayout: sidebar,
    preferredProvider: "codex",
    offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "codex"),
    timezone: () => "UTC",
  });
  agents = agentService;
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
    logDirectory: join(work, "logs"),
  });
  host = hostService;
  const untilPresence = (description: string, accepts: (snapshot: TeamPresenceSnapshot) => boolean) =>
    until<TeamPresenceSnapshot>(description, (done) => {
      const listener = (snapshot: TeamPresenceSnapshot) => {
        if (accepts(snapshot)) done(snapshot);
      };
      hostService.on("presence", listener);
      listener(hostService.getPresence());
      return () => hostService.off("presence", listener);
    });

  await ok(
    hostService.startRelayHosting(hostStore, {
      reconnect,
      firstBytesDeadlineMs: FIRST_BYTES_DEADLINE_MS,
      tunnelConnectionDeadlineMs: CONNECTION_DEADLINE_MS,
    }),
  );
  await until<void>("the host is online at the relay", (done) => {
    const listener = () => {
      if (hostService.getStatus().apiOnline) done();
    };
    hostService.on("changed", listener);
    listener();
    return () => hostService.off("changed", listener);
  });

  const openTunnel = async (dialer: RelayDialer, channel: RelayV2TunnelChannel, key: string) => {
    const stream = await ok(dialer.dial(hostKeyId));
    closers.push(() => stream.destroy());
    const tunnel = new TestTunnel(channel, stream);
    stream.write(encodeRelayV2TunnelMarker({ version: RELAY_V2_TUNNEL_VERSION, channel, connectionKey: key }));
    return tunnel;
  };
  const openTunnels = async (dialer: RelayDialer, key: string) => {
    const [rpc, events, files] = await Promise.all(
      RELAY_V2_TUNNEL_CHANNELS.map((channel) => openTunnel(dialer, channel, key)),
    );
    assert.ok(rpc && events && files);
    return { rpc, events, files };
  };
  const connectV2 = async (dialer: RelayDialer, key = connectionKey()) => {
    const client = new V2Client(await openTunnels(dialer, key));
    await client.rpc.next("the host sends relay-v2-ready", (message) =>
      control(message)?.type === "relay-v2-ready" ? true : null,
    );
    client.tunnels.events.send(encodeTeamProtocolV2Frame({ version: 2, type: "event-ack", throughSequence: 0 }));
    closers.push(() => client.close());
    return { client, key };
  };

  const desktopFetch = (dialer: RelayDialer) => {
    const fetcher = createRelayFetch({ dialer, target: hostKeyId });
    closers.push(fetcher.close);
    return fetcher;
  };
  const desktopCall = async (
    fetcher: ReturnType<typeof createRelayFetch>,
    method: string,
    path: string,
    options: { token?: string; json?: unknown } = {},
  ) => {
    const response = await deadline(
      `${method} ${path}`,
      fetcher.fetch(`${fetcher.origin}${path}`, {
        method,
        headers: {
          [TEAM_PROTOCOL_VERSION_HEADER]: String(TEAM_PROTOCOL_V10),
          [TEAM_APP_VERSION_HEADER]: APP_VERSION,
          ...teamCapabilityHeaders(TEAM_PROTOCOL_V10, TEAM_CURRENT_CAPABILITIES),
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
          ...(options.json === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(options.json === undefined ? {} : { body: JSON.stringify(options.json) }),
      }),
    );
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
  const tokenOf = (body: unknown): string => {
    assert.ok(isDynamicRecord(body) && isString(body.sessionToken), inspect(body));
    return body.sessionToken;
  };
  const idOf = (body: unknown): string => {
    assert.ok(isDynamicRecord(body) && isString(body.id), inspect(body));
    return body.id;
  };

  await check("The host advertises relay-v2-tunnels-v1 while relay hosting is on", async () => {
    const answer = await desktopCall(desktopFetch(aliceDialer), "GET", TEAM_API_ROUTES.compatibility);
    assert.equal(answer.status, 200);
    assert.ok(isDynamicRecord(answer.body) && Array.isArray(answer.body.capabilities), inspect(answer.body));
    assert.ok(answer.body.capabilities.includes(TEAM_RELAY_V2_TUNNELS_CAPABILITY));
    assert.ok(answer.body.capabilities.includes(TEAM_RELAY_AUTH_CAPABILITY));
  });

  let alice: Awaited<ReturnType<typeof connectV2>> | null = null;
  let aliceMemberId = "";
  await check("Three tunnels with one connection key get relay-v2-ready and a member session for alice", async () => {
    alice = await connectV2(aliceDialer);
    const me = resultOf(await alice.client.request("GET", TEAM_API_ROUTES.me, null));
    assert.equal(me.status, 200);
    assert.ok(isDynamicRecord(me.body), inspect(me.body));
    assert.deepEqual([me.body.role, me.body.name], ["member", "alice"]);
    aliceMemberId = idOf(me.body);
    await untilPresence("the host sees alice online through her events tunnel", (snapshot) =>
      snapshot.members.some((member) => member.id === aliceMemberId && member.online),
    );
  });

  await check("V2 RPC frames list the host's agents and negotiate protocol 10", async () => {
    assert.ok(alice);
    const compatibility = resultOf(await alice.client.request("GET", TEAM_API_ROUTES.compatibility, null));
    assert.equal(compatibility.status, 200);
    const listed = resultOf(await alice.client.request("GET", TEAM_API_ROUTES.agents.all, null));
    assert.equal(listed.status, 200);
    assert.ok(JSON.stringify(listed.body).includes(fixture.id), inspect(listed.body));
  });

  await check(
    "A message to the agent goes through the RPC tunnel and its reply arrives on the events tunnel",
    async () => {
      assert.ok(alice);
      const client = alice.client;
      const text = `Relay V2 check ${randomBytes(4).toString("hex")}`;
      const reply = client.tunnels.events.next("the reply of the fixture", (message) => {
        if (!isString(message)) return null;
        const frame = decodeTeamProtocolV2EventFrame(message);
        if (frame.type !== "event") return null;
        const json = JSON.stringify(frame.payload);
        return json.includes(fixture.id) && json.includes("Done.") ? frame.sequence : null;
      });
      const sent = resultOf(
        await client.request("POST", TEAM_API_ROUTES.agent.messages(fixture.id), {
          agentId: fixture.id,
          text,
          timezone: "UTC",
        }),
      );
      assert.ok(sent.status >= 200 && sent.status < 300, inspect(sent));
      assert.ok((await reply) > 0);
      assert.ok(readFileSync(fakeCodexLog, "utf8").includes(text), "The host provider did not get the message.");
    },
  );

  await check("A file goes up and comes back through the files tunnel with the same hash", async () => {
    assert.ok(alice);
    const client = alice.client;
    const blob = new Uint8Array(randomBytes(TRANSFER_BYTES));
    const transferId = await client.upload(blob, "relay-v2.bin", "application/octet-stream");
    const uploaded = resultOf(
      await client.request(
        "POST",
        `${TEAM_API_ROUTES.attachments}?name=relay-v2.bin&mime=application%2Foctet-stream`,
        null,
        { bodyTransferId: transferId, contentType: "application/octet-stream" },
      ),
    );
    assert.equal(uploaded.status, 201, inspect(uploaded));
    const downloaded = resultOf(await client.request("GET", TEAM_API_ROUTES.attachment(idOf(uploaded.body)), null));
    assert.ok(isDynamicRecord(downloaded.file) && isString(downloaded.file.transferId), inspect(downloaded));
    assert.equal(downloaded.file.size, TRANSFER_BYTES);
    const file = await client.download(downloaded.file.transferId);
    assert.equal(file.bytes.byteLength, TRANSFER_BYTES);
    assert.equal(sha256(file.bytes), sha256(blob));
  });

  await check("A desktop HTTP client and a V2 client use the host at the same time", async () => {
    assert.ok(alice);
    const client = alice.client;
    const desktop = desktopFetch(ownerDialer);
    const [signIn, v2Agents] = await Promise.all([
      desktopCall(desktop, "POST", TEAM_API_ROUTES.auth.relay),
      client.request("GET", TEAM_API_ROUTES.agents.all, null),
    ]);
    assert.equal(signIn.status, 200, inspect(signIn.body));
    const token = tokenOf(signIn.body);
    const [desktopAgents, v2Me] = await Promise.all([
      desktopCall(desktop, "GET", TEAM_API_ROUTES.agents.all, { token }),
      client.request("GET", TEAM_API_ROUTES.me, null),
    ]);
    assert.equal(desktopAgents.status, 200);
    assert.ok(JSON.stringify(desktopAgents.body).includes(fixture.id));
    assert.equal(resultOf(v2Agents).status, 200);
    assert.equal(resultOf(v2Me).status, 200);
  });

  await check("A V2 client cannot use the password, invitation or account sign-in routes", async () => {
    assert.ok(alice);
    const login = errorOf(
      await alice.client.request("POST", TEAM_API_ROUTES.auth.login, {
        username: "owner",
        password: "a-password-of-the-owner",
      }),
    );
    assert.deepEqual([login.status, login.message], [403, RELAY_SIGN_IN_ONLY]);
  });

  await check("A tunnel with alice's connection key from bob is refused, and alice keeps working", async () => {
    assert.ok(alice);
    const stolen = await openTunnel(bobDialer, "files", alice.key);
    const refusal = await stolen.next("the refusal", (message) => control(message));
    assert.deepEqual(refusal, {
      type: "relay-v2-refused",
      version: RELAY_V2_TUNNEL_VERSION,
      code: "different_peer",
      message: null,
    });
    await stolen.untilClosed("the refused tunnel closes");
    const duplicate = await openTunnel(aliceDialer, "rpc", alice.key);
    assert.equal((await duplicate.next("the refusal", (message) => control(message)))?.type, "relay-v2-refused");
    await duplicate.untilClosed("the duplicate tunnel closes");
    assert.equal(resultOf(await alice.client.request("GET", TEAM_API_ROUTES.me, null)).status, 200);
  });

  await check("A connection that never opens all three tunnels is refused after its deadline", async () => {
    const lonely = await openTunnel(aliceDialer, "rpc", connectionKey());
    const refusal = await lonely.next("the refusal", (message) => control(message));
    assert.equal(refusal?.type === "relay-v2-refused" ? refusal.code : null, "connection_incomplete");
    await lonely.untilClosed("the incomplete tunnel closes");
  });

  await check("A certificate of another team cannot dial the host", async () => {
    const refusal = await deadline("the dial of eve", failureOf(eveDialer.dial(hostKeyId)));
    assert.equal(refusal.code, "target_unavailable");
  });

  await check("A disabled member gets 401 on the open connection and is refused on a new one", async () => {
    const bob = await connectV2(bobDialer);
    const me = resultOf(await bob.client.request("GET", TEAM_API_ROUTES.me, null));
    const bobId = idOf(me.body);
    const owner = desktopFetch(ownerDialer);
    const ownerToken = tokenOf((await desktopCall(owner, "POST", TEAM_API_ROUTES.auth.relay)).body);
    const disabled = await desktopCall(owner, "PATCH", TEAM_API_ROUTES.team.member(bobId), {
      token: ownerToken,
      json: { disabled: true },
    });
    assert.equal(disabled.status, 200, inspect(disabled.body));
    assert.equal(errorOf(await bob.client.request("GET", TEAM_API_ROUTES.me, null)).status, 401);
    bob.client.close();
    const again = await openTunnels(bobDialer, connectionKey());
    for (const tunnel of Object.values(again)) {
      const refusal = await tunnel.next("the refusal", (message) => control(message));
      assert.deepEqual(refusal, {
        type: "relay-v2-refused",
        version: RELAY_V2_TUNNEL_VERSION,
        code: "sign_in_refused",
        message: MEMBER_DISABLED,
      });
      await tunnel.untilClosed("the refused tunnel closes");
    }
  });

  const rawStream = async () => {
    const stream = await ok(aliceDialer.dial(hostKeyId));
    closers.push(() => stream.destroy());
    stream.on("error", () => stream.destroy());
    return stream;
  };
  const untilStreamCloses = (stream: RelayStream, description: string) =>
    until<void>(description, (done) => {
      const listener = () => done();
      if (stream.destroyed) done();
      stream.once("close", listener);
      stream.resume();
      return () => stream.off("close", listener);
    });

  await check("A stream that sends only part of a marker, or nothing, is closed after the deadline", async () => {
    const partial = await rawStream();
    const silent = await rawStream();
    const started = Date.now();
    partial.write(Buffer.from(RELAY_V2_TUNNEL_PREFIX.slice(0, 9)));
    await Promise.all([
      untilStreamCloses(partial, "the partial marker stream closes"),
      untilStreamCloses(silent, "the silent stream closes"),
    ]);
    assert.ok(Date.now() - started >= FIRST_BYTES_DEADLINE_MS - 100, "The stream closed before the deadline.");
  });

  await check("An OPTIONS request that begins like the marker is HTTP, sent in small parts", async () => {
    const stream = await rawStream();
    const head = new Promise<string>((resolveHead) => {
      let text = "";
      stream.on("data", (chunk: Buffer) => {
        text += chunk.toString("latin1");
        if (text.includes("\r\n\r\n")) resolveHead(text);
      });
    });
    assert.ok(RELAY_V2_TUNNEL_PREFIX.startsWith("OP"));
    stream.write(Buffer.from("OP"));
    stream.write(Buffer.from(`TIONS ${TEAM_API_ROUTES.compatibility} HTTP/1.1\r\nHost: relay.invalid\r\n\r\n`));
    const answer = await deadline("the HTTP answer", head);
    assert.match(answer, /^HTTP\/1\.1 \d{3} /u);
  });

  await check("A marker inside an HTTP body on a keep-alive stream stays HTTP", async () => {
    const stream = await rawStream();
    const marker = encodeRelayV2TunnelMarker({
      version: RELAY_V2_TUNNEL_VERSION,
      channel: "rpc",
      connectionKey: connectionKey(),
    });
    const exchange = (method: string, path: string, body: Uint8Array | null) =>
      deadline(
        `${method} ${path}`,
        new Promise<number>((resolveStatus, reject) => {
          const outgoing = httpRequest(
            {
              method,
              path,
              host: "relay.invalid",
              createConnection: () => stream,
              headers: {
                [TEAM_PROTOCOL_VERSION_HEADER]: String(TEAM_PROTOCOL_V10),
                [TEAM_APP_VERSION_HEADER]: APP_VERSION,
                Connection: "keep-alive",
                ...(body ? { "Content-Length": String(body.byteLength), "Content-Type": "text/plain" } : {}),
              },
            },
            (response) => {
              response.resume();
              response.once("end", () => resolveStatus(response.statusCode ?? 0));
            },
          );
          outgoing.once("error", reject);
          outgoing.flushHeaders();
          if (body) outgoing.write(body);
          outgoing.end();
        }),
      );
    const first = await exchange("POST", TEAM_API_ROUTES.auth.relay, marker);
    assert.equal(first, 200);
    assert.equal(stream.destroyed, false);
    const second = await exchange("GET", TEAM_API_ROUTES.compatibility, null);
    assert.equal(second, 200);
  });

  await check("After relay hosting stops, V2 tunnels close and the capability is gone", async () => {
    assert.ok(alice);
    const closed = Promise.all(Object.values(alice.client.tunnels).map((tunnel) => tunnel.untilClosed("closes")));
    await ok(hostService.stopRelayHosting());
    await closed;
    const status = await ok(hostService.startLoopbackOnly());
    const origin = (status.apiUrl ?? "").replace("localhost", "127.0.0.1");
    const response = await deadline("the loopback compatibility", fetch(`${origin}${TEAM_API_ROUTES.compatibility}`));
    const capabilities = capabilitiesOf(await response.text());
    assert.equal(capabilities.includes(TEAM_RELAY_V2_TUNNELS_CAPABILITY), false);
  });
} finally {
  for (const close of closers) close();
  if (host) await runCauseEffect(host.shutdown()).catch(() => undefined);
  if (agents) await runCauseEffect(agents.stop()).catch(() => undefined);
  database?.close();
  if (relay) {
    relay.child.kill("SIGKILL");
    await deadline("the relay server process ends", relay.exited).catch(() => undefined);
  }
  rmSync(work, { recursive: true, force: true });
}

const failedChecks = checks.filter((entry) => !entry.passed);
mkdirSync(OUT, { recursive: true });
writeFileSync(
  join(OUT, "report.json"),
  `${JSON.stringify(
    {
      passed: failedChecks.length === 0,
      runtime: `node ${process.version}`,
      checks,
      ...(failedChecks.length === 0 ? {} : { relayLogs: relayLogs.map((log) => log.join("")) }),
    },
    null,
    2,
  )}\n`,
);
for (const entry of checks) {
  process.stdout.write(
    `${entry.passed ? "PASS" : "FAIL"} ${entry.name}${entry.error ? `\n     ${entry.error}` : ""}\n`,
  );
}
process.stdout.write(`Report: ${join(OUT, "report.json")}\n`);
process.exit(failedChecks.length === 0 ? 0 : 1);
