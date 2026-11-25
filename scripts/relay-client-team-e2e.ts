import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes, X509Certificate } from "node:crypto";
import { subscribe } from "node:diagnostics_channel";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createNetServer, Socket } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { inspect } from "node:util";
import { AGENT_PROVIDERS, type AgentEvent, type ServerSummary } from "@openbot/contracts/ipc";
import { decodeRelayIdentityBundle, type RelayIdentityBundle } from "@openbot/contracts/relay-protocol/identity-bundle";
import { RELAY_PATH, type RelayTeamMember } from "@openbot/contracts/relay-protocol/messages";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { Effect, Result } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { AgentService as AgentServiceInstance } from "../src/backend/agent-service";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { OpenBotDatabase as OpenBotDatabaseInstance } from "../src/backend/openbot-database";
import type { HostService as HostServiceInstance } from "../src/main/host-service";
import type { LocalProfile } from "../src/main/local-profile-store";
import { RelayClientCoordinator } from "../src/main/relay/client-coordinator";
import { HostRelay } from "../src/main/relay/host-relay";
import { type RelayCipher, RelayIdentityStore } from "../src/main/relay/identity-store";
import { decodeAgentSummaries, decodeQueuedMessageReceipt } from "../src/main/remote-agent-decoding";
import type { RelayDirectoryHost } from "../src/main/remote-relay-directory";
import type {
  RemoteRelayTransport,
  RemoteServerManager as RemoteServerManagerInstance,
} from "../src/main/remote-server-manager";
import { readStoredRemoteServers, type StoredRemoteServer } from "../src/main/remote-server-stored-shape";
import type { TeamApiBrowser } from "../src/main/team-api/dependencies";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, ".openbot-build/relay-client-team-e2e");
const MAIN = resolve(ROOT, "remote/api/src/relay/main.ts");
const WAIT_MS = 30_000;
const TRANSFER_BYTES = 8 * 1024 * 1024;
const READY_LINE = "OpenBot relay is ready";
const APP_VERSION = "0.0.0-e2e";
const TEAM = "Acme";
const HOST_USER = "host-user";
const CLIENT_USER = "alice";
const MEMBER_DISABLED = "This team member is disabled.";
const HOST_OFFLINE = "The host is offline.";
const RELAY_ADDRESS_SUFFIX = ".relay.invalid";

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

