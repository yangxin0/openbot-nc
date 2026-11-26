import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, randomBytes, X509Certificate } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { inspect } from "node:util";
import type { HostStatus, TeamPresenceSnapshot } from "@openbot/contracts/ipc";
import { decodeRelayIdentityBundle, type RelayIdentityBundle } from "@openbot/contracts/relay-protocol/identity-bundle";
import { RELAY_PATH, type RelayTeamMember } from "@openbot/contracts/relay-protocol/messages";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  TEAM_APP_VERSION_HEADER,
  TEAM_CURRENT_CAPABILITIES,
  TEAM_PROTOCOL_V1_WEBSOCKET,
  TEAM_PROTOCOL_V10,
  TEAM_PROTOCOL_VERSION_HEADER,
  TEAM_RELAY_AUTH_CAPABILITY,
  teamCapabilityHeaders,
} from "@openbot/contracts/team-protocol";
import { Effect, Option, Result, Schema } from "effect";
import WebSocket from "ws";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { SidebarLayoutStore } from "../src/backend/sidebar-layout-store";
import { HostService } from "../src/main/host-service";
import type { LocalProfile } from "../src/main/local-profile-store";
import { RelayControl, type RelayControlState } from "../src/main/relay/control";
import { RelayDialer } from "../src/main/relay/dialer";
import { createRelayFetch, RelayAgent } from "../src/main/relay/fetch";
import { type RelayCipher, RelayIdentityStore } from "../src/main/relay/identity-store";
import { decodeJoinResult } from "../src/main/remote-team-decoding";
import type { TeamApiBrowser } from "../src/main/team-api/dependencies";
import { TeamStore } from "../src/main/team-store";
import { rawDataText } from "../src/main/ws-raw-data";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, ".openbot-build/relay-team-api-e2e");
const MAIN = resolve(ROOT, "remote/api/src/relay/main.ts");
const WAIT_MS = 30_000;
const TRANSFER_BYTES = 8 * 1024 * 1024;
const READY_LINE = "OpenBot relay is ready";
const APP_VERSION = "0.0.0-e2e";
const TEAM = "Acme";
const HOST_USER = "host-user";
const SERVER_NAME = "OpenBot-NC";
const RELAY_SIGN_IN_ONLY = "A relay connection signs in only with its certificate.";
const MEMBER_DISABLED = "This team member is disabled.";

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

function untilState(
  control: RelayControl,
  description: string,
  accepts: (state: RelayControlState) => boolean,
): Promise<RelayControlState> {
  return until(description, (done) => {
    const listener = (state: RelayControlState) => {
      if (accepts(state)) done(state);
    };
    control.on("state", listener);
    listener(control.state());
    return () => control.off("state", listener);
  });
}

function untilRoster(
  control: RelayControl,
  description: string,
  accepts: (members: readonly RelayTeamMember[]) => boolean,
): Promise<readonly RelayTeamMember[]> {
  return until(description, (done) => {
    const listener = (members: readonly RelayTeamMember[]) => {
      if (accepts(members)) done(members);
    };
    control.on("roster", listener);
    listener(control.roster());
    return () => control.off("roster", listener);
  });
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

const MemberBody = Schema.Struct({
  id: Schema.String,
  role: Schema.String,
  name: Schema.NullOr(Schema.String),
  disabled: Schema.Boolean,
});
const PresenceEvent = Schema.Struct({
  type: Schema.Literal("team-presence"),
  snapshot: Schema.Struct({ members: Schema.Array(Schema.Struct({ id: Schema.String, role: Schema.String })) }),
});
const StoredTeamMembers = Schema.Struct({
  hosts: Schema.Array(
    Schema.Struct({
      members: Schema.Array(
        Schema.Struct({
          id: Schema.String,
          role: Schema.String,
          email: Schema.NullOr(Schema.String),
          accountId: Schema.optional(Schema.String),
          relayUser: Schema.optional(Schema.String),
          passwordHash: Schema.optional(Schema.String),
        }),
      ),
    }),
  ),
});
const decodeError = Schema.decodeUnknownSync(Schema.Struct({ error: Schema.String }));
const decodeMember = Schema.decodeUnknownSync(MemberBody);
const decodeSession = Schema.decodeUnknownSync(Schema.Struct({ member: MemberBody, sessionToken: Schema.String }));
const decodeCompatibility = Schema.decodeUnknownSync(Schema.Struct({ capabilities: Schema.Array(Schema.String) }));
const decodeAgents = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ id: Schema.String })));
const decodeAttachment = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }));
const decodeStoredTeam = Schema.decodeUnknownSync(Schema.fromJsonString(StoredTeamMembers));
const decodePresenceEvent = Schema.decodeUnknownOption(Schema.fromJsonString(PresenceEvent));

