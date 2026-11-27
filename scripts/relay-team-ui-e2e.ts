import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { inspect } from "node:util";
import type { OpenBotDesktopApi, RelayState, ServerSummary } from "@openbot/contracts/ipc";
import { decodeList, requiredString } from "@openbot/contracts/ipc-decoding";
import { RELAY_PATH } from "@openbot/contracts/relay-protocol/messages";
import { createOpenBotLogger } from "@openbot/logging";
import type { Browser, Page } from "playwright-core";
import { developmentUserDataName } from "../src/main/development-profile";
import { decodeRelayState } from "../src/preload/relay-decoding";
import { decodeServer } from "../src/preload/team-decoding";
import { devBrowserPages, openDevBrowser } from "./dev-automation/cdp-client";
import { type DevInstanceRecord, readDevInstanceRecords } from "./dev-automation/instance-registry";
import { findMainPages } from "./dev-automation/page-url";
import { resolveDevelopmentAppDataRoot } from "./development-state-paths";

declare global {
  interface Window {
    openbot: OpenBotDesktopApi;
  }
}

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, ".openbot-build/relay-team-ui-e2e");
const MAIN = resolve(ROOT, "remote/api/src/relay/main.ts");
const READY_LINE = "OpenBot relay is ready";
const START_GUARD_MS = 300_000;
const WAIT_MS = 60_000;
const TEAM = "Acme";
const HOST_USER = "host-user";
const HOST_DEVICE = "host-mac";
const MEMBER_USER = "member";
const MEMBER_DEVICE = "member-laptop";
const SETUP_FILE = "openbot-setup-v2.json";
const logger = createOpenBotLogger("relay-team-ui-e2e");

interface Check {
  name: string;
  passed: boolean;
  error?: string;
}

const checks: Check[] = [];
const artifacts: string[] = [];
let diagnose: ((name: string) => Promise<void>) | null = null;

async function check(name: string, run: () => void | Promise<void>): Promise<void> {
  try {
    await run();
    checks.push({ name, passed: true });
    logger.info(`PASS ${name}`);
  } catch (error) {
    checks.push({ name, passed: false, error: error instanceof Error ? error.message : inspect(error) });
    logger.error(`FAIL ${name}`, error instanceof Error ? error.message : inspect(error));
    await diagnose?.(name).catch((cause: unknown) =>
      logger.warn("Could not write the failure details.", inspect(cause)),
    );
  }
}

process.on("unhandledRejection", (reason) => {
  checks.push({ name: "No promise fails without a handler", passed: false, error: inspect(reason) });
});

