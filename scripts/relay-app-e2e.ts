import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash, randomInt, X509Certificate } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { inspect } from "node:util";
import type { OpenBotDesktopApi, RelayState, ServerSummary } from "@openbot/contracts/ipc";
import { decodeRelayIdentityBundle, type RelayIdentityBundle } from "@openbot/contracts/relay-protocol/identity-bundle";
import { RELAY_PATH, type RelayTeamMember } from "@openbot/contracts/relay-protocol/messages";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect, Result } from "effect";
import type { Browser, Page } from "playwright-core";
import { developmentUserDataName } from "../src/main/development-profile";
import { RelayClientCoordinator } from "../src/main/relay/client-coordinator";
import { type RelayCipher, RelayIdentityStore } from "../src/main/relay/identity-store";
import { RELAY_IDENTITY_FILE } from "../src/main/relay-service";
import { decodeAgentSummaries } from "../src/main/remote-agent-decoding";
import type { RelayDirectoryHost } from "../src/main/remote-relay-directory";
import { type RemoteRelayTransport, RemoteServerManager } from "../src/main/remote-server-manager";
import { decodeRelayState } from "../src/preload/relay-decoding";
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
const OUT = resolve(ROOT, ".openbot-build/relay-app-e2e");
const MAIN = resolve(ROOT, "remote/api/src/relay/main.ts");
const READY_LINE = "OpenBot relay is ready";
const START_GUARD_MS = 300_000;
const WAIT_MS = 60_000;
const TEAM = "Acme";
const APP_USER = "app-user";
const CLIENT_USER = "test-client";
const SECOND_USER = "second-file";
const logger = createOpenBotLogger("relay-app-e2e");

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
    logger.info(`PASS ${name}`);
  } catch (error) {
    checks.push({ name, passed: false, error: error instanceof Error ? error.message : inspect(error) });
    logger.error(`FAIL ${name}`, error instanceof Error ? error.message : inspect(error));
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

function issue(environment: Record<string, string>, file: string, user: string, device: string): RelayIdentityBundle {
  const result = command(environment, "ca", "issue", "--team", TEAM, "--user", user, "--device", device, "--out", file);
  assert.equal(result.status, 0, result.output);
  const bundle = decodeRelayIdentityBundle(JSON.parse(readFileSync(file, "utf8")));
  assert.ok(bundle, "The identity file must decode.");
  return bundle;
}

function keyIdOf(bundle: RelayIdentityBundle): string {
  const spki = new X509Certificate(bundle.certificate).publicKey.export({ type: "spki", format: "der" });
  return createHash("sha256").update(spki).digest("base64url");
}

function pemBodyLines(pem: string): string[] {
  return pem
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length >= 16 && !line.startsWith("-----"));
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
    onData();
    return () => child.stdout.off("data", onData);
  }).catch((error: unknown) => {
    child.kill("SIGKILL");
    throw new Error(`${error instanceof Error ? error.message : inspect(error)} Log: ${log.join("")}`);
  });
  return { child, log, exited };
}

interface RunningApp {
  child: ChildProcess;
  exited: Promise<number | null>;
  output: () => string;
  instance: DevInstanceRecord;
  browser: Browser | null;
  page: Page | null;
}

const instanceId = (() => {
  for (;;) {
    const candidate = String(randomInt(40_000, 49_999));
    if (!existsSync(join(resolveDevelopmentAppDataRoot(), developmentUserDataName("app", candidate)))) return candidate;
  }
})();
const profile = join(resolveDevelopmentAppDataRoot(), developmentUserDataName("app", instanceId));
let launches = 0;

