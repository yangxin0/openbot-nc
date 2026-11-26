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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { inspect } from "node:util";
import { decodeRelayIdentityBundle, type RelayIdentityBundle } from "@openbot/contracts/relay-protocol/identity-bundle";
import {
  RELAY_LABEL_LIMIT,
  RELAY_PATH,
  RELAY_PROTOCOL_VERSION,
  RELAY_SESSION_FRAME_PAYLOAD_LIMIT,
  RELAY_SESSION_WINDOW_BYTES,
  RELAY_SESSIONS_FEATURE,
  type RelayRole,
  type RelayServerProofTranscriptInput,
  type RelayTeamMember,
  relayServerProofTranscript,
} from "@openbot/contracts/relay-protocol/messages";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { Effect, Result } from "effect";
import WebSocket, { WebSocketServer } from "ws";
import { generateSigningKey, issueCertificate } from "../remote/api/src/relay/x509";
import { RelayAcceptor } from "../src/main/relay/acceptor";
import { RelayControl, type RelayControlState } from "../src/main/relay/control";
import { RelayDialer } from "../src/main/relay/dialer";
import { createRelayFetch, RelayAgent } from "../src/main/relay/fetch";
import { type RelayCipher, RelayIdentityError, RelayIdentityStore } from "../src/main/relay/identity-store";
import { RelaySocketError } from "../src/main/relay/socket";
import { RelayStream } from "../src/main/relay/stream";
import { rawDataBytes } from "../src/main/ws-raw-data";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, ".openbot-build/relay-client-e2e");
const MAIN = resolve(ROOT, "remote/api/src/relay/main.ts");
const SYSTEM_ROOTS_CHILD = resolve(ROOT, "scripts/relay-client-system-roots-child.ts");
const WAIT_MS = 30_000;
const TRANSFER_BYTES = 8 * 1024 * 1024;
const HELD_BYTES = 32 * 1024 * 1024;
const POOL_SIZE = 4;
const PARALLEL_REQUESTS = 20;
const READY_LINE = "OpenBot relay is ready";

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