function deadline<T>(description: string, promise: Promise<T>, limitMs = WAIT_MS): Promise<T> {
  return new Promise<T>((resolveValue, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out: ${description}.`)), limitMs);
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

function until<T>(
  description: string,
  subscribe: (done: (value: T) => void) => () => void,
  limitMs = WAIT_MS,
): Promise<T> {
  const state: { unsubscribe: (() => void) | null; finished: boolean } = { unsubscribe: null, finished: false };
  const found = new Promise<T>((resolveValue) => {
    state.unsubscribe = subscribe((value) => {
      state.finished = true;
      state.unsubscribe?.();
      resolveValue(value);
    });
    if (state.finished) state.unsubscribe();
  });
  return deadline(description, found, limitMs).finally(() => state.unsubscribe?.());
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

function issue(environment: Record<string, string>, file: string, user: string, device: string): void {
  const result = command(environment, "ca", "issue", "--team", TEAM, "--user", user, "--device", device, "--out", file);
  assert.equal(result.status, 0, result.output);
}

function joinCode(environment: Record<string, string>, user: string, device: string): string {
  const result = command(environment, "ca", "code", "--team", TEAM, "--user", user, "--device", device);
  assert.equal(result.status, 0, result.output);
  const line = result.output.split("\n").find((entry) => entry.trim().startsWith("openbot-nc://enroll?"));
  assert.ok(line, "ca code must print a join code.");
  return line.trim();
}

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
    onData();
    return () => child.stdout.off("data", onData);
  }).catch((error: unknown) => {
    child.kill("SIGKILL");
    throw new Error(`${error instanceof Error ? error.message : inspect(error)} Log: ${log.join("")}`);
  });
  return { child, log, exited };
}

type StackService = "app" | "test-client";

interface AppProfile {
  role: "host" | "member";
  service: StackService;
  path: string;
}

interface RunningApp {
  profile: AppProfile;
  instance: DevInstanceRecord;
  browser: Browser | null;
  page: Page | null;
}

interface Stack {
  child: ChildProcess;
  exited: Promise<number | null>;
  output: () => string;
}

function newProfiles(): { instanceId: string; host: AppProfile; member: AppProfile } {
  for (;;) {
    const instanceId = String(randomInt(40_000, 49_999));
    const profile = (role: AppProfile["role"], service: StackService): AppProfile => ({
      role,
      service,
      path: join(resolveDevelopmentAppDataRoot(), developmentUserDataName(service, instanceId)),
    });
    const host = profile("host", "app");
    const member = profile("member", "test-client");
    if (existsSync(host.path) || existsSync(member.path)) continue;
    for (const created of [host, member]) {
      mkdirSync(created.path);
      writeFileSync(
        join(created.path, SETUP_FILE),
        `${JSON.stringify({ version: 2, preferredProvider: "codex", completedAt: new Date().toISOString() })}\n`,
      );
    }
    return { instanceId, host, member };
  }
}

function startStack(
  instanceId: string,
  hostSwitches: string[],
  memberSwitches: string[],
  extraCertificates: string,
): Stack {
  const logFile = createWriteStream(join(OUT, "stack.log"));
  const child = spawn("bun", ["scripts/dev-services.ts", "test-client"], {
    cwd: ROOT,
    env: {
      ...process.env,
      OPENBOT_DEV_INSTANCE_ID: instanceId,
      OPENBOT_DEV_WINDOW_FOCUS: "background",
      NODE_EXTRA_CA_CERTS: extraCertificates,
      OPENBOT_DEV_ELECTRON_ARGS: JSON.stringify(hostSwitches),
      OPENBOT_DEV_TEST_CLIENT_ELECTRON_ARGS: JSON.stringify(memberSwitches),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const append = (chunk: Buffer) => {
    output = `${output}${chunk.toString()}`.slice(-800_000);
    logFile.write(chunk);
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  const exited = new Promise<number | null>((resolveExit) => {
    child.once("exit", resolveExit);
  });
  child.once("close", () => logFile.end());
  return { child, exited, output: () => output };
}

function untilOutput(stack: Stack, description: string, found: (output: string) => boolean): Promise<void> {
  return until<void>(
    description,
    (done) => {
      const look = () => {
        if (found(stack.output())) done();
      };
      stack.child.stdout?.on("data", look);
      stack.child.stderr?.on("data", look);
      look();
      return () => {
        stack.child.stdout?.off("data", look);
        stack.child.stderr?.off("data", look);
      };
    },
    START_GUARD_MS,
  );
}

async function startedApp(stack: Stack, instanceId: string, profile: AppProfile): Promise<RunningApp> {
  const runnerExit = stack.exited.then((code) => {
    throw new Error(`The dev runner exited with code ${code}. Log: ${stack.output().slice(-4_000)}`);
  });
  runnerExit.catch(() => undefined);
  const marker = `[${profile.service}] dev:automation can reach this instance with --instance=${instanceId} `;
  await Promise.race([
    untilOutput(stack, `the ${profile.role} app is in the instance registry`, (output) => output.includes(marker)),
    runnerExit,
  ]);
  const instance = readDevInstanceRecords().find(
    (candidate) =>
      candidate.instanceId === instanceId && candidate.projectRoot === ROOT && candidate.service === profile.service,
  );
  if (!instance) throw new Error(`The instance registry has no ${profile.service} record for ${instanceId}.`);
  const devTools = `DevTools listening on ws://127.0.0.1:${instance.remoteDebuggingPort}/`;
  await Promise.race([
    untilOutput(stack, `the ${profile.role} app opens its debug port`, (output) => output.includes(devTools)),
    runnerExit,
  ]);
  return { profile, instance, browser: null, page: null };
}

async function mainTargetListed(app: RunningApp): Promise<boolean> {
  const response = await fetch(`http://127.0.0.1:${app.instance.remoteDebuggingPort}/json/list`).catch(() => null);
  if (!response?.ok) return false;
  const urls = decodeList(await response.json(), "debug target", (target) => requiredString(target, "url"));
  return (
    findMainPages(
      urls.map((url) => ({ url: () => url })),
      app.instance.rendererPort,
    ).length > 0
  );
}

async function waitForMainTarget(app: RunningApp): Promise<void> {
  const limit = Date.now() + START_GUARD_MS;
  while (!(await mainTargetListed(app))) {
    if (Date.now() > limit) throw new Error(`Timed out: the ${app.profile.role} app lists its main window.`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
}

async function connectPage(app: RunningApp): Promise<Page> {
  if (app.page) return app.page;
  await waitForMainTarget(app);
  const browser = await openDevBrowser(app.instance.remoteDebuggingPort, logger, { ownerPid: app.instance.pid });
  app.browser = browser;
  const watched = new Set<Page>();
  const page = await until<Page>(`the main window of the ${app.profile.role} app`, (done) => {
    const look = () => {
      const pages = devBrowserPages(browser);
      for (const candidate of pages) {
        if (watched.has(candidate)) continue;
        watched.add(candidate);
        candidate.on("framenavigated", look);
      }
      const [main] = findMainPages(pages, app.instance.rendererPort);
      if (main) done(main);
    };
    const contexts = browser.contexts();
    for (const context of contexts) context.on("page", look);
    look();
    return () => {
      for (const context of contexts) context.off("page", look);
      for (const candidate of watched) candidate.off("framenavigated", look);
    };
  }).catch(async (error: unknown) => {
    const urls = devBrowserPages(browser).map((candidate) => candidate.url());
    const targets = await fetch(`http://127.0.0.1:${app.instance.remoteDebuggingPort}/json/list`)
      .then((response) => response.text())
      .catch((cause: unknown) => inspect(cause));
    throw new Error(
      `${error instanceof Error ? error.message : inspect(error)} Renderer port ${app.instance.rendererPort}; contexts ${browser.contexts().length}; pages ${inspect(urls)}; targets ${targets}`,
    );
  });
  await page.waitForFunction(() => typeof window.openbot === "object" && typeof window.openbot.relay === "object", {
    timeout: START_GUARD_MS,
  });
  app.page = page;
  return page;
}

async function stopStack(stack: Stack): Promise<void> {
  const stopped = spawnSync("bun", ["scripts/dev-stack.ts", "stop", `--pid=${stack.child.pid}`], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (stopped.status !== 0) {
    logger.warn(`dev-stack stop did not finish: ${stopped.stdout}${stopped.stderr}`);
    stack.child.kill("SIGTERM");
  }
  await deadline("the dev stack stops", stack.exited, WAIT_MS);
}

const WAIT_FOR_RELAY_STATE = `([hosting, peer]) => new Promise((resolve) => {
  let finished = false;
  let unsubscribe = null;
  function matches(state) {
    if (state.identity === null || state.control.status !== "online") return false;
    if (hosting && !(state.hosting && state.hostingState.status === "online")) return false;
    return peer === null || state.members.some((member) => member.user === peer && member.hosting);
  }
  function finish(state) {
    if (finished || !matches(state)) return;
    finished = true;
    if (unsubscribe) unsubscribe();
    resolve(state);
  }
  unsubscribe = window.openbot.relay.onState(finish);
  if (finished) unsubscribe();
  window.openbot.relay.getState().then(finish);
})`;

async function relayState(page: Page, hosting: boolean, peer: string | null): Promise<RelayState> {
  return decodeRelayState(
    await deadline(
      `the relay state (hosting ${hosting}, hosting peer ${peer ?? "none"})`,
      page.evaluate(`(${WAIT_FOR_RELAY_STATE})(${JSON.stringify([hosting, peer])})`),
      START_GUARD_MS,
    ),
  );
}

const WAIT_FOR_TEAM_SERVER = `([user, active]) => new Promise((resolve) => {
  let finished = false;
  let unsubscribe = null;
  function finish(list) {
    if (finished) return;
    const server = list.find((candidate) => candidate.relayHost && candidate.relayHost.user === user);
    if (!server || server.state !== "online" || (active && !server.active)) return;
    finished = true;
    if (unsubscribe) unsubscribe();
    resolve(server);
  }
  unsubscribe = window.openbot.servers.onEvent(finish);
  if (finished) unsubscribe();
  window.openbot.servers.list().then(finish);
})`;

async function teamServer(page: Page, user: string, active = false): Promise<ServerSummary> {
  return decodeServer(
    await deadline(
      `the server of ${user} is online${active ? " and open" : ""}`,
      page.evaluate(`(${WAIT_FOR_TEAM_SERVER})(${JSON.stringify([user, active])})`),
      START_GUARD_MS,
    ),
  );
}

interface HeldImage {
  url: string;
  requested: Promise<void>;
  release: () => void;
  close: () => Promise<void>;
}

async function holdImage(): Promise<HeldImage> {
  const released = Promise.withResolvers<void>();
  const requested = Promise.withResolvers<void>();
  const server = createHttpServer((_request, response) => {
    requested.resolve();
    void released.promise.then(() => {
      response.writeHead(204, { "cache-control": "no-store" });
      response.end();
    });
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  const address = server.address();
  if (!address || typeof address !== "object") throw new Error("The image server has no port.");
  return {
    url: `http://127.0.0.1:${address.port}/held.png`,
    requested: requested.promise,
    release: () => released.resolve(),
    close: () =>
      new Promise<void>((resolveClose) => {
        released.resolve();
        server.closeAllConnections();
        server.close(() => resolveClose());
      }),
  };
}

function heldImageScript(url: string): string {
  return `(() => {
  const image = document.createElement("img");
  image.hidden = true;
  image.alt = "";
  image.src = ${JSON.stringify(url)};
  const add = () => document.documentElement.append(image);
  if (document.documentElement) add();
  else document.addEventListener("readystatechange", add, { once: true });
})()`;
}

async function untilMainRoster(page: Page, user: string, present: boolean): Promise<void> {
  await page.waitForFunction(
    async ({ name, wanted }) => {
      const state = await window.openbot.relay.getState();
      return state.members.some((candidate) => candidate.user === name) === wanted;
    },
    { name: user, wanted: present },
    { polling: 100, timeout: WAIT_MS },
  );
}

async function openServerMenu(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: /^Open server menu for / })
    .first()
    .click({ timeout: WAIT_MS });
  await page.getByRole("menu", { name: "Server menu" }).waitFor({ state: "visible", timeout: WAIT_MS });
}

async function chooseMenuItem(page: Page, name: string): Promise<void> {
  await page.getByRole("menuitem", { name, exact: true }).click({ timeout: WAIT_MS });
  await page.getByRole("menu", { name: "Server menu" }).waitFor({ state: "detached", timeout: WAIT_MS });
}

async function openTeamSettings(page: Page): Promise<void> {
  await openServerMenu(page);
  await chooseMenuItem(page, "Team servers");
  await page.getByRole("heading", { name: "Team identity" }).waitFor({ state: "visible", timeout: WAIT_MS });
}

async function settled(page: Page): Promise<void> {
  await page.locator(".app-loading").waitFor({ state: "detached", timeout: START_GUARD_MS });
  await page.waitForFunction(
    () =>
      document.querySelector('[inert][aria-hidden="true"] [role="menu"], [inert][aria-hidden="true"][role="menu"]') ===
      null,
    undefined,
    { timeout: WAIT_MS },
  );
}

interface MainDiagnostics {
  relay: RelayState;
  servers: Pick<ServerSummary, "id" | "name" | "active" | "state" | "relayHost">[];
  readyState: DocumentReadyState;
}

interface AppDiagnostics {
  role: AppProfile["role"];
  main: MainDiagnostics | string;
  shownMembers: string | null;
  snapshot: string;
}

async function appDiagnostics(app: RunningApp, page: Page, prefix: string): Promise<AppDiagnostics> {
  const picture = join(OUT, `${prefix}-${app.profile.role}.png`);
  await page.screenshot({ path: picture }).then(
    () => artifacts.push(picture),
    () => undefined,
  );
  const members = page.getByRole("region", { name: "Members", exact: true });
  return {
    role: app.profile.role,
    main: await page
      .evaluate(async () => ({
        relay: await window.openbot.relay.getState(),
        servers: (await window.openbot.servers.list()).map((server) => ({
          id: server.id,
          name: server.name,
          active: server.active,
          state: server.state,
          ...(server.relayHost ? { relayHost: server.relayHost } : {}),
        })),
        readyState: document.readyState,
      }))
      .catch((error: unknown) => inspect(error)),
    shownMembers: (await members.count()) > 0 ? await members.first().innerText() : null,
    snapshot: await page.ariaSnapshot({ depth: 12 }).catch((error: unknown) => inspect(error)),
  };
}

async function writeDiagnostics(name: string, running: readonly RunningApp[]): Promise<void> {
  const prefix = `failure-${checks.length}`;
  const reports: AppDiagnostics[] = [];
  for (const app of running) if (app.page) reports.push(await appDiagnostics(app, app.page, prefix));
  const details = { check: name, at: new Date().toISOString(), apps: reports };
  const file = join(OUT, `${prefix}.json`);
  writeFileSync(file, `${JSON.stringify(details, null, 2)}\n`);
  artifacts.push(file);
}

async function screenshot(page: Page, name: string): Promise<string> {
  await settled(page);
  const path = join(OUT, name);
  await page.screenshot({ path });
  artifacts.push(path);
  return path;
}

const work = mkdtempSync(join(tmpdir(), "openbot-relay-team-ui-e2e-"));
const dataDirectory = join(work, "data");
const hostIdentityFile = join(work, "host-user.json");
const memberIdentityFile = join(work, "member.json");
const profiles: AppProfile[] = [];
const apps: RunningApp[] = [];
let stack: Stack | null = null;
let stackInstanceId = "";
let relay: Relay | null = null;
let hostServerName = "";

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

try {
  const [relayPort, healthPort] = await Promise.all([freePort(), freePort()]);
  const relayUrl = `wss://127.0.0.1:${relayPort}${RELAY_PATH}`;
  const environment = {
    RELAY_DATA_DIR: dataDirectory,
    RELAY_HOST: "127.0.0.1",
    RELAY_PORT: String(relayPort),
    RELAY_HEALTH_PORT: String(healthPort),
    RELAY_PUBLIC_URL: relayUrl,
  };
  assert.equal(command(environment, "ca", "init").status, 0);
  assert.equal(command(environment, "ca", "server", "--dns", "localhost", "--ip", "127.0.0.1").status, 0);
  assert.equal(command(environment, "ca", "team", "add", TEAM).status, 0);
  issue(environment, hostIdentityFile, HOST_USER, HOST_DEVICE);
  issue(environment, memberIdentityFile, MEMBER_USER, MEMBER_DEVICE);
  relay = await startRelay(environment);

  const created = newProfiles();
  stackInstanceId = created.instanceId;
  profiles.push(created.host, created.member);
  const running = startStack(
    created.instanceId,
    [`--import-relay-identity=${hostIdentityFile}`, "--relay-hosting=on"],
    [`--import-relay-identity=${memberIdentityFile}`],
    join(dataDirectory, "ca", "root.crt"),
  );
  stack = running;
  const [host, member] = await Promise.all([
    startedApp(running, created.instanceId, created.host),
    startedApp(running, created.instanceId, created.member),
  ]);
  apps.push(host, member);
  const [hostPage, memberPage] = await Promise.all([connectPage(host), connectPage(member)]);
  await Promise.all([settled(hostPage), settled(memberPage)]);
  diagnose = (name) => writeDiagnostics(name, [host, member]);

  await check("The host app imports host-user and shares its agents through the relay", async () => {
    const state = await relayState(hostPage, true, null);
    assert.deepEqual(
      [state.identity?.team, state.identity?.user, state.identity?.device],
      [TEAM, HOST_USER, HOST_DEVICE],
    );
  });

  await check("The member app imports member and sees host-user sharing in the roster", async () => {
    const state = await relayState(memberPage, false, HOST_USER);
    assert.equal(state.identity?.user, MEMBER_USER);
    assert.equal(state.hosting, false);
  });

  await check("The member app lists the host as a server, online, with its user and device", async () => {
    const server = await teamServer(memberPage, HOST_USER);
    hostServerName = server.name;
    assert.equal(server.kind, "remote");
    assert.equal(server.apiUrl, null, "A relay server must not show an address.");
    assert.deepEqual(server.relayHost, { user: HOST_USER, device: HOST_DEVICE });
    await openServerMenu(memberPage);
    const row = memberPage.getByRole("menuitem", {
      name: `${hostServerName}, shared by ${HOST_USER} · ${HOST_DEVICE}`,
      exact: true,
    });
    await row.waitFor({ state: "visible", timeout: WAIT_MS });
    await memberPage.keyboard.press("Escape");
  });

  await check("The member's Team section shows both members", async () => {
    await openTeamSettings(memberPage);
    const list = memberPage.getByRole("region", { name: "Members", exact: true });
    await list.getByText(HOST_USER, { exact: true }).waitFor({ state: "visible", timeout: WAIT_MS });
    await list.getByText(MEMBER_USER, { exact: true }).waitFor({ state: "visible", timeout: WAIT_MS });
    const text = await list.innerText();
    assert.match(text, /This computer/u);
    assert.match(text, /Sharing agents/u);
    await memberPage.getByText(relayUrl, { exact: true }).waitFor({ state: "visible", timeout: WAIT_MS });
    await screenshot(memberPage, "member-team.png");
  });

  await check("The host's Team section shows sharing on and both members", async () => {
    await openTeamSettings(hostPage);
    const list = hostPage.getByRole("region", { name: "Members", exact: true });
    await list.getByText(MEMBER_USER, { exact: true }).waitFor({ state: "visible", timeout: WAIT_MS });
    await hostPage.getByText("Your team can open the agents of this computer.").waitFor({
      state: "visible",
      timeout: WAIT_MS,
    });
    const sharing = hostPage.getByRole("switch", { name: "Share this computer's agents with my team" });
    assert.equal(await sharing.isChecked(), true);
    await screenshot(hostPage, "host-team.png");
    await hostPage.getByRole("button", { name: "Remove", exact: true }).scrollIntoViewIfNeeded({ timeout: WAIT_MS });
    await screenshot(hostPage, "host-team-sharing.png");
  });

  await check("The member opens the host server and its agent list renders", async () => {
    await memberPage.keyboard.press("Escape");
    await memberPage.getByRole("heading", { name: "Team identity" }).waitFor({ state: "hidden", timeout: WAIT_MS });
    await openServerMenu(memberPage);
    await chooseMenuItem(memberPage, `${hostServerName}, shared by ${HOST_USER} · ${HOST_DEVICE}`);
    const opened = await teamServer(memberPage, HOST_USER, true);
    await memberPage
      .getByRole("button", { name: `Open server menu for ${hostServerName}` })
      .first()
      .waitFor({ state: "visible", timeout: WAIT_MS });
    await memberPage.waitForFunction(
      (name) => {
        const text = document.body.innerText;
        return !text.includes(`Connecting to ${name}`) && !text.includes(`Loading ${name}`);
      },
      hostServerName,
      { timeout: WAIT_MS },
    );
    const yaml = await memberPage.ariaSnapshot({ depth: 30 });
    writeFileSync(join(OUT, "member-host-snapshot.yaml"), `${yaml}\n`);
    artifacts.push(join(OUT, "member-host-snapshot.yaml"));
    assert.doesNotMatch(yaml, /Cannot connect to/u);
    assert.doesNotMatch(yaml, /Team identity/u, "The Team settings cover the workspace of the host.");
    assert.match(
      yaml,
      new RegExp(`Open server menu for ${hostServerName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`, "u"),
    );
    const listed = await memberPage.evaluate(
      (serverId) =>
        window.openbot.agent
          .listAgents(serverId)
          .then((agents) => agents.map((agent) => ({ id: agent.id, name: agent.name }))),
      opened.id,
    );
    const local = await hostPage.evaluate(() =>
      window.openbot.agent.listAgents().then((agents) => agents.map((agent) => ({ id: agent.id, name: agent.name }))),
    );
    assert.deepEqual(
      listed.map((agent) => agent.id).sort(),
      local.map((agent) => agent.id).sort(),
      "The member does not see the agents of the host.",
    );
    const names = local.length === 0 ? ["Create your first agent"] : local.map((agent) => agent.name);
    for (const name of names) assert.ok(yaml.includes(name), `The agent list of the host does not show ${name}.`);
    await screenshot(memberPage, "member-host-workspace.png");
  });

  await check("The host's Team section shows a roster change that arrives while its window loads", async () => {
    const image = await holdImage();
    const session = await hostPage.context().newCDPSession(hostPage);
    await session.send("Page.enable");
    const { identifier } = await session.send("Page.addScriptToEvaluateOnNewDocument", {
      source: heldImageScript(image.url),
    });
    try {
      await hostPage.reload({ waitUntil: "commit" });
      await deadline("the reloaded host window asks for the held image", image.requested);
      await settled(hostPage);
      await openTeamSettings(hostPage);
      const list = hostPage.getByRole("region", { name: "Members", exact: true });
      await list.getByText(MEMBER_USER, { exact: true }).waitFor({ state: "visible", timeout: WAIT_MS });
      assert.notEqual(await hostPage.evaluate(() => document.readyState), "complete");
      await memberPage.evaluate(() => window.openbot.relay.removeIdentity());
      await untilMainRoster(hostPage, MEMBER_USER, false);
      image.release();
      await hostPage.waitForFunction(() => document.readyState === "complete", undefined, { timeout: WAIT_MS });
      await list.getByText(MEMBER_USER, { exact: true }).waitFor({ state: "detached", timeout: WAIT_MS });
      await list.getByText(HOST_USER, { exact: true }).waitFor({ state: "visible", timeout: WAIT_MS });
      await screenshot(hostPage, "host-team-after-load.png");
    } finally {
      await session.send("Page.removeScriptToEvaluateOnNewDocument", { identifier }).catch(() => undefined);
      await session.detach().catch(() => undefined);
      await image.close();
    }
  });

  await check("The member joins with a code in Settings > Team, and Replace with a code joins again", async () => {
    await openServerMenu(memberPage);
    await chooseMenuItem(memberPage, "Connect to your team");
    await memberPage.getByRole("heading", { name: "Team identity" }).waitFor({ state: "visible", timeout: WAIT_MS });
    await memberPage.getByRole("textbox", { name: "Join code" }).fill(joinCode(environment, "joiner", "laptop-2"));
    await screenshot(memberPage, "member-join-code.png");
    await memberPage.getByRole("button", { name: "Join", exact: true }).click();
    await memberPage
      .getByText("laptop-2", { exact: true })
      .first()
      .waitFor({ state: "visible", timeout: WAIT_MS })
      .catch(async (error: unknown) => {
        const alerts = await memberPage.getByRole("alert").allInnerTexts();
        throw new Error(`The join did not finish: ${alerts.join(" | ")} ${inspect(error)}`);
      });
    const joined = await relayState(memberPage, false, HOST_USER);
    assert.deepEqual(
      [joined.identity?.team, joined.identity?.user, joined.identity?.device],
      [TEAM, "joiner", "laptop-2"],
    );
    await memberPage.getByText("joiner", { exact: true }).first().waitFor({ state: "visible", timeout: WAIT_MS });
    await screenshot(memberPage, "member-joined.png");
    await memberPage.getByRole("button", { name: "Use a code", exact: true }).click();
    await memberPage
      .getByRole("alertdialog", { name: "Replace the team identity?" })
      .getByRole("button", { name: "Continue", exact: true })
      .click();
    const dialog = memberPage.getByRole("alertdialog", { name: "Join with a code" });
    await dialog.getByRole("textbox", { name: "Join code" }).fill(joinCode(environment, "joiner", "laptop-3"));
    await dialog.getByRole("button", { name: "Join", exact: true }).click();
    await dialog.waitFor({ state: "detached", timeout: WAIT_MS });
    const replaced = await relayState(memberPage, false, HOST_USER);
    assert.equal(replaced.identity?.device, "laptop-3");
    await memberPage.getByText("laptop-3", { exact: true }).first().waitFor({ state: "visible", timeout: WAIT_MS });
    await screenshot(memberPage, "member-replaced.png");
  });
} catch (error) {
  checks.push({ name: "The test runs to its end", passed: false, error: inspect(error) });
} finally {
  for (const app of apps) await app.browser?.close().catch(() => undefined);
  if (stack)
    await stopStack(stack).catch((error: unknown) => logger.warn("The dev stack did not stop.", inspect(error)));
  if (relay) {
    relay.child.kill("SIGTERM");
    await deadline("the relay server stops", relay.exited).catch(() => relay?.child.kill("SIGKILL"));
  }
  for (const profile of profiles) rmSync(profile.path, { recursive: true, force: true });
  rmSync(work, { recursive: true, force: true });
  const passed = checks.filter((entry) => entry.passed).length;
  const report = {
    passed,
    failed: checks.length - passed,
    checks,
    hostServerName,
    instances: profiles.map((profile) => ({
      role: profile.role,
      service: profile.service,
      instanceId: stackInstanceId,
    })),
    artifacts: artifacts.map((path) => path.slice(ROOT.length + 1)),
    relayLog: relay?.log.join("").slice(-20_000) ?? "",
  };
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  logger.info(`Report: ${join(OUT, "report.json")} (${passed} of ${checks.length} passed)`);
  process.exit(passed === checks.length && checks.length > 0 ? 0 : 1);
}