async function startApp(switches: string[]): Promise<RunningApp> {
  launches += 1;
  mkdirSync(OUT, { recursive: true });
  const logFile = createWriteStream(join(OUT, `app-${launches}.log`));
  const child = spawn("bun", ["scripts/dev-services.ts", "app"], {
    cwd: ROOT,
    env: {
      ...process.env,
      OPENBOT_DEV_INSTANCE_ID: instanceId,
      OPENBOT_DEV_WINDOW_FOCUS: "background",
      OPENBOT_DEV_ELECTRON_ARGS: JSON.stringify(switches),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const append = (chunk: Buffer) => {
    output = `${output}${chunk.toString()}`.slice(-400_000);
    logFile.write(chunk);
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  const exited = new Promise<number | null>((resolveExit) => {
    child.once("exit", resolveExit);
  });
  child.once("close", () => logFile.end());
  const marker = `--instance=${instanceId}`;
  const instance = await until<DevInstanceRecord>(
    "the dev app is in the instance registry",
    (done) => {
      const look = () => {
        if (!output.includes(marker)) return;
        const record = readDevInstanceRecords().find(
          (candidate) => candidate.instanceId === instanceId && candidate.projectRoot === ROOT,
        );
        if (record) done(record);
      };
      child.stdout?.on("data", look);
      child.stderr?.on("data", look);
      look();
      return () => {
        child.stdout?.off("data", look);
        child.stderr?.off("data", look);
      };
    },
    START_GUARD_MS,
  );
  return { child, exited, output: () => output, instance, browser: null, page: null };
}

async function connectPage(app: RunningApp): Promise<Page> {
  if (app.page) return app.page;
  const browser = await openDevBrowser(app.instance.remoteDebuggingPort, logger, { ownerPid: app.instance.pid });
  app.browser = browser;
  const page = await until<Page>("the main window of the app", (done) => {
    const look = () => {
      const [main] = findMainPages(devBrowserPages(browser), app.instance.rendererPort);
      if (main) done(main);
    };
    const contexts = browser.contexts();
    for (const context of contexts) context.on("page", look);
    look();
    return () => {
      for (const context of contexts) context.off("page", look);
    };
  });
  await page.waitForFunction(() => typeof window.openbot === "object" && typeof window.openbot.relay === "object", {
    timeout: WAIT_MS,
  });
  app.page = page;
  return page;
}

type StateCondition = "hosting-online" | "hosting-off-online" | "identity-online";

const WAIT_FOR_RELAY_STATE = `(wanted) => new Promise((resolve) => {
  let finished = false;
  let unsubscribe = null;
  function matches(state) {
    if (state.identity === null || state.control.status !== "online") return false;
    if (wanted === "hosting-online") return state.hosting && state.hostingState.status === "online";
    if (wanted === "hosting-off-online") return !state.hosting && state.hostingState.status === "off";
    return true;
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

interface PageRelayState {
  state: RelayState;
  raw: string;
}

async function appState(page: Page, condition: StateCondition): Promise<PageRelayState> {
  return pageRelayState(
    await deadline(
      `the app relay state is ${condition}`,
      page.evaluate(`(${WAIT_FOR_RELAY_STATE})(${JSON.stringify(condition)})`),
    ),
  );
}

function pageRelayState(value: unknown): PageRelayState {
  return { state: decodeRelayState(value), raw: JSON.stringify(value) };
}

async function stopApp(app: RunningApp): Promise<void> {
  await app.browser?.close().catch(() => undefined);
  const stopped = spawnSync("bun", ["scripts/dev-stack.ts", "stop", `--pid=${app.child.pid}`], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (stopped.status !== 0) {
    logger.warn(`dev-stack stop did not finish: ${stopped.stdout}${stopped.stderr}`);
    app.child.kill("SIGTERM");
  }
  await deadline("the dev app stops", app.exited, WAIT_MS);
}

const work = mkdtempSync(join(tmpdir(), "openbot-relay-app-e2e-"));
const dataDirectory = join(work, "data");
const clientData = join(work, "client");
mkdirSync(clientData);
const appIdentityFile = join(work, "app-user.json");
const clientIdentityFile = join(work, "test-client.json");
const secondIdentityFile = join(work, "second-file.json");

const [relayPort, healthPort] = await Promise.all([freePort(), freePort()]);
const relayUrl = `wss://127.0.0.1:${relayPort}${RELAY_PATH}`;
const environment = {
  RELAY_DATA_DIR: dataDirectory,
  RELAY_HOST: "127.0.0.1",
  RELAY_PORT: String(relayPort),
  RELAY_HEALTH_PORT: String(healthPort),
  RELAY_PUBLIC_URL: relayUrl,
};

const relayRequests: string[] = [];
let relay: Relay | null = null;
let app: RunningApp | null = null;
let coordinator: RelayClientCoordinator | null = null;
let manager: RemoteServerManager | null = null;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
mkdirSync(profile);

try {
  await check("The relay server makes a root, a server certificate and the team Acme", () => {
    assert.equal(command(environment, "ca", "init").status, 0);
    assert.equal(command(environment, "ca", "server", "--dns", "localhost", "--ip", "127.0.0.1").status, 0);
    assert.equal(command(environment, "ca", "team", "add", TEAM).status, 0);
  });

  const appBundle = issue(environment, appIdentityFile, APP_USER, "desktop");
  const clientBundle = issue(environment, clientIdentityFile, CLIENT_USER, "node");
  issue(environment, secondIdentityFile, SECOND_USER, "desktop");
  const appKeyId = keyIdOf(appBundle);
  const clientStore = new RelayIdentityStore({ path: join(clientData, "identity.json"), cipher: testCipher });
  await ok(clientStore.importBundle(clientBundle));

  relay = await startRelay(environment);

  const clientCoordinator = new RelayClientCoordinator({
    identity: clientStore,
    reconnect: { baseMs: 100, maxMs: 500 },
  });
  coordinator = clientCoordinator;
  const transport: RemoteRelayTransport = {
    fetchFor: (url) => {
      const send = clientCoordinator.fetchFor(url);
      if (!send) return null;
      return (input, init) => {
        relayRequests.push(`${init?.method ?? "GET"} ${new URL(input).pathname}`);
        return send(input, init);
      };
    },
    openEventSocket: (url, protocols) => clientCoordinator.openEventSocket(url, protocols),
  };
  const clientManager = new RemoteServerManager(join(clientData, "openbot-remote-servers.json"), testCipher, {
    appVersion: "0.0.0-e2e",
    relayTransport: transport,
  });
  manager = clientManager;
  await Effect.runPromise(clientManager.initialize());
  await Effect.runPromise(clientManager.startEventConnections());
  await ok(clientCoordinator.start(clientManager.relayRecords));

  const untilRoster = (
    description: string,
    accepts: (members: readonly RelayTeamMember[]) => boolean,
    limitMs = WAIT_MS,
  ) =>
    until<readonly RelayTeamMember[]>(
      description,
      (done) => {
        const listener = (members: readonly RelayTeamMember[]) => {
          if (accepts(members)) done(members);
        };
        clientCoordinator.on("roster", listener);
        listener(clientCoordinator.roster());
        return () => clientCoordinator.off("roster", listener);
      },
      limitMs,
    );
  const untilHosts = (description: string, accepts: (hosts: readonly RelayDirectoryHost[]) => boolean) =>
    until<readonly RelayDirectoryHost[]>(description, (done) => {
      const listener = (hosts: readonly RelayDirectoryHost[]) => {
        if (accepts(hosts)) done(hosts);
      };
      clientCoordinator.on("hosts", listener);
      listener(clientCoordinator.hosts());
      return () => clientCoordinator.off("hosts", listener);
    });
  const untilServer = (description: string, accepts: (server: ServerSummary) => boolean) =>
    until<ServerSummary>(description, (done) => {
      const listener = (list: ServerSummary[]) => {
        const server = list.find((candidate) => candidate.kind === "remote");
        if (server && accepts(server)) done(server);
      };
      clientManager.on("changed", listener);
      listener(clientManager.list());
      return () => clientManager.off("changed", listener);
    });
  const appMember = (members: readonly RelayTeamMember[]) => members.find((member) => member.user === APP_USER);

  await until<void>("the test client is online", (done) => {
    const listener = () => {
      if (clientCoordinator.state().status === "online") done();
    };
    clientCoordinator.on("state", listener);
    listener();
    return () => clientCoordinator.off("state", listener);
  });

  app = await startApp([`--import-relay-identity=${appIdentityFile}`, "--relay-hosting=on"]);
  const firstApp = app;

  await check(
    "The app imports the identity file of the start switch and is in the roster with hosting on",
    async () => {
      const members = await untilRoster(
        "the app hosts in the roster",
        (roster) => appMember(roster)?.hosting === true,
        START_GUARD_MS,
      );
      const member = appMember(members);
      assert.equal(member?.keyId, appKeyId);
      assert.equal(member?.device, "desktop");
    },
  );

  let hostServerId = "";
  await check("The test client signs in with /v1/auth/relay and lists the app's agents", async () => {
    const server = await untilServer("the app is an online server record", (candidate) => candidate.state === "online");
    hostServerId = server.id;
    assert.ok(
      relayRequests.includes(`POST ${TEAM_API_ROUTES.auth.relay}`),
      `No relay sign-in in ${inspect(relayRequests)}`,
    );
    assert.equal(server.role, "member");
    const listed = await ok(clientManager.request(hostServerId, TEAM_API_ROUTES.agents.all, decodeAgentSummaries));
    const page = await connectPage(firstApp);
    const local = await deadline(
      "the local agent list",
      page.evaluate(() => window.openbot.agent.listAgents()),
    );
    assert.deepEqual(
      listed.map((agent) => agent.id).sort(),
      local.map((agent) => agent.id).sort(),
      "The agents through the relay are not the agents of the app.",
    );
  });

  let firstState: PageRelayState | null = null;
  await check("relay.getState() of the app names the team, the user and the members", async () => {
    const page = await connectPage(firstApp);
    const read = await appState(page, "hosting-online");
    firstState = read;
    const { state } = read;
    assert.equal(state.identity?.team, TEAM);
    assert.equal(state.identity?.user, APP_USER);
    assert.equal(state.identity?.device, "desktop");
    assert.equal(state.identity?.keyId, appKeyId);
    assert.equal(state.identity?.relayUrl, relayUrl);
    assert.equal(state.hosting, true);
    const self = state.members.find((member) => member.self);
    assert.deepEqual([self?.user, self?.hosting, self?.keyId], [APP_USER, true, appKeyId]);
    const client = state.members.find((member) => member.user === CLIENT_USER);
    assert.deepEqual([client?.self, client?.hosting], [false, false]);
  });

  await check("No private key, certificate or session token crosses the preload", () => {
    assert.ok(firstState, "No state was read.");
    const text = firstState.raw;
    assert.doesNotMatch(text, /PRIVATE KEY|CERTIFICATE|encryptedPrivateKey|sessionToken/u);
    for (const line of [...pemBodyLines(appBundle.privateKey), ...pemBodyLines(appBundle.certificate)])
      assert.ok(!text.includes(line), "A key or certificate line reached the renderer.");
    assert.doesNotMatch(text, /"(privateKey|certificate|chain|root|encryptedPrivateKey|sessionToken|token)"/u);
    assert.equal(firstState.state.identity?.keyId, appKeyId);
  });

  await check("setHosting(false) through the preload removes the app from the hosts of the team", async () => {
    const page = await connectPage(firstApp);
    const gone = untilHosts("the client has no host", (hosts) => hosts.length === 0);
    const notHosting = untilRoster("the app no longer hosts", (roster) => appMember(roster)?.hosting === false);
    const returned = await deadline(
      "setHosting(false)",
      page.evaluate(() => window.openbot.relay.setHosting(false)),
    );
    assert.equal(returned.hosting, false);
    assert.equal(returned.hostingState.status, "off");
    await notHosting;
    await gone;
    await untilServer("the app record is no longer online", (server) => server.state !== "online");
  });

  await check("The stored identity keeps the private key encrypted and the identity file stays on disk", () => {
    const stored = readFileSync(join(profile, RELAY_IDENTITY_FILE), "utf8");
    assert.match(stored, /"encryptedPrivateKey"/u);
    assert.doesNotMatch(stored, /PRIVATE KEY/u);
    for (const line of pemBodyLines(appBundle.privateKey)) assert.ok(!stored.includes(line));
    assert.ok(existsSync(appIdentityFile), "The start switch deleted the identity file.");
  });

  const leftRoster = untilRoster("the app leaves the roster", (roster) => appMember(roster) === undefined);
  await stopApp(firstApp);
  app = null;
  await leftRoster;

  app = await startApp([`--import-relay-identity=${secondIdentityFile}`]);
  const secondApp = app;

  await check(
    "A restart with the same profile keeps the identity and the hosting choice, and ignores the switch",
    async () => {
      const members = await untilRoster(
        "the app is back in the roster",
        (roster) => appMember(roster) !== undefined,
        START_GUARD_MS,
      );
      assert.equal(appMember(members)?.hosting, false);
      assert.equal(
        members.some((member) => member.user === SECOND_USER),
        false,
      );
      const page = await connectPage(secondApp);
      const { state } = await appState(page, "hosting-off-online");
      assert.deepEqual([state.identity?.team, state.identity?.user, state.identity?.keyId], [TEAM, APP_USER, appKeyId]);
      assert.equal(state.hosting, false);
    },
  );

  await check("The app writes no private key line to its logs", () => {
    const logs = join(profile, "logs");
    const files = existsSync(logs) ? readdirSync(logs, { recursive: true, encoding: "utf8" }) : [];
    const secrets = pemBodyLines(appBundle.privateKey);
    let scanned = 0;
    for (const name of files) {
      const path = join(logs, name);
      if (!statSync(path).isFile()) continue;
      scanned += 1;
      const text = readFileSync(path, "utf8");
      assert.doesNotMatch(text, /BEGIN [A-Z ]*PRIVATE KEY/u, `${name} has a private key.`);
      for (const line of secrets) assert.ok(!text.includes(line), `${name} has a line of the private key.`);
    }
    assert.ok(scanned > 0, "The app wrote no log file.");
  });
} catch (error) {
  checks.push({ name: "The test runs to its end", passed: false, error: inspect(error) });
} finally {
  if (app) await stopApp(app).catch((error: unknown) => logger.warn("The app did not stop.", inspect(error)));
  if (coordinator) await Effect.runPromise(coordinator.stop()).catch(() => undefined);
  if (manager) await Effect.runPromise(Effect.result(manager.stop())).catch(() => undefined);
  if (relay) {
    relay.child.kill("SIGTERM");
    await deadline("the relay server stops", relay.exited).catch(() => relay?.child.kill("SIGKILL"));
  }
  rmSync(profile, { recursive: true, force: true });
  rmSync(work, { recursive: true, force: true });
  const passed = checks.filter((entry) => entry.passed).length;
  const report = {
    passed,
    failed: checks.length - passed,
    checks,
    instanceId,
    relayLog: relay?.log.join("").slice(-20_000) ?? "",
  };
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  logger.info(`Report: ${join(OUT, "report.json")} (${passed} of ${checks.length} passed)`);
  process.exit(passed === checks.length && checks.length > 0 ? 0 : 1);
}
