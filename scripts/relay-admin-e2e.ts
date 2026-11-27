import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { inspect } from "node:util";
import { decodeRelayHubServerMessage } from "@openbot/contracts/relay-protocol/decode";
import {
  decodeRelayEnrollError,
  decodeRelayEnrollResponse,
  parseRelayJoinCode,
  RELAY_ENROLL_PATH,
  type RelayEnrollResponse,
  type RelayJoinCode,
  relayBase64Url,
  relayEnrollRefusal,
  relayEnrollTranscript,
} from "@openbot/contracts/relay-protocol/enrollment";
import {
  type RelayHubHello,
  type RelayHubServerMessage,
  relayHelloTranscript,
} from "@openbot/contracts/relay-protocol/hub";
import { createRelayMessageKey } from "@openbot/contracts/relay-protocol/message-crypto";
import { RELAY_PATH, RELAY_PROTOCOL_VERSION, relayAudience } from "@openbot/contracts/relay-protocol/messages";
import { webRelayCrypto } from "@openbot/team-client/relay-crypto";
import { Schema } from "effect";
import { type Browser, chromium, type Page } from "playwright-core";
import WebSocket from "ws";

declare global {
  interface Window {
    reportCspViolation?: (text: string) => void;
  }
}

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, ".openbot-build/relay-admin-e2e");
const MAIN = resolve(ROOT, "remote/api/src/relay/main.ts");
const WAIT_MS = 30_000;
const TEAM = "Acme";
const ENROLL_LIMIT_PER_ADDRESS = 40;
const CONTENT_SECURITY_POLICY =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const ECDSA_P256 = { name: "ECDSA", namedCurve: "P-256" } as const;
const ECDSA_SHA256 = { name: "ECDSA", hash: "SHA-256" } as const;

interface Check {
  name: string;
  passed: boolean;
  error?: string;
}

interface HttpAnswer {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
}

interface HttpCall {
  port: number;
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

interface RunningServer {
  child: ChildProcess;
  log: string[];
  relayPort: number;
  adminPort: number;
  publicUrl: string;
}

interface Device {
  keys: CryptoKeyPair;
  spki: Uint8Array<ArrayBuffer>;
}

interface Enrolled {
  device: Device;
  response: RelayEnrollResponse;
}

interface AdminSession {
  cookie: string;
  csrf: string;
}

const checks: Check[] = [];
const secrets: string[] = [];
const screenshots: string[] = [];

async function check(name: string, run: () => void | Promise<void>): Promise<void> {
  try {
    await run();
    checks.push({ name, passed: true });
  } catch (error) {
    checks.push({ name, passed: false, error: error instanceof Error ? error.message : inspect(error) });
  }
}

function deadline<T>(description: string, promise: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out: ${description}`)), WAIT_MS);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
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

function joinCodeFrom(output: string): RelayJoinCode {
  const line = output.split("\n").find((entry) => entry.trim().startsWith("openbot-nc://enroll?"));
  assert.ok(line, `No join code in the output: ${output}`);
  const code = parseRelayJoinCode(line);
  assert.ok(code, "The join code must parse.");
  secrets.push(code.code);
  return code;
}

function call(secure: boolean, options: HttpCall): Promise<HttpAnswer> {
  return new Promise((resolveAnswer, reject) => {
    const send = secure ? httpsRequest : httpRequest;
    const request = send(
      {
        host: "127.0.0.1",
        port: options.port,
        path: options.path,
        method: options.method ?? "GET",
        headers: options.headers ?? {},
        ...(secure ? { ca: rootPem, servername: "localhost" } : {}),
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolveAnswer({
            status: response.statusCode ?? 0,
            headers: response.headers,
            text: Buffer.concat(chunks).toString("utf8"),
          }),
        );
        response.on("error", reject);
      },
    );
    request.on("error", reject);
    request.end(options.body);
  });
}

function running(): RunningServer {
  assert.ok(current, "The server must run.");
  return current;
}

function relayCall(options: Omit<HttpCall, "port">): Promise<HttpAnswer> {
  const port = running().relayPort;
  return call(true, { ...options, port, headers: { host: `localhost:${port}`, ...options.headers } });
}

function adminCall(options: Omit<HttpCall, "port">): Promise<HttpAnswer> {
  return call(false, { ...options, port: running().adminPort, headers: { host: adminHost(), ...options.headers } });
}

function adminHost(): string {
  return `127.0.0.1:${running().adminPort}`;
}

function adminOrigin(): string {
  return `http://${adminHost()}`;
}

function adminPost(path: string, body: unknown, session: AdminSession | null, headers: Record<string, string> = {}) {
  return adminCall({
    path,
    method: "POST",
    headers: {
      origin: adminOrigin(),
      "content-type": "application/json",
      ...(session === null ? {} : { cookie: session.cookie, "x-openbot-csrf": session.csrf }),
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function adminGet(path: string, session: AdminSession | null): Promise<HttpAnswer> {
  return adminCall({ path, headers: session === null ? {} : { cookie: session.cookie } });
}

const readSession = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ csrf: Schema.String })));
const readTeams = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({ teams: Schema.Array(Schema.Struct({ name: Schema.String, status: Schema.String })) }),
  ),
);
const readMembers = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      members: Schema.Array(
        Schema.Struct({
          keyId: Schema.String,
          status: Schema.String,
          online: Schema.Boolean,
          hosting: Schema.Boolean,
          label: Schema.NullOr(Schema.String),
        }),
      ),
    }),
  ),
);
const readCodes = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({ codes: Schema.Array(Schema.Struct({ id: Schema.String, creator: Schema.String })) }),
  ),
);
const readCreatedCode = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ id: Schema.String, url: Schema.String, qr: Schema.String })),
);
const readOverview = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ membersOnline: Schema.Number })));

