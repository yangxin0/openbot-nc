import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes, X509Certificate } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { inspect } from "node:util";
import { AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import { decodeRelayIdentityBundle, type RelayIdentityBundle } from "@openbot/contracts/relay-protocol/identity-bundle";
import { RELAY_PATH } from "@openbot/contracts/relay-protocol/messages";
import { translateFor } from "@openbot/i18n";
import { Effect, Result } from "effect";
import { type Browser, type BrowserContext, chromium, type Page } from "playwright-core";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { AgentService as AgentServiceInstance } from "../src/backend/agent-service";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { OpenBotDatabase as OpenBotDatabaseInstance } from "../src/backend/openbot-database";
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
const OUT = resolve(ROOT, ".openbot-build/relay-web-client-e2e");
const WEB_CLIENT = resolve(ROOT, ".openbot-build/web-client");
const MAIN = resolve(ROOT, "remote/api/src/relay/main.ts");
const WAIT_MS = 60_000;
const READY_LINE = "OpenBot relay is ready";
const APP_VERSION = "0.0.0-e2e";
const TEAM = "Acme";
const HOST_USER = "host-user";
const HOST_DEVICE = "server";
const AGENT_NAME = "Relay web fixture";
const PROMPT = "Hello from the web client over the relay";
const VIEWPORT = { width: 1280, height: 800 };
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

function buildWebClient(): void {
  const result = spawnSync("bun", ["run", "web-client:build"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.ok(existsSync(join(WEB_CLIENT, "index.html")), "The build must write index.html.");
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

interface PageWatch {
  errors: string[];
  violations: string[];
}

async function openWebClient(context: BrowserContext, origin: string, watch: PageWatch): Promise<Page> {
  const page = await context.newPage();
  page.on("pageerror", (error) => watch.errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") watch.errors.push(`console: ${message.text()}`);
  });
  await page.exposeFunction("reportCspViolation", (text: string) => watch.violations.push(text));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      window.reportCspViolation?.(
        `${event.violatedDirective} ${event.blockedURI} ${event.sourceFile}:${event.lineNumber}:${event.columnNumber} ${event.sample}`,
      );
    });
  });
  await page.goto(`${origin}/app`);
  return page;
}

const identityHeading = (page: Page) => page.getByRole("heading", { name: english("webClient.identity.title") });
const loadingScreenGone = (page: Page) => page.locator(".app-loading").waitFor({ state: "detached", timeout: WAIT_MS });
const agentInSidebar = (page: Page) => page.getByText(AGENT_NAME, { exact: true }).first();

const work = mkdtempSync(join(tmpdir(), "openbot-relay-web-client-e2e-"));
const dataDirectory = join(work, "data");
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

const [relayPort, healthPort] = await Promise.all([freePort(), freePort()]);
const origin = `https://localhost:${relayPort}`;
const environment = {
  RELAY_DATA_DIR: dataDirectory,
  RELAY_HOST: "127.0.0.1",
  RELAY_PORT: String(relayPort),
  RELAY_HEALTH_PORT: String(healthPort),
  RELAY_PUBLIC_URL: `wss://localhost:${relayPort}${RELAY_PATH}`,
  RELAY_WEB_CLIENT_DIR: WEB_CLIENT,
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
  answerPermission: unused,
  answerHttpSignIn: unused,
  answerViewDialog: unused,
};
const localOwner: LocalProfile = { id: "local-profile-e2e", name: "Host Person", chatColor: null };

let relay: Relay | null = null;
let database: OpenBotDatabaseInstance | null = null;
let agents: AgentServiceInstance | null = null;
let host: HostServiceInstance | null = null;
let browser: Browser | null = null;
let page: Page | null = null;
const watch: PageWatch = { errors: [], violations: [] };
const screenshots: string[] = [];

async function screenshot(target: Page, name: string, settle = false): Promise<void> {
  const path = join(OUT, name);
  await target.screenshot({ path, animations: settle ? "disabled" : "allow" });
  screenshots.push(path);
}

