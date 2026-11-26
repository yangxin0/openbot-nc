import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes, X509Certificate } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createNetServer, connect as netConnect, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { inspect } from "node:util";
import { decodeRelayIdentityBundle, type RelayIdentityBundle } from "@openbot/contracts/relay-protocol/identity-bundle";
import { RELAY_PATH } from "@openbot/contracts/relay-protocol/messages";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  TEAM_APP_VERSION_HEADER,
  TEAM_CURRENT_CAPABILITIES,
  TEAM_PROTOCOL_V10,
  TEAM_PROTOCOL_VERSION_HEADER,
  teamCapabilityHeaders,
} from "@openbot/contracts/team-protocol";
import { Effect, Result, Schema } from "effect";
import WsSocket from "ws";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { SidebarLayoutStore } from "../src/backend/sidebar-layout-store";
import { HostService } from "../src/main/host-service";
import { RelayControl, type RelayControlState } from "../src/main/relay/control";
import { RelayDialer } from "../src/main/relay/dialer";
import { createRelayFetch } from "../src/main/relay/fetch";
import { type RelayCipher, RelayIdentityStore } from "../src/main/relay/identity-store";
import { decodeJoinResult } from "../src/main/remote-team-decoding";
import type { TeamApiBrowser } from "../src/main/team-api/dependencies";
import { TeamStore } from "../src/main/team-store";
import {
  installCountingWebSocket,
  measureTeamClient,
  type TeamClientMeasurements,
} from "./relay-session-latency-e2e-client";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, ".openbot-build/relay-session-latency-e2e");
const MAIN = resolve(ROOT, "remote/api/src/relay/main.ts");
const PHONE = resolve(ROOT, "scripts/relay-session-latency-e2e-phone.ts");
const ONE_WAY_DELAY_MS = 100;
const ROUND_TRIP_MS = 4 * ONE_WAY_DELAY_MS;
const TRANSFER_BYTES = 4 * 1024 * 1024;
const WAIT_MS = 60_000;
const READY_LINE = "OpenBot relay is ready";
const APP_VERSION = "0.0.0-e2e";
const TEAM = "Acme";
const REQUEST_SAMPLES = 5;
const APPS = ["host", "desktop", "browser", "phone"] as const;
const TEST_DATA_IDLE_MS = 1_500;

interface Check {
  name: string;
  passed: boolean;
  error?: string;
}

const checks: Check[] = [];
type ReportValue = number | boolean | string | readonly ReportValue[] | { readonly [key: string]: ReportValue };
const numbers: Record<string, ReportValue> = { oneWayDelayMs: ONE_WAY_DELAY_MS, roundTripMs: ROUND_TRIP_MS };
const Measured = Schema.Struct({
  tunnelsReadyMs: Schema.Number,
  sessionOpensForTunnels: Schema.Number,
  connectMs: Schema.Number,
  sessionOpensForConnect: Schema.Number,
  requestMs: Schema.Array(Schema.Number),
  requestStatuses: Schema.Array(Schema.Number),
  duringUploadMs: Schema.Array(Schema.Number),
  duringUploadActive: Schema.Array(Schema.Boolean),
  uploadMs: Schema.Number,
  uploadStatus: Schema.Number,
  sockets: Schema.Number,
});
const decodePhoneResult = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      ok: Schema.Boolean,
      measured: Schema.optional(Measured),
      globalCrypto: Schema.optional(Schema.String),
      error: Schema.optional(Schema.String),
    }),
  ),
);
const decodeAttachment = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }));

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

async function ok<A, E>(operation: Effect.Effect<A, E>): Promise<A> {
  const result = await Effect.runPromise(Effect.result(operation));
  if (Result.isFailure(result)) throw new Error(`The operation failed: ${inspect(result.failure)}`);
  return result.success;
}

