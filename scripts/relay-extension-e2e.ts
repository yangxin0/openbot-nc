import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes, X509Certificate } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { inspect } from "node:util";
import { AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import { decodeRelayIdentityBundle, type RelayIdentityBundle } from "@openbot/contracts/relay-protocol/identity-bundle";
import { RELAY_PATH } from "@openbot/contracts/relay-protocol/messages";
import type { ClientBrowserPresence } from "@openbot/contracts/team-protocol/client-browser-v1";
import { translateFor } from "@openbot/i18n";
import { Effect, Result } from "effect";
import { type BrowserContext, chromium, type Page } from "playwright-core";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { AgentService as AgentServiceInstance } from "../src/backend/agent-service";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { OpenBotDatabase as OpenBotDatabaseInstance } from "../src/backend/openbot-database";
import { ClientBrowserHub } from "../src/main/client-browser-hub";
import type { HostService as HostServiceInstance } from "../src/main/host-service";
import type { LocalProfile } from "../src/main/local-profile-store";
import { type RelayCipher, RelayIdentityStore } from "../src/main/relay/identity-store";
import type { TeamApiBrowser } from "../src/main/team-api/dependencies";

declare global {
  interface Window {
    reportCspViolation?: (text: string) => void;
  }
}

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, ".openbot-build/relay-extension-e2e");
const EXTENSION = resolve(ROOT, ".openbot-build/browser-extension");
const MAIN = resolve(ROOT, "remote/api/src/relay/main.ts");
const WAIT_MS = 60_000;
const READY_LINE = "OpenBot relay is ready";
const APP_VERSION = "0.0.0-e2e";
const TEAM = "Acme";
const HOST_USER = "host-user";
const HOST_DEVICE = "server";
const AGENT_NAME = "Relay extension fixture";
const PROMPT = "Hello from the extension over the relay";
const VIEWPORT = { width: 400, height: 760 };
const RUN = randomBytes(3).toString("hex");
const SHARED_TITLE = `Shared tab ${RUN}`;
const english = translateFor("en");

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

function issue(environment: Record<string, string>, user: string, device: string): RelayIdentityBundle {
  const file = join(work, `${randomBytes(6).toString("hex")}.json`);
  const result = command(environment, "ca", "issue", "--team", TEAM, "--user", user, "--device", device, "--out", file);
  assert.equal(result.status, 0, result.output);
  const bundle = decodeRelayIdentityBundle(JSON.parse(readFileSync(file, "utf8")));
  assert.ok(bundle, "The identity file must decode.");
  return bundle;
}

function joinCode(user: string, device: string): string {
  const result = command(environment, "ca", "code", "--team", TEAM, "--user", user, "--device", device);
  assert.equal(result.status, 0, result.output);
  const line = result.output.split("\n").find((entry) => entry.trim().startsWith("openbot-nc://enroll?"));
  assert.ok(line, "ca code must print a join code.");
  return line.trim();
}

function spkiDigest(certificate: string): string {
  const spki = new X509Certificate(certificate).publicKey.export({ type: "spki", format: "der" });
  return createHash("sha256").update(spki).digest("base64");
}

interface ExtensionManifest {
  name?: unknown;
  action?: { default_title?: unknown };
  permissions?: unknown;
  host_permissions?: unknown;
  externally_connectable?: unknown;
  content_scripts?: unknown;
}