function issue(environment: Record<string, string>, directory: string, user: string, device: string) {
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

async function killRelay(relay: Relay): Promise<void> {
  relay.child.kill("SIGKILL");
  await deadline("the relay server process ends", relay.exited);
}

interface NetworkLog {
  tcpTargets: string[];
  globalFetches: string[];
  httpHosts: string[];
  accountServiceCalls: number;
  relayRequests: string[];
  relaySocketOpens: number;
}

const network: NetworkLog = {
  tcpTargets: [],
  globalFetches: [],
  httpHosts: [],
  accountServiceCalls: 0,
  relayRequests: [],
  relaySocketOpens: 0,
};

subscribe("net.client.socket", (message) => {
  if (!isDynamicRecord(message) || !(message.socket instanceof Socket)) return;
  const socket = message.socket;
  socket.once("connect", () => network.tcpTargets.push(`${socket.remoteAddress}:${socket.remotePort}`));
});
subscribe("undici:request:create", (message) => {
  const request = isDynamicRecord(message) ? message.request : undefined;
  network.globalFetches.push(isDynamicRecord(request) && isString(request.origin) ? request.origin : "unknown");
});
subscribe("http.client.request.start", (message) => {
  const request = isDynamicRecord(message) ? message.request : undefined;
  const host = isDynamicRecord(request) && isString(request.host) ? request.host : "unknown";
  const path = isDynamicRecord(request) && isString(request.path) ? request.path : "";
  network.httpHosts.push(`${host}${host.endsWith(RELAY_ADDRESS_SUFFIX) ? "" : path}`);
});

const work = mkdtempSync(join(tmpdir(), "openbot-relay-client-team-e2e-"));
const dataDirectory = join(work, "data");
const storeDirectory = join(work, "stores");
const hostData = join(work, "host");
const clientData = join(work, "client");
const fakeHome = join(work, "home");
const fakeCodex = join(work, "codex");
const fakeCodexLog = join(work, "codex.jsonl");
mkdirSync(storeDirectory);
mkdirSync(clientData);
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
const { RemoteServerManager } = await import("../src/main/remote-server-manager");
const { RemoteServerStore } = await import("../src/main/remote-server-store");
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
let database: OpenBotDatabaseInstance | null = null;
let agents: AgentServiceInstance | null = null;
let host: HostServiceInstance | null = null;
let coordinator: RelayClientCoordinator | null = null;
let manager: RemoteServerManagerInstance | null = null;
const sharedHosting: { relay: HostRelay | null } = { relay: null };
const serversPath = join(clientData, "openbot-remote-servers.json");

function storedServers(): StoredRemoteServer[] {
  const stored = readStoredRemoteServers(JSON.parse(readFileSync(serversPath, "utf8")));
  assert.ok(stored, "The server list file must load.");
  return stored.servers;
}

function remoteServers(list: readonly ServerSummary[]): ServerSummary[] {
  return list.filter((server) => server.kind === "remote");
}

try {
  await check("The certificate commands make a root, a server certificate and a team", () => {
    assert.equal(command(environment, "ca", "init").status, 0);
    assert.equal(command(environment, "ca", "server", "--dns", "localhost", "--ip", "127.0.0.1").status, 0);
    assert.equal(command(environment, "ca", "team", "add", TEAM).status, 0);
  });

  const hostBundle = issue(environment, work, HOST_USER, "server");
  const clientBundle = issue(environment, work, CLIENT_USER, "laptop");
  const hostKeyId = keyIdOf(hostBundle);
  const clientKeyId = keyIdOf(clientBundle);
  const hostStore = new RelayIdentityStore({ path: join(storeDirectory, "host.json"), cipher: testCipher });
  const clientStore = new RelayIdentityStore({ path: join(storeDirectory, "client.json"), cipher: testCipher });
  await ok(hostStore.importBundle(hostBundle));
  await ok(clientStore.importBundle(clientBundle));

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
      name: "Relay client fixture",
      description: "Synthetic agent for the relay client check",
      avatarSeed: "relay-client-team",
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
  });
  host = hostService;
  await ok(hostService.startRelayHosting(hostStore, { reconnect }));
  const hostServerId = team.getIdentity()?.serverId ?? "";
  assert.ok(hostServerId, "The host has a server identity.");

  const clientCoordinator = new RelayClientCoordinator({ identity: clientStore, reconnect });
  coordinator = clientCoordinator;
  const transport: RemoteRelayTransport = {
    fetchFor: (url) => {
      const send = clientCoordinator.fetchFor(url);
      if (!send) return null;
      return (input, init) => {
        const target = new URL(input);
        network.relayRequests.push(`${init?.method ?? "GET"} ${target.pathname}`);
        return send(input, init);
      };
    },
    openEventSocket: (url, protocols) => {
      const socket = clientCoordinator.openEventSocket(url, protocols);
      if (socket) network.relaySocketOpens += 1;
      return socket;
    },
  };
  const clientManager = new RemoteServerManager(serversPath, testCipher, {
    appVersion: APP_VERSION,
    relayTransport: transport,
  });
  manager = clientManager;

  const untilServer = (description: string, accepts: (server: ServerSummary) => boolean) =>
    until<ServerSummary>(description, (done) => {
      const listener = (list: ServerSummary[]) => {
        const [server, ...others] = remoteServers(list);
        if (server && others.length === 0 && accepts(server)) done(server);
      };
      clientManager.on("changed", listener);
      listener(clientManager.list());
      return () => clientManager.off("changed", listener);
    });
  const untilHosts = (description: string, accepts: (hosts: readonly RelayDirectoryHost[]) => boolean) =>
    until<readonly RelayDirectoryHost[]>(description, (done) => {
      const listener = (hosts: readonly RelayDirectoryHost[]) => {
        if (accepts(hosts)) done(hosts);
      };
      clientCoordinator.on("hosts", listener);
      listener(clientCoordinator.hosts());
      return () => clientCoordinator.off("hosts", listener);
    });
  const untilRoster = (description: string, accepts: (members: readonly RelayTeamMember[]) => boolean) =>
    until<readonly RelayTeamMember[]>(description, (done) => {
      const listener = (members: readonly RelayTeamMember[]) => {
        if (accepts(members)) done(members);
      };
      clientCoordinator.on("roster", listener);
      listener(clientCoordinator.roster());
      return () => clientCoordinator.off("roster", listener);
    });
  const relaySignIns = () => network.relayRequests.filter((entry) => entry === `POST ${TEAM_API_ROUTES.auth.relay}`);
  const online = (server: ServerSummary) => server.state === "online" && !server.issue;
  const listAgents = () => clientManager.request(hostServerId, TEAM_API_ROUTES.agents.all, decodeAgentSummaries);
  const memberSessions = () => {
    const member = team.listMembers().find((candidate) => candidate.name === CLIENT_USER);
    assert.ok(member, "The host has the client member.");
    return { memberId: member.id, sessions: hostService.listSessions().filter((s) => s.memberId === member.id) };
  };

  await runCauseEffect(clientManager.initialize());
  await runCauseEffect(clientManager.startEventConnections());
  await ok(clientCoordinator.start(clientManager.relayRecords));

  await check("The host appears as one relay server record from the roster", async () => {
    const server = await untilServer("the host record is online", online);
    assert.equal(server.id, hostServerId);
    assert.equal(server.apiUrl, null);
    const [stored, ...others] = storedServers();
    assert.equal(others.length, 0);
    assert.ok(stored);
    assert.deepEqual(
      [stored.id, stored.transport, stored.relayKeyId, stored.relayUser, stored.relayDevice, stored.username],
      [hostServerId, "relay", hostKeyId, HOST_USER, "server", CLIENT_USER],
    );
    assert.ok(stored.apiUrl.endsWith(RELAY_ADDRESS_SUFFIX), stored.apiUrl);
    assert.notEqual(stored.encryptedToken, "");
  });

  await check("The client signs in with the relay route and lists the host's agents with the client code", async () => {
    assert.equal(relaySignIns().length, 1);
    assert.equal(clientManager.list().find((server) => server.id === hostServerId)?.role, "member");
    assert.equal(memberSessions().sessions.length, 1);
    const listed = await ok(listAgents());
    assert.ok(
      listed.some((agent) => agent.id === fixture.id),
      inspect(listed.map((agent) => agent.id)),
    );
  });

  await check("The host keeps an idle relay stream for 60 seconds", async () => {
    const apiUrl = storedServers()[0]?.apiUrl ?? "";
    const send = clientCoordinator.fetchFor(new URL(apiUrl));
    assert.ok(send, "The relay address has no relay fetch.");
    const response = await deadline("the compatibility answer", send(`${apiUrl}${TEAM_API_ROUTES.compatibility}`));
    await response.arrayBuffer();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("keep-alive"), "timeout=60");
  });

  await check("A chat message reaches the host's agent and its reply comes back on the events stream", async () => {
    const text = `Relay check ${randomBytes(4).toString("hex")}`;
    const event = until<string>("the reply of the fixture arrives as an agent event", (done) => {
      const listener = (serverId: string, agentEvent: AgentEvent) => {
        const json = JSON.stringify(agentEvent);
        if (serverId === hostServerId && json.includes(fixture.id) && json.includes("Done.")) done(agentEvent.type);
      };
      clientManager.on("agent", listener);
      return () => clientManager.off("agent", listener);
    });
    const receipt = await ok(
      clientManager.request(hostServerId, TEAM_API_ROUTES.agent.messages(fixture.id), decodeQueuedMessageReceipt, {
        method: "POST",
        body: { agentId: fixture.id, text, timezone: "UTC" },
      }),
    );
    assert.ok(receipt);
    await event;
    const conversation = await ok(clientManager.readAgentConversation(fixture.id, hostServerId));
    assert.ok(JSON.stringify(conversation).includes(text), "The host conversation does not have the message.");
    assert.ok(readFileSync(fakeCodexLog, "utf8").includes(text), "The host provider did not get the message.");
  });

  await check("An 8 MiB attachment goes up and comes back through the client code with the same hash", async () => {
    const blob = new Uint8Array(randomBytes(TRANSFER_BYTES));
    const draft = await ok(
      clientManager.uploadAttachment("relay-blob.bin", "application/octet-stream", blob, hostServerId),
    );
    const downloaded = await ok(clientManager.downloadAttachment(draft.id, hostServerId));
    assert.equal(downloaded.bytes.byteLength, TRANSFER_BYTES);
    assert.equal(sha256(downloaded.bytes), sha256(blob));
  });

  await check("The client connects again after the relay server restarts", async () => {
    assert.ok(relay);
    const before = clientManager.list().find((server) => server.id === hostServerId)?.connectionSequence ?? 0;
    const offline = untilServer("the record goes offline with the relay", (server) => server.state !== "online");
    await killRelay(relay);
    await offline;
    relay = await startRelay(environment);
    relayLogs.push(relay.log);
    await untilServer(
      "the record is online again",
      (server) => online(server) && (server.connectionSequence ?? 0) > before,
    );
    await ok(listAgents());
    assert.equal(relaySignIns().length, 1, "A relay restart must not need a new sign-in.");
  });

  await check("The client signs in again after the owner revokes its session on the host", async () => {
    const { sessions } = memberSessions();
    const tokenBefore = storedServers()[0]?.encryptedToken;
    const signInsBefore = relaySignIns().length;
    for (const session of sessions) await ok(hostService.revokeSession(session.id));
    const refused = await failureOf(listAgents());
    assert.match(inspect(refused.cause), /401/u);
    await untilServer(
      "the record is online with a new session",
      (server) => online(server) && relaySignIns().length === signInsBefore + 1,
    );
    assert.notEqual(storedServers()[0]?.encryptedToken, tokenBefore);
    await ok(listAgents());
  });

  await check("A disabled member gets a final state with no retry loop", async () => {
    const { memberId } = memberSessions();
    await ok(hostService.updateMember({ memberId, disabled: true }));
    await failureOf(listAgents());
    const refused = await untilServer(
      "the record shows the disabled state",
      (server) => server.issue?.message === MEMBER_DISABLED,
    );
    assert.deepEqual(
      [refused.state, refused.issue?.code, refused.issue?.retryable, refused.issue?.reference],
      ["error", "authentication_required", false, "relay/member_disabled"],
    );
    const signIns = relaySignIns().length;
    const gone = untilHosts("the host leaves the directory", (hosts) => hosts.length === 0);
    await ok(hostService.stopRelayHosting());
    await gone;
    await ok(hostService.startRelayHosting(hostStore, { reconnect }));
    await untilHosts("the host is checked again", (hosts) => hosts.some((entry) => entry.serverId === hostServerId));
    await ok(clientManager.wake());
    await failureOf(listAgents());
    const after = clientManager.list().find((server) => server.id === hostServerId);
    assert.equal(after?.issue?.message, MEMBER_DISABLED);
    assert.equal(relaySignIns().length, signIns, "The client signed in again by itself.");
    await ok(hostService.updateMember({ memberId, disabled: false }));
    await ok(clientManager.login({ serverId: hostServerId }));
    await untilServer("the record is online after a new sign-in", online);
    assert.equal(relaySignIns().length, signIns + 1);
  });

  await check("A host that stops hosting stays in the list as offline and comes back when it hosts again", async () => {
    const offline = untilServer(
      "the record shows the host offline",
      (server) => server.issue?.message === HOST_OFFLINE,
    );
    await ok(hostService.stopRelayHosting());
    const server = await offline;
    assert.equal(server.state, "offline");
    assert.deepEqual(
      storedServers().map((stored) => stored.id),
      [hostServerId],
    );
    await ok(hostService.startRelayHosting(hostStore, { reconnect }));
    await untilServer("the record is online again", online);
    await ok(listAgents());
  });

  await check("A renewed host certificate keeps the same record with the new key", async () => {
    const renewed = issue(environment, work, HOST_USER, "server");
    const renewedKeyId = keyIdOf(renewed);
    assert.notEqual(renewedKeyId, hostKeyId);
    const offline = untilServer("the record goes offline", (server) => server.state !== "online");
    await ok(hostService.stopRelayHosting());
    await offline;
    await ok(hostStore.replaceBundle(renewed));
    await ok(hostService.startRelayHosting(hostStore, { reconnect }));
    await untilServer("the record is online under the new key", online);
    const [stored, ...others] = storedServers();
    assert.equal(others.length, 0);
    assert.deepEqual([stored?.id, stored?.relayKeyId], [hostServerId, renewedKeyId]);
    await ok(listAgents());
  });

  await check(
    "This computer can host on the shared control socket, and its own key never becomes a record",
    async () => {
      const hosting = new HostRelay({
        identity: clientStore,
        server: { acceptConnection: (stream) => stream.destroy(), setRelayHosting: () => undefined },
        label: "Alice laptop",
        control: clientCoordinator.control,
      });
      sharedHosting.relay = hosting;
      await ok(hosting.start());
      await untilRoster("the roster shows this computer hosting", (members) =>
        members.some((member) => member.keyId === clientKeyId && member.hosting),
      );
      assert.equal(clientCoordinator.state().status, "online");
      assert.equal(
        clientCoordinator.hosts().some((entry) => entry.keyId === clientKeyId),
        false,
      );
      assert.equal(remoteServers(clientManager.list()).length, 1);
      await ok(hosting.stop());
      sharedHosting.relay = null;
      await untilRoster("the roster shows this computer not hosting", (members) =>
        members.some((member) => member.keyId === clientKeyId && !member.hosting),
      );
      assert.equal(clientCoordinator.state().status, "online");
      await ok(listAgents());
    },
  );

  await check(
    "A server list of a released version loads; old WebRTC records and an unknown transport do not load and stay preserved",
    async () => {
      const directory = join(work, "released");
      mkdirSync(directory);
      const path = join(directory, "openbot-remote-servers.json");
      const base = {
        fingerprint: "fingerprint",
        username: "person@example.com",
        encryptedToken: Buffer.from("token").toString("base64"),
        role: "member",
      };
      const webrtcRecord = {
        ...base,
        id: "webrtc-server",
        name: "WebRTC",
        apiUrl: "webrtc://webrtc-server",
        transport: "webrtc-v2",
      };
      writeFileSync(
        path,
        `${JSON.stringify({
          version: 3,
          activeServerId: "direct-server",
          servers: [
            { ...base, id: "direct-server", name: "Direct", apiUrl: "https://openbot.example" },
            webrtcRecord,
            {
              ...base,
              id: "relay-server",
              name: "Relay",
              apiUrl: "https://not-the-relay.example",
              transport: "relay",
              relayKeyId: hostKeyId,
              relayTeamId: "A".repeat(43),
              relayUser: HOST_USER,
              relayDevice: null,
            },
            { ...base, id: "future-server", name: "Future", apiUrl: "future://x", transport: "future-v9" },
            { ...base, id: "broken-relay", name: "Broken", apiUrl: "x", transport: "relay", relayKeyId: "short" },
          ],
        })}\n`,
      );
      const store = new RemoteServerStore({ path, cipher: testCipher });
      await ok(store.load());
      assert.deepEqual(
        store.servers.map((server) => [server.id, server.transport ?? "direct"]),
        [
          ["direct-server", "direct"],
          ["relay-server", "relay"],
        ],
      );
      const relayRecord = store.find("relay-server");
      assert.ok(relayRecord?.apiUrl.endsWith(RELAY_ADDRESS_SUFFIX), relayRecord?.apiUrl);
      assert.equal(store.activeServerId, "direct-server");
      await ok(store.persist());
      const written = readStoredRemoteServers(JSON.parse(readFileSync(path, "utf8")));
      assert.deepEqual(
        written?.unreadableServers.map((preserved) => preserved.entry.id),
        ["webrtc-server", "future-server", "broken-relay"],
      );
      assert.deepEqual(written?.unreadableServers[0]?.entry, webrtcRecord);
    },
  );

  await check("The client opens network connections only to the relay server", () => {
    const relayTarget = `127.0.0.1:${relayPort}`;
    assert.ok(network.tcpTargets.length > 0, "No connection was seen.");
    assert.deepEqual(
      network.tcpTargets.filter((target) => target !== relayTarget),
      [],
    );
    assert.deepEqual(network.globalFetches, []);
    assert.deepEqual(
      network.httpHosts.filter((entry) => !entry.endsWith(RELAY_ADDRESS_SUFFIX) && entry !== `127.0.0.1${RELAY_PATH}`),
      [],
    );
    assert.equal(network.accountServiceCalls, 0);
    assert.ok(network.relaySocketOpens > 0, "The events socket did not go through the relay.");
  });
} finally {
  if (sharedHosting.relay) await Effect.runPromise(sharedHosting.relay.stop()).catch(() => undefined);
  if (coordinator) await Effect.runPromise(coordinator.stop()).catch(() => undefined);
  if (manager) await Effect.runPromise(manager.stop()).catch(() => undefined);
  if (host) await runCauseEffect(host.shutdown()).catch(() => undefined);
  if (agents) await runCauseEffect(agents.stop()).catch(() => undefined);
  database?.close();
  if (relay) await killRelay(relay).catch(() => undefined);
  rmSync(work, { recursive: true, force: true });
}

const failed = checks.filter((entry) => !entry.passed);
mkdirSync(OUT, { recursive: true });
writeFileSync(
  join(OUT, "report.json"),
  `${JSON.stringify(
    {
      passed: failed.length === 0,
      runtime: `node ${process.version}`,
      checks,
      network: {
        tcpTargets: [...new Set(network.tcpTargets)],
        globalFetches: network.globalFetches.length,
        relayRequests: network.relayRequests.length,
        relaySocketOpens: network.relaySocketOpens,
        accountServiceCalls: network.accountServiceCalls,
      },
      ...(failed.length === 0 ? {} : { relayLogs: relayLogs.map((log) => log.join("")) }),
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
process.exit(failed.length === 0 ? 0 : 1);