try {
  await check("The web client builds into .openbot-build/web-client", () => buildWebClient());

  await check("The certificate commands make a root, a localhost server identity and a team", () => {
    assert.equal(command(environment, "ca", "init").status, 0);
    assert.equal(command(environment, "ca", "server", "--dns", "localhost", "--ip", "127.0.0.1").status, 0);
    assert.equal(command(environment, "ca", "team", "add", TEAM).status, 0);
  });

  const hostBundle = issue(environment, HOST_USER, HOST_DEVICE);
  const aliceBundle = issue(environment, "alice", "browser");
  const bobBundle = issue(environment, "bob", "browser");
  const serverCertificate = readFileSync(join(dataDirectory, "tls/server.crt"), "utf8");

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
  await runCauseEffect(
    agentStore.createAgent({
      name: AGENT_NAME,
      description: "Synthetic agent for the web client relay check",
      avatarSeed: "relay-web-client",
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

  browser = await chromium.launch({ args: [`--ignore-certificate-errors-spki-list=${spkiDigest(serverCertificate)}`] });
  const context = await browser.newContext({ viewport: VIEWPORT });
  const openPage = await openWebClient(context, origin, watch);
  page = openPage;

  await check("The relay serves the web client with its CSP, and the page shows the identity screen", async () => {
    await identityHeading(openPage).waitFor({ timeout: WAIT_MS });
    await loadingScreenGone(openPage);
    const policy = await openPage.evaluate(() =>
      fetch("/app/").then((response) => response.headers.get("content-security-policy")),
    );
    assert.match(policy ?? "", /default-src 'none'/u);
    await screenshot(openPage, "identity.png");
  });

  const pasteField = openPage.getByRole("textbox", { name: english("webClient.identity.pasteLabel") });
  const importButton = openPage.getByRole("button", { name: english("webClient.identity.import") });

  await check("A wrong paste shows the identity error", async () => {
    await openPage.getByRole("button", { name: english("webClient.identity.fileOption") }).click();
    await pasteField.fill(JSON.stringify({ version: 1, certificate: "not a certificate" }));
    await importButton.click();
    await openPage
      .getByRole("alert")
      .filter({ hasText: english("error.remote.relayIdentityInvalid") })
      .waitFor({ timeout: WAIT_MS });
    await screenshot(openPage, "identity-error.png");
  });

  await check("A pasted identity shows the host in the server list, shared by its user and device", async () => {
    await pasteField.fill(JSON.stringify(aliceBundle));
    await importButton.click();
    await agentInSidebar(openPage).waitFor({ timeout: WAIT_MS });
    await openPage.getByRole("button", { name: english("server.menu.open", { name: "OpenBot-NC" }) }).click();
    const row = openPage.getByRole("menuitem", {
      name: new RegExp(english("server.rail.relayHost", { host: `${HOST_USER} · ${HOST_DEVICE}` }), "u"),
    });
    await row.waitFor({ timeout: WAIT_MS });
    await screenshot(openPage, "server-list.png");
    await openPage.keyboard.press("Escape");
    await row.waitFor({ state: "hidden", timeout: WAIT_MS });
  });

  await check("The host's agent list shows, and a sent message gets the agent's reply", async () => {
    await agentInSidebar(openPage).click();
    const composer = openPage.getByRole("textbox", {
      name: english("composer.placeholder.message", { name: AGENT_NAME }),
    });
    await composer.waitFor({ timeout: WAIT_MS });
    await composer.fill(PROMPT);
    await composer.press("Enter");
    await openPage.getByText(PROMPT, { exact: true }).first().waitFor({ timeout: WAIT_MS });
    await openPage.getByText("Done.", { exact: true }).first().waitFor({ timeout: WAIT_MS });
    const prompts = readFileSync(fakeCodexLog, "utf8");
    assert.match(prompts, new RegExp(PROMPT, "u"));
    await screenshot(openPage, "conversation.png");
  });

  await check("A page load keeps the identity", async () => {
    await openPage.reload();
    await agentInSidebar(openPage).waitFor({ timeout: WAIT_MS });
    assert.equal(await identityHeading(openPage).count(), 0);
  });

  await check("A picked identity file imports in a second browser context", async () => {
    const second = await browser?.newContext({ viewport: VIEWPORT });
    assert.ok(second);
    try {
      const secondPage = await openWebClient(second, origin, watch);
      await identityHeading(secondPage).waitFor({ timeout: WAIT_MS });
      const file = join(work, "bob-identity.json");
      writeFileSync(file, JSON.stringify(bobBundle));
      await secondPage.locator('input[type="file"]').setInputFiles(file);
      await agentInSidebar(secondPage).waitFor({ timeout: WAIT_MS });
    } finally {
      await second.close();
    }
  });

  await check(
    "A join code on the identity screen joins, the host shows, and Replace with a code joins again",
    async () => {
      const third = await browser?.newContext({ viewport: VIEWPORT });
      assert.ok(third);
      try {
        const joinPage = await openWebClient(third, origin, watch);
        await identityHeading(joinPage).waitFor({ timeout: WAIT_MS });
        const joinField = joinPage.getByRole("textbox", { name: english("settings.team.join.label") });
        const joinButton = joinPage.getByRole("button", { name: english("settings.team.join.action"), exact: true });
        await joinField.waitFor({ timeout: WAIT_MS });
        await screenshot(joinPage, "identity-join.png", true);
        const otherServer = joinCode("carol", "laptop").replace(/server=[^&]+/u, "server=relay.example.com");
        await joinField.fill(otherServer);
        await joinButton.click();
        await joinPage.getByText(english("error.remote.relayJoinOtherServer")).waitFor({ timeout: WAIT_MS });
        await screenshot(joinPage, "identity-join-error.png");
        await joinField.fill(joinCode("carol", "browser"));
        await joinButton.click();
        await agentInSidebar(joinPage).waitFor({ timeout: WAIT_MS });
        await screenshot(joinPage, "joined.png");
        await joinPage
          .getByRole("button", { name: english("app.rail.settings") })
          .first()
          .click();
        await joinPage.getByRole("button", { name: english("settings.team.replaceCode.action") }).click();
        await joinPage
          .getByRole("alertdialog", { name: english("settings.team.replaceCode.confirmTitle") })
          .getByRole("button", { name: english("settings.team.replaceCode.confirm") })
          .click();
        const dialog = joinPage.getByRole("alertdialog", { name: english("settings.team.join.title") });
        await dialog
          .getByRole("textbox", { name: english("settings.team.join.label") })
          .fill(joinCode("carol", "tablet"));
        await screenshot(joinPage, "replace-with-code.png", true);
        await dialog.getByRole("button", { name: english("settings.team.join.action"), exact: true }).click();
        await dialog.waitFor({ state: "detached", timeout: WAIT_MS });
        await agentInSidebar(joinPage).waitFor({ timeout: WAIT_MS });
        const device = await joinPage.evaluate(async () => {
          const database = await new Promise<IDBDatabase>((resolveDatabase, reject) => {
            const request = indexedDB.open("openbot-relay-identity", 1);
            request.onsuccess = () => resolveDatabase(request.result);
            request.onerror = () => reject(request.error);
          });
          const saved = await new Promise<unknown>((resolveSaved, reject) => {
            const request = database.transaction("identity").objectStore("identity").get("current");
            request.onsuccess = () => resolveSaved(request.result);
            request.onerror = () => reject(request.error);
          });
          database.close();
          return typeof saved === "object" && saved !== null && "device" in saved ? saved.device : null;
        });
        assert.equal(device, "tablet");
      } finally {
        await third.close();
      }
    },
  );

  await check("Remove identity in the account settings returns to the identity screen", async () => {
    await openPage
      .getByRole("button", { name: english("app.rail.settings") })
      .first()
      .click();
    await openPage.getByRole("button", { name: english("settings.team.remove.action") }).click();
    await openPage.getByRole("button", { name: english("settings.team.remove.confirm") }).click();
    await identityHeading(openPage).waitFor({ timeout: WAIT_MS });
    await openPage.reload();
    await identityHeading(openPage).waitFor({ timeout: WAIT_MS });
  });

  await check("The pages had no CSP violation and no console error", () => {
    assert.deepEqual(watch.violations, []);
    assert.deepEqual(watch.errors, []);
  });
} finally {
  if (page) await page.screenshot({ path: join(OUT, "page-final.png") }).catch(() => undefined);
  await browser?.close().catch(() => undefined);
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
      browser: "chromium (playwright-core)",
      viewport: VIEWPORT,
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
    `${entry.passed ? "PASS" : "FAIL"} ${entry.name}${
      entry.error
        ? `
     ${entry.error}`
        : ""
    }
`,
  );
}
process.stdout.write(`Report: ${join(OUT, "report.json")}
`);
process.exit(failedChecks.length === 0 ? 0 : 1);