function enrollError(answer: HttpAnswer): string {
  const error = decodeRelayEnrollError(JSON.parse(answer.text));
  assert.ok(error, `The answer is not an enroll error: ${answer.status} ${answer.text}`);
  return error.error;
}

async function newDevice(): Promise<Device> {
  const keys = await crypto.subtle.generateKey(ECDSA_P256, false, ["sign", "verify"]);
  return { keys, spki: new Uint8Array(await crypto.subtle.exportKey("spki", keys.publicKey)) };
}

async function sign(device: Device, data: Uint8Array<ArrayBuffer>): Promise<string> {
  const signature = new Uint8Array(await crypto.subtle.sign(ECDSA_SHA256, device.keys.privateKey, data));
  secrets.push(relayBase64Url(signature));
  return relayBase64Url(signature);
}

async function enrollBody(code: RelayJoinCode, device: Device, server = code.server): Promise<string> {
  const secretHash = new Uint8Array(await crypto.subtle.digest("SHA-256", code.secret));
  const proof = await sign(device, relayEnrollTranscript({ secretHash, server, publicKey: device.spki }));
  return JSON.stringify({
    version: 1,
    code: code.code,
    publicKey: relayBase64Url(device.spki),
    label: "E2E device",
    proof,
  });
}

function enrollRequest(body: string): Promise<HttpAnswer> {
  return relayCall({
    path: RELAY_ENROLL_PATH,
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://client.example" },
    body,
  });
}

async function enroll(code: RelayJoinCode): Promise<Enrolled> {
  const device = await newDevice();
  const answer = await enrollRequest(await enrollBody(code, device));
  assert.equal(answer.status, 200, answer.text);
  const response = decodeRelayEnrollResponse(JSON.parse(answer.text));
  assert.ok(response, "The enroll response must decode.");
  return { device, response };
}

class RelayPeer {
  readonly socket: WebSocket;
  readonly closed: Promise<{ code: number; reason: string }>;
  readonly #messages: RelayHubServerMessage[] = [];
  readonly #listeners = new Set<() => void>();