function storedMembers(path: string) {
  const [first] = decodeStoredTeam(readFileSync(path, "utf8")).hosts;
  assert.ok(first, "The team file has no host.");
  return first.members;
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

type Send = (input: string, init?: RequestInit) => Promise<Response>;

interface Answer {
  status: number;
  body: unknown;
}

function teamHeaders(token: string | null): Record<string, string> {
  return {
    [TEAM_PROTOCOL_VERSION_HEADER]: String(TEAM_PROTOCOL_V10),
    [TEAM_APP_VERSION_HEADER]: APP_VERSION,
    ...teamCapabilityHeaders(TEAM_PROTOCOL_V10, TEAM_CURRENT_CAPABILITIES),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function call(
  send: Send,
  origin: string,
  method: string,
  path: string,
  options: { token?: string | null; json?: unknown } = {},
): Promise<Answer> {
  const response = await deadline(
    `${method} ${path}`,
    send(`${origin}${path}`, {
      method,
      headers: {
        ...teamHeaders(options.token ?? null),
        ...(options.json === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(options.json === undefined ? {} : { body: JSON.stringify(options.json) }),
    }),
  );
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

function errorText(answer: Answer): string {
  return decodeError(answer.body).error;
}

type RelayFetcher = ReturnType<typeof createRelayFetch>;

interface Session {
  token: string;
  memberId: string;
  role: string;
  name: string | null;
}

async function relaySignIn(fetcher: RelayFetcher): Promise<Session> {
  const answer = await call(fetcher.fetch, fetcher.origin, "POST", TEAM_API_ROUTES.auth.relay);
  assert.equal(answer.status, 200, inspect(answer.body));
  const joined = decodeJoinResult(answer.body);
  const { member, sessionToken } = decodeSession(answer.body);
  assert.equal(sessionToken, joined.sessionToken);
  return { token: sessionToken, memberId: member.id, role: joined.member.role, name: member.name };
}

const work = mkdtempSync(join(tmpdir(), "openbot-relay-team-api-e2e-"));
const dataDirectory = join(work, "data");
const storeDirectory = join(work, "stores");
const userData = join(work, "user-data");
mkdirSync(storeDirectory);

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
const controls: RelayControl[] = [];
const closers: Array<() => void> = [];
let database: OpenBotDatabase | null = null;
let agents: AgentService | null = null;
let host: HostService | null = null;
const teamPath = join(userData, "openbot-team-server-v2.json");

try {
  await check("The certificate commands make a root, a server certificate and two teams", () => {
    assert.equal(command(environment, "ca", "init").status, 0);
    assert.equal(command(environment, "ca", "server", "--dns", "localhost", "--ip", "127.0.0.1").status, 0);
    assert.equal(command(environment, "ca", "team", "add", TEAM).status, 0);
    assert.equal(command(environment, "ca", "team", "add", "Other").status, 0);
  });

  const hostBundle = issue(environment, work, TEAM, HOST_USER, "server");
  const hostLaptopBundle = issue(environment, work, TEAM, HOST_USER, "laptop");
  const aliceBundle = issue(environment, work, TEAM, "alice", "laptop");
  const bobBundle = issue(environment, work, TEAM, "bob", "desk");
  const eveBundle = issue(environment, work, "Other", "eve", "phone");
  const hostKeyId = keyIdOf(hostBundle);
  const aliceKeyId = keyIdOf(aliceBundle);

  const store = async (name: string, bundle: RelayIdentityBundle) => {
    const identity = new RelayIdentityStore({ path: join(storeDirectory, `${name}.json`), cipher: testCipher });
    await ok(identity.importBundle(bundle));
    return identity;
  };
  const hostStore = await store("host", hostBundle);
  const hostLaptopStore = await store("host-laptop", hostLaptopBundle);
  const aliceStore = await store("alice", aliceBundle);
  const bobStore = await store("bob", bobBundle);
  const eveStore = await store("eve", eveBundle);

  relay = await startRelay(environment);
  relayLogs.push(relay.log);

  database = new OpenBotDatabase(userData);
  const agentStore = new AgentStore(userData, join(work, "home"), database);
  const mailbox = new MailboxStore(userData, agentStore.sharedRoot, agentStore.database);
  const sidebar = new SidebarLayoutStore(join(userData, "sidebar-layout.json"));
  const team = new TeamStore(teamPath);
  await runCauseEffect(sidebar.initialize());
  await runCauseEffect(agentStore.initialize());
  await runCauseEffect(mailbox.initialize());
  await runCauseEffect(team.initialize());
  const fixture = await runCauseEffect(
    agentStore.createAgent({
      name: "Relay fixture",
      description: "Synthetic agent for the relay Team API check",
      avatarSeed: "relay-team-api",
      avatarHue: null,
    }),
  );
  const agentService = new AgentService({ store: agentStore, mailbox, browser: agentBrowser, sidebarLayout: sidebar });
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

  const untilHost = (description: string, accepts: (status: HostStatus) => boolean) =>
    until<HostStatus>(description, (done) => {
      const listener = (status: HostStatus) => {
        if (accepts(status)) done(status);
      };
      hostService.on("changed", listener);
      listener(hostService.getStatus());
      return () => hostService.off("changed", listener);
    });
  const untilPresence = (description: string, accepts: (snapshot: TeamPresenceSnapshot) => boolean) =>
    until<TeamPresenceSnapshot>(description, (done) => {
      const listener = (snapshot: TeamPresenceSnapshot) => {
        if (accepts(snapshot)) done(snapshot);
      };
      hostService.on("presence", listener);
      listener(hostService.getPresence());
      return () => hostService.off("presence", listener);
    });

  await check("Relay hosting makes a host with the local owner and binds the certificate user to it", async () => {
    assert.equal(team.configured, false);
    const status = await ok(hostService.startRelayHosting(hostStore, { reconnect }));
    assert.equal(status.phase, "online");
    assert.equal(status.configured, true);
    assert.equal(status.serverName, SERVER_NAME);
    assert.equal(status.apiUrl, relayUrl);
    const online = await untilHost("the host is online at the relay", (current) => current.apiOnline);
    assert.equal(online.message, "Your team can connect to this OpenBot-NC through the relay server.");
    assert.equal(hostService.relayHostingState()?.status, "online");
    assert.equal(decodeStoredTeam(readFileSync(teamPath, "utf8")).hosts.length, 1);
    assert.deepEqual(
      storedMembers(teamPath).map((member) => [member.role, member.relayUser, member.accountId, member.email]),
      [["owner", HOST_USER, localOwner.id, null]],
    );
  });

  const aliceControl = new RelayControl({ identity: aliceStore, reconnect });
  const bobControl = new RelayControl({ identity: bobStore, reconnect });
  const eveControl = new RelayControl({ identity: eveStore, reconnect });
  const hostLaptopControl = new RelayControl({ identity: hostLaptopStore, reconnect });
  controls.push(aliceControl, bobControl, eveControl, hostLaptopControl);

  await check("A member of the team sees the host in the roster, hosting, with the server name", async () => {
    await ok(aliceControl.start());
    await ok(bobControl.start());
    await ok(eveControl.start());
    await ok(hostLaptopControl.start());
    const roster = await untilRoster(aliceControl, "alice sees the host", (members) =>
      members.some((member) => member.keyId === hostKeyId && member.hosting),
    );
    const seen = roster.find((member) => member.keyId === hostKeyId);
    assert.deepEqual([seen?.user, seen?.device, seen?.label], [HOST_USER, "server", SERVER_NAME]);
    await untilState(eveControl, "eve is online", (state) => state.status === "online");
    assert.equal(
      eveControl.roster().some((member) => member.keyId === hostKeyId),
      false,
    );
  });

  const aliceDialer = new RelayDialer({ control: aliceControl });
  const bobDialer = new RelayDialer({ control: bobControl });
  const hostLaptopDialer = new RelayDialer({ control: hostLaptopControl });
  const eveDialer = new RelayDialer({ control: eveControl });
  const aliceFetch = createRelayFetch({ dialer: aliceDialer, target: hostKeyId });
  const bobFetch = createRelayFetch({ dialer: bobDialer, target: hostKeyId });
  const ownerFetch = createRelayFetch({ dialer: hostLaptopDialer, target: hostKeyId });
  closers.push(aliceFetch.close, bobFetch.close, ownerFetch.close);

  await check("The host serves the relay sign-in capability through the relay", async () => {
    const answer = await call(aliceFetch.fetch, aliceFetch.origin, "GET", TEAM_API_ROUTES.compatibility);
    assert.equal(answer.status, 200);
    assert.ok(decodeCompatibility(answer.body).capabilities.includes(TEAM_RELAY_AUTH_CAPABILITY));
  });

  let alice: Session | null = null;
  await check("The relay sign-in gives alice a stored member session, and /v1/me agrees", async () => {
    const session = await relaySignIn(aliceFetch);
    alice = session;
    assert.equal(session.role, "member");
    assert.equal(session.name, "alice");
    const me = await call(aliceFetch.fetch, aliceFetch.origin, "GET", TEAM_API_ROUTES.me, { token: session.token });
    assert.equal(me.status, 200);
    const member = decodeMember(me.body);
    assert.deepEqual(
      [member.id, member.role, member.name, member.disabled],
      [session.memberId, "member", "alice", false],
    );
    const again = await relaySignIn(aliceFetch);
    assert.equal(again.memberId, session.memberId);
    assert.notEqual(again.token, session.token);
  });

  let owner: Session | null = null;
  await check("A second device of the host user gets the owner session", async () => {
    const session = await relaySignIn(ownerFetch);
    owner = session;
    assert.equal(session.role, "owner");
    assert.equal(session.memberId, team.getOwnerMemberId());
  });

  await check("A route that needs a session works with the relay session token", async () => {
    assert.ok(alice);
    assert.ok(owner);
    const memberAgents = await call(aliceFetch.fetch, aliceFetch.origin, "GET", TEAM_API_ROUTES.agents.all, {
      token: alice.token,
    });
    assert.equal(memberAgents.status, 200, inspect(memberAgents.body));
    decodeAgents(memberAgents.body);
    const ownerAgents = await call(ownerFetch.fetch, ownerFetch.origin, "GET", TEAM_API_ROUTES.agents.all, {
      token: owner.token,
    });
    assert.equal(ownerAgents.status, 200, inspect(ownerAgents.body));
    assert.ok(decodeAgents(ownerAgents.body).some((agent) => agent.id === fixture.id));
    const anonymous = await call(aliceFetch.fetch, aliceFetch.origin, "GET", TEAM_API_ROUTES.agents.all);
    assert.equal(anonymous.status, 401);
  });

  await check("An 8 MiB attachment goes up and comes back through the relay with the same hash", async () => {
    assert.ok(alice);
    const blob = randomBytes(TRANSFER_BYTES);
    const uploaded = await deadline(
      "the upload",
      aliceFetch.fetch(
        `${aliceFetch.origin}${TEAM_API_ROUTES.attachments}?name=blob.bin&mime=application%2Foctet-stream`,
        {
          method: "POST",
          headers: { ...teamHeaders(alice.token), "Content-Type": "application/octet-stream" },
          body: blob,
        },
      ),
    );
    assert.equal(uploaded.status, 201);
    const attachment = decodeAttachment(await uploaded.json());
    const downloaded = await deadline(
      "the download",
      aliceFetch.fetch(`${aliceFetch.origin}${TEAM_API_ROUTES.attachment(attachment.id)}`, {
        headers: teamHeaders(alice.token),
      }),
    );
    assert.equal(downloaded.status, 200);
    const bytes = new Uint8Array(await deadline("the download body", downloaded.arrayBuffer()));
    assert.equal(bytes.byteLength, TRANSFER_BYTES);
    assert.equal(sha256(bytes), sha256(blob));
  });

  await check("A relay caller cannot use the password, invitation or account sign-in routes", async () => {
    const login = await call(aliceFetch.fetch, aliceFetch.origin, "POST", TEAM_API_ROUTES.auth.login, {
      json: { username: "owner", password: "a-password-of-the-owner" },
    });
    assert.deepEqual([login.status, errorText(login)], [403, RELAY_SIGN_IN_ONLY]);
    const account = await call(aliceFetch.fetch, aliceFetch.origin, "POST", TEAM_API_ROUTES.auth.account, {
      json: { accountTicket: "ticket" },
    });
    assert.deepEqual([account.status, errorText(account)], [403, RELAY_SIGN_IN_ONLY]);
    const join = await call(aliceFetch.fetch, aliceFetch.origin, "POST", TEAM_API_ROUTES.join.server, {
      json: { inviteToken: "token", username: "mallory", password: "a-password-of-mallory" },
    });
    assert.deepEqual([join.status, errorText(join)], [403, RELAY_SIGN_IN_ONLY]);
    const joinAccount = await call(aliceFetch.fetch, aliceFetch.origin, "POST", TEAM_API_ROUTES.join.account, {
      json: { inviteToken: "token", accountTicket: "ticket" },
    });
    assert.deepEqual([joinAccount.status, errorText(joinAccount)], [403, RELAY_SIGN_IN_ONLY]);
  });

  const eventsAgent = new RelayAgent({ dialer: aliceDialer, target: hostKeyId, poolSize: 1 });
  closers.push(() => eventsAgent.destroy());
  const eventsClosed: { promise: Promise<void> | null } = { promise: null };

  await check("The events socket on a second stream gets the role change that the owner makes", async () => {
    assert.ok(alice);
    assert.ok(owner);
    const aliceSession = alice;
    const socket = new WebSocket(
      `ws://relay.invalid${TEAM_API_ROUTES.events}`,
      [TEAM_PROTOCOL_V1_WEBSOCKET, `openbot-token.${aliceSession.token}`],
      { agent: eventsAgent },
    );
    closers.push(() => socket.terminate());
    eventsClosed.promise = new Promise<void>((resolveClosed) => socket.once("close", () => resolveClosed()));
    socket.on("error", () => undefined);
    await until<void>("the events socket opens", (done) => {
      const listener = () => done();
      socket.once("open", listener);
      return () => socket.off("open", listener);
    });
    assert.equal(socket.protocol, TEAM_PROTOCOL_V1_WEBSOCKET);
    await untilPresence("the host sees alice online", (snapshot) =>
      snapshot.members.some((member) => member.id === aliceSession.memberId && member.online),
    );
    const seen = until<void>("alice gets the presence with her new role", (done) => {
      const listener = (data: WebSocket.RawData, binary: boolean) => {
        if (binary) return;
        const event = decodePresenceEvent(rawDataText(data));
        if (
          Option.isSome(event) &&
          event.value.snapshot.members.some((member) => member.id === aliceSession.memberId && member.role === "admin")
        )
          done();
      };
      socket.on("message", listener);
      return () => socket.off("message", listener);
    });
    const changed = await call(
      ownerFetch.fetch,
      ownerFetch.origin,
      "PATCH",
      TEAM_API_ROUTES.team.member(aliceSession.memberId),
      { token: owner.token, json: { role: "admin" } },
    );
    assert.equal(changed.status, 200, inspect(changed.body));
    assert.equal(decodeMember(changed.body).role, "admin");
    await seen;
  });

  await check("A stored session sees the new role at its next request", async () => {
    assert.ok(alice);
    const me = await call(aliceFetch.fetch, aliceFetch.origin, "GET", TEAM_API_ROUTES.me, { token: alice.token });
    assert.equal(me.status, 200);
    assert.equal(decodeMember(me.body).role, "admin");
  });

  await check("The owner disables bob, and bob's session and next relay sign-in are refused", async () => {
    assert.ok(owner);
    const bob = await relaySignIn(bobFetch);
    assert.equal(bob.role, "member");
    const disabled = await call(
      ownerFetch.fetch,
      ownerFetch.origin,
      "PATCH",
      TEAM_API_ROUTES.team.member(bob.memberId),
      {
        token: owner.token,
        json: { disabled: true },
      },
    );
    assert.equal(disabled.status, 200, inspect(disabled.body));
    const me = await call(bobFetch.fetch, bobFetch.origin, "GET", TEAM_API_ROUTES.me, { token: bob.token });
    assert.equal(me.status, 401);
    const refused = await call(bobFetch.fetch, bobFetch.origin, "POST", TEAM_API_ROUTES.auth.relay);
    assert.deepEqual([refused.status, errorText(refused)], [400, MEMBER_DISABLED]);
    const members = team.listMembers();
    assert.equal(members.filter((member) => member.name === "bob").length, 1);
  });

  await check("A certificate of another team cannot dial the host", async () => {
    const refusal = await deadline("the dial of eve", failureOf(eveDialer.dial(hostKeyId)));
    assert.equal(refusal.code, "target_unavailable");
  });

  await check("After the revocation of alice's certificate, her control socket and her streams close", async () => {
    assert.ok(alice);
    const aliceSession = alice;
    assert.ok(eventsClosed.promise);
    const revoked = untilState(
      aliceControl,
      "alice is refused",
      (state) => state.status === "offline" && state.retryInMs === null,
    );
    const offlineAtHost = untilPresence("the host sees alice offline", (snapshot) =>
      snapshot.members.some((member) => member.id === aliceSession.memberId && !member.online),
    );
    const revocation = command(environment, "ca", "revoke", "--", aliceKeyId);
    assert.equal(revocation.status, 0, revocation.output);
    const final = await revoked;
    assert.equal(final.status === "offline" ? final.code : null, "certificate_revoked");
    await deadline("the events socket of alice closes", eventsClosed.promise);
    await offlineAtHost;
    const refused = await deadline("a dial of the revoked certificate", failureOf(aliceDialer.dial(hostKeyId)));
    assert.equal(refused.code, "certificate_revoked");
  });

  await check("Relay hosting stops, and the host leaves the roster", async () => {
    const gone = untilRoster(bobControl, "bob sees that the host is gone", (members) =>
      members.every((member) => member.keyId !== hostKeyId),
    );
    const status = await ok(hostService.stopRelayHosting());
    assert.equal(status.phase, "idle");
    assert.equal(hostService.relayHostingState(), null);
    await gone;
  });

  await check("On loopback, the relay sign-in answers 401 and the relay capability is not served", async () => {
    const status = await ok(hostService.startLoopbackOnly());
    const apiUrl = status.apiUrl ?? "";
    assert.ok(apiUrl.startsWith("http://localhost:"), apiUrl);
    const origin = apiUrl.replace("localhost", "127.0.0.1");
    const signIn = await call(fetch, origin, "POST", TEAM_API_ROUTES.auth.relay);
    assert.deepEqual([signIn.status, errorText(signIn)], [401, "Authentication required."]);
    const compatibility = await call(fetch, origin, "GET", TEAM_API_ROUTES.compatibility);
    assert.equal(decodeCompatibility(compatibility.body).capabilities.includes(TEAM_RELAY_AUTH_CAPABILITY), false);
  });

  await runCauseEffect(hostService.shutdown());
  host = null;

  await check("A new team store on the same file keeps the members, roles and certificate users", async () => {
    assert.ok(alice);
    const aliceSession = alice;
    const reopened = new TeamStore(teamPath);
    await runCauseEffect(reopened.initialize());
    assert.equal(reopened.configured, true);
    const members = reopened.listMembers();
    assert.deepEqual(
      members.map((member) => [member.name, member.role, member.disabled]),
      [
        [localOwner.name, "owner", false],
        ["alice", "admin", false],
        ["bob", "member", true],
      ],
    );
    const again = await runCauseEffect(
      reopened.loginWithRelayPeer({ keyId: aliceKeyId, user: "alice", device: "laptop" }),
    );
    assert.deepEqual([again.member.id, again.member.role], [aliceSession.memberId, "admin"]);
    assert.deepEqual(
      storedMembers(teamPath).map((member) => member.relayUser),
      [HOST_USER, "alice", "bob"],
    );
  });

  await check("A team file of a released version with no certificate users loads and binds its owner", async () => {
    const directory = join(work, "released");
    mkdirSync(directory);
    const path = join(directory, "openbot-team-server-v2.json");
    const keys = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const createdAt = new Date(0).toISOString();
    const released = {
      version: 2,
      activeAccountId: "released-account",
      hosts: [
        {
          version: 1,
          serverId: "released-server",
          serverName: "Released Server",
          enabledOnLaunch: false,
          publicKey: keys.publicKey,
          privateKey: keys.privateKey,
          members: [
            {
              id: "released-owner",
              accountId: "released-account",
              username: "owner",
              email: null,
              name: "Owner",
              avatarUrl: null,
              role: "owner",
              disabled: false,
              createdAt,
            },
            {
              id: "released-carol",
              username: "carol",
              email: null,
              name: null,
              avatarUrl: null,
              role: "admin",
              disabled: false,
              createdAt,
              passwordSalt: "salt",
              passwordHash: "hash",
            },
          ],
          invites: [],
          sessions: [],
        },
      ],
    };
    writeFileSync(path, `${JSON.stringify(released)}\n`);
    const reopened = new TeamStore(path);
    await runCauseEffect(reopened.initialize());
    assert.equal(reopened.getIdentity()?.serverId, "released-server");
    await runCauseEffect(reopened.bindRelayOwner(HOST_USER));
    const ownerSession = await runCauseEffect(
      reopened.loginWithRelayPeer({ keyId: hostKeyId, user: HOST_USER, device: "server" }),
    );
    assert.deepEqual([ownerSession.member.id, ownerSession.member.role], ["released-owner", "owner"]);
    const carol = await runCauseEffect(reopened.loginWithRelayPeer({ keyId: aliceKeyId, user: "carol", device: null }));
    assert.notEqual(carol.member.id, "released-carol");
    assert.equal(carol.member.role, "member");
    const releasedMembers = storedMembers(path);
    assert.deepEqual(
      releasedMembers.map((member) => [
        member.id === "released-carol" ? "released-carol" : member.role,
        member.relayUser,
      ]),
      [
        ["owner", HOST_USER],
        ["released-carol", undefined],
        ["member", "carol"],
      ],
    );
    assert.equal(releasedMembers[1]?.passwordHash, "hash");
  });
} finally {
  for (const close of closers) close();
  for (const control of controls) await Effect.runPromise(control.stop());
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