function untilState(control: RelayControl, accepts: (state: RelayControlState) => boolean): Promise<void> {
  return deadline(
    "the relay control state",
    new Promise<void>((resolveState) => {
      const listener = (state: RelayControlState) => {
        if (!accepts(state)) return;
        control.off("state", listener);
        resolveState();
      };
      control.on("state", listener);
      listener(control.state());
    }),
  );
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
  user: string,
  device: string,
): RelayIdentityBundle {
  const file = join(directory, `${randomBytes(6).toString("hex")}.json`);
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
  await deadline(
    "the relay server is ready",
    new Promise<void>((resolveReady) => {
      child.stdout.on("data", (chunk: Buffer) => {
        log.push(chunk.toString());
        if (log.join("").includes(READY_LINE)) resolveReady();
      });
    }),
  ).catch((error: unknown) => {
    child.kill("SIGKILL");
    throw new Error(`${error instanceof Error ? error.message : inspect(error)} Log: ${log.join("")}`);
  });
  return { child, log, exited };
}

interface DelayProxy {
  server: Server;
  accepted: number;
  sockets: Set<Socket>;
}

function delayed(from: Socket, to: Socket): void {
  from.on("data", (chunk: Buffer) => {
    setTimeout(() => {
      if (!to.destroyed) to.write(chunk);
    }, ONE_WAY_DELAY_MS);
  });
  from.on("end", () => setTimeout(() => to.end(), ONE_WAY_DELAY_MS));
  from.on("close", () => setTimeout(() => to.destroy(), ONE_WAY_DELAY_MS));
  from.on("error", () => undefined);
}

function startDelayProxy(listenPort: number, relayPort: number): Promise<DelayProxy> {
  const proxy: DelayProxy = { server: createNetServer(), accepted: 0, sockets: new Set() };
  proxy.server.on("connection", (device) => {
    proxy.accepted += 1;
    const relay = netConnect(relayPort, "127.0.0.1");
    for (const socket of [device, relay]) {
      socket.setNoDelay(true);
      proxy.sockets.add(socket);
      socket.once("close", () => proxy.sockets.delete(socket));
    }
    delayed(device, relay);
    delayed(relay, device);
  });
  return new Promise((resolveProxy, reject) => {
    proxy.server.once("error", reject);
    proxy.server.listen(listenPort, "127.0.0.1", () => resolveProxy(proxy));
  });
}