  constructor() {
    this.socket = new WebSocket(running().publicUrl, { ca: rootPem, family: 4 });
    this.socket.on("message", (data, binary) => {
      if (binary) return;
      const message = decodeRelayHubServerMessage(JSON.parse(String(data)));
      if (message) this.#messages.push(message);
      for (const listener of this.#listeners) listener();
    });
    this.closed = new Promise((resolveClosed) => {
      this.socket.once("close", (code, reason) => {
        resolveClosed({ code, reason: reason.toString() });
        for (const listener of this.#listeners) listener();
      });
    });
  }

  message<Type extends RelayHubServerMessage["type"]>(
    type: Type,
  ): Promise<Extract<RelayHubServerMessage, { type: Type }>> {
    return deadline(
      `a ${type} message`,
      new Promise((resolveMessage, reject) => {
        const look = () => {
          const index = this.#messages.findIndex((message) => message.type === type);
          const found = this.#messages[index];
          if (found !== undefined && isType(found, type)) {
            this.#messages.splice(index, 1);
            this.#listeners.delete(look);
            resolveMessage(found);
          } else if (this.socket.readyState === WebSocket.CLOSED) {
            this.#listeners.delete(look);
            reject(new Error(`The socket closed before a ${type} message.`));
          }
        };
        this.#listeners.add(look);
        look();
      }),
    );
  }
}

function isType<Type extends RelayHubServerMessage["type"]>(
  message: RelayHubServerMessage,
  type: Type,
): message is Extract<RelayHubServerMessage, { type: Type }> {
  return message.type === type;
}

async function connectMember(enrolled: Enrolled): Promise<RelayPeer> {
  const peer = new RelayPeer();
  const signBytes = async (data: Uint8Array<ArrayBuffer>) =>
    new Uint8Array(await crypto.subtle.sign(ECDSA_SHA256, enrolled.device.keys.privateKey, data));
  const messageKey = await createRelayMessageKey(webRelayCrypto, {
    keyId: keyIdOf(enrolled.response.certificate),
    timestamp: Date.now(),
    sign: signBytes,
  });
  assert.ok(messageKey, "The message key cannot be made.");
  const fields: Omit<RelayHubHello, "type" | "certificate" | "chain" | "signature"> = {
    version: RELAY_PROTOCOL_VERSION,
    audience: relayAudience(running().publicUrl),
    timestamp: messageKey.timestamp,
    clientNonce: relayBase64Url(crypto.getRandomValues(new Uint8Array(32))),
    label: "E2E device",
    hosting: true,
    capabilities: [],
    suspendable: false,
    messageKey: messageKey.text,
    messageKeySignature: messageKey.signature,
  };
  const hello = JSON.stringify({
    type: "hello",
    ...fields,
    certificate: enrolled.response.certificate,
    chain: enrolled.response.chain,
    signature: await sign(enrolled.device, relayHelloTranscript(fields)),
  });
  if (peer.socket.readyState === WebSocket.OPEN) peer.socket.send(hello);
  else peer.socket.once("open", () => peer.socket.send(hello));
  return peer;
}

function keyIdOf(certificate: string): string {
  const spki = new X509Certificate(certificate).publicKey.export({ type: "spki", format: "der" });
  return createHash("sha256").update(spki).digest("base64url");
}

function waitForLine(child: ChildProcess, log: string[], pattern: RegExp): Promise<void> {
  return deadline(
    `the server line ${pattern}`,
    new Promise((resolveLine, reject) => {
      const look = () => {
        if (pattern.test(log.join(""))) {
          child.stdout?.off("data", look);
          resolveLine();
        }
      };
      child.stdout?.on("data", look);
      child.once("exit", () => reject(new Error(`The server stopped: ${log.join("")}`)));
      look();
    }),
  );
}

async function startServer(extra: Record<string, string>): Promise<RunningServer> {
  const [relayPort, healthPort, adminPort] = await Promise.all([freePort(), freePort(), freePort()]);
  const publicUrl = `wss://localhost:${relayPort}${RELAY_PATH}`;
  const log: string[] = [];
  const child = spawn("bun", [MAIN, "serve"], {
    cwd: ROOT,
    env: {
      ...process.env,
      ...environment,
      RELAY_HOST: "127.0.0.1",
      RELAY_PORT: String(relayPort),
      RELAY_HEALTH_PORT: String(healthPort),
      RELAY_PUBLIC_URL: publicUrl,
      RELAY_ADMIN_HOST: "127.0.0.1",
      RELAY_ADMIN_PORT: String(adminPort),
      RELAY_ENROLL_LIMIT_PER_ADDRESS: String(ENROLL_LIMIT_PER_ADDRESS),
      ...extra,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk: Buffer) => log.push(chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => log.push(chunk.toString()));
  children.push(child);
  return { child, log, relayPort, adminPort, publicUrl };
}

function exitOf(child: ChildProcess): Promise<number | null> {
  return deadline(
    "the server exit",
    new Promise((resolveExit) => {
      if (child.exitCode !== null) resolveExit(child.exitCode);
      else child.once("exit", (code) => resolveExit(code));
    }),
  );
}

function loginToken(environment: Record<string, string>): { url: string; token: string } {
  const result = command(environment, "admin", "login");
  assert.equal(result.status, 0, result.output);
  const url = result.output.split("\n").find((line) => line.startsWith("http://"));
  assert.ok(url, result.output);
  const token = new URL(url).hash.slice(1);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/u);
  secrets.push(token);
  return { url, token };
}

async function signIn(token: string): Promise<AdminSession> {
  const answer = await adminPost("/admin/api/session", { token }, null);
  assert.equal(answer.status, 200, answer.text);
  const cookieHeader = answer.headers["set-cookie"]?.[0] ?? "";
  assert.match(cookieHeader, /HttpOnly/u);
  assert.match(cookieHeader, /SameSite=Strict/u);
  assert.match(cookieHeader, /Path=\/admin/u);
  const cookie = cookieHeader.split(";")[0] ?? "";
  const { csrf } = readSession(answer.text);
  secrets.push(cookie.split("=")[1] ?? "", csrf);
  return { cookie, csrf };
}

function assertSecurityHeaders(answer: HttpAnswer): void {
  assert.equal(answer.headers["content-security-policy"], CONTENT_SECURITY_POLICY);
  assert.equal(answer.headers["x-content-type-options"], "nosniff");
  assert.equal(answer.headers["referrer-policy"], "no-referrer");
  assert.equal(answer.headers["cache-control"], "no-store");
}

async function screenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(OUT, name), fullPage: true });
  screenshots.push(join(".openbot-build/relay-admin-e2e", name));
}