function nextState(
  control: RelayControl,
  description: string,
  accepts: (state: RelayControlState) => boolean,
): Promise<RelayControlState> {
  return until(description, (done) => {
    const listener = (state: RelayControlState) => {
      if (accepts(state)) done(state);
    };
    control.on("state", listener);
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
  device?: string,
): RelayIdentityBundle {
  const file = join(directory, `${randomBytes(6).toString("hex")}.json`);
  const result = command(
    environment,
    "ca",
    "issue",
    "--team",
    team,
    "--user",
    user,
    ...(device === undefined ? [] : ["--device", device]),
    "--out",
    file,
  );
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

interface FakeServerProof {
  certificate: string;
  privateKey: KeyObject;
  change?: (transcript: RelayServerProofTranscriptInput) => RelayServerProofTranscriptInput;
}

interface FakeRelay {
  url: string;
  connections: number;
  received: string[][];
  closed: EventEmitter<{ closed: [] }>;
  closedCount: number;
  stop: () => void;
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
    clientKeyId: createHash("sha256")
      .update(new X509Certificate(hello.certificate).publicKey.export({ type: "spki", format: "der" }))
      .digest("base64url"),
  };
}

function isRole(value: unknown): value is RelayRole {
  return value === "member";
}

async function startFakeRelay(tls: { cert: string; key: string }, proof: FakeServerProof): Promise<FakeRelay> {
  const server = createHttpsServer(tls);
  const sockets = new WebSocketServer({ server, path: RELAY_PATH });
  const fake: FakeRelay = {
    url: "",
    connections: 0,
    received: [],
    closed: new EventEmitter<{ closed: [] }>(),
    closedCount: 0,
    stop: () => {
      for (const client of sockets.clients) client.terminate();
      sockets.close();
      server.close();
    },
  };
  sockets.on("connection", (socket) => {
    fake.connections += 1;
    const received: string[] = [];
    fake.received.push(received);
    const serverNonce = randomBytes(32).toString("base64url");
    socket.send(JSON.stringify({ type: "challenge", version: RELAY_PROTOCOL_VERSION, nonce: serverNonce }));
    socket.on("message", (data) => {
      const message = Buffer.from(rawDataBytes(data)).toString("utf8");
      received.push(message);
      const transcript = received.length === 1 ? helloTranscript(serverNonce, message) : null;
      if (!transcript) return;
      const signature = sign(
        "sha256",
        Buffer.from(relayServerProofTranscript(proof.change?.(transcript) ?? transcript)),
        {
          key: proof.privateKey,
          dsaEncoding: "ieee-p1363",
        },
      ).toString("base64url");
      socket.send(
        JSON.stringify({
          type: "server-proof",
          version: RELAY_PROTOCOL_VERSION,
          certificate: proof.certificate,
          signature,
        }),
      );
      socket.send(
        JSON.stringify({
          type: "welcome",
          version: RELAY_PROTOCOL_VERSION,
          self: { keyId: transcript.clientKeyId, user: "dave", device: null },
          team: { id: "t".repeat(43), name: "Alpha Team" },
          members: [],
          features: [RELAY_SESSIONS_FEATURE],
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
  return until("the fake relay sees the socket close", (done) => {
    const listener = () => {
      if (fake.closedCount >= count) done(undefined);
    };
    fake.closed.on("closed", listener);
    listener();
    return () => fake.closed.off("closed", listener);
  });
}

interface HostEvents {
  slowStarted: [];
  slowClosed: [];
  heldStarted: [];
}

const blob = randomBytes(TRANSFER_BYTES);
const blobDigest = sha256(blob);
const hostEvents = new EventEmitter<HostEvents>();
const hostPeers: string[] = [];
const host = {
  accepted: 0,
  open: 0,
  gatePending: 0,
  gateMostPending: 0,
  gateStreams: new Set<unknown>(),
  gateOpened: false,
  releaseHeld: () => {},
};
const gate = new EventEmitter<{ opened: [] }>();
const heldReleased = new Promise<void>((resolveHeld) => {
  host.releaseHeld = resolveHeld;
});

type HostAnswer =
  | { user: string | null; device: string | null; keyId: string | null }
  | { bytes: number; sha256: string }
  | { passed: true }
  | { error: string };

function sendJson(response: ServerResponse, status: number, value: HostAnswer): void {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, { "Content-Type": "application/json", "Content-Length": String(body.length) });
  response.end(body);
}

function digestBody(request: IncomingMessage): Promise<{ bytes: number; sha256: string }> {
  return new Promise((resolveDigest, reject) => {
    const hash = createHash("sha256");
    let bytes = 0;
    request.on("data", (chunk: Buffer) => {
      hash.update(chunk);
      bytes += chunk.length;
    });
    request.once("end", () => resolveDigest({ bytes, sha256: hash.digest("hex") }));
    request.once("error", reject);
  });
}

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.once("end", () => resolveBody(Buffer.concat(chunks)));
    request.once("error", reject);
  });
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", "http://host.invalid");
  const route = `${request.method} ${url.pathname}`;
  const stream = request.socket;
  const peer = stream instanceof RelayStream ? stream.peer : null;
  if (route === "GET /hello") {
    sendJson(response, 200, { user: peer?.user ?? null, device: peer?.device ?? null, keyId: peer?.keyId ?? null });
    return;
  }
  if (route === "POST /echo") {
    const body = await readBody(request);
    response.writeHead(200, {
      "Content-Type": request.headers["content-type"] ?? "application/octet-stream",
      "Content-Length": String(body.length),
      "X-Request-Length": request.headers["content-length"] ?? "none",
    });
    response.end(body);
    return;
  }
  if (route === "POST /upload") {
    sendJson(response, 200, await digestBody(request));
    return;
  }
  if (route === "GET /download") {
    response.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": String(blob.length) });
    response.end(blob);
    return;
  }
  if (route === "GET /redirect") {
    response.writeHead(302, { Location: "/hello", "Content-Length": "0" });
    response.end();
    return;
  }
  if (route === "GET /gate") {
    host.gatePending += 1;
    host.gateMostPending = Math.max(host.gateMostPending, host.gatePending);
    host.gateStreams.add(stream);
    if (host.gatePending >= POOL_SIZE && !host.gateOpened) {
      host.gateOpened = true;
      gate.emit("opened");
    }
    if (!host.gateOpened) await once(gate, "opened");
    host.gatePending -= 1;
    sendJson(response, 200, { passed: true });
    return;
  }
  if (route === "GET /slow") {
    response.once("close", () => hostEvents.emit("slowClosed"));
    hostEvents.emit("slowStarted");
    return;
  }
  if (route === "POST /held") {
    hostEvents.emit("heldStarted");
    await heldReleased;
    sendJson(response, 200, await digestBody(request));
    return;
  }
  sendJson(response, 404, { error: "Not found" });
}

const work = mkdtempSync(join(tmpdir(), "openbot-relay-client-e2e-"));
const dataDirectory = join(work, "data");
const foreignDirectory = join(work, "foreign");
const storeDirectory = join(work, "stores");
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

let relay: Relay | null = null;
const relayLogs: string[][] = [];
let server: Server | null = null;
const controls: RelayControl[] = [];
const acceptors: RelayAcceptor[] = [];
const closers: Array<() => void> = [];

try {
  await check("The certificate commands make a root, a server certificate and two teams", () => {
    assert.equal(command(environment, "ca", "init").status, 0);
    assert.equal(command(environment, "ca", "server", "--dns", "localhost", "--ip", "127.0.0.1").status, 0);
    assert.equal(command(environment, "ca", "team", "add", "Alpha Team").status, 0);
    assert.equal(command(environment, "ca", "team", "add", "Beta Team").status, 0);
    const foreign = { RELAY_DATA_DIR: foreignDirectory, RELAY_PUBLIC_URL: relayUrl };
    assert.equal(command(foreign, "ca", "init").status, 0);
    assert.equal(command(foreign, "ca", "team", "add", "Alpha Team").status, 0);
    assert.equal(command(foreign, "ca", "server", "--dns", "localhost", "--ip", "127.0.0.1").status, 0);
  });

  const alice = issue(environment, work, "Alpha Team", "alice", "laptop");
  const bob = issue(environment, work, "Alpha Team", "bob", "desk");
  const dave = issue(environment, work, "Alpha Team", "dave");
  const carol = issue(environment, work, "Beta Team", "carol", "server");
  const foreignAlice = issue(
    { RELAY_DATA_DIR: foreignDirectory, RELAY_PUBLIC_URL: relayUrl },
    work,
    "Alpha Team",
    "alice",
    "laptop",
  );
  const aliceKeyId = keyIdOf(alice);
  const bobKeyId = keyIdOf(bob);
  const carolKeyId = keyIdOf(carol);

  const alicePath = join(storeDirectory, "alice.json");
  const aliceStore = new RelayIdentityStore({ path: alicePath, cipher: testCipher });
  const bobStore = new RelayIdentityStore({ path: join(storeDirectory, "bob.json"), cipher: testCipher });
  const carolStore = new RelayIdentityStore({ path: join(storeDirectory, "carol.json"), cipher: testCipher });

  await check("A store imports an identity file and gives the identity of the certificate", async () => {
    assert.equal(await ok(aliceStore.load()), null);
    assert.equal(aliceStore.current(), null);
    const identity = await ok(aliceStore.importBundle(alice));
    assert.equal(identity.user, "alice");
    assert.equal(identity.device, "laptop");
    assert.equal(identity.team, "Alpha Team");
    assert.equal(identity.keyId, aliceKeyId);
    assert.equal(identity.relayUrl, relayUrl);
    assert.equal(identity.certificate, alice.certificate);
    assert.deepEqual(identity.chain, alice.chain);
    assert.equal(identity.root, alice.root);
    assert.equal(identity.expiresAt, Date.parse(new X509Certificate(alice.certificate).validTo));
    assert.ok(identity.expiresAt > Date.now());
    assert.deepEqual(aliceStore.current(), identity);
    await ok(bobStore.importBundle(bob));
    await ok(carolStore.importBundle(carol));
  });

  await check("The identity file on the disk has no plain private key, and a new store loads it", async () => {
    const stored = readFileSync(alicePath, "utf8");
    assert.equal(stored.includes("PRIVATE KEY"), false);
    assert.equal(stored.includes(alice.privateKey.trim().split("\n")[1] ?? "missing"), false);
    assert.match(stored, /"encryptedPrivateKey":"[A-Za-z0-9+/=]+"/u);
    const second = new RelayIdentityStore({ path: alicePath, cipher: testCipher });
    assert.deepEqual(await ok(second.load()), aliceStore.current());
    assert.ok(second.signHello({ nonce: "n".repeat(43), clientNonce: "c".repeat(43), role: "member" }));
  });

  await check("A second import is refused, and an explicit replace is accepted", async () => {
    const refusal = await failureOf(aliceStore.importBundle(dave));
    assert.ok(refusal instanceof RelayIdentityError);
    assert.equal(refusal.reason, "already_imported");
    assert.equal(aliceStore.current()?.user, "alice");
    const fresh = new RelayIdentityStore({ path: alicePath, cipher: testCipher });
    assert.equal((await failureOf(fresh.importBundle(dave))).reason, "already_imported");
    const scratch = new RelayIdentityStore({ path: join(storeDirectory, "scratch.json"), cipher: testCipher });
    await ok(scratch.importBundle(dave));
    assert.equal((await ok(scratch.replaceBundle(alice))).user, "alice");
    await ok(scratch.remove());
    assert.equal(scratch.current(), null);
    assert.equal(existsSync(join(storeDirectory, "scratch.json")), false);
  });

  await check(
    "A store refuses a wrong private key, a foreign root, an expired certificate and a bad file",
    async () => {
      const fresh = (name: string, now?: () => number) =>
        new RelayIdentityStore({
          path: join(storeDirectory, `${name}.json`),
          cipher: testCipher,
          ...(now ? { now } : {}),
        });
      const wrongKey = await failureOf(fresh("wrong-key").importBundle({ ...alice, privateKey: bob.privateKey }));
      assert.equal(wrongKey.reason, "key_mismatch");
      const foreignRoot = await failureOf(fresh("foreign-root").importBundle({ ...alice, root: foreignAlice.root }));
      assert.equal(foreignRoot.reason, "untrusted_chain");
      const otherNames = await failureOf(fresh("other-names").importBundle({ ...alice, user: "mallory" }));
      assert.equal(otherNames.reason, "invalid_bundle");
      const late = fresh("expired", () => Date.parse(new X509Certificate(alice.certificate).validTo) + 1);
      assert.equal((await failureOf(late.importBundle(alice))).reason, "expired");
      assert.equal((await failureOf(fresh("not-a-bundle").importBundle({ version: 1 }))).reason, "invalid_bundle");
      for (const name of ["wrong-key", "foreign-root", "other-names", "expired", "not-a-bundle"]) {
        assert.equal(existsSync(join(storeDirectory, `${name}.json`)), false);
      }
    },
  );

  relay = await startRelay(environment);
  relayLogs.push(relay.log);

  const aliceControl = new RelayControl({ identity: aliceStore, reconnect });
  const bobControl = new RelayControl({ identity: bobStore, reconnect });
  const carolControl = new RelayControl({ identity: carolStore, hosting: true, label: "Carol server", reconnect });
  controls.push(aliceControl, bobControl, carolControl);
  const aliceDialer = new RelayDialer({ control: aliceControl });
  const bobDialer = new RelayDialer({ control: bobControl });

  await check("Two members of one team go online and see each other in the roster", async () => {
    await ok(aliceControl.start());
    await ok(bobControl.start());
    await ok(carolControl.start());
    await Promise.all(
      controls.map((control) => untilState(control, "a member is online", (state) => state.status === "online")),
    );
    const seenByAlice = await untilRoster(aliceControl, "alice sees two members", (members) => members.length === 2);
    const seenByBob = await untilRoster(bobControl, "bob sees two members", (members) => members.length === 2);
    assert.deepEqual(
      seenByAlice.map((member) => [member.user, member.device, member.hosting]),
      [
        ["alice", "laptop", false],
        ["bob", "desk", false],
      ],
    );
    assert.deepEqual(
      seenByBob.map((member) => member.keyId),
      [aliceKeyId, bobKeyId],
    );
    assert.deepEqual(aliceControl.self(), { keyId: aliceKeyId, user: "alice", device: "laptop" });
    assert.equal(aliceControl.team()?.name, "Alpha Team");
    assert.equal(bobControl.team()?.id, aliceControl.team()?.id);
    assert.notEqual(carolControl.team()?.id, aliceControl.team()?.id);
    assert.deepEqual(
      carolControl.roster().map((member) => member.user),
      ["carol"],
    );
  });

  await check("A presence change of one member reaches the other member", async () => {
    await ok(bobControl.setHosting(true, "Bob desk"));
    const members = await untilRoster(aliceControl, "alice sees that bob hosts", (roster) =>
      roster.some((member) => member.keyId === bobKeyId && member.hosting && member.label === "Bob desk"),
    );
    assert.equal(members.find((member) => member.keyId === aliceKeyId)?.hosting, false);
    const tooLong = await failureOf(bobControl.setHosting(true, "x".repeat(RELAY_LABEL_LIMIT + 1)));
    assert.equal(tooLong.code, "invalid_message");
    assert.equal(bobControl.state().status, "online");
  });

  const hostServer = createServer((request, response) => {
    handle(request, response).catch(() => response.destroy());
  });
  hostServer.keepAliveTimeout = WAIT_MS;
  server = hostServer;
  const echoSockets = new WebSocketServer({ noServer: true });
  hostServer.on("upgrade", (request, socket, head) => {
    echoSockets.handleUpgrade(request, socket, head, (client) => {
      client.on("message", (data, isBinary) => client.send(data, { binary: isBinary }));
    });
  });
  const refusedAccepts: string[] = [];
  const bobAcceptor = new RelayAcceptor({
    control: bobControl,
    onStream: (stream, peer) => {
      hostPeers.push(peer.user);
      host.accepted += 1;
      host.open += 1;
      stream.once("close", () => {
        host.open -= 1;
      });
      hostServer.emit("connection", stream);
    },
    onRefused: (error) => refusedAccepts.push(error.code),
  });
  acceptors.push(bobAcceptor);
  await ok(bobAcceptor.start());

  const fetcher = createRelayFetch({ dialer: aliceDialer, target: bobKeyId, poolSize: POOL_SIZE });
  closers.push(() => fetcher.close());

  await check("A request through the relay reaches the HTTP server, which knows the verified peer", async () => {
    const response = await deadline("the first request", fetcher.fetch(`${fetcher.origin}/hello`));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/json");
    assert.deepEqual(await response.json(), { user: "alice", device: "laptop", keyId: aliceKeyId });
    assert.equal(host.accepted, 1);
    assert.deepEqual(hostPeers, ["alice"]);
  });

  await check("A POST request carries its body and its length, and the stream is used again", async () => {
    const text = JSON.stringify({ message: "héllo", list: [1, 2, 3] });
    const response = await deadline(
      "the POST request",
      fetcher.fetch(`${fetcher.origin}/echo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: text,
      }),
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-request-length"), String(Buffer.byteLength(text)));
    assert.equal(await response.text(), text);
    assert.equal(host.accepted, 1);
  });

  await check("A redirect answer is given as it is, and a different address is refused", async () => {
    const response = await deadline("the redirect request", fetcher.fetch(`${fetcher.origin}/redirect`));
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/hello");
    await response.arrayBuffer();
    await assert.rejects(fetcher.fetch("http://other.invalid/hello"), TypeError);
    const missing = await deadline("the unknown path", fetcher.fetch(`${fetcher.origin}/missing`));
    assert.equal(missing.status, 404);
    await missing.arrayBuffer();
  });

  await check("An upload of 8 MiB arrives complete, from a buffer and from a streamed body", async () => {
    for (const body of [blob, new Blob([blob])]) {
      const response = await deadline(
        "the upload",
        fetcher.fetch(`${fetcher.origin}/upload`, { method: "POST", body }),
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { bytes: TRANSFER_BYTES, sha256: blobDigest });
    }
  });

  await check("A download of 8 MiB arrives complete as a stream", async () => {
    const response = await deadline("the download", fetcher.fetch(`${fetcher.origin}/download`));
    assert.equal(response.status, 200);
    assert.ok(response.body);
    const reader = response.body.getReader();
    const hash = createHash("sha256");
    let bytes = 0;
    let parts = 0;
    for (;;) {
      const part = await deadline("a part of the download", reader.read());
      if (part.done) break;
      hash.update(part.value);
      bytes += part.value.byteLength;
      parts += 1;
    }
    assert.equal(bytes, TRANSFER_BYTES);
    assert.equal(hash.digest("hex"), blobDigest);
    assert.ok(parts > 1, "The download must arrive in more than one part.");
  });

  await check("20 requests at the same time use a pool of 4 streams", async () => {
    const answers = await deadline(
      "the parallel requests",
      Promise.all(
        Array.from({ length: PARALLEL_REQUESTS }, async () => {
          const response = await fetcher.fetch(`${fetcher.origin}/gate`);
          return { status: response.status, text: await response.text() };
        }),
      ),
    );
    assert.deepEqual(
      answers,
      Array.from({ length: PARALLEL_REQUESTS }, () => ({ status: 200, text: JSON.stringify({ passed: true }) })),
    );
    assert.equal(host.gateMostPending, POOL_SIZE);
    assert.equal(host.gateStreams.size, POOL_SIZE);
    assert.equal(host.open, POOL_SIZE);
    assert.equal(host.accepted, POOL_SIZE);
  });

  await check("A sender holds its data while the receiver holds its credits, and continues when it reads", async () => {
    const held = randomBytes(HELD_BYTES);
    const stream = await deadline("the dial", ok(aliceDialer.dial(bobKeyId)));
    assert.equal(stream.connecting, false);
    assert.equal(stream.peer?.keyId, bobKeyId);
    assert.equal(stream.peer?.user, "bob");
    assert.equal(new X509Certificate(stream.peer?.certificate ?? "").subject.includes("CN=bob"), true);
    const blocked = until<void>("the sender uses its whole window", (done) => {
      const look = () => {
        if (stream.unacknowledgedBytes() + RELAY_SESSION_FRAME_PAYLOAD_LIMIT > RELAY_SESSION_WINDOW_BYTES) done();
      };
      const stop = stream.onProgress(look);
      look();
      return stop;
    });
    const started = deadline("the held request starts", once(hostEvents, "heldStarted"));
    const answered = new Promise<{ status: number; body: Buffer }>((resolveAnswer, reject) => {
      const request = httpRequest({
        createConnection: () => stream,
        method: "POST",
        host: "host.invalid",
        path: "/held",
        headers: { "Content-Length": String(held.length) },
      });
      request.once("error", reject);
      request.once("response", (response) => {
        readBody(response).then((body) => resolveAnswer({ status: response.statusCode ?? 0, body }), reject);
      });
      request.end(held);
    });
    answered.catch(() => undefined);
    await started;
    await blocked;
    assert.ok(stream.unacknowledgedBytes() <= RELAY_SESSION_WINDOW_BYTES);
    assert.ok(stream.queuedBytes() > 0, "The sender keeps the rest of its data.");
    host.releaseHeld();
    const answer = await deadline("the held upload", answered);
    assert.equal(answer.status, 200);
    assert.deepEqual(JSON.parse(answer.body.toString("utf8")), {
      bytes: HELD_BYTES,
      sha256: sha256(held),
    });
    stream.destroy();
  });

  await check("A WebSocket through a relay agent echoes text and bytes", async () => {
    const agent = new RelayAgent({ dialer: aliceDialer, target: bobKeyId, poolSize: 1 });
    const socket = new WebSocket("ws://host.invalid/echo", { agent });
    try {
      await deadline("the WebSocket opens", once(socket, "open"));
      const received: Array<{ data: Buffer; binary: boolean }> = [];
      const both = until<void>("two echoes", (done) => {
        const listener = (data: WebSocket.RawData, binary: boolean) => {
          received.push({ data: Buffer.from(rawDataBytes(data)), binary });
          if (received.length === 2) done();
        };
        socket.on("message", listener);
        return () => socket.off("message", listener);
      });
      const bytes = randomBytes(300_000);
      socket.send("text through the relay");
      socket.send(bytes);
      await both;
      assert.equal(received[0]?.binary, false);
      assert.equal(received[0]?.data.toString("utf8"), "text through the relay");
      assert.equal(received[1]?.binary, true);
      assert.equal(sha256(received[1]?.data ?? Buffer.alloc(0)), sha256(bytes));
      const closed = deadline("the WebSocket closes", once(socket, "close"));
      socket.close(1000);
      await closed;
    } finally {
      socket.terminate();
      agent.destroy();
    }
  });

  await check("A dial to a member of a different team and to a member that does not host is refused", async () => {
    assert.equal(carolControl.state().status, "online");
    const otherTeam = await deadline("the dial to the other team", failureOf(aliceDialer.dial(carolKeyId)));
    assert.equal(otherTeam.code, "target_unavailable");
    const notHosting = await deadline("the dial to a member that does not host", failureOf(bobDialer.dial(aliceKeyId)));
    assert.equal(notHosting.code, "target_unavailable");
    const notAKey = await failureOf(aliceDialer.dial("not a key"));
    assert.equal(notAKey.code, "invalid_message");
    const itself = await deadline("the dial to itself", failureOf(aliceDialer.dial(aliceKeyId)));
    assert.equal(itself.code, "invalid_message");
  });

  await check("A dial gets its stream as soon as the member starts to host", async () => {
    const aliceAcceptor = new RelayAcceptor({
      control: aliceControl,
      onStream: (stream) => stream.pipe(stream),
    });
    acceptors.push(aliceAcceptor);
    await ok(aliceAcceptor.start());
    await ok(aliceControl.setHosting(true, "Alice laptop"));
    await untilRoster(bobControl, "bob sees that alice hosts", (members) =>
      members.some((member) => member.keyId === aliceKeyId && member.hosting),
    );
    const stream = await deadline("the dial", ok(bobDialer.dial(aliceKeyId)));
    assert.equal(stream.peer?.keyId, aliceKeyId);
    const echoed = deadline("the echo of the stream", once(stream, "data"));
    stream.write("ping through the relay");
    const [data] = await echoed;
    assert.equal(Buffer.isBuffer(data) ? data.toString("utf8") : "", "ping through the relay");
    const ended = deadline("the stream closes", once(stream, "close"));
    stream.end();
    await ended;
    await ok(aliceAcceptor.stop());
    await ok(aliceControl.setHosting(false));
  });

  await check("An abort stops a request that runs, and stops a download that runs", async () => {
    const waiting = new AbortController();
    const started = deadline("the slow request starts", once(hostEvents, "slowStarted"));
    const closedAtHost = deadline("the host sees the abort", once(hostEvents, "slowClosed"));
    const pending = fetcher.fetch(`${fetcher.origin}/slow`, { signal: waiting.signal });
    await started;
    waiting.abort();
    await assert.rejects(pending, { name: "AbortError" });
    await closedAtHost;
    const reading = new AbortController();
    const response = await deadline(
      "the download starts",
      fetcher.fetch(`${fetcher.origin}/download`, { signal: reading.signal }),
    );
    assert.ok(response.body);
    const reader = response.body.getReader();
    const first = await deadline("the first part", reader.read());
    assert.equal(first.done, false);
    reading.abort();
    await assert.rejects(
      async () => {
        for (;;) {
          const part = await deadline("a part after the abort", reader.read());
          if (part.done) return;
        }
      },
      { name: "AbortError" },
    );
    const before = new AbortController();
    before.abort();
    await assert.rejects(fetcher.fetch(`${fetcher.origin}/hello`, { signal: before.signal }), { name: "AbortError" });
    const after = await deadline("a request after the aborts", fetcher.fetch(`${fetcher.origin}/hello`));
    assert.equal(after.status, 200);
    await after.arrayBuffer();
  });

  await check("An identity with an Ed25519 key goes online and signs its proof", async () => {
    const directory = join(dataDirectory, "ca/teams");
    const name = createHash("sha256").update("Alpha Team").digest("base64url");
    const issuer = {
      certificate: readFileSync(join(directory, `${name}.crt`), "utf8"),
      privateKey: createPrivateKey(readFileSync(join(directory, `${name}.key`), "utf8")),
    };
    const key = generateKeyPairSync("ed25519");
    const issued = issueCertificate({
      subject: { organization: "Alpha Team", commonName: "erin" },
      publicKey: key.publicKey,
      profile: { kind: "member" },
      days: 30,
      issuer,
      now: Date.now(),
    });
    const store = new RelayIdentityStore({ path: join(storeDirectory, "erin.json"), cipher: testCipher });
    const identity = await ok(
      store.importBundle({
        version: 1,
        relayUrl,
        team: "Alpha Team",
        user: "erin",
        device: null,
        certificate: issued.certificate,
        chain: [issuer.certificate],
        root: alice.root,
        privateKey: key.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      }),
    );
    const control = new RelayControl({ identity: store, reconnect });
    controls.push(control);
    await ok(control.start());
    await untilState(control, "the Ed25519 member is online", (state) => state.status === "online");
    assert.deepEqual(control.self(), { keyId: identity.keyId, user: "erin", device: null });
    await untilRoster(aliceControl, "alice sees the Ed25519 member", (roster) =>
      roster.some((member) => member.keyId === identity.keyId),
    );
    await ok(control.stop());
    assert.deepEqual(control.state(), { status: "offline", code: "stopped", message: "Stopped.", retryInMs: null });
    await untilRoster(aliceControl, "alice sees that the Ed25519 member is gone", (roster) =>
      roster.every((member) => member.keyId !== identity.keyId),
    );
  });

  await check("A second control connection of one certificate replaces the first, which stays stopped", async () => {
    const store = new RelayIdentityStore({ path: join(storeDirectory, "dave.json"), cipher: testCipher });
    const identity = await ok(store.importBundle(dave));
    const first = new RelayControl({ identity: store, reconnect });
    const second = new RelayControl({ identity: store, reconnect });
    controls.push(first, second);
    await ok(first.start());
    await untilState(first, "the first connection is online", (state) => state.status === "online");
    const states: RelayControlState[] = [];
    first.on("state", (state) => states.push(state));
    const replaced = nextState(first, "the first connection is replaced", (state) => state.status === "offline");
    await ok(second.start());
    await untilState(second, "the second connection is online", (state) => state.status === "online");
    const final = await replaced;
    assert.deepEqual(
      [final.status === "offline" ? final.code : null, final.status === "offline" ? final.retryInMs : 0],
      ["replaced", null],
    );
    await untilRoster(aliceControl, "alice sees the member", (roster) =>
      roster.some((member) => member.keyId === identity.keyId),
    );
    await ok(second.stop());
    await untilRoster(aliceControl, "alice sees that the member is gone", (roster) =>
      roster.every((member) => member.keyId !== identity.keyId),
    );
    assert.deepEqual(
      states.map((state) => state.status),
      ["offline"],
    );
    assert.deepEqual(first.state(), final);
  });

  await check("A relay server that demands a TLS certificate accepts the certificate of the identity", async () => {
    const [gatedPort, gatedHealthPort] = await Promise.all([freePort(), freePort()]);
    const gatedUrl = `wss://127.0.0.1:${gatedPort}${RELAY_PATH}`;
    const gated = await startRelay({
      ...environment,
      RELAY_PORT: String(gatedPort),
      RELAY_HEALTH_PORT: String(gatedHealthPort),
      RELAY_PUBLIC_URL: gatedUrl,
      RELAY_TLS_CLIENT_CERTIFICATES: "required",
    });
    relayLogs.push(gated.log);
    try {
      const bare = new WebSocket(gatedUrl, { ca: dave.root });
      const outcome = await deadline(
        "the socket with no certificate ends",
        Promise.race([once(bare, "error").then(() => "refused"), once(bare, "message").then(() => "accepted")]),
      );
      bare.terminate();
      assert.equal(outcome, "refused");
      const store = new RelayIdentityStore({ path: join(storeDirectory, "gated.json"), cipher: testCipher });
      await ok(store.importBundle({ ...dave, relayUrl: gatedUrl }));
      const control = new RelayControl({ identity: store, reconnect });
      controls.push(control);
      await ok(control.start());
      await untilState(control, "the member is online at the second server", (state) => state.status === "online");
      assert.equal(control.self()?.user, "dave");
      await ok(control.stop());
    } finally {
      await killRelay(gated);
    }
  });

  await check("A relay address with no TLS on a different computer is refused and not tried again", async () => {
    const store = new RelayIdentityStore({ path: join(storeDirectory, "plain.json"), cipher: testCipher });
    await ok(store.importBundle({ ...dave, relayUrl: "ws://relay.example.com/v1/relay" }));
    const control = new RelayControl({ identity: store, reconnect });
    controls.push(control);
    const states: RelayControlState[] = [];
    control.on("state", (state) => states.push(state));
    const stopped = nextState(control, "the control stops", (state) => state.status === "offline");
    await ok(control.start());
    const final = await stopped;
    assert.deepEqual(
      [final.status === "offline" ? final.code : null, final.status === "offline" ? final.retryInMs : 0],
      ["insecure_relay_url", null],
    );
    assert.deepEqual(
      states.map((state) => state.status),
      ["connecting", "offline"],
    );
    const none = new RelayControl({
      identity: new RelayIdentityStore({ path: join(storeDirectory, "none.json"), cipher: testCipher }),
      reconnect,
    });
    const refused = nextState(none, "the control with no identity stops", (state) => state.status === "offline");
    await ok(none.start());
    const noIdentity = await refused;
    assert.equal(noIdentity.status === "offline" ? noIdentity.code : null, "identity_unavailable");
  });

  const serverTls = {
    cert: readFileSync(join(dataDirectory, "tls/server.crt"), "utf8"),
    key: readFileSync(join(dataDirectory, "tls/server.key"), "utf8"),
  };
  const teamServerProof: FakeServerProof = { certificate: serverTls.cert, privateKey: createPrivateKey(serverTls.key) };
  const fakeRelayStore = async (name: string, proof: FakeServerProof) => {
    const fake = await startFakeRelay(serverTls, proof);
    closers.push(fake.stop);
    const store = new RelayIdentityStore({ path: join(storeDirectory, `${name}.json`), cipher: testCipher });
    await ok(store.importBundle({ ...dave, relayUrl: fake.url }));
    return { fake, store };
  };
  const refusedByProof = async (name: string, proof: FakeServerProof, reason: string) => {
    const { fake, store } = await fakeRelayStore(name, proof);
    const control = new RelayControl({ identity: store, reconnect });
    controls.push(control);
    const states: RelayControlState[] = [];
    control.on("state", (state) => states.push(state));
    const stopped = nextState(control, "the control stops", (state) => state.status === "offline");
    await ok(control.start());
    const final = await stopped;
    await untilFakeClosed(fake, 1);
    assert.deepEqual(
      [final.status === "offline" ? final.code : null, final.status === "offline" ? final.retryInMs : 0],
      ["server_refused", null],
    );
    assert.ok(final.status === "offline" && final.message.includes(`(${reason})`), JSON.stringify(final));
    assert.deepEqual(
      states.map((state) => state.status),
      ["connecting", "offline"],
    );
    assert.equal(control.self(), null);
    assert.equal(fake.connections, 1);
    assert.equal(fake.received[0]?.length, 1);
    return { fake, store, control };
  };

  await check("The desktop accepts a correct server proof", async () => {
    const { fake, store } = await fakeRelayStore("proof-good", teamServerProof);
    const control = new RelayControl({ identity: store, reconnect });
    controls.push(control);
    await ok(control.start());
    await untilState(control, "the member is online at the fake relay", (state) => state.status === "online");
    assert.equal(control.self()?.keyId, keyIdOf(dave));
    await ok(control.stop());
    assert.equal(fake.connections, 1);
  });

  await check("The desktop refuses a server identity of a different root and does not connect again", async () => {
    const foreignServer = {
      certificate: readFileSync(join(foreignDirectory, "tls/server.crt"), "utf8"),
      privateKey: createPrivateKey(readFileSync(join(foreignDirectory, "tls/server.key"), "utf8")),
    };
    await refusedByProof("proof-foreign-root", foreignServer, "untrusted");
  });

  await check("The desktop refuses a server identity for a different host and does not connect again", async () => {
    const key = generateSigningKey();
    const issued = issueCertificate({
      subject: { commonName: "relay.example.com" },
      publicKey: key.publicKey,
      profile: { kind: "server", dnsNames: ["relay.example.com"], ipAddresses: [] },
      days: 30,
      issuer: {
        certificate: readFileSync(join(dataDirectory, "ca/root.crt"), "utf8"),
        privateKey: createPrivateKey(readFileSync(join(dataDirectory, "ca/root.key"), "utf8")),
      },
      now: Date.now(),
    });
    await refusedByProof("proof-other-host", { certificate: issued.certificate, privateKey: key.privateKey }, "host");
  });

  await check("The desktop refuses a wrong server signature, and a dial opens no other socket", async () => {
    const { fake, control } = await refusedByProof(
      "proof-wrong-signature",
      {
        ...teamServerProof,
        change: (transcript) => ({ ...transcript, clientNonce: randomBytes(32).toString("base64url") }),
      },
      "signature",
    );
    const refused = await deadline(
      "a dial to the fake relay",
      failureOf(new RelayDialer({ control }).dial(aliceKeyId)),
    );
    assert.equal(refused.code, "server_refused");
    assert.equal(fake.connections, 1);
  });

  await check("The desktop trusts a TLS certificate of the system roots and of the identity root", async () => {
    const publicDirectory = join(work, "public");
    assert.equal(command({ RELAY_DATA_DIR: publicDirectory }, "ca", "init").status, 0);
    assert.equal(
      command({ RELAY_DATA_DIR: publicDirectory }, "ca", "server", "--dns", "localhost", "--ip", "127.0.0.1").status,
      0,
    );
    const [publicPort, publicHealthPort] = await Promise.all([freePort(), freePort()]);
    const publicUrl = `wss://127.0.0.1:${publicPort}${RELAY_PATH}`;
    const publicRelay = await startRelay({
      ...environment,
      RELAY_PORT: String(publicPort),
      RELAY_HEALTH_PORT: String(publicHealthPort),
      RELAY_PUBLIC_URL: publicUrl,
      RELAY_TLS_CERT_PATH: join(publicDirectory, "tls/server.crt"),
      RELAY_TLS_KEY_PATH: join(publicDirectory, "tls/server.key"),
    });
    relayLogs.push(publicRelay.log);
    try {
      const frank = issue(environment, work, "Alpha Team", "frank");
      const store = new RelayIdentityStore({ path: join(storeDirectory, "frank.json"), cipher: testCipher });
      await ok(store.importBundle({ ...frank, relayUrl: publicUrl }));
      const control = new RelayControl({ identity: store, reconnect });
      controls.push(control);
      const refused = nextState(
        control,
        "TLS refuses a root that is not trusted",
        (state) => state.status === "offline",
      );
      await ok(control.start());
      const first = await refused;
      await ok(control.stop());
      assert.deepEqual(
        [first.status === "offline" ? first.code : null, first.status === "offline" && first.retryInMs !== null],
        ["connect_failed", true],
      );
      const bundlePath = join(work, "frank-identity.json");
      writeFileSync(bundlePath, JSON.stringify(frank), { mode: 0o600 });
      const child = spawn(
        process.execPath,
        [...process.execArgv, SYSTEM_ROOTS_CHILD, bundlePath, storeDirectory, publicUrl, relayUrl],
        {
          cwd: ROOT,
          env: { ...process.env, NODE_EXTRA_CA_CERTS: join(publicDirectory, "ca/root.crt") },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const output: string[] = [];
      child.stdout.on("data", (chunk: Buffer) => output.push(chunk.toString()));
      child.stderr.on("data", (chunk: Buffer) => output.push(chunk.toString()));
      const [code] = await deadline("the process with the extra root ends", once(child, "exit"));
      assert.equal(code, 0, output.join(""));
      const lines = output.join("").trim().split("\n");
      assert.deepEqual(JSON.parse(lines[lines.length - 1] ?? "null"), [
        { relayUrl: publicUrl, status: "online", code: null },
        { relayUrl, status: "online", code: null },
      ]);
    } finally {
      await killRelay(publicRelay);
    }
  });

  await check("The control connections come back after the relay server starts again", async () => {
    assert.ok(relay);
    const offline = Promise.all(
      [aliceControl, bobControl].map((control) =>
        untilState(control, "a member is offline", (state) => state.status === "offline"),
      ),
    );
    relay.child.kill("SIGTERM");
    const states = await offline;
    for (const state of states) {
      assert.deepEqual([state.status, state.status === "offline" ? state.code : null], ["offline", "closed"]);
      assert.notEqual(state.status === "offline" ? state.retryInMs : null, null);
    }
    await killRelay(relay);
    assert.deepEqual(aliceControl.roster(), []);
    relay = await startRelay(environment);
    relayLogs.push(relay.log);
    await Promise.all(
      [aliceControl, bobControl].map((control) =>
        untilState(control, "a member is online again", (state) => state.status === "online"),
      ),
    );
    await untilRoster(aliceControl, "alice sees that bob hosts again", (roster) =>
      roster.some((member) => member.keyId === bobKeyId && member.hosting && member.label === "Bob desk"),
    );
    const response = await deadline("a request after the restart", fetcher.fetch(`${fetcher.origin}/hello`));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { user: "alice", device: "laptop", keyId: aliceKeyId });
  });

  await check("A revoked certificate is reported, and its control connection does not start again", async () => {
    const states: RelayControlState[] = [];
    bobControl.on("state", (state) => states.push(state));
    const revoked = untilState(bobControl, "bob is offline", (state) => state.status === "offline");
    const gone = untilRoster(aliceControl, "alice sees that bob is gone", (roster) =>
      roster.every((member) => member.keyId !== bobKeyId),
    );
    const revocation = command(environment, "ca", "revoke", "--", bobKeyId);
    assert.equal(revocation.status, 0, revocation.output);
    const final = await revoked;
    assert.deepEqual(
      [final.status === "offline" ? final.code : null, final.status === "offline" ? final.retryInMs : 0],
      ["certificate_revoked", null],
    );
    await gone;
    assert.deepEqual(
      states.map((state) => state.status),
      ["offline"],
    );
    assert.deepEqual(bobControl.state(), final);
    const refused = await deadline("a dial to the revoked member", failureOf(aliceDialer.dial(bobKeyId)));
    assert.equal(refused.code, "target_unavailable");
    const failedRequest = await deadline(
      "a request to the revoked member",
      fetcher.fetch(`${fetcher.origin}/hello`).then(
        () => null,
        (error: unknown) => error,
      ),
    );
    assert.ok(failedRequest instanceof TypeError);
    assert.ok(failedRequest.cause instanceof RelaySocketError);
    assert.equal(failedRequest.cause.code, "target_unavailable");
    const refusedAgain = nextState(bobControl, "bob is refused again", (state) => state.status === "offline");
    await ok(bobControl.start());
    const again = await refusedAgain;
    assert.equal(again.status === "offline" ? again.code : null, "certificate_revoked");
  });

  await check("No accepted connection was refused by the certificate check", () => {
    assert.deepEqual(refusedAccepts, []);
  });
} finally {
  for (const close of closers) close();
  for (const acceptor of acceptors) await Effect.runPromise(acceptor.stop());
  for (const control of controls) await Effect.runPromise(control.stop());
  if (server) server.closeAllConnections();
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
