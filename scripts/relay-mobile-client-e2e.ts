import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash, createPrivateKey, type KeyObject, randomBytes, sign, X509Certificate } from "node:crypto";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpsServer } from "node:https";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { inspect } from "node:util";
import { AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import { decodeRelayIdentityBundle, type RelayIdentityBundle } from "@openbot/contracts/relay-protocol/identity-bundle";
import {
  RELAY_PATH,
  RELAY_PROTOCOL_VERSION,
  type RelayRole,
  type RelayServerProofTranscriptInput,
  relayServerProofTranscript,
} from "@openbot/contracts/relay-protocol/messages";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { Effect, Result } from "effect";
import { WebSocketServer } from "ws";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { AgentService as AgentServiceInstance } from "../src/backend/agent-service";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { OpenBotDatabase as OpenBotDatabaseInstance } from "../src/backend/openbot-database";
import type { HostService as HostServiceInstance } from "../src/main/host-service";
import type { LocalProfile } from "../src/main/local-profile-store";
import { type RelayCipher, RelayIdentityStore } from "../src/main/relay/identity-store";
import type { TeamApiBrowser } from "../src/main/team-api/dependencies";
import { rawDataBytes } from "../src/main/ws-raw-data";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, ".openbot-build/relay-mobile-client-e2e");
const MAIN = resolve(ROOT, "remote/api/src/relay/main.ts");
const PHONE = resolve(ROOT, "scripts/relay-mobile-client-e2e-phone.ts");
const WAIT_MS = 60_000;
const READY_LINE = "OpenBot relay is ready";
const APP_VERSION = "0.0.0-e2e";
const TEAM = "Acme";
const OTHER_TEAM = "Other";
const HOST_USER = "host-user";
const HOST_DEVICE = "server";
const AGENT_NAME = "Relay phone fixture";
const FILE_BYTES = 96 * 1024 + 7;

interface Check {
  name: string;
  passed: boolean;
  error?: string;
}

interface FakeRelay {
  url: string;
  connections: number;
  stop: () => void;
}

interface PhoneReport {
  checks: Check[];
  facts: Record<string, string | number | string[] | number[] | null>;
}