function buildExtension(): ExtensionManifest {
  const result = spawnSync("bun", ["run", "extension:build"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  const manifestPath = join(EXTENSION, "manifest.json");
  assert.ok(existsSync(manifestPath), "The build must write manifest.json.");
  const manifest: ExtensionManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  return manifest;
}

function vendorFiles(directory: string): string[] {
  const listing = spawnSync("grep", ["-rlE", "openbot\\.run|nightly-labs|openpanel", directory], { encoding: "utf8" });
  return listing.stdout.split("\n").filter(Boolean);
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

interface ReportFacts {
  manifest?: ExtensionManifest;
  extensionId?: string;
  serverName?: string;
  snapshotStart?: string;
}

interface PageWatch {
  errors: string[];
  violations: string[];
  requests: string[];
}

function watchPage(page: Page, watch: PageWatch): void {
  page.on("pageerror", (error) => watch.errors.push(`pageerror ${page.url()}: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") watch.errors.push(`console ${page.url()}: ${message.text()}`);
  });
}

function sharedPageServer(): Promise<{ server: Server; url: string }> {
  const server = createHttpServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(
      `<!doctype html><html><head><meta charset="utf-8"><title>${SHARED_TITLE}</title></head><body><h1>${SHARED_TITLE}</h1><p>A page for the extension check.</p></body></html>`,
    );
  });
  return new Promise((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address !== "object") {
        reject(new Error("No port."));
        return;
      }
      resolveServer({ server, url: `http://127.0.0.1:${address.port}/shared` });
    });
  });
}

class WatchedClientBrowserHub extends ClientBrowserHub {
  readonly members = new Set<string>();
  readonly #listeners = new Set<(memberId: string, presence: ClientBrowserPresence) => void>();

  override setPresence(memberId: string, sessionId: string, presence: ClientBrowserPresence): void {
    super.setPresence(memberId, sessionId, presence);
    this.members.add(memberId);
    for (const listener of [...this.#listeners]) listener(memberId, presence);
  }

  onPresence(listener: (memberId: string, presence: ClientBrowserPresence) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

const identityHeading = (page: Page) => page.getByRole("heading", { name: english("webClient.identity.title") });
const agentRow = (page: Page) => page.getByRole("button", { name: new RegExp(AGENT_NAME, "u") }).first();

const work = mkdtempSync(join(tmpdir(), "openbot-relay-extension-e2e-"));
const dataDirectory = join(work, "data");
const hostData = join(work, "host");
const fakeHome = join(work, "home");
const fakeCodex = join(work, "codex");
const fakeCodexLog = join(work, "codex.jsonl");
const profile = join(work, "chromium-profile");
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

const [relayPort, healthPort] = await Promise.all([freePort(), freePort()]);
const environment = {
  RELAY_DATA_DIR: dataDirectory,
  RELAY_HOST: "127.0.0.1",
  RELAY_PORT: String(relayPort),
  RELAY_HEALTH_PORT: String(healthPort),
  RELAY_PUBLIC_URL: `wss://localhost:${relayPort}${RELAY_PATH}`,
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
let context: BrowserContext | null = null;
let sharedServer: Server | null = null;
let panel: Page | null = null;
const hub = new WatchedClientBrowserHub();
const watch: PageWatch = { errors: [], violations: [], requests: [] };
const screenshots: string[] = [];
const facts: ReportFacts = {};

async function screenshot(target: Page, name: string): Promise<void> {
  const path = join(OUT, name);
  await target.waitForFunction(
    () =>
      document
        .getAnimations()
        .every(
          (animation) => animation.playState !== "running" || animation.effect?.getTiming().iterations === Infinity,
        ),
    undefined,
    { timeout: WAIT_MS },
  );
  await target.screenshot({ path });
  screenshots.push(path);
}

try {
  let manifest: ExtensionManifest = {};
  await check(
    "The extension builds into .openbot-build/browser-extension as OpenBot-NC with no vendor permission",
    () => {
      manifest = buildExtension();
      facts.manifest = manifest;
      assert.equal(manifest.name, "OpenBot-NC");
      assert.equal(manifest.action?.default_title, "OpenBot-NC");
      assert.ok(Array.isArray(manifest.permissions));
      assert.ok(!manifest.permissions.includes("identity"), "The identity permission must be gone.");
      assert.equal(manifest.host_permissions, undefined);
      assert.equal(manifest.externally_connectable, undefined);
      assert.equal(manifest.content_scripts, undefined);
      assert.deepEqual(vendorFiles(EXTENSION), []);
    },
  );

  await check("The certificate commands make a root, a localhost server identity and a team", () => {
    assert.equal(command(environment, "ca", "init").status, 0);
    assert.equal(command(environment, "ca", "server", "--dns", "localhost", "--ip", "127.0.0.1").status, 0);
    assert.equal(command(environment, "ca", "team", "add", TEAM).status, 0);
  });

  const hostBundle = issue(environment, HOST_USER, HOST_DEVICE);
  const aliceBundle = issue(environment, "alice", "extension");
  const bobBundle = issue(environment, "bob", "extension");
  const serverCertificate = readFileSync(join(dataDirectory, "tls/server.crt"), "utf8");

  relay = await startRelay(environment);
  const shared = await sharedPageServer();
  sharedServer = shared.server;

  database = new OpenBotDatabase(hostData);
  const agentStore = new AgentStore(hostData, fakeHome, database);
  const mailbox = new MailboxStore(hostData, agentStore.sharedRoot, agentStore.database);
  const sidebar = new SidebarLayoutStore(join(hostData, "sidebar-layout.json"));
  const team = new TeamStore(join(hostData, "openbot-team-server-v2.json"));
  await runCauseEffect(sidebar.initialize());
  await runCauseEffect(agentStore.initialize());
  await runCauseEffect(mailbox.initialize());
  await runCauseEffect(team.initialize());
  await runCauseEffect(
    agentStore.createAgent({
      name: AGENT_NAME,
      description: "Synthetic agent for the extension relay check",
      avatarSeed: "relay-extension",
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
    clientBrowser: hub,
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

  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    viewport: VIEWPORT,
    args: [
      `--disable-extensions-except=${EXTENSION}`,
      `--load-extension=${EXTENSION}`,
      `--ignore-certificate-errors-spki-list=${spkiDigest(serverCertificate)}`,
    ],
  });
  const browserContext = context;
  browserContext.on("request", (request) => {
    const url = URL.parse(request.url());
    if (!url || ["chrome-extension:", "data:", "blob:"].includes(url.protocol)) return;
    if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") watch.requests.push(request.url());
  });
  await browserContext.exposeBinding("reportCspViolation", (_source, text: string) => watch.violations.push(text));
  await browserContext.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      window.reportCspViolation?.(
        `${event.violatedDirective} ${event.blockedURI} ${event.sourceFile}:${event.lineNumber}:${event.columnNumber}`,
      );
    });
  });
  const worker =
    browserContext.serviceWorkers()[0] ?? (await browserContext.waitForEvent("serviceworker", { timeout: WAIT_MS }));
  const extensionId = new URL(worker.url()).host;
  facts.extensionId = extensionId;
  const panelUrl = `chrome-extension://${extensionId}/sidepanel.html`;

  async function openPanel(): Promise<Page> {
    const page = await browserContext.newPage();
    watchPage(page, watch);
    await page.goto(panelUrl);
    return page;
  }

  const firstPanel = await openPanel();
  panel = firstPanel;

  await check("The side panel shows the identity screen", async () => {
    await identityHeading(firstPanel).waitFor({ timeout: WAIT_MS });
    await firstPanel.getByText(english("extension.identity.description")).waitFor({ timeout: WAIT_MS });
    await screenshot(firstPanel, "identity.png");
  });

  const pasteField = (page: Page) => page.getByRole("textbox", { name: english("webClient.identity.pasteLabel") });
  const importButton = (page: Page) => page.getByRole("button", { name: english("webClient.identity.import") });

  await check("A wrong paste shows the identity error", async () => {
    await pasteField(firstPanel).fill(JSON.stringify({ version: 1, certificate: "not a certificate" }));
    await importButton(firstPanel).click();
    await firstPanel
      .getByRole("alert")
      .filter({ hasText: english("error.remote.relayIdentityInvalid") })
      .waitFor({ timeout: WAIT_MS });
    await screenshot(firstPanel, "identity-error.png");
  });

  await check("A pasted identity shows the host and its agent list", async () => {
    await pasteField(firstPanel).fill(JSON.stringify(aliceBundle));
    await importButton(firstPanel).click();
    await agentRow(firstPanel).waitFor({ timeout: WAIT_MS });
    const serverName = (await firstPanel.locator(".ph-server-name").textContent())?.trim() ?? "";
    facts.serverName = serverName;
    assert.ok(serverName.length > 0, "The server name must show.");
    await firstPanel.getByRole("button", { name: english("extension.home.serverMenu") }).click();
    await firstPanel.getByRole("menuitem", { name: serverName }).waitFor({ timeout: WAIT_MS });
    await screenshot(firstPanel, "home.png");
    await firstPanel.getByRole("button", { name: english("extension.home.serverMenu") }).click();
  });

  await check("A message to the agent gets the agent's reply", async () => {
    await agentRow(firstPanel).click();
    const composer = firstPanel.getByRole("textbox", { name: english("extension.chat.ask", { name: AGENT_NAME }) });
    await composer.waitFor({ timeout: WAIT_MS });
    await composer.fill(PROMPT);
    await composer.press("Enter");
    await firstPanel.getByText(PROMPT, { exact: true }).first().waitFor({ timeout: WAIT_MS });
    await firstPanel.getByText("Done.", { exact: true }).first().waitFor({ timeout: WAIT_MS });
    assert.match(readFileSync(fakeCodexLog, "utf8"), new RegExp(PROMPT, "u"));
    await screenshot(firstPanel, "conversation.png");
    await firstPanel
      .getByRole("button", { name: english("common.back") })
      .first()
      .click();
  });

  await check("Browser sharing for agents reads the shared tab through the relay", async () => {
    const presence = until<{ memberId: string; tabId: string }>("the shared tab reaches the host", (done) =>
      hub.onPresence((memberId, value) => {
        const tab = value.tabs.find((entry) => entry.title === SHARED_TITLE);
        if (value.sharing && tab) done({ memberId, tabId: tab.id });
      }),
    );
    const tabPage = await browserContext.newPage();
    watchPage(tabPage, watch);
    await tabPage.goto(shared.url);
    const { memberId, tabId } = await presence;
    const chrome = hub.tabs(memberId)?.find((entry) => entry.tabs.some((tab) => tab.id === tabId))?.chrome;
    assert.ok(chrome, "The host must list the shared Chrome.");
    const agent = agentService.listAgents().find((entry) => entry.name === AGENT_NAME);
    assert.ok(agent, "The fixture agent must exist.");
    const call = Effect.runPromise(
      Effect.result(hub.call(memberId, chrome, { id: agent.id, name: AGENT_NAME }, { kind: "snapshot", tabId })),
    );
    await firstPanel.bringToFront();
    await firstPanel
      .getByRole("button", { name: english("extension.browser.ask.allowOnce") })
      .click({ timeout: WAIT_MS });
    const answer = await deadline("the snapshot command answers", call);
    if (Result.isFailure(answer)) throw new Error(`The snapshot failed: ${inspect(answer.failure)}`);
    facts.snapshotStart = answer.success.text.slice(0, 200);
    assert.match(answer.success.text, new RegExp(SHARED_TITLE, "u"));
    await tabPage.close();
  });

  await check("Reopening the side panel keeps the identity", async () => {
    await firstPanel.close();
    const reopened = await openPanel();
    panel = reopened;
    await agentRow(reopened).waitFor({ timeout: WAIT_MS });
    assert.equal(await identityHeading(reopened).count(), 0);
  });

  await check(
    "Settings show the identity, and Remove identity with a confirm step returns to the identity screen",
    async () => {
      const page = panel;
      assert.ok(page);
      await page.getByRole("button", { name: english("extension.home.serverMenu") }).click();
      await page.getByRole("menuitem", { name: english("extension.home.settings") }).click();
      await page.getByText("alice", { exact: true }).waitFor({ timeout: WAIT_MS });
      await page.getByText(english("settings.team.connection.online"), { exact: true }).waitFor({ timeout: WAIT_MS });
      await screenshot(page, "settings.png");
      await page.getByRole("button", { name: english("settings.team.remove.title") }).click();
      const confirm = page.getByRole("region", { name: english("settings.team.remove.confirmTitle") });
      await confirm.waitFor({ timeout: WAIT_MS });
      await screenshot(page, "settings-confirm.png");
      await confirm.getByRole("button", { name: english("settings.team.remove.confirm") }).click();
      await identityHeading(page).waitFor({ timeout: WAIT_MS });
      await page.reload();
      await identityHeading(page).waitFor({ timeout: WAIT_MS });
    },
  );

  await check("A join code in the side panel joins and shows the host, and the identity has its device", async () => {
    const page = panel;
    assert.ok(page);
    const joinField = page.getByRole("textbox", { name: english("settings.team.join.label") });
    await joinField.fill("openbot-nc://enroll?v=1");
    await page.getByRole("button", { name: english("settings.team.join.action"), exact: true }).click();
    await page.getByText(english("error.remote.relayJoinInvalidCode")).waitFor({ timeout: WAIT_MS });
    await screenshot(page, "identity-join-error.png");
    await joinField.fill(joinCode("dana", "extension"));
    await screenshot(page, "identity-join.png");
    await page.getByRole("button", { name: english("settings.team.join.action"), exact: true }).click();
    await agentRow(page).waitFor({ timeout: WAIT_MS });
    await screenshot(page, "joined.png");
    await page.getByRole("button", { name: english("extension.home.serverMenu") }).click();
    await page.getByRole("menuitem", { name: english("extension.home.settings") }).click();
    await page.getByText("dana", { exact: true }).waitFor({ timeout: WAIT_MS });
    await page.getByText("extension", { exact: true }).waitFor({ timeout: WAIT_MS });
    await page.getByRole("button", { name: english("settings.team.remove.title") }).click();
    const confirm = page.getByRole("region", { name: english("settings.team.remove.confirmTitle") });
    await confirm.getByRole("button", { name: english("settings.team.remove.confirm") }).click();
    await identityHeading(page).waitFor({ timeout: WAIT_MS });
  });

  await check("A picked identity file imports after the removal", async () => {
    const page = panel;
    assert.ok(page);
    const file = join(work, "bob-identity.json");
    writeFileSync(file, JSON.stringify(bobBundle));
    await page.locator('input[type="file"]').setInputFiles(file);
    await agentRow(page).waitFor({ timeout: WAIT_MS });
  });

  await check("The extension pages had no CSP violation, no console error, and no request to another server", () => {
    assert.deepEqual(watch.violations, []);
    assert.deepEqual(watch.errors, []);
    assert.deepEqual(watch.requests, []);
  });
} finally {
  if (panel) await panel.screenshot({ path: join(OUT, "page-final.png") }).catch(() => undefined);
  await context?.close().catch(() => undefined);
  sharedServer?.close();
  if (host) await runCauseEffect(host.shutdown()).catch(() => undefined);
  if (agents) await runCauseEffect(agents.stop()).catch(() => undefined);
  database?.close();
  hub.dispose();
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
      browser: "chromium (playwright-core, persistent context with the unpacked extension)",
      viewport: VIEWPORT,
      facts,
      screenshots,
      checks,
      ...(failedChecks.length === 0 ? {} : { relayLog: relay?.log.join("") ?? "", pageErrors: watch }),
    },
    null,
    2,
  )}
`,
);
for (const entry of checks) {
  process.stdout.write(
    `${entry.passed ? "PASS" : "FAIL"} ${entry.name}${entry.error ? `\n     ${entry.error}` : ""}\n`,
  );
}
process.stdout.write(`Report: ${join(OUT, "report.json")}\n`);
process.exit(failedChecks.length === 0 ? 0 : 1);