const work = mkdtempSync(join(tmpdir(), "openbot-relay-admin-e2e-"));
const dataDirectory = join(work, "data");
const environment: Record<string, string> = { RELAY_DATA_DIR: dataDirectory };
const children: ChildProcess[] = [];
const peers: RelayPeer[] = [];
const browsers: Browser[] = [];
let rootPem = "";
let current: RunningServer | null = null;
let session: AdminSession = { cookie: "", csrf: "" };
let enrolledMember: Enrolled | null = null;
let memberPeer: RelayPeer | null = null;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

try {
  for (const args of [
    ["ca", "init"],
    ["ca", "team", "add", TEAM],
    ["ca", "server", "--dns", "localhost"],
  ]) {
    const result = command(environment, ...args);
    assert.equal(result.status, 0, result.output);
  }
  rootPem = readFileSync(join(dataDirectory, "ca", "root.crt"), "utf8");

  await check("serve refuses an admin page on a wildcard address or a public address", async () => {
    for (const host of ["0.0.0.0", "::", "8.8.8.8"]) {
      const refused = await startServer({ RELAY_ADMIN_HOST: host });
      assert.equal(await exitOf(refused.child), 1, `RELAY_ADMIN_HOST=${host}`);
      assert.match(refused.log.join(""), /The admin page did not start/u);
    }
    const name = await startServer({ RELAY_ADMIN_HOST: "admin.example" });
    assert.equal(await exitOf(name.child), 1);
    assert.match(name.log.join(""), /must be an IP address/u);
  });

  const server = await startServer({});
  current = server;
  environment.RELAY_PUBLIC_URL = server.publicUrl;
  environment.RELAY_ADMIN_HOST = "127.0.0.1";
  environment.RELAY_ADMIN_PORT = String(server.adminPort);
  await waitForLine(server.child, server.log, /The admin page is at/u);

  await check(
    "ca code prints a join code that the shared parser reads, and ca codes lists it without its secret",
    () => {
      const result = command(environment, "ca", "code", "--team", TEAM, "--user", "alice", "--device", "laptop");
      assert.equal(result.status, 0, result.output);
      const code = joinCodeFrom(result.output);
      assert.equal(code.server, `localhost:${server.relayPort}`);
      const root = new X509Certificate(rootPem);
      assert.equal(code.root, createHash("sha256").update(root.raw).digest("base64url"));
      const listed = command(environment, "ca", "codes");
      assert.equal(listed.status, 0, listed.output);
      assert.match(listed.output, /Acme \/ alice \/ laptop/u);
      assert.ok(!listed.output.includes(code.code), "ca codes must not print the secret.");
      const files = readdirSync(join(dataDirectory, "ca", "codes"));
      assert.ok(files.every((file) => !file.includes(code.code)));
      assert.ok(files.some((file) => /^[0-9a-f]{64}\.json$/u.test(file)));
      for (const file of files)
        assert.ok(!readFileSync(join(dataDirectory, "ca", "codes", file), "utf8").includes(code.code));
      const id = listed.output.trim().split(" ")[0] ?? "";
      const cancelled = command(environment, "ca", "code", "cancel", id);
      assert.equal(cancelled.status, 0, cancelled.output);
      assert.equal(command(environment, "ca", "codes").output.trim(), "");
    },
  );

  await check(
    "A client enrolls with a join code, and the certificate holds its own key and passes the client check",
    async () => {
      const code = joinCodeFrom(
        command(environment, "ca", "code", "--team", TEAM, "--user", "alice", "--device", "laptop").output,
      );
      const enrolled = await enroll(code);
      const response = enrolled.response;
      assert.equal(response.team.name, TEAM);
      assert.equal(response.user, "alice");
      assert.equal(response.device, "laptop");
      assert.equal(response.relayUrl, server.publicUrl);
      const spki = new X509Certificate(response.certificate).publicKey.export({ type: "spki", format: "der" });
      assert.deepEqual(new Uint8Array(spki), enrolled.device.spki);
      assert.equal(
        await relayEnrollRefusal({
          code,
          response,
          publicKey: enrolled.device.spki,
          now: Date.now(),
          crypto: webRelayCrypto,
        }),
        null,
      );
      const otherDevice = await newDevice();
      assert.equal(
        await relayEnrollRefusal({
          code,
          response,
          publicKey: otherDevice.spki,
          now: Date.now(),
          crypto: webRelayCrypto,
        }),
        "key_mismatch",
      );
      assert.equal(
        await relayEnrollRefusal({
          code: { ...code, root: code.root.replace(/^./u, code.root.startsWith("A") ? "B" : "A") },
          response,
          publicKey: enrolled.device.spki,
          now: Date.now(),
          crypto: webRelayCrypto,
        }),
        "root_mismatch",
      );
      const listed = command(environment, "ca", "list", "--team", TEAM);
      assert.match(listed.output, /Acme \/ alice \/ laptop \(E2E device\)/u);
      enrolledMember = enrolled;
      const second = await enrollRequest(await enrollBody(code, await newDevice()));
      assert.equal(second.status, 403);
      assert.equal(enrollError(second), "code_unknown");
    },
  );

  await check("An expired join code gets code_unknown, and the server removes it", async () => {
    const code = joinCodeFrom(command(environment, "ca", "code", "--team", TEAM, "--user", "erin").output);
    const directory = join(dataDirectory, "ca", "codes");
    const file = join(directory, `${createHash("sha256").update(code.secret).digest("hex")}.json`);
    const entry = readFileSync(file, "utf8");
    assert.match(entry, /"expiresAt":\d+/u);
    writeFileSync(file, entry.replace(/"expiresAt":\d+/u, `"expiresAt":${Date.now() - 1000}`));
    const answer = await enrollRequest(await enrollBody(code, await newDevice()));
    assert.equal(answer.status, 403);
    assert.equal(enrollError(answer), "code_unknown");
    assert.ok(!readdirSync(directory).includes(file.split("/").at(-1) ?? ""), "The expired code file must be removed.");
  });

  await check("A wrong proof gets proof_invalid and does not use the code", async () => {
    const code = joinCodeFrom(command(environment, "ca", "code", "--team", TEAM, "--user", "frank").output);
    const device = await newDevice();
    const wrongServer = await enrollRequest(await enrollBody(code, device, "other.example"));
    assert.equal(wrongServer.status, 403);
    assert.equal(enrollError(wrongServer), "proof_invalid");
    const body = JSON.parse(await enrollBody(code, device));
    const otherKey = await newDevice();
    const swapped = await enrollRequest(JSON.stringify({ ...body, publicKey: relayBase64Url(otherKey.spki) }));
    assert.equal(enrollError(swapped), "proof_invalid");
    const enrolled = await enroll(code);
    assert.equal(enrolled.response.user, "frank");
  });

  await check("Two enrolls with one code at the same time give exactly one certificate", async () => {
    const code = joinCodeFrom(command(environment, "ca", "code", "--team", TEAM, "--user", "grace").output);
    const bodies = await Promise.all([enrollBody(code, await newDevice()), enrollBody(code, await newDevice())]);
    const answers = await Promise.all(bodies.map((body) => enrollRequest(body)));
    assert.deepEqual(answers.map((answer) => answer.status).sort(), [200, 403]);
    const refused = answers.find((answer) => answer.status === 403);
    assert.ok(refused);
    assert.equal(enrollError(refused), "code_unknown");
  });

  await check("The enrolled member connects to the relay with its certificate and gets welcome", async () => {
    assert.ok(enrolledMember, "The enrollment check must pass first.");
    const peer = await connectMember(enrolledMember);
    peers.push(peer);
    await peer.message("server-proof");
    const welcome = await peer.message("welcome");
    assert.equal(welcome.team.name, TEAM);
    assert.equal(welcome.self.user, "alice");
    assert.equal(welcome.self.keyId, keyIdOf(enrolledMember.response.certificate));
    memberPeer = peer;
  });

  await check("The enroll route answers a CORS preflight for any origin, without credentials", async () => {
    const answer = await relayCall({
      path: RELAY_ENROLL_PATH,
      method: "OPTIONS",
      headers: {
        origin: "https://client.example",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });
    assert.equal(answer.status, 204);
    assert.equal(answer.headers["access-control-allow-origin"], "*");
    assert.equal(answer.headers["access-control-allow-methods"], "POST");
    assert.equal(answer.headers["access-control-allow-headers"], "content-type");
    assert.equal(answer.headers["access-control-allow-credentials"], undefined);
    const refused = await enrollRequest("{}");
    assert.equal(refused.headers["access-control-allow-origin"], "*");
    assert.equal(enrollError(refused), "invalid_request");
  });

  await check("The enroll route refuses a body larger than 8 KiB and a body that is not JSON", async () => {
    const large = await enrollRequest(JSON.stringify({ version: 1, padding: "x".repeat(9 * 1024) }));
    assert.equal(large.status, 413);
    assert.equal(enrollError(large), "invalid_request");
    const text = await relayCall({
      path: RELAY_ENROLL_PATH,
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "hello",
    });
    assert.equal(enrollError(text), "invalid_request");
  });

  await check(
    "Admin routes are not on the relay listener, and the enroll route is not on the admin listener",
    async () => {
      assert.equal((await relayCall({ path: "/admin" })).status, 404);
      assert.equal((await relayCall({ path: "/admin/api/session" })).status, 404);
      assert.equal((await adminCall({ path: RELAY_ENROLL_PATH })).status, 404);
    },
  );

  await check("An admin login link signs in once, with a strict session cookie", async () => {
    const { token } = loginToken(environment);
    session = await signIn(token);
    const again = await adminPost("/admin/api/session", { token }, null);
    assert.equal(again.status, 403);
    const wrong = await adminPost("/admin/api/session", { token: "A".repeat(43) }, null);
    assert.equal(wrong.status, 403);
  });

  await check(
    "The admin page refuses a wrong Host, a missing or wrong Origin, no CSRF token and no session",
    async () => {
      assert.equal(
        (await adminCall({ path: "/admin", headers: { host: `evil.example:${server.adminPort}` } })).status,
        403,
      );
      assert.equal(
        (await adminCall({ path: "/admin", headers: { host: `localhost:${server.adminPort}` } })).status,
        403,
      );
      const body = { team: "Delta" };
      const noOrigin = await adminCall({
        path: "/admin/api/teams",
        method: "POST",
        headers: { "content-type": "application/json", cookie: session.cookie, "x-openbot-csrf": session.csrf },
        body: JSON.stringify(body),
      });
      assert.equal(noOrigin.status, 403);
      assert.equal((await adminPost("/admin/api/teams", body, session, { origin: "http://evil.example" })).status, 403);
      assert.equal((await adminPost("/admin/api/teams", body, session, { "x-openbot-csrf": "" })).status, 403);
      assert.equal((await adminPost("/admin/api/teams", body, session, { "x-openbot-csrf": "wrong" })).status, 403);
      assert.equal((await adminPost("/admin/api/teams", body, session, { "content-type": "text/plain" })).status, 403);
      assert.equal((await adminPost("/admin/api/teams", body, null)).status, 403);
      assert.equal((await adminGet("/admin/api/teams", null)).status, 401);
      assert.equal((await adminGet("/admin/api/teams", { cookie: "openbot_relay_admin=wrong", csrf: "" })).status, 401);
      const teams = readTeams((await adminGet("/admin/api/teams", session)).text).teams;
      assert.ok(!teams.some((team) => team.name === "Delta"), "A refused request must not add a team.");
    },
  );

  await check("Admin responses carry the security headers, also on a refusal", async () => {
    for (const answer of [
      await adminGet("/admin", null),
      await adminGet("/admin/admin.js", null),
      await adminGet("/admin/api/overview", session),
      await adminGet("/admin/api/teams", null),
      await adminGet("/admin/missing", null),
      await adminPost("/admin/api/teams", {}, null),
    ]) {
      assertSecurityHeaders(answer);
    }
  });

  await check("With a session, the admin adds a team and makes, lists and cancels a join code", async () => {
    const added = await adminPost("/admin/api/teams", { team: "Gamma" }, session);
    assert.equal(added.status, 200, added.text);
    const teams = readTeams((await adminGet("/admin/api/teams", session)).text).teams;
    assert.ok(teams.some((team) => team.name === "Gamma" && team.status === "valid"));
    const created = await adminPost("/admin/api/codes", { team: "Gamma", user: "henry", device: "phone" }, session);
    assert.equal(created.status, 200, created.text);
    const code = readCreatedCode(created.text);
    const parsed = parseRelayJoinCode(code.url);
    assert.ok(parsed, "The admin code must parse.");
    secrets.push(parsed.code);
    assert.match(code.qr, /^data:image\/svg\+xml;base64,/u);
    const listed = readCodes((await adminGet("/admin/api/codes", session)).text).codes;
    assert.ok(listed.some((entry) => entry.id === code.id && entry.creator === "admin"));
    assert.ok(!JSON.stringify(listed).includes(parsed.code), "The code list must not hold the secret.");
    const cancelled = await adminPost("/admin/api/codes/cancel", { id: code.id }, session);
    assert.equal(cancelled.status, 200, cancelled.text);
    const after = readCodes((await adminGet("/admin/api/codes", session)).text).codes;
    assert.ok(!after.some((entry) => entry.id === code.id));
    const refused = await enrollRequest(await enrollBody(parsed, await newDevice()));
    assert.equal(enrollError(refused), "code_unknown");
  });

  await check("The admin member list shows the enrolled member online and hosting", async () => {
    assert.ok(enrolledMember && memberPeer, "The member must be connected.");
    const members = readMembers((await adminGet(`/admin/api/members?team=${TEAM}`, session)).text).members;
    const alice = members.find((member) => member.keyId === keyIdOf(enrolledMember?.response.certificate ?? ""));
    assert.ok(alice, JSON.stringify(members));
    assert.equal(alice.online, true);
    assert.equal(alice.hosting, true);
    assert.equal(alice.status, "valid");
    assert.equal(alice.label, "E2E device");
    const overview = readOverview((await adminGet("/admin/api/overview", session)).text);
    assert.equal(overview.membersOnline, 1);
  });

  await check("An admin revoke drops the live socket at once, and the member cannot connect again", async () => {
    assert.ok(enrolledMember && memberPeer, "The member must be connected.");
    const keyId = keyIdOf(enrolledMember.response.certificate);
    const revoked = await adminPost("/admin/api/revoke", { keyId }, session);
    assert.equal(revoked.status, 200, revoked.text);
    const error = await memberPeer.message("error");
    assert.equal(error.code, "certificate_revoked");
    await deadline("the revoked socket closes", memberPeer.closed);
    const again = await connectMember(enrolledMember);
    peers.push(again);
    const refused = await again.message("error");
    assert.equal(refused.code, "certificate_revoked");
    const members = readMembers((await adminGet(`/admin/api/members?team=${TEAM}`, session)).text).members;
    const alice = members.find((member) => member.keyId === keyId);
    assert.equal(alice?.status, "revoked");
    assert.equal(alice?.online, false);
  });

  await check(
    "The admin page works in Chromium: theme, sign in, make a code with its QR image, revoke a member",
    async () => {
      const dave = await enroll(
        joinCodeFrom(command(environment, "ca", "code", "--team", TEAM, "--user", "dave", "--device", "desk").output),
      );
      const davePeer = await connectMember(dave);
      peers.push(davePeer);
      await davePeer.message("welcome");
      const browser = await chromium.launch({ channel: "chrome", headless: true });
      browsers.push(browser);
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const signedOutPage = await context.newPage();
      await signedOutPage.goto(`${adminOrigin()}/admin`);
      await signedOutPage.locator("#signed-out").waitFor({ timeout: WAIT_MS });
      await screenshot(signedOutPage, "sign-in.png");
      const themeChoice = (name: string) => signedOutPage.getByRole("button", { name, exact: true });
      const pageTheme = () => signedOutPage.evaluate(() => document.documentElement.dataset.theme ?? "system");
      const savedTheme = () => signedOutPage.evaluate(() => localStorage.getItem("openbot.admin.theme"));
      await themeChoice("Dark theme").click();
      assert.equal(await savedTheme(), "dark");
      await signedOutPage.reload();
      await signedOutPage.locator("#signed-out").waitFor({ timeout: WAIT_MS });
      assert.equal(await pageTheme(), "dark");
      assert.equal(await themeChoice("Dark theme").getAttribute("aria-pressed"), "true");
      await screenshot(signedOutPage, "sign-in-dark.png");
      await themeChoice("System theme").click();
      assert.equal(await pageTheme(), "system");
      assert.equal(await savedTheme(), null);
      await signedOutPage.close();
      const page = await context.newPage();
      const problems: string[] = [];
      await page.exposeFunction("reportCspViolation", (text: string) => problems.push(`CSP: ${text}`));
      await page.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (event) =>
          window.reportCspViolation?.(`${event.violatedDirective} ${event.blockedURI}`),
        );
      });
      page.on("console", (message) => {
        if (message.type() === "error") problems.push(`console: ${message.text()}`);
      });
      page.on("pageerror", (error) => problems.push(`page: ${error.message}`));
      const { url } = loginToken(environment);
      await page.goto(url);
      await page.waitForURL(`${adminOrigin()}/admin`, { timeout: WAIT_MS });
      await page.locator("#overview dt").first().waitFor({ timeout: WAIT_MS });
      await page.locator("#member-rows tr", { hasText: "dave" }).waitFor({ timeout: WAIT_MS });
      await screenshot(page, "overview.png");

      await page.locator("#code-form select[name=team]").selectOption(TEAM);
      await page.locator("#code-form input[name=user]").fill("carol");
      await page.locator("#code-form input[name=device]").fill("phone");
      await page.getByRole("button", { name: "Create code" }).click();
      await page.locator("#code-result").waitFor({ state: "visible", timeout: WAIT_MS });
      await page.waitForFunction(() => {
        const image = document.querySelector("#code-qr");
        return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
      });
      const codeText = await page.locator("#code-url").inputValue();
      const parsed = parseRelayJoinCode(codeText);
      assert.ok(parsed, `The page shows a code that does not parse: ${codeText}`);
      secrets.push(parsed.code);
      await page.locator("#code-rows tr", { hasText: "carol" }).waitFor({ timeout: WAIT_MS });
      await screenshot(page, "join-code.png");

      const row = page.locator("#member-rows tr", { hasText: "dave" });
      await row.getByRole("button", { name: "Revoke" }).click();
      await row.getByRole("button", { name: "Confirm revoke" }).click();
      await page
        .locator("#member-rows tr", { hasText: "dave" })
        .locator("td.status-revoked")
        .waitFor({ timeout: WAIT_MS });
      const closed = await deadline("the socket of dave closes", davePeer.closed);
      assert.ok(closed.code > 0);
      await screenshot(page, "revoked.png");
      await page.emulateMedia({ colorScheme: "dark" });
      await screenshot(page, "revoked-dark.png");
      assert.deepEqual(problems, []);
      await context.close();
    },
  );

  await check("The enroll route limits the requests of one address", async () => {
    let limited: HttpAnswer | null = null;
    for (let attempt = 0; attempt <= ENROLL_LIMIT_PER_ADDRESS && limited === null; attempt += 1) {
      const answer = await enrollRequest("{}");
      if (answer.status === 429) limited = answer;
    }
    assert.ok(limited, "No request was limited.");
    assert.equal(enrollError(limited), "rate_limited");
  });

  await check("The server log holds no join code secret, sign-in token, session, CSRF token or proof", () => {
    const log = server.log.join("");
    assert.ok(secrets.length >= 10, `Only ${secrets.length} secrets were collected.`);
    for (const secret of secrets.filter((value) => value.length >= 16)) {
      assert.ok(!log.includes(secret), `The log holds a secret that starts with ${secret.slice(0, 4)}.`);
    }
    assert.match(log, /Join code [0-9a-f]{12} made a certificate/u);
    assert.match(log, /Admin session [0-9a-f]{8} started/u);
  });
} finally {
  for (const peer of peers) peer.socket.terminate();
  for (const browser of browsers) await browser.close();
  for (const child of children) child.kill("SIGTERM");
  rmSync(work, { recursive: true, force: true });
}

const report = {
  service: "remote/api relay admin page and join codes",
  passed: checks.filter((entry) => entry.passed).length,
  failed: checks.filter((entry) => !entry.passed).length,
  screenshots,
  checks,
};
writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
for (const failed of checks.filter((entry) => !entry.passed))
  process.stderr.write(`FAIL ${failed.name}: ${failed.error}\n`);
process.stdout.write(
  `Wrote .openbot-build/relay-admin-e2e/report.json: ${report.passed} passed, ${report.failed} failed.\n`,
);
process.exit(report.failed === 0 ? 0 : 1);
