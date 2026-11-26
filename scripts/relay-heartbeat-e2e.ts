import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes, X509Certificate } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createNetServer, connect as netConnect, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { inspect } from "node:util";
import { decodeRelayIdentityBundle, type RelayIdentityBundle } from "@openbot/contracts/relay-protocol/identity-bundle";
import { RELAY_PATH, RELAY_RESUME_CHECK_TIMEOUT_MS } from "@openbot/contracts/relay-protocol/messages";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  TEAM_APP_VERSION_HEADER,
  TEAM_CURRENT_CAPABILITIES,
  TEAM_PROTOCOL_V10,
  TEAM_PROTOCOL_VERSION_HEADER,
  teamCapabilityHeaders,
} from "@openbot/contracts/team-protocol";
import type { RelayControlSnapshot } from "@openbot/team-client/relay-client";
import { Effect, Result } from "effect";
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
import type { TeamApiBrowser } from "../src/main/team-api/dependencies";
import { TeamStore } from "../src/main/team-store";
import { installCountingWebSocket } from "./relay-session-latency-e2e-client";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, ".openbot-build/relay-heartbeat-e2e");
const MAIN = resolve(ROOT, "remote/api/src/relay/main.ts");
const ONE_WAY_DELAY_MS = 67;
const SERVER_RTT_MS = 2 * ONE_WAY_DELAY_MS;
const THROUGH_RTT_MS = 2 * SERVER_RTT_MS;
const HEARTBEAT = { intervalMs: 1_000, timeoutMs: 3_000 };
const SERVER_HEARTBEAT_TIMEOUT_MS = 5_000;
const SLACK_MS = 400;
const WAIT_MS = 60_000;
const READY_LINE = "OpenBot relay is ready";
const APP_VERSION = "0.0.0-e2e";
const TEAM = "Acme";
const REQUEST_SAMPLES = 5;
const BIG_CHUNK_BYTES = 200;

interface Check {
  name: string;
  passed: boolean;
  error?: string;
}

type ReportValue = number | boolean | string | null | readonly ReportValue[] | { readonly [key: string]: ReportValue };
const checks: Check[] = [];
const numbers: Record<string, ReportValue> = {
  oneWayDelayMs: ONE_WAY_DELAY_MS,
  serverRoundTripMs: SERVER_RTT_MS,
  throughServerRoundTripMs: THROUGH_RTT_MS,
  heartbeat: HEARTBEAT,
  serverHeartbeatTimeoutMs: SERVER_HEARTBEAT_TIMEOUT_MS,
  resumeCheckTimeoutMs: RELAY_RESUME_CHECK_TIMEOUT_MS,
};

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

