import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  type KeyObject,
  randomBytes,
  sign,
  X509Certificate,
} from "node:crypto";
import { EventEmitter, once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { inspect } from "node:util";
import { AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import {
  type RelayServerProofTranscriptInput,
  relayServerProofTranscript,
} from "@openbot/contracts/relay-protocol/hub";
import { decodeRelayIdentityBundle, type RelayIdentityBundle } from "@openbot/contracts/relay-protocol/identity-bundle";
import { RELAY_PATH, RELAY_PROTOCOL_VERSION } from "@openbot/contracts/relay-protocol/messages";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import type { TeamProtocolV2Json } from "@openbot/contracts/team-protocol";
import { RelayHubClient, webRelayCrypto } from "@openbot/team-client/relay-client";
import type { RemoteTeamCommandResult } from "@openbot/team-client/remote-peer";
import { Effect, Result } from "effect";
import { type Browser, chromium, type Page } from "playwright-core";
import { WebSocketServer, WebSocket as WsSocket } from "ws";
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
const OUT = resolve(ROOT, ".openbot-build/relay-browser-client-e2e");
const MAIN = resolve(ROOT, "remote/api/src/relay/main.ts");
const PAGE_ENTRY = resolve(ROOT, "scripts/relay-browser-client-e2e-page.ts");
const WAIT_MS = 45_000;
const READY_LINE = "OpenBot relay is ready";
const APP_VERSION = "0.0.0-e2e";
const TEAM = "Acme";
const FILE_BYTES = 150 * 1024 + 7;

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

function spkiDigest(certificate: string, encoding: "base64" | "base64url"): string {
  const spki = new X509Certificate(certificate).publicKey.export({ type: "spki", format: "der" });
  return createHash("sha256").update(spki).digest(encoding);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
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

interface FakeRelay {
  url: string;
  connections: number;
  closedCount: number;
  closed: EventEmitter<{ closed: [] }>;
  stop: () => void;
}

interface FakeRelayBehavior {
  proof: { certificate: string; privateKey: KeyObject };
  rosterMember?: {
    user: string;
    device: string | null;
    certificate: string;
    messageKey: string;
    messageKeySignature: string;
  };
}

function helloTranscript(text: string): RelayServerProofTranscriptInput | null {
  const hello = JSON.parse(text);
  if (!isDynamicRecord(hello) || !isString(hello.certificate) || !isString(hello.clientNonce)) return null;
  if (!isString(hello.audience) || hello.type !== "hello") return null;
  return {
    clientNonce: hello.clientNonce,
    audience: hello.audience,
    clientKeyId: spkiDigest(hello.certificate, "base64url"),
  };
}

async function startFakeRelay(tls: { cert: string; key: string }, behavior: FakeRelayBehavior): Promise<FakeRelay> {
  const server = createHttpsServer(tls);
  const sockets = new WebSocketServer({ server, path: RELAY_PATH });
  const fake: FakeRelay = {
    url: "",
    connections: 0,
    closedCount: 0,
    closed: new EventEmitter<{ closed: [] }>(),
    stop: () => {
      for (const client of sockets.clients) client.terminate();
      sockets.close();
      server.close();
    },
  };
  sockets.on("connection", (socket) => {
    fake.connections += 1;
    let answered = false;
    socket.on("message", (data) => {
      const text = Buffer.from(rawDataBytes(data)).toString("utf8");
      const transcript = answered ? null : helloTranscript(text);
      if (!transcript) return;
      answered = true;
      const signature = sign("sha256", Buffer.from(relayServerProofTranscript(transcript)), {
        key: behavior.proof.privateKey,
        dsaEncoding: "ieee-p1363",
      }).toString("base64url");
      socket.send(
        JSON.stringify({
          type: "server-proof",
          version: RELAY_PROTOCOL_VERSION,
          certificate: behavior.proof.certificate,
          signature,
        }),
      );
      socket.send(
        JSON.stringify({
          type: "welcome",
          version: RELAY_PROTOCOL_VERSION,
          self: {
            keyId: transcript.clientKeyId,
            user: "alice",
            device: "browser",
            label: null,
            hosting: false,
            capabilities: [],
            suspendable: false,
            certificate: "fake",
            messageKey: "A".repeat(87),
            messageKeySignature: "A",
            keyTimestamp: 0,
            connectedAt: 0,
            lastHeardAt: 0,
          },
          team: { id: "t".repeat(43), name: TEAM },
          roster: behavior.rosterMember
            ? [
                {
                  keyId: spkiDigest(behavior.rosterMember.certificate, "base64url"),
                  user: behavior.rosterMember.user,
                  device: behavior.rosterMember.device,
                  label: null,
                  hosting: true,
                  capabilities: [],
                  suspendable: false,
                  certificate: behavior.rosterMember.certificate,
                  messageKey: behavior.rosterMember.messageKey,
                  messageKeySignature: behavior.rosterMember.messageKeySignature,
                  keyTimestamp: Date.now(),
                  connectedAt: Date.now(),
                  lastHeardAt: Date.now(),
                },
              ]
            : [],
        }),
      );
    });
    socket.on("close", () => {
      fake.closedCount += 1;
      fake.closed.emit("closed");
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address !== "object") throw new Error("The fake relay has no port.");
  fake.url = `wss://127.0.0.1:${address.port}${RELAY_PATH}`;
  return fake;
}

function untilFakeClosed(fake: FakeRelay, count: number): Promise<void> {
  return until("the fake relay sees the sockets close", (done) => {
    const listener = () => {
      if (fake.closedCount >= count) done(undefined);
    };
    fake.closed.on("closed", listener);
    listener();
    return () => fake.closed.off("closed", listener);
  });
}

function startPageServer(script: string): Promise<{ server: Server; origin: string }> {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Relay browser client</title></head>
<body style="font-family: system-ui; margin: 24px"><h1>Relay browser client E2E</h1>
<input id="identity-file" type="file" accept="application/json"><pre id="log"></pre>
<script type="module" src="/page.js"></script></body></html>`;
  const server = createHttpServer((request, response) => {
    if (request.url === "/page.js") {
      response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      response.end(script);
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(html);
  });
  return new Promise((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address !== "object") reject(new Error("The page server has no port."));
      else resolveServer({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

function bundlePage(): string {
  const outfile = join(work, "page.js");
  const result = spawnSync("bun", ["build", PAGE_ENTRY, "--target=browser", "--format=esm", `--outfile=${outfile}`], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  return readFileSync(outfile, "utf8");
}

function bodyOf(result: RemoteTeamCommandResult): TeamProtocolV2Json {
  assert.ok(result.ok && result.body !== undefined, `The request failed: ${result.error ?? "no body"}`);
  return result.body;
}

const work = mkdtempSync(join(tmpdir(), "openbot-relay-browser-client-e2e-"));
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

const [relayPort, healthPort, foreignPort, foreignHealthPort] = await Promise.all([
  freePort(),
  freePort(),
  freePort(),
  freePort(),
]);
const relayUrl = `wss://127.0.0.1:${relayPort}${RELAY_PATH}`;
const environment = {
  RELAY_DATA_DIR: dataDirectory,
  RELAY_HOST: "127.0.0.1",
  RELAY_PORT: String(relayPort),
  RELAY_HEALTH_PORT: String(healthPort),
  RELAY_PUBLIC_URL: relayUrl,
};
const foreignEnvironment = {
  RELAY_DATA_DIR: foreignDirectory,
  RELAY_HOST: "127.0.0.1",
  RELAY_PORT: String(foreignPort),
  RELAY_HEALTH_PORT: String(foreignHealthPort),
  RELAY_PUBLIC_URL: `wss://127.0.0.1:${foreignPort}${RELAY_PATH}`,
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
let browser: Browser | null = null;
let page: Page | null = null;
const closers: Array<() => void> = [];

try {
  await check("The certificate commands make a root, a server identity, two teams and a foreign root", () => {
    assert.equal(command(environment, "ca", "init").status, 0);
    assert.equal(command(environment, "ca", "server", "--dns", "localhost", "--ip", "127.0.0.1").status, 0);
    assert.equal(command(environment, "ca", "team", "add", TEAM).status, 0);
    assert.equal(command(environment, "ca", "team", "add", "Other").status, 0);
    assert.equal(command(foreignEnvironment, "ca", "init").status, 0);
    assert.equal(command(foreignEnvironment, "ca", "server", "--dns", "localhost", "--ip", "127.0.0.1").status, 0);
  });

  const hostBundle = issue(environment, TEAM, "host-user", "server");
  const aliceBundle = issue(environment, TEAM, "alice", "browser");
  const eveBundle = issue(environment, "Other", "eve", "server");
  const hostKeyId = spkiDigest(hostBundle.certificate, "base64url");
  const aliceKeyId = spkiDigest(aliceBundle.certificate, "base64url");
  const eveKeyId = spkiDigest(eveBundle.certificate, "base64url");
  const serverTls = {
    cert: readFileSync(join(dataDirectory, "tls/server.crt"), "utf8"),
    key: readFileSync(join(dataDirectory, "tls/server.key"), "utf8"),
  };

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
      name: "Relay browser fixture",
      description: "Synthetic agent for the browser relay client check",
      avatarSeed: "relay-browser-client",
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
  await ok(hostService.startRelayHosting(hostStore, { reconnect: { baseMs: 100, maxMs: 500 } }));
  await until<void>("the host is online at the relay", (done) => {
    const listener = () => {
      if (hostService.getStatus().apiOnline) done();
    };
    hostService.on("changed", listener);
    listener();
    return () => hostService.off("changed", listener);
  });

  const script = bundlePage();
  const pageServer = await startPageServer(script);
  closers.push(() => pageServer.server.close());
  browser = await chromium.launch({
    args: [`--ignore-certificate-errors-spki-list=${spkiDigest(serverTls.cert, "base64")}`],
  });
  const openPage = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  page = openPage;
  const pageErrors: string[] = [];
  openPage.on("pageerror", (error) => pageErrors.push(error.message));
  await openPage.goto(pageServer.origin);
  await openPage.waitForFunction(() => "relayBrowserTest" in window);
  const aliceText = JSON.stringify(aliceBundle);

  await check("A pasted identity imports with a key that cannot be exported", async () => {
    const imported = await deadline(
      "the text import",
      openPage.evaluate((text) => window.relayBrowserTest.importText(text), aliceText),
    );
    assert.deepEqual(
      [imported.keyId, imported.team, imported.user, imported.device, imported.extractable, imported.exportRefused],
      [aliceKeyId, TEAM, "alice", "browser", false, true],
    );
  });

  await check("A picked identity file imports the same identity", async () => {
    const file = join(work, "alice-identity.json");
    writeFileSync(file, aliceText);
    await openPage.setInputFiles("#identity-file", file);
    const imported = await deadline(
      "the file import",
      openPage.evaluate(() => window.relayBrowserTest.importFile()),
    );
    assert.deepEqual([imported.keyId, imported.exportRefused], [aliceKeyId, true]);
  });

  await check("The identity is saved in IndexedDB and stays not exportable after a page load", async () => {
    await deadline(
      "the save",
      openPage.evaluate(() => window.relayBrowserTest.saveIdentity()),
    );
    await openPage.reload();
    await openPage.waitForFunction(() => "relayBrowserTest" in window);
    const loaded = await deadline(
      "the load",
      openPage.evaluate(() => window.relayBrowserTest.loadIdentity()),
    );
    assert.ok(loaded, "The saved identity must load.");
    assert.deepEqual([loaded.keyId, loaded.extractable, loaded.exportRefused], [aliceKeyId, false, true]);
  });

  await check("The control goes online and the roster shows the host", async () => {
    await openPage.evaluate(() => window.relayBrowserTest.startControl());
    const hosts = await deadline(
      "the host in the roster",
      openPage.evaluate((key) => window.relayBrowserTest.waitForHost(key), hostKeyId),
    );
    assert.ok(hosts.includes(hostKeyId), inspect(hosts));
    assert.equal(hosts.includes(aliceKeyId), false);
  });

  await check("A V2 peer over the relay connects and lists the host's agents", async () => {
    const connected = await deadline(
      "the connect",
      openPage.evaluate((key) => window.relayBrowserTest.connect(key), hostKeyId),
    );
    assert.ok(connected.ok, connected.error);
    const compatibility = await deadline(
      "the compatibility request",
      openPage.evaluate((path) => window.relayBrowserTest.request("GET", path, null), TEAM_API_ROUTES.compatibility),
    );
    assert.equal(compatibility.status, 200, compatibility.error);
    const listed = await deadline(
      "the agent list",
      openPage.evaluate((path) => window.relayBrowserTest.request("GET", path, null), TEAM_API_ROUTES.agents.all),
    );
    assert.equal(listed.status, 200, listed.error);
    assert.ok(JSON.stringify(bodyOf(listed)).includes(fixture.id), inspect(listed.body));
  });

  await check("A message to the agent gets its reply event through the relay", async () => {
    const text = `Browser relay check ${randomBytes(4).toString("hex")}`;
    const reply = openPage.evaluate((id) => window.relayBrowserTest.waitForEvent([id, "Done."]), fixture.id);
    const sent = await deadline(
      "the message",
      openPage.evaluate(({ path, body }) => window.relayBrowserTest.request("POST", path, body), {
        path: TEAM_API_ROUTES.agent.messages(fixture.id),
        body: { agentId: fixture.id, text, timezone: "UTC" },
      }),
    );
    assert.ok(sent.ok && (sent.status ?? 0) >= 200 && (sent.status ?? 0) < 300, inspect(sent));
    assert.ok((await deadline("the reply event", reply)) >= 0);
    assert.ok(readFileSync(fakeCodexLog, "utf8").includes(text), "The host provider did not get the message.");
  });

  await check("A file goes up and comes back with the same hash", async () => {
    const bytes = new Uint8Array(randomBytes(FILE_BYTES));
    const uploaded = await deadline(
      "the upload",
      openPage.evaluate(
        ({ path, base64 }) =>
          window.relayBrowserTest.upload(path, "relay-browser.bin", "application/octet-stream", base64),
        {
          path: `${TEAM_API_ROUTES.attachments}?name=relay-browser.bin&mime=application%2Foctet-stream`,
          base64: Buffer.from(bytes).toString("base64"),
        },
      ),
    );
    assert.equal(uploaded.status, 201, inspect(uploaded));
    const body = bodyOf(uploaded);
    assert.ok(isDynamicRecord(body) && isString(body.id), inspect(body));
    const downloaded = await deadline(
      "the download",
      openPage.evaluate(
        (path) => window.relayBrowserTest.request("GET", path, null),
        TEAM_API_ROUTES.attachment(body.id),
      ),
    );
    const file = bodyOf(downloaded);
    assert.ok(isDynamicRecord(file) && isString(file.base64), inspect(downloaded).slice(0, 400));
    assert.equal(sha256(Buffer.from(file.base64, "base64")), sha256(bytes));
  });

  await openPage.screenshot({ path: join(OUT, "page.png"), fullPage: true });

  await check("A server identity from another root is refused with server_refused and no retry", async () => {
    const foreignProof = {
      certificate: readFileSync(join(foreignDirectory, "tls/server.crt"), "utf8"),
      privateKey: createPrivateKey(readFileSync(join(foreignDirectory, "tls/server.key"), "utf8")),
    };
    const fake = await startFakeRelay(serverTls, { proof: foreignProof });
    closers.push(fake.stop);
    const states = await deadline(
      "the control at the fake relay",
      openPage.evaluate(
        (text) => window.relayBrowserTest.controlStates(text),
        JSON.stringify({ ...aliceBundle, relayUrl: fake.url }),
      ),
    );
    await untilFakeClosed(fake, 1);
    const final = states.at(-1);
    assert.deepEqual(
      [
        final?.status,
        final?.status === "offline" ? final.code : null,
        final?.status === "offline" ? final.retryInMs : 0,
      ],
      ["offline", "server_refused", null],
    );
    assert.ok(final?.status === "offline" && final.message.includes("(untrusted)"), inspect(final));
    assert.deepEqual(
      states.map((state) => state.status),
      ["connecting", "offline"],
    );
    assert.equal(fake.connections, 1);
  });

  await check("A host of another team is not in the roster and the page cannot reach it", async () => {
    const eveKey = createPrivateKey(eveBundle.privateKey);
    const eve = new RelayHubClient({
      identity: {
        relayUrl: eveBundle.relayUrl,
        team: eveBundle.team,
        keyId: eveKeyId,
        certificate: eveBundle.certificate,
        chain: eveBundle.chain,
        root: eveBundle.root,
      },
      sign: async (data) => sign("sha256", data, { key: eveKey, dsaEncoding: "ieee-p1363" }),
      crypto: webRelayCrypto,
      hosting: true,
      openSocket: (url, events) => {
        const socket = new WsSocket(url, { ca: eveBundle.root });
        socket.on("open", () => events.open());
        socket.on("message", (data, binary) => {
          const bytes = rawDataBytes(data);
          if (binary) events.binary(new Uint8Array(bytes));
          else events.text(Buffer.from(bytes).toString("utf8"));
        });
        socket.on("close", (code, reason) => events.closed(code, reason.toString("utf8")));
        socket.on("error", () => undefined);
        return {
          get bufferedAmount() {
            return socket.bufferedAmount;
          },
          send: (data) => socket.send(data),
          close: (code, reason) => socket.close(code, reason),
        };
      },
    });
    eve.start();
    closers.push(() => eve.stop());
    await deadline(
      "the other team's host online",
      new Promise<void>((resolveOnline) => {
        const stop = eve.subscribe((snapshot) => {
          if (snapshot.state.status !== "online") return;
          stop();
          resolveOnline();
        });
      }),
    );
    assert.equal(await openPage.evaluate((keyId) => window.relayBrowserTest.rosterHas(keyId), eveKeyId), false);
    const refusal = await deadline(
      "the dial to the other team's host",
      openPage.evaluate((target) => window.relayBrowserTest.dialMain(target), eveKeyId),
    );
    assert.ok(refusal.startsWith("host_offline:"), refusal);
    eve.stop();
  });

  await check(
    "A roster member whose message key is not signed by its certificate is refused (fake server)",
    async () => {
      const { publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
      const jwk = publicKey.export({ format: "jwk" });
      const point = Buffer.concat([
        Buffer.from([4]),
        Buffer.from(String(jwk.x), "base64url"),
        Buffer.from(String(jwk.y), "base64url"),
      ]);
      const fake = await startFakeRelay(serverTls, {
        proof: { certificate: serverTls.cert, privateKey: createPrivateKey(serverTls.key) },
        rosterMember: {
          user: "host-user",
          device: "server",
          certificate: hostBundle.certificate,
          messageKey: point.toString("base64url"),
          messageKeySignature: randomBytes(64).toString("base64url"),
        },
      });
      closers.push(fake.stop);
      const refusal = await deadline(
        "the dial at the fake relay",
        openPage.evaluate(({ text, target }) => window.relayBrowserTest.dialFailure(text, target), {
          text: JSON.stringify({ ...aliceBundle, relayUrl: fake.url }),
          target: spkiDigest(hostBundle.certificate, "base64url"),
        }),
      );
      assert.ok(refusal.startsWith("peer_refused:"), refusal);
      assert.ok(fake.connections >= 1);
    },
  );

  await check("A bundle with a wrong private key or a key of another type is refused at import", async () => {
    const wrongKey = await openPage.evaluate(
      (text) => window.relayBrowserTest.importFailure(text),
      JSON.stringify({ ...aliceBundle, privateKey: eveBundle.privateKey }),
    );
    assert.equal(wrongKey, "key_mismatch");
    const ed25519 = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const otherType = await openPage.evaluate(
      (text) => window.relayBrowserTest.importFailure(text),
      JSON.stringify({ ...aliceBundle, privateKey: ed25519 }),
    );
    assert.equal(otherType, "unsupported_key");
    const foreignRoot = await openPage.evaluate(
      (text) => window.relayBrowserTest.importFailure(text),
      JSON.stringify({ ...aliceBundle, root: readFileSync(join(foreignDirectory, "ca/root.crt"), "utf8") }),
    );
    assert.equal(foreignRoot, "untrusted_chain");
  });

  await check("The saved identity is removed", async () => {
    assert.equal(await openPage.evaluate(() => window.relayBrowserTest.removeIdentity()), true);
    await deadline(
      "the stop",
      openPage.evaluate(() => window.relayBrowserTest.stopAll()),
    );
  });

  await check("The page had no errors", () => {
    assert.deepEqual(pageErrors, []);
  });
} finally {
  if (page) await page.screenshot({ path: join(OUT, "page-final.png"), fullPage: true }).catch(() => undefined);
  await browser?.close().catch(() => undefined);
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
      browser: "chromium (playwright-core)",
      screenshot: join(OUT, "page.png"),
      checks,
      ...(failedChecks.length === 0 ? {} : { relayLog: relay?.log.join("") ?? "" }),
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