interface Relay {
  child: ChildProcess;
  log: string[];
  exited: Promise<void>;
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

function issue(environment: Record<string, string>, team: string, user: string, device: string): RelayIdentityBundle {
  const file = join(work, `${randomBytes(6).toString("hex")}.json`);
  const result = command(environment, "ca", "issue", "--team", team, "--user", user, "--device", device, "--out", file);
  assert.equal(result.status, 0, result.output);
  const bundle = decodeRelayIdentityBundle(JSON.parse(readFileSync(file, "utf8")));
  assert.ok(bundle, "The identity file must decode.");
  return bundle;
}

function keyIdOf(certificate: string): string {
  const spki = new X509Certificate(certificate).publicKey.export({ type: "spki", format: "der" });
  return createHash("sha256").update(spki).digest("base64url");
}

function isRole(value: unknown): value is RelayRole {
  return value === "member" || value === "client" || value === "accept";
}

function helloTranscript(serverNonce: string, text: string): RelayServerProofTranscriptInput | null {
  const hello = JSON.parse(text);
  if (!isDynamicRecord(hello) || !isString(hello.certificate) || !isString(hello.clientNonce)) return null;
  if (!isString(hello.audience) || !isRole(hello.role)) return null;
  return {
    serverNonce,
    clientNonce: hello.clientNonce,
    audience: hello.audience,
    role: hello.role,
    clientKeyId: keyIdOf(hello.certificate),
    target: isString(hello.target) ? hello.target : undefined,
  };
}

async function startFakeRelay(
  tls: { cert: string; key: string },
  proof: { certificate: string; privateKey: KeyObject },
  openPeer?: { user: string; device: string; certificate: string },
): Promise<FakeRelay> {
  const server = createHttpsServer(tls);
  const sockets = new WebSocketServer({ server, path: RELAY_PATH });
  const fake: FakeRelay = {
    url: "",
    connections: 0,
    stop: () => {
      for (const client of sockets.clients) client.terminate();
      sockets.close();
      server.close();
    },
  };
  sockets.on("connection", (socket) => {
    fake.connections += 1;
    const serverNonce = randomBytes(32).toString("base64url");
    let answered = false;
    socket.send(JSON.stringify({ type: "challenge", version: RELAY_PROTOCOL_VERSION, nonce: serverNonce }));
    socket.on("message", (data) => {
      const transcript = answered
        ? null
        : helloTranscript(serverNonce, Buffer.from(rawDataBytes(data)).toString("utf8"));
      if (!transcript) return;
      answered = true;
      const signature = sign("sha256", Buffer.from(relayServerProofTranscript(transcript)), {
        key: proof.privateKey,
        dsaEncoding: "ieee-p1363",
      }).toString("base64url");
      socket.send(
        JSON.stringify({
          type: "server-proof",
          version: RELAY_PROTOCOL_VERSION,
          certificate: proof.certificate,
          signature,
        }),
      );
      if (transcript.role === "client" && transcript.target && openPeer) {
        socket.send(
          JSON.stringify({
            type: "open",
            version: RELAY_PROTOCOL_VERSION,
            connectionId: randomBytes(16).toString("base64url"),
            peer: { keyId: transcript.target, ...openPeer },
          }),
        );
        return;
      }
      socket.send(
        JSON.stringify({
          type: "welcome",
          version: RELAY_PROTOCOL_VERSION,
          self: { keyId: transcript.clientKeyId, user: "alice", device: "phone" },
          team: { id: "t".repeat(43), name: TEAM },
          members: [],
        }),
      );
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address !== "object") throw new Error("The fake relay has no port.");
  fake.url = `wss://localhost:${address.port}${RELAY_PATH}`;
  return fake;
}

async function startRelay(environment: Record<string, string>): Promise<Relay> {
  const log: string[] = [];
  const child = spawn("bun", [MAIN, "serve"], {
    cwd: ROOT,
    env: { ...process.env, ...environment },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = new Promise<void>((resolveExit) => child.once("exit", () => resolveExit()));
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

function runPhone(configPath: string): Promise<{ code: number | null; output: string }> {
  const child = spawn(process.execPath, ["--import", "tsx", PHONE, configPath], {
    cwd: ROOT,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output: string[] = [];
  child.stdout.on("data", (chunk: Buffer) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => output.push(chunk.toString()));
  return deadline(
    "the phone process ends",
    new Promise((resolveExit) => child.once("exit", (code) => resolveExit({ code, output: output.join("") }))),
  );
}

const testCipher: RelayCipher = {
  encrypt: (value) => Buffer.from(value, "utf8").reverse(),
  decrypt: (value) => Buffer.from(value).reverse().toString("utf8"),
};

const work = mkdtempSync(join(tmpdir(), "openbot-relay-mobile-e2e-"));
const dataDirectory = join(work, "data");
const foreignDirectory = join(work, "foreign");
const hostData = join(work, "host");
const fakeHome = join(work, "home");
const fakeCodex = join(work, "codex");
const fakeCodexLog = join(work, "codex.jsonl");
mkdirSync(fakeHome);
mkdirSync(OUT, { recursive: true });
process.env.HOME = fakeHome;
process.env.CODEX_HOME = join(fakeHome, ".codex");
process.env.OPENBOT_CODEX_PATH = fakeCodex;

writeFileSync(
  fakeCodex,
  `#!/usr/bin/env node
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

const [relayPort, healthPort, foreignPort, foreignHealthPort] = await Promise.all([
  freePort(),
  freePort(),
  freePort(),
  freePort(),
]);
const environment = {
  RELAY_DATA_DIR: dataDirectory,
  RELAY_HOST: "127.0.0.1",
  RELAY_PORT: String(relayPort),
  RELAY_HEALTH_PORT: String(healthPort),
  RELAY_PUBLIC_URL: `wss://localhost:${relayPort}${RELAY_PATH}`,
};
const foreignEnvironment = {
  RELAY_DATA_DIR: foreignDirectory,
  RELAY_HOST: "127.0.0.1",
  RELAY_PORT: String(foreignPort),
  RELAY_HEALTH_PORT: String(foreignHealthPort),
  RELAY_PUBLIC_URL: `wss://localhost:${foreignPort}${RELAY_PATH}`,
};

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
let database: OpenBotDatabaseInstance | null = null;
let agents: AgentServiceInstance | null = null;
let host: HostServiceInstance | null = null;
const closers: Array<() => void> = [];
let phoneFacts: PhoneReport["facts"] | null = null;
let phoneOutput = "";

try {
  await check("The certificate commands make a root, a localhost server identity, two teams and a foreign root", () => {
    assert.equal(command(environment, "ca", "init").status, 0);
    assert.equal(command(environment, "ca", "server", "--dns", "localhost", "--ip", "127.0.0.1").status, 0);
    assert.equal(command(environment, "ca", "team", "add", TEAM).status, 0);
    assert.equal(command(environment, "ca", "team", "add", OTHER_TEAM).status, 0);
    assert.equal(command(foreignEnvironment, "ca", "init").status, 0);
    assert.equal(command(foreignEnvironment, "ca", "server", "--dns", "localhost", "--ip", "127.0.0.1").status, 0);
  });

  const hostBundle = issue(environment, TEAM, HOST_USER, HOST_DEVICE);
  const phoneBundle = issue(environment, TEAM, "alice", "phone");
  const otherHostBundle = issue(environment, OTHER_TEAM, "eve", HOST_DEVICE);
  const serverTls = {
    cert: readFileSync(join(dataDirectory, "tls/server.crt"), "utf8"),
    key: readFileSync(join(dataDirectory, "tls/server.key"), "utf8"),
  };
  const serverRoot = readFileSync(join(dataDirectory, "ca/root.crt"), "utf8");

  relay = await startRelay(environment);

  database = new OpenBotDatabase(hostData);
  const agentStore = new AgentStore(hostData, fakeHome, database);
  const mailbox = new MailboxStore(hostData, agentStore.sharedRoot, agentStore.database);
  const sidebar = new SidebarLayoutStore(join(hostData, "sidebar-layout.json"));
  const team = new TeamStore(join(hostData, "openbot-team-server-v2.json"));
  await runCauseEffect(sidebar.initialize());
  await runCauseEffect(agentStore.initialize());
  await runCauseEffect(mailbox.initialize());
  await runCauseEffect(team.initialize());
  const fixture = await runCauseEffect(
    agentStore.createAgent({
      name: AGENT_NAME,
      description: "Synthetic agent for the phone relay check",
      avatarSeed: "relay-phone",
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
  const hostStore = new RelayIdentityStore({ path: join(work, "host-identity.json"), cipher: testCipher });
  await ok(hostStore.importBundle(hostBundle));
  await check("The host's fake Codex provider is ready", async () => {
    const providerStatus = await runCauseEffect(agentService.refreshProviders({ automatic: false }));
    assert.equal(providerStatus.phase, "ready");
  });
  await ok(hostService.startRelayHosting(hostStore, { reconnect: { baseMs: 100, maxMs: 500 } }));
  await until<void>("the host is online at the relay", (done) => {
    const listener = () => {
      if (hostService.getStatus().apiOnline) done();
    };
    hostService.on("changed", listener);
    listener();
    return () => hostService.off("changed", listener);
  });

  const foreignProof = await startFakeRelay(serverTls, {
    certificate: readFileSync(join(foreignDirectory, "tls/server.crt"), "utf8"),
    privateKey: createPrivateKey(readFileSync(join(foreignDirectory, "tls/server.key"), "utf8")),
  });
  closers.push(foreignProof.stop);
  const otherTeamPeer = await startFakeRelay(
    serverTls,
    { certificate: serverTls.cert, privateKey: createPrivateKey(serverTls.key) },
    { user: "eve", device: HOST_DEVICE, certificate: otherHostBundle.certificate },
  );
  closers.push(otherTeamPeer.stop);

  const fileBytes = randomBytes(FILE_BYTES);
  const phoneOut = join(work, "phone-report.json");
  const configPath = join(work, "phone-config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      phoneText: JSON.stringify(phoneBundle),
      wrongKeyText: JSON.stringify({ ...phoneBundle, privateKey: otherHostBundle.privateKey }),
      otherHostText: JSON.stringify(otherHostBundle),
      otherHostKeyId: keyIdOf(otherHostBundle.certificate),
      hostKeyId: keyIdOf(hostBundle.certificate),
      agentId: fixture.id,
      serverRoot,
      foreignProofRelayUrl: foreignProof.url,
      otherTeamPeerRelayUrl: otherTeamPeer.url,
      fileBase64: fileBytes.toString("base64"),
      out: phoneOut,
      waitMs: WAIT_MS / 2,
    }),
  );
  const phone = await runPhone(configPath);
  phoneOutput = phone.output;
  await check("The phone process ran to the end", () => {
    assert.equal(phone.code, 0, phone.output.slice(-4000));
  });
  const phoneReport: PhoneReport = JSON.parse(readFileSync(phoneOut, "utf8"));
  assert.ok(Array.isArray(phoneReport.checks), "The phone report is not valid.");
  phoneFacts = phoneReport.facts;
  for (const entry of phoneReport.checks) {
    if (!isDynamicRecord(entry) || !isString(entry.name) || typeof entry.passed !== "boolean") continue;
    checks.push({
      name: `Phone: ${entry.name}`,
      passed: entry.passed,
      ...(isString(entry.error) ? { error: entry.error } : {}),
    });
  }

  await check("The host provider got the phone's message", () => {
    assert.ok(readFileSync(fakeCodexLog, "utf8").includes("Hello from the phone over the relay"));
  });

  await check("The client stopped after server_refused: one connection to the fake relay, no retry", () => {
    assert.equal(foreignProof.connections, 1);
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
writeFileSync(
  join(OUT, "report.json"),
  `${JSON.stringify(
    {
      passed: failedChecks.length === 0,
      runtime: `node ${process.version}`,
      phoneRuntime: "node without crypto.subtle, React Native-like WebSocket shim (binaryType arraybuffer)",
      checks,
      phoneFacts,
      ...(failedChecks.length === 0
        ? {}
        : { relayLog: relay?.log.join("") ?? "", phoneOutput: phoneOutput.slice(-8000) }),
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