function deadline<T>(description: string, promise: Promise<T>, waitMs = WAIT_MS): Promise<T> {
  return new Promise<T>((resolveValue, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out: ${description}.`)), waitMs);
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

function untilState(control: RelayControl, accepts: (state: RelayControlState) => boolean): Promise<RelayControlState> {
  return deadline(
    "the relay control state",
    new Promise<RelayControlState>((resolveState) => {
      const listener = (state: RelayControlState) => {
        if (!accepts(state)) return;
        control.off("state", listener);
        resolveState(state);
      };
      control.on("state", listener);
      listener(control.state());
    }),
  );
}

interface SnapshotSource {
  snapshot(): RelayControlSnapshot;
  subscribe(listener: () => void): () => void;
}

function untilSnapshot(
  source: SnapshotSource,
  accepts: (snapshot: RelayControlSnapshot) => boolean,
): Promise<RelayControlSnapshot> {
  return deadline(
    "the relay snapshot",
    new Promise<RelayControlSnapshot>((resolveSnapshot) => {
      const look = () => {
        const snapshot = source.snapshot();
        if (!accepts(snapshot)) return;
        queueMicrotask(() => stop());
        resolveSnapshot(snapshot);
      };
      const stop = source.subscribe(look);
      look();
    }),
  );
}

function untilRoster(control: RelayControl, accepts: (keyIds: Set<string>) => boolean): Promise<number> {
  return deadline(
    "the roster",
    new Promise<number>((resolveRoster) => {
      const listener = () => {
        if (!accepts(new Set(control.roster().map((member) => member.keyId)))) return;
        control.off("roster", listener);
        resolveRoster(performance.now());
      };
      control.on("roster", listener);
      listener();
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

type Direction = "up" | "down";

interface ChunkMark {
  at: number;
  bytes: number;
}

interface ProxiedConnection {
  index: number;
  acceptedAt: number;
  closedAt: number | null;
  device: Socket;
  relay: Socket;
  frozen: boolean;
  frozenAt: number | null;
  bytesWhileFrozen: number[];
  marks: Record<Direction, ChunkMark[]>;
}

interface ControlledProxy {
  server: Server;
  connections: ProxiedConnection[];
  recording: boolean;
}

function forward(proxy: ControlledProxy, connection: ProxiedConnection, direction: Direction): void {
  const [from, to] = direction === "up" ? [connection.device, connection.relay] : [connection.relay, connection.device];
  from.on("data", (chunk: Buffer) => {
    if (connection.frozen) {
      if (direction === "up") connection.bytesWhileFrozen.push(chunk.byteLength);
      return;
    }
    if (proxy.recording) connection.marks[direction].push({ at: performance.now(), bytes: chunk.byteLength });
    setTimeout(() => {
      if (!to.destroyed && !connection.frozen) to.write(chunk);
    }, ONE_WAY_DELAY_MS);
  });
  from.on("end", () => {
    if (!connection.frozen) setTimeout(() => to.end(), ONE_WAY_DELAY_MS);
  });
  from.on("close", () => {
    if (!connection.frozen) setTimeout(() => to.destroy(), ONE_WAY_DELAY_MS);
  });
  from.on("error", () => undefined);
}

function startProxy(listenPort: number, relayPort: number): Promise<ControlledProxy> {
  const proxy: ControlledProxy = { server: createNetServer(), connections: [], recording: false };
  proxy.server.on("connection", (device) => {
    const relay = netConnect(relayPort, "127.0.0.1");
    const connection: ProxiedConnection = {
      index: proxy.connections.length,
      acceptedAt: performance.now(),
      closedAt: null,
      device,
      relay,
      frozen: false,
      frozenAt: null,
      bytesWhileFrozen: [],
      marks: { up: [], down: [] },
    };
    proxy.connections.push(connection);
    device.once("close", () => {
      connection.closedAt ??= performance.now();
    });
    for (const socket of [device, relay]) socket.setNoDelay(true);
    forward(proxy, connection, "up");
    forward(proxy, connection, "down");
  });
  return new Promise((resolveProxy, reject) => {
    proxy.server.once("error", reject);
    proxy.server.listen(listenPort, "127.0.0.1", () => resolveProxy(proxy));
  });
}

function freeze(connection: ProxiedConnection | undefined): number {
  assert.ok(connection, "The connection to freeze exists.");
  connection.frozen = true;
  connection.frozenAt = performance.now();
  return connection.frozenAt;
}

function teamHeaders(): Record<string, string> {
  return {
    [TEAM_PROTOCOL_VERSION_HEADER]: String(TEAM_PROTOCOL_V10),
    [TEAM_APP_VERSION_HEADER]: APP_VERSION,
    ...teamCapabilityHeaders(TEAM_PROTOCOL_V10, TEAM_CURRENT_CAPABILITIES),
  };
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

interface LogBook {
  lines: Array<{ at: number; line: string }>;
  listeners: Set<() => void>;
  logger: { info(line: string): void; warn(line: string): void };
}

function logBook(): LogBook {
  const book: LogBook = {
    lines: [],
    listeners: new Set(),
    logger: {
      info: (line) => add(line),
      warn: (line) => add(line),
    },
  };
  function add(line: string): void {
    book.lines.push({ at: performance.now(), line });
    for (const listener of [...book.listeners]) listener();
  }
  return book;
}

function untilLine(book: LogBook, text: string, after: number): Promise<number> {
  return deadline(
    `the log line "${text}"`,
    new Promise<number>((resolveLine) => {
      const look = () => {
        const found = book.lines.find((entry) => entry.at >= after && entry.line.includes(text));
        if (!found) return;
        book.listeners.delete(look);
        resolveLine(found.at);
      };
      book.listeners.add(look);
      look();
    }),
  );
}

const work = mkdtempSync(join(tmpdir(), "openbot-relay-heartbeat-e2e-"));
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
  RELAY_CLIENT_HEARTBEAT_TIMEOUT_MS: String(SERVER_HEARTBEAT_TIMEOUT_MS),
  RELAY_METRICS_TOKEN: metricsToken,
};
const reconnect = { baseMs: 500, maxMs: 2_000 };
let relay: Relay | null = null;
let proxy: ControlledProxy | null = null;
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

async function untilMetrics(accepts: (values: Record<string, number>) => boolean): Promise<Record<string, number>> {
  for (const started = Date.now(); Date.now() - started < WAIT_MS; ) {
    const current = await metrics();
    if (accepts(current)) return current;
    await new Promise<void>((resolveNext) => setImmediate(resolveNext));
  }
  throw new Error("Timed out: the relay metrics.");
}

function soleSockets(values: Record<string, number>, members: number): boolean {
  return (
    values.openbot_relay_members === members &&
    values.openbot_relay_sockets === members + (values.openbot_relay_data_sockets ?? 0) &&
    (values.openbot_relay_data_sockets ?? 0) <= members
  );
}

interface HttpSession {
  write(data: Uint8Array): void;
  listen(handlers: { data: (data: Uint8Array) => void; closed: () => void }): void;
  readonly closed: boolean;
}

function httpOverSession(session: HttpSession): () => Promise<number> {
  let buffer = "";
  let waiting: ((status: number) => void) | null = null;
  const decoder = new TextDecoder();
  const take = () => {
    const status = /HTTP\/1\.1 (\d{3})/u.exec(buffer)?.[1];
    if (status === undefined || !waiting) return;
    const resolveStatus = waiting;
    waiting = null;
    resolveStatus(Number(status));
  };
  session.listen({
    data: (data) => {
      buffer += decoder.decode(data, { stream: true });
      take();
    },
    closed: () => undefined,
  });
  const headers = Object.entries(teamHeaders())
    .map(([name, value]) => `${name}: ${value}\r\n`)
    .join("");
  return () =>
    deadline(
      "an HTTP answer on the session",
      new Promise<number>((resolveStatus) => {
        buffer = "";
        waiting = resolveStatus;
        session.write(
          new TextEncoder().encode(
            `GET ${TEAM_API_ROUTES.compatibility} HTTP/1.1\r\nHost: relay\r\n${headers}Connection: keep-alive\r\n\r\n`,
          ),
        );
      }),
    );
}

function lastConnectMs(lines: readonly string[]): number | null {
  for (const line of [...lines].reverse()) {
    const found = /relay connected in (\d+) ms/u.exec(line);
    if (found) return Number(found[1]);
  }
  return null;
}

try {
  await check("The certificate commands make a root, a server certificate and a team", () => {
    assert.equal(command(environment, "ca", "init").status, 0);
    assert.equal(command(environment, "ca", "server", "--dns", "localhost", "--ip", "127.0.0.1").status, 0);
    assert.equal(command(environment, "ca", "team", "add", TEAM).status, 0);
  });
  const hostBundle = issue(environment, work, "host-user", "server");
  const desktopBundle = issue(environment, work, "alice", "laptop");
  const phoneBundle = issue(environment, work, "alice", "phone");
  const browserBundle = issue(environment, work, "alice", "browser");
  const hostKeyId = keyIdOf(hostBundle);
  const browserKeyId = keyIdOf(browserBundle);
  const phoneKeyId = keyIdOf(phoneBundle);
  const store = async (name: string, bundle: RelayIdentityBundle) => {
    const identity = new RelayIdentityStore({ path: join(work, `${name}.json`), cipher: testCipher });
    await ok(identity.importBundle(bundle));
    return identity;
  };
  const hostStore = await store("host", hostBundle);
  const desktopStore = await store("desktop", desktopBundle);

  relay = await startRelay(environment);
  proxy = await startProxy(proxyPort, relayPort);
  const proxied = proxy;

  const counts = installCountingWebSocket(WsSocket, hostBundle.root);
  const { createNobleRelayCrypto } = await import("@openbot/team-client/relay-crypto-noble");
  const { createRelayIdentityFromText, startRelayControl } = await import("@openbot/team-client/relay-client");
  const { PhoneRelayRuntime } = await import("../apps/mobile/src/features/identity/model/phone-relay-runtime");
  const nobleCrypto = createNobleRelayCrypto({ randomBytes: (size) => new Uint8Array(randomBytes(size)) });
  const phoneIdentity = await createRelayIdentityFromText(JSON.stringify(phoneBundle), { crypto: nobleCrypto });
  const phoneLog: string[] = [];
  const phone = new PhoneRelayRuntime({ identity: phoneIdentity, crypto: nobleCrypto }, () => undefined, reconnect, {
    heartbeat: HEARTBEAT,
    log: (_level, line) => phoneLog.push(line),
  });
  phone.start();
  stops.push(() => phone.stop());
  await untilSnapshot(phone, (snapshot) => snapshot.state.status === "online");
  let phoneControlIndex = proxied.connections.length - 1;

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
  const hostLog = logBook();
  const hostControl = new RelayControl({
    identity: hostStore,
    reconnect,
    heartbeat: HEARTBEAT,
    logger: hostLog.logger,
  });
  controls.push(hostControl);
  await ok(hostService.startRelayHosting(hostStore, { reconnect, control: hostControl }));
  await untilState(hostControl, (state) => state.status === "online");

  const desktopLog = logBook();
  const desktopControl = new RelayControl({
    identity: desktopStore,
    reconnect,
    heartbeat: HEARTBEAT,
    logger: desktopLog.logger,
  });
  controls.push(desktopControl);
  const dialer = new RelayDialer({ control: desktopControl });
  await ok(desktopControl.start());
  await untilState(desktopControl, (state) => state.status === "online");
  let desktopControlIndex = proxied.connections.length - 1;

  const desktopStates: string[] = [];
  desktopControl.on("state", (state) => desktopStates.push(state.status));

  const request = async (fetcher: ReturnType<typeof createRelayFetch>) => {
    const started = performance.now();
    const answer = await deadline(
      "a request",
      fetcher.fetch(`${fetcher.origin}${TEAM_API_ROUTES.compatibility}`, { headers: teamHeaders() }),
    );
    await answer.text();
    assert.equal(answer.status, 200);
    return { started, ended: performance.now() };
  };

  const requestAgain = async (fetcher: ReturnType<typeof createRelayFetch>) => {
    try {
      return await request(fetcher);
    } catch {
      return request(fetcher);
    }
  };

  await check("(a) The heartbeat round trip of each app is about one round trip to the server", async () => {
    const phoneOnline = await untilSnapshot(
      phone,
      (snapshot) => snapshot.state.status === "online" && snapshot.state.rttMs !== undefined,
    );
    await untilState(desktopControl, (state) => state.status === "online" && state.rttMs !== undefined);
    await untilState(hostControl, (state) => state.status === "online" && state.rttMs !== undefined);
    const desktopRtt = desktopControl.heartbeatRttMs();
    const hostRtt = hostControl.heartbeatRttMs();
    const phoneRtt = phoneOnline.state.status === "online" ? (phoneOnline.state.rttMs ?? null) : null;
    numbers.heartbeatRttMs = { desktop: desktopRtt, host: hostRtt, phoneFirst: phoneRtt };
    for (const [name, value] of [
      ["desktop", desktopRtt],
      ["host", hostRtt],
      ["phone", phoneRtt],
    ] as const) {
      assert.ok(value !== null, `The ${name} app has a heartbeat round trip.`);
      assert.ok(
        value >= SERVER_RTT_MS && value <= SERVER_RTT_MS + 60,
        `The ${name} heartbeat round trip is ${value} ms, not about ${SERVER_RTT_MS} ms.`,
      );
    }
  });

  const fetcher = createRelayFetch({ dialer, target: hostKeyId });
  closers.push(() => fetcher.close());
  await request(fetcher);
  let desktopDataIndex = proxied.connections.length - 2;
  const hostDataIndex = proxied.connections.length - 1;

  await check("Request round trip breakdown through the relay (client, server, host)", async () => {
    const breakdowns: Array<Record<string, number>> = [];
    for (let index = 0; index < REQUEST_SAMPLES; index += 1) {
      for (const connection of proxied.connections) connection.marks = { up: [], down: [] };
      proxied.recording = true;
      const { started, ended } = await request(fetcher);
      proxied.recording = false;
      const big = (marks: ChunkMark[]) => marks.filter((mark) => mark.bytes >= BIG_CHUNK_BYTES);
      const clientData = proxied.connections[desktopDataIndex];
      const hostData = proxied.connections[hostDataIndex];
      assert.ok(clientData && hostData);
      const clientUp = big(clientData.marks.up)[0];
      const hostDown = big(hostData.marks.down).find((mark) => clientUp !== undefined && mark.at > clientUp.at);
      const hostUp = big(hostData.marks.up).find((mark) => hostDown !== undefined && mark.at > hostDown.at);
      const clientDown = big(clientData.marks.down).find((mark) => hostUp !== undefined && mark.at > hostUp.at);
      assert.ok(clientUp && hostDown && hostUp && clientDown, "The proxy saw each leg of the request.");
      breakdowns.push({
        totalMs: Math.round(ended - started),
        clientSendMs: Math.round(clientUp.at - started),
        serverForwardRequestMs: Math.round(hostDown.at - clientUp.at - ONE_WAY_DELAY_MS),
        hostReplyMs: Math.round(hostUp.at - hostDown.at - ONE_WAY_DELAY_MS),
        serverForwardReplyMs: Math.round(clientDown.at - hostUp.at - ONE_WAY_DELAY_MS),
        clientReceiveMs: Math.round(ended - clientDown.at - ONE_WAY_DELAY_MS),
        networkMs: 4 * ONE_WAY_DELAY_MS,
      });
    }
    numbers.requestBreakdown = breakdowns;
    for (const breakdown of breakdowns) {
      assert.ok(
        (breakdown.totalMs ?? 0) <= THROUGH_RTT_MS + 60,
        `A request took ${breakdown.totalMs} ms, more than one round trip through the server.`,
      );
    }
  });

  await check(
    "(b) A frozen control socket is found within interval + 3 s; the session opened meanwhile waits for the reconnect",
    async () => {
      const frozenAt = freeze(proxied.connections[desktopControlIndex]);
      const before = proxied.connections.length;
      const dialed = ok(dialer.dial(hostKeyId)).then((stream) => {
        const readyAt = performance.now();
        stream.destroy();
        return readyAt;
      });
      const offline = await untilState(desktopControl, (state) => state.status === "offline");
      const detectedAt = performance.now();
      await untilState(desktopControl, (state) => state.status === "online");
      const onlineAt = performance.now();
      desktopControlIndex = before;
      const readyAt = await deadline("the session after the reconnect", dialed);
      desktopDataIndex = proxied.connections.length - 1;
      const answer = await requestAgain(fetcher);
      numbers.desktopFrozenControl = {
        code: offline.status === "offline" ? offline.code : "none",
        retryInMs: offline.status === "offline" ? (offline.retryInMs ?? -1) : -1,
        detectMs: Math.round(detectedAt - frozenAt),
        reconnectMs: Math.round(onlineAt - detectedAt),
        sessionReadyMs: Math.round(readyAt - frozenAt),
        requestAfterMs: Math.round(answer.ended - answer.started),
      };
      assert.equal(offline.status === "offline" ? offline.code : null, "heartbeat_timeout");
      assert.equal(offline.status === "offline" ? offline.retryInMs : null, 0, "The first reconnect starts at once.");
      assert.ok(
        detectedAt - frozenAt <= HEARTBEAT.intervalMs + HEARTBEAT.timeoutMs + SLACK_MS,
        `Detection took ${Math.round(detectedAt - frozenAt)} ms.`,
      );
      assert.ok(readyAt - onlineAt <= 3 * THROUGH_RTT_MS, "The session opened soon after the reconnect.");
    },
  );

  await check(
    "(b) Phone resume with a dead control socket: a new control socket races it and the session is ready in about one connect plus one round trip",
    async () => {
      const first = await deadline("the phone session", phone.openSession(hostKeyId));
      first.close();
      const phoneData = proxied.connections.length - 1;
      const frozenPhoneControl = phoneControlIndex;
      phone.pause();
      freeze(proxied.connections[phoneControlIndex]);
      freeze(proxied.connections[phoneData]);
      const before = proxied.connections.length;
      const sessionOpensBefore = counts.sessionOpens;
      const statuses: string[] = [];
      const stopStatuses = phone.subscribe(() => statuses.push(phone.snapshot().state.status));
      const resumedAt = performance.now();
      phone.resume();
      const readyAt = await deadline(
        "the phone session after resume",
        phone.openSession(hostKeyId).then((session) => {
          const at = performance.now();
          session.close();
          return at;
        }),
      );
      stopStatuses();
      phoneControlIndex = before;
      const after = await untilMetrics((values) => soleSockets(values, 3));
      const connectMs = lastConnectMs(phoneLog);
      numbers.phoneResume = {
        sessionReadyMs: Math.round(readyAt - resumedAt),
        newControlConnectMs: connectMs,
        statuses: [...new Set(statuses)],
        sessionOpensSent: counts.sessionOpens - sessionOpensBefore,
        relayMembers: after.openbot_relay_members ?? -1,
        relaySockets: after.openbot_relay_sockets ?? -1,
      };
      assert.ok(
        phoneLog.some((line) => line.includes("the new control socket won")),
        "The new control socket won the race.",
      );
      assert.ok(!statuses.includes("offline"), "The phone state did not go offline.");
      assert.ok(
        readyAt - resumedAt <= 4 * SERVER_RTT_MS + THROUGH_RTT_MS + SLACK_MS,
        `The session was ready ${Math.round(readyAt - resumedAt)} ms after resume.`,
      );
      assert.equal(counts.sessionOpens - sessionOpensBefore, 1, "The phone sent one session-open, on the new socket.");
      assert.ok(
        Math.max(0, ...(proxied.connections[frozenPhoneControl]?.bytesWhileFrozen ?? [0])) < BIG_CHUNK_BYTES,
        "No session-open went on the frozen control socket.",
      );
      assert.equal(
        desktopControl.roster().filter((member) => member.keyId === phoneKeyId).length,
        1,
        "The roster shows the phone once.",
      );
    },
  );

  await check(
    "(b) Phone resume with a live control socket: the old socket answers first, the new socket closes, no session is lost",
    async () => {
      const kept = await deadline("the kept phone session", phone.openSession(hostKeyId));
      const ask = httpOverSession(kept);
      assert.equal(await ask(), 200);
      const before = proxied.connections.length;
      const socketsBefore = counts.sockets;
      const statuses: string[] = [];
      const stopStatuses = phone.subscribe(() => statuses.push(phone.snapshot().state.status));
      const resumedAt = performance.now();
      phone.resume();
      const readyAt = await deadline(
        "a phone session during the race",
        phone.openSession(hostKeyId).then((session) => {
          const at = performance.now();
          session.close();
          return at;
        }),
      );
      const extra = proxied.connections[before];
      assert.ok(extra, "The new control socket was opened.");
      await untilMetrics((values) => soleSockets(values, 3) && extra.closedAt !== null);
      const answer = await ask();
      stopStatuses();
      numbers.phoneResumeAlive = {
        sessionDuringRaceReadyMs: Math.round(readyAt - resumedAt),
        extraSocketLifetimeMs: extra.closedAt === null ? -1 : Math.round(extra.closedAt - extra.acceptedAt),
        extraWebSockets: counts.sockets - socketsBefore,
        statuses: [...new Set(statuses)],
        keptSessionOpen: !kept.closed,
        keptSessionAnswer: answer,
      };
      kept.close();
      assert.ok(phoneLog.some((line) => line.includes("the control socket answered; closing the new one")));
      assert.equal(counts.sockets - socketsBefore, 1, "The race opened one extra WebSocket.");
      assert.ok(!statuses.includes("offline") && !statuses.includes("connecting"), "The phone state stayed online.");
      assert.equal(answer, 200, "The kept session still answers.");
      assert.ok(
        extra.closedAt !== null && extra.closedAt - extra.acceptedAt <= 4 * SERVER_RTT_MS + SLACK_MS,
        "The extra control socket lived at most one connect time.",
      );
      assert.ok(
        readyAt - resumedAt <= SERVER_RTT_MS + THROUGH_RTT_MS + SLACK_MS,
        `The session during the race was ready after ${Math.round(readyAt - resumedAt)} ms.`,
      );
      assert.equal(desktopControl.roster().filter((member) => member.keyId === phoneKeyId).length, 1);
    },
  );

  await check(
    "(c) The server closes a control socket that stops pinging; others see the member go offline",
    async () => {
      const browserIdentity = await createRelayIdentityFromText(JSON.stringify(browserBundle));
      const browser = startRelayControl(browserIdentity, { reconnect, heartbeat: HEARTBEAT });
      stops.push(() => browser.stop());
      await untilSnapshot(
        { snapshot: () => browser.snapshot(), subscribe: (listener) => browser.subscribe(listener) },
        (snapshot) => snapshot.state.status === "online",
      );
      await untilRoster(desktopControl, (keyIds) => keyIds.has(browserKeyId));
      const pausedAt = performance.now();
      browser.pause();
      const goneAt = await untilRoster(desktopControl, (keyIds) => !keyIds.has(browserKeyId));
      const backAt = await untilRoster(desktopControl, (keyIds) => keyIds.has(browserKeyId));
      numbers.serverHeartbeatTimeout = {
        offlineInRosterMs: Math.round(goneAt - pausedAt),
        backInRosterMs: Math.round(backAt - goneAt),
      };
      assert.ok(goneAt - pausedAt >= SERVER_HEARTBEAT_TIMEOUT_MS - HEARTBEAT.intervalMs, "The server waited.");
      assert.ok(
        goneAt - pausedAt <= SERVER_HEARTBEAT_TIMEOUT_MS + SERVER_RTT_MS + SLACK_MS,
        `The member left the roster after ${Math.round(goneAt - pausedAt)} ms.`,
      );
    },
  );

  await check("(d) A data socket that stops answering pings is replaced and a new session works", async () => {
    desktopStates.length = 0;
    const before = proxied.connections.length;
    const frozenAt = freeze(proxied.connections[desktopDataIndex]);
    const missedAt = await untilLine(desktopLog, "relay data heartbeat missed", frozenAt);
    const answer = await requestAgain(fetcher);
    numbers.desktopFrozenData = {
      detectMs: Math.round(missedAt - frozenAt),
      newRequestMs: Math.round(answer.ended - answer.started),
      newWebSockets: proxied.connections.length - before,
    };
    desktopDataIndex = proxied.connections.length - 1;
    assert.ok(
      missedAt - frozenAt <= HEARTBEAT.intervalMs + HEARTBEAT.timeoutMs + SLACK_MS,
      `Detection took ${Math.round(missedAt - frozenAt)} ms.`,
    );
    assert.equal(proxied.connections.length - before, 1, "Only the data socket opened again.");
    assert.deepEqual(desktopStates, [], "The control state did not change.");
  });

  await check("(e) The app state stays connected while only a host session reconnects", async () => {
    desktopStates.length = 0;
    const frozenAt = freeze(proxied.connections[hostDataIndex]);
    const missedAt = await untilLine(hostLog, "relay data heartbeat missed", frozenAt);
    const answer = await requestAgain(fetcher);
    numbers.hostSessionReconnect = {
      hostDetectMs: Math.round(missedAt - frozenAt),
      requestAfterMs: Math.round(answer.ended - answer.started),
      desktopStateChanges: desktopStates.length,
      hostListed: desktopControl.roster().some((member) => member.keyId === hostKeyId && member.hosting),
    };
    assert.deepEqual(desktopStates, [], "The app state stayed connected.");
    assert.equal(desktopControl.state().status, "online");
    assert.ok(desktopControl.roster().some((member) => member.keyId === hostKeyId && member.hosting));
  });

  await check("Log lines: one per reconnect with the phases and the heartbeat round trip, no secrets", () => {
    const all = [...desktopLog.lines.map((entry) => entry.line), ...phoneLog];
    numbers.logSample = all.filter((line) => line.startsWith("relay ")).slice(0, 12);
    assert.ok(all.some((line) => /relay connected in \d+ ms \(TCP\+TLS\+WebSocket open \d+ ms, challenge/u.test(line)));
    assert.ok(all.some((line) => /relay data socket bound in \d+ ms/u.test(line)));
    for (const secret of [desktopBundle.privateKey, phoneBundle.privateKey]) {
      for (const line of all) assert.ok(!line.includes(secret.slice(40, 80)), "A log line holds a key.");
    }
    for (const line of all) assert.ok(!/ticket|signature|proof/iu.test(line), `A log line names a secret: ${line}`);
  });
} finally {
  for (const close of closers) close();
  for (const stop of stops) stop();
  for (const control of controls) await Effect.runPromise(control.stop());
  if (host) await runCauseEffect(host.shutdown()).catch(() => undefined);
  if (agents) await runCauseEffect(agents.stop()).catch(() => undefined);
  database?.close();
  for (const connection of proxy?.connections ?? []) {
    connection.device.destroy();
    connection.relay.destroy();
  }
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