function teamHeaders(token: string | null): Record<string, string> {
  return {
    [TEAM_PROTOCOL_VERSION_HEADER]: String(TEAM_PROTOCOL_V10),
    [TEAM_APP_VERSION_HEADER]: APP_VERSION,
    ...teamCapabilityHeaders(TEAM_PROTOCOL_V10, TEAM_CURRENT_CAPABILITIES),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function rounded(values: readonly number[]): number[] {
  return values.map((value) => Math.round(value));
}

function assertBelow(values: readonly number[], limitMs: number, description: string): void {
  for (const value of values)
    assert.ok(value < limitMs, `${description}: ${Math.round(value)} ms is not below ${limitMs} ms.`);
}

const testCipher: RelayCipher = {
  encrypt: (value) => Buffer.from(value, "utf8").reverse(),
  decrypt: (value) => Buffer.from(value).reverse().toString("utf8"),
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

const work = mkdtempSync(join(tmpdir(), "openbot-relay-session-latency-e2e-"));
const dataDirectory = join(work, "data");
const userData = join(work, "user-data");
const [relayPort, proxyPort, healthPort] = await Promise.all([freePort(), freePort(), freePort()]);
const relayUrl = `wss://127.0.0.1:${proxyPort}${RELAY_PATH}`;
const metricsToken = randomBytes(16).toString("hex");
const environment = {
  RELAY_DATA_DIR: dataDirectory,
  RELAY_HOST: "127.0.0.1",
  RELAY_PORT: String(relayPort),
  RELAY_HEALTH_PORT: String(healthPort),
  RELAY_PUBLIC_URL: relayUrl,
  RELAY_METRICS_TOKEN: metricsToken,
};
const reconnect = { baseMs: 100, maxMs: 500 };
const socketsAfter: Record<string, number> = {};
let relay: Relay | null = null;
let proxy: DelayProxy | null = null;
let database: OpenBotDatabase | null = null;
let agents: AgentService | null = null;
let host: HostService | null = null;
const controls: RelayControl[] = [];
const closers: Array<() => void> = [];
const stops: Array<() => void> = [];

async function metrics(): Promise<Record<string, number>> {
  const response = await fetch(`http://127.0.0.1:${healthPort}/metrics`, {
    headers: { Authorization: `Bearer ${metricsToken}` },
  });
  const values: Record<string, number> = {};
  for (const line of (await response.text()).split("\n")) {
    const [name, value] = line.split(" ");
    if (name && value) values[name] = Number(value);
  }
  return values;
}

async function untilMetric(name: string, value: number): Promise<Record<string, number>> {
  for (const started = Date.now(); Date.now() - started < WAIT_MS; ) {
    const current = await metrics();
    if (current[name] === value) return current;
    await new Promise<void>((resolveNext) => setImmediate(resolveNext));
  }
  throw new Error(`Timed out: the relay metric ${name} is ${value}.`);
}

function assertClient(measured: TeamClientMeasurements, name: string): void {
  numbers[name] = {
    tunnelsReadyMs: Math.round(measured.tunnelsReadyMs),
    sessionOpensForTunnels: measured.sessionOpensForTunnels,
    connectMs: Math.round(measured.connectMs),
    sessionOpensForConnect: measured.sessionOpensForConnect,
    requestMs: rounded(measured.requestMs),
    duringUploadMs: rounded(measured.duringUploadMs),
    duringUploadActive: measured.duringUploadActive,
    uploadMs: Math.round(measured.uploadMs),
    webSockets: measured.sockets,
  };
  assert.equal(measured.sessionOpensForTunnels, 1, "One host connection opens exactly one session.");
  assert.equal(measured.sessionOpensForConnect, 1, "The peer connection opens exactly one session.");
  assert.equal(measured.sockets, 2, "The app opened one control and one data WebSocket.");
  assert.ok(
    measured.tunnelsReadyMs <= 2.5 * ROUND_TRIP_MS,
    `The three channels took ${Math.round(measured.tunnelsReadyMs)} ms, more than 2.5 round trips.`,
  );
  assert.deepEqual(measured.requestStatuses, Array(REQUEST_SAMPLES).fill(200));
  assertBelow(measured.requestMs, 1.5 * ROUND_TRIP_MS, "A request on the open connection");
  assert.ok(measured.duringUploadActive.filter(Boolean).length >= 2, "At least two requests ran during the upload.");
  assertBelow(measured.duringUploadMs, 1.5 * ROUND_TRIP_MS, "A request during the 4 MiB upload");
  assert.equal(measured.uploadStatus, 201);
}

try {
  await check("The certificate commands make a root, a server certificate and a team", () => {
    assert.equal(command(environment, "ca", "init").status, 0);
    assert.equal(command(environment, "ca", "server", "--dns", "localhost", "--ip", "127.0.0.1").status, 0);
    assert.equal(command(environment, "ca", "team", "add", TEAM).status, 0);
  });
  const hostBundle = issue(environment, work, "host-user", "server");
  const desktopBundle = issue(environment, work, "alice", "laptop");
  const browserBundle = issue(environment, work, "alice", "browser");
  const phoneBundle = issue(environment, work, "alice", "phone");
  const hostKeyId = keyIdOf(hostBundle);
  const store = async (name: string, bundle: RelayIdentityBundle) => {
    const identity = new RelayIdentityStore({ path: join(work, `${name}.json`), cipher: testCipher });
    await ok(identity.importBundle(bundle));
    return identity;
  };
  const hostStore = await store("host", hostBundle);
  const desktopStore = await store("desktop", desktopBundle);

  relay = await startRelay(environment);
  proxy = await startDelayProxy(proxyPort, relayPort);
  const proxied = proxy;

  database = new OpenBotDatabase(userData);
  const agentStore = new AgentStore(userData, join(work, "home"), database);
  const mailbox = new MailboxStore(userData, agentStore.sharedRoot, agentStore.database);
  const sidebar = new SidebarLayoutStore(join(userData, "sidebar-layout.json"));
  const team = new TeamStore(join(userData, "openbot-team-server-v2.json"));
  await runCauseEffect(sidebar.initialize());
  await runCauseEffect(agentStore.initialize());
  await runCauseEffect(mailbox.initialize());
  await runCauseEffect(team.initialize());
  agents = new AgentService({ store: agentStore, mailbox, browser: agentBrowser, sidebarLayout: sidebar });
  const hostService = new HostService({
    appVersion: APP_VERSION,
    store: team,
    agents,
    agentsReady: () => Effect.void,
    skills: { listInstalledForChatTags: () => Effect.succeed([]) },
    sidebarLayout: sidebar,
    mailbox,
    browser: teamBrowser,
    getLocalProfile: () => ({ id: "local-profile-e2e", name: "Host Person", chatColor: null }),
  });
  host = hostService;
  const hostControl = new RelayControl({ identity: hostStore, reconnect });
  controls.push(hostControl);

  await check("The host app shares on its control WebSocket", async () => {
    await ok(hostService.startRelayHosting(hostStore, { reconnect, control: hostControl }));
    await untilState(hostControl, (state) => state.status === "online");
    socketsAfter.host = proxied.accepted;
    assert.equal(proxied.accepted, 1);
  });

  const desktopControl = new RelayControl({ identity: desktopStore, reconnect });
  controls.push(desktopControl);
  const dialer = new RelayDialer({ control: desktopControl });
  await check("The desktop client app connects with its control WebSocket", async () => {
    await ok(desktopControl.start());
    await untilState(desktopControl, (state) => state.status === "online");
    socketsAfter.desktop = proxied.accepted;
    assert.equal(proxied.accepted, 2);
  });

  await check("The first session opens one data WebSocket for each of the two apps", async () => {
    const started = performance.now();
    const fetcher = createRelayFetch({ dialer, target: hostKeyId });
    const response = await deadline(
      "the first request with no data socket",
      fetcher.fetch(`${fetcher.origin}${TEAM_API_ROUTES.compatibility}`, { headers: teamHeaders(null) }),
    );
    await response.text();
    numbers.desktopColdFirstRequestMs = Math.round(performance.now() - started);
    fetcher.close();
    assert.equal(response.status, 200);
    socketsAfter.desktopData = proxied.accepted;
    assert.equal(proxied.accepted, 4);
    assert.equal((await untilMetric("openbot_relay_data_sockets", 2)).openbot_relay_members, 2);
  });

  await check(
    "(a) With the data socket open, a session is ready in about one round trip and the first request in about two",
    async () => {
      await untilMetric("openbot_relay_sessions", 0);
      const dialStarted = performance.now();
      const stream = await deadline("the desktop session", ok(dialer.dial(hostKeyId)));
      const sessionReadyMs = performance.now() - dialStarted;
      stream.destroy();
      const before = await untilMetric("openbot_relay_sessions", 0);
      const fetcher = createRelayFetch({ dialer, target: hostKeyId });
      closers.push(fetcher.close);
      const started = performance.now();
      const response = await deadline(
        "the first request",
        fetcher.fetch(`${fetcher.origin}${TEAM_API_ROUTES.compatibility}`, { headers: teamHeaders(null) }),
      );
      await response.text();
      const firstRequestMs = performance.now() - started;
      const after = await metrics();
      const desktopNumbers = { sessionReadyMs: Math.round(sessionReadyMs), firstRequestMs: Math.round(firstRequestMs) };
      numbers.desktop = desktopNumbers;
      assert.equal(response.status, 200);
      assert.equal((after.openbot_relay_sessions ?? 0) - (before.openbot_relay_sessions ?? 0), 1);
      assert.ok(sessionReadyMs <= 1.5 * ROUND_TRIP_MS, `The session took ${Math.round(sessionReadyMs)} ms.`);
      assert.ok(firstRequestMs <= 2.5 * ROUND_TRIP_MS, `The first request took ${Math.round(firstRequestMs)} ms.`);
      const further: number[] = [];
      for (let index = 0; index < REQUEST_SAMPLES; index += 1) {
        const next = performance.now();
        const answer = await deadline(
          "a further request",
          fetcher.fetch(`${fetcher.origin}${TEAM_API_ROUTES.compatibility}`, { headers: teamHeaders(null) }),
        );
        await answer.text();
        further.push(performance.now() - next);
        assert.equal(answer.status, 200);
      }
      numbers.desktop = { ...desktopNumbers, furtherRequestMs: rounded(further) };
      assertBelow(further, 1.5 * ROUND_TRIP_MS, "A further desktop request");
      assert.equal(proxied.accepted, 4, "No session opened a WebSocket.");
    },
  );

  await check(
    "(d) During a 4 MiB download, a new session opens and a small request is answered in about one round trip",
    async () => {
      const big = createRelayFetch({ dialer, target: hostKeyId });
      const small = createRelayFetch({ dialer, target: hostKeyId });
      closers.push(big.close, small.close);
      const signIn = await deadline(
        "the relay sign-in",
        big.fetch(`${big.origin}${TEAM_API_ROUTES.auth.relay}`, { method: "POST", headers: teamHeaders(null) }),
      );
      assert.equal(signIn.status, 200);
      const token = decodeJoinResult(await signIn.json()).sessionToken;
      const blob = randomBytes(TRANSFER_BYTES);
      const uploadStarted = performance.now();
      const uploaded = await deadline(
        "the upload",
        big.fetch(`${big.origin}${TEAM_API_ROUTES.attachments}?name=blob.bin&mime=application%2Foctet-stream`, {
          method: "POST",
          headers: { ...teamHeaders(token), "Content-Type": "application/octet-stream" },
          body: blob,
        }),
      );
      const uploadMs = performance.now() - uploadStarted;
      assert.equal(uploaded.status, 201);
      const attachment = decodeAttachment(await uploaded.json());
      const warm = await deadline(
        "the warm request",
        small.fetch(`${small.origin}${TEAM_API_ROUTES.compatibility}`, { headers: teamHeaders(null) }),
      );
      await warm.text();
      const downloadStarted = performance.now();
      const download = await deadline(
        "the download",
        big.fetch(`${big.origin}${TEAM_API_ROUTES.attachment(attachment.id)}`, { headers: teamHeaders(token) }),
      );
      assert.equal(download.status, 200);
      const reader = download.body?.getReader();
      assert.ok(reader);
      const state = { done: false, bytes: 0 };
      const hash = createHash("sha256");
      const first = await reader.read();
      if (first.value) {
        state.bytes += first.value.byteLength;
        hash.update(first.value);
      }
      const reading = (async () => {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          state.bytes += part.value.byteLength;
          hash.update(part.value);
        }
        state.done = true;
      })();
      const sessionStarted = performance.now();
      const extra = await deadline("a session during the download", ok(dialer.dial(hostKeyId)));
      const sessionDuringDownloadMs = performance.now() - sessionStarted;
      const sessionDuringActive = !state.done;
      extra.destroy();
      const during: number[] = [];
      const active: boolean[] = [];
      for (let index = 0; index < REQUEST_SAMPLES && !state.done; index += 1) {
        const next = performance.now();
        const answer = await deadline(
          "a request during the download",
          small.fetch(`${small.origin}${TEAM_API_ROUTES.compatibility}`, { headers: teamHeaders(null) }),
        );
        await answer.text();
        during.push(performance.now() - next);
        active.push(!state.done);
      }
      await deadline("the download body", reading);
      const downloadMs = performance.now() - downloadStarted;
      numbers.desktopTransfer = {
        sessionDuringDownloadMs: Math.round(sessionDuringDownloadMs),
        sessionDuringDownloadActive: sessionDuringActive,
        uploadMs: Math.round(uploadMs),
        downloadMs: Math.round(downloadMs),
        duringDownloadMs: rounded(during),
        duringDownloadActive: active,
      };
      assert.equal(state.bytes, TRANSFER_BYTES);
      assert.equal(hash.digest("hex"), createHash("sha256").update(blob).digest("hex"));
      assert.ok(sessionDuringActive, "The session opened while the download ran.");
      assert.ok(
        sessionDuringDownloadMs <= 1.5 * ROUND_TRIP_MS,
        `The session took ${Math.round(sessionDuringDownloadMs)} ms.`,
      );
      assert.ok(active.filter(Boolean).length >= 2, "At least two requests ran during the download.");
      assertBelow(during, 1.5 * ROUND_TRIP_MS, "A request during the download");
      assert.equal(proxied.accepted, 4, "No session opened a WebSocket.");
    },
  );

  const uploadBase64 = randomBytes(TRANSFER_BYTES).toString("base64");
  await check(
    "The browser app: two WebSockets, one session per host connection, channels ready in about two round trips",
    async () => {
      const counts = installCountingWebSocket(WsSocket, hostBundle.root);
      const { createRelayIdentityFromText, createRelayTeamPeer, startRelayControl } = await import(
        "@openbot/team-client/relay-client"
      );
      const identity = await createRelayIdentityFromText(JSON.stringify(browserBundle));
      const control = startRelayControl(identity, { reconnect });
      stops.push(() => control.stop());
      await deadline(
        "the browser control is online",
        new Promise<void>((resolveOnline) => {
          const stop = control.subscribe((snapshot) => {
            if (snapshot.state.status !== "online") return;
            queueMicrotask(() => stop());
            resolveOnline();
          });
        }),
      );
      assert.equal(proxied.accepted, 5);
      const measured = await measureTeamClient({
        sessions: control,
        createPeer: (actions) => createRelayTeamPeer(control, actions),
        hostKeyId,
        uploadBase64,
        sessionOpens: () => counts.sessionOpens,
        sockets: () => counts.sockets,
        waitMs: WAIT_MS,
      });
      assertClient(measured, "browser");
      socketsAfter.browser = proxied.accepted;
      assert.equal(proxied.accepted, 6, "The browser opened one control and one data WebSocket.");
    },
  );

  await check("The phone app (noble crypto, no global crypto): the same with two WebSockets", async () => {
    const configPath = join(work, "phone.json");
    const outPath = join(work, "phone-result.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        phoneText: JSON.stringify(phoneBundle),
        serverRoot: hostBundle.root,
        hostKeyId,
        uploadBase64,
        out: outPath,
        waitMs: WAIT_MS,
      }),
    );
    const child = spawn(process.execPath, ["--import", "tsx", PHONE, configPath], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output: string[] = [];
    child.stdout.on("data", (chunk: Buffer) => output.push(chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => output.push(chunk.toString()));
    await deadline("the phone process", new Promise<void>((resolveExit) => child.once("exit", () => resolveExit())));
    const result = decodePhoneResult(readFileSync(outPath, "utf8"));
    if (!result.ok || !result.measured) throw new Error(`The phone failed: ${result.error ?? ""} ${output.join("")}`);
    assert.equal(result.globalCrypto, "undefined", "The phone process had a global crypto.");
    socketsAfter.phone = proxied.accepted;
    assertClient(result.measured, "phone");
    assert.equal(proxied.accepted, 8);
  });

  await check(
    "(b, c) After the idle time the data socket closes, control stays open, and the next session opens it again",
    async () => {
      await untilMetric("openbot_relay_sockets", 6);
      const idleStore = await store("idle", issue(environment, work, "alice", "idle"));
      const idleControl = new RelayControl({ identity: idleStore, reconnect, dataIdleMs: TEST_DATA_IDLE_MS });
      controls.push(idleControl);
      const idleDialer = new RelayDialer({ control: idleControl });
      await ok(idleControl.start());
      await untilState(idleControl, (state) => state.status === "online");
      assert.equal(proxied.accepted, 9);
      const fetcher = createRelayFetch({ dialer: idleDialer, target: hostKeyId });
      closers.push(fetcher.close);
      const call = async () => {
        const started = performance.now();
        const answer = await deadline(
          "a request of the idle app",
          fetcher.fetch(`${fetcher.origin}${TEAM_API_ROUTES.compatibility}`, { headers: teamHeaders(null) }),
        );
        await answer.text();
        assert.equal(answer.status, 200);
        return performance.now() - started;
      };
      await call();
      assert.equal(proxied.accepted, 10);
      fetcher.close();
      const closed = await untilMetric("openbot_relay_data_sockets", 3);
      assert.equal(closed.openbot_relay_members, 4, "The control sockets stay open.");
      assert.equal(idleControl.state().status, "online");
      const fresh = createRelayFetch({ dialer: idleDialer, target: hostKeyId });
      closers.push(fresh.close);
      const reopenStarted = performance.now();
      const answer = await deadline(
        "the first request after the idle time",
        fresh.fetch(`${fresh.origin}${TEAM_API_ROUTES.compatibility}`, { headers: teamHeaders(null) }),
      );
      await answer.text();
      const afterIdleMs = performance.now() - reopenStarted;
      assert.equal(answer.status, 200);
      numbers.afterIdle = { dataIdleMs: TEST_DATA_IDLE_MS, firstRequestAfterIdleMs: Math.round(afterIdleMs) };
      assert.equal(proxied.accepted, 11, "Only the data socket opened again.");
      assert.equal((await untilMetric("openbot_relay_data_sockets", 4)).openbot_relay_members, 4);
      assert.ok(
        afterIdleMs <= 4.5 * ROUND_TRIP_MS,
        `The first request after the idle time took ${Math.round(afterIdleMs)} ms.`,
      );
    },
  );

  await check("Each app used at most two WebSockets (control and data) for the whole run", async () => {
    numbers.webSocketsAccepted = proxied.accepted;
    numbers.webSocketsAfterEachStep = socketsAfter;
    assert.deepEqual(
      [...APPS, "desktopData"].map((app) => socketsAfter[app]),
      [1, 2, 6, 8, 4],
    );
    const live = await metrics();
    numbers.relayMetricsAtEnd = live;
    assert.ok((live.openbot_relay_data_sockets ?? 0) <= (live.openbot_relay_members ?? 0));
  });
} finally {
  for (const close of closers) close();
  for (const stop of stops) stop();
  for (const control of controls) await Effect.runPromise(control.stop());
  if (host) await runCauseEffect(host.shutdown()).catch(() => undefined);
  if (agents) await runCauseEffect(agents.stop()).catch(() => undefined);
  database?.close();
  for (const socket of proxy?.sockets ?? []) socket.destroy();
  proxy?.server.close();
  if (relay) {
    relay.child.kill("SIGKILL");
    await relay.exited;
  }
  rmSync(work, { recursive: true, force: true });
}

const failed = checks.filter((entry) => !entry.passed);
mkdirSync(OUT, { recursive: true });
writeFileSync(
  join(OUT, "report.json"),
  `${JSON.stringify({ passed: failed.length === 0, runtime: `node ${process.version}`, numbers, checks, ...(failed.length === 0 ? {} : { relayLog: relay?.log.join("") ?? "" }) }, null, 2)}\n`,
);
for (const entry of checks) {
  process.stdout.write(
    `${entry.passed ? "PASS" : "FAIL"} ${entry.name}${entry.error ? `\n     ${entry.error}` : ""}\n`,
  );
}
process.stdout.write(`${JSON.stringify(numbers, null, 2)}\nReport: ${join(OUT, "report.json")}\n`);
process.exit(failed.length === 0 ? 0 : 1);
