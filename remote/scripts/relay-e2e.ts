import { strict as assert } from "node:assert";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash, createPrivateKey, randomBytes, sign, verify, X509Certificate } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { connect as connectTls } from "node:tls";
import { decodeRelayServerMessage } from "@openbot/contracts/relay-protocol/decode";
import { decodeRelayIdentityBundle, type RelayIdentityBundle } from "@openbot/contracts/relay-protocol/identity-bundle";
import {
  RELAY_CLOSE_CODES,
  RELAY_PATH,
  RELAY_PROTOCOL_VERSION,
  RELAY_SESSION_ASSIGNED_ID_MIN,
  RELAY_SESSION_FRAME_PAYLOAD_LIMIT,
  RELAY_SESSION_WINDOW_BYTES,
  RELAY_SESSIONS_FEATURE,
  type RelayRole,
  type RelayServerMessage,
  type RelayServerProofTranscriptInput,
  relayAudience,
  relayHelloTranscript,
  relayServerProofTranscript,
} from "@openbot/contracts/relay-protocol/messages";
import {
  decodeRelaySessionFrame,
  encodeRelaySessionEnd,
  encodeRelaySessionFrame,
} from "@openbot/contracts/relay-protocol/sessions";
import { generateSigningKey, issueCertificate } from "../api/src/relay/x509";

const ROOT = resolve(import.meta.dirname, "../..");
const OUT = resolve(ROOT, ".openbot-build/relay-e2e");
const MAIN = resolve(ROOT, "remote/api/src/relay/main.ts");
const BUILD = resolve(ROOT, "remote/scripts/build-relay.ts");
const WAIT_MS = 15_000;
const TRANSFER_BYTES = 8 * 1024 * 1024;
const SESSIONS_PER_PAIR = 4;

const checks: Array<{ name: string; passed: boolean; error?: string }> = [];

async function check(name: string, run: () => void | Promise<void>): Promise<void> {
  try {
    await run();
    checks.push({ name, passed: true });
  } catch (error) {
    checks.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) });
  }
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
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

function issue(environment: Record<string, string>, directory: string, team: string, user: string, device?: string) {
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

function keyId(bundle: RelayIdentityBundle): string {
  const spki = new X509Certificate(bundle.certificate).publicKey.export({ type: "spki", format: "der" });
  return createHash("sha256").update(spki).digest("base64url");
}

interface Closed {
  code: number;
  reason: string;
}

function openSocket(url: string, tls: Bun.TLSOptions): WebSocket {
  return Reflect.construct(WebSocket, [url, { tls }]);
}

function hasType<Type extends RelayServerMessage["type"]>(
  message: RelayServerMessage,
  type: Type,
): message is Extract<RelayServerMessage, { type: Type }> {
  return message.type === type;
}

class Peer {
  readonly messages: RelayServerMessage[] = [];
  readonly order: RelayServerMessage["type"][] = [];
  readonly binary: Uint8Array[] = [];
  serverProof: Extract<RelayServerMessage, { type: "server-proof" }> | null = null;
  readonly closed: Promise<Closed>;
  readonly #waiters = new Set<() => void>();
  readonly #socket: WebSocket;
  undecoded = 0;

  constructor(url: string, tls: Bun.TLSOptions) {
    this.#socket = openSocket(url, tls);
    this.#socket.binaryType = "arraybuffer";
    this.closed = new Promise((resolveClosed) => {
      this.#socket.addEventListener("close", (event) => {
        resolveClosed({ code: event.code, reason: event.reason });
        this.#wake();
      });
    });
    this.#socket.addEventListener("message", (event) => {
      if (typeof event.data === "string") {
        const message = decodeRelayServerMessage(JSON.parse(event.data));
        if (message) {
          this.messages.push(message);
          this.order.push(message.type);
          if (message.type === "server-proof") this.serverProof ??= message;
        } else this.undecoded += 1;
      } else if (event.data instanceof ArrayBuffer) this.binary.push(new Uint8Array(event.data));
      this.#wake();
    });
  }

  #wake(): void {
    for (const waiter of [...this.#waiters]) waiter();
  }

  async until<T>(read: () => T | undefined, description: string): Promise<T> {
    const deadline = Date.now() + WAIT_MS;
    for (;;) {
      const value = read();
      if (value !== undefined) return value;
      const rest = deadline - Date.now();
      if (rest <= 0)
        throw new Error(`Timed out: ${description}. Messages: ${JSON.stringify(this.messages).slice(0, 400)}`);
      await new Promise<void>((resolveWait) => {
        const timer = setTimeout(done, rest);
        const waiters = this.#waiters;
        function done() {
          clearTimeout(timer);
          waiters.delete(done);
          resolveWait();
        }
        waiters.add(done);
      });
    }
  }

  message<Type extends RelayServerMessage["type"]>(
    type: Type,
    matches: (message: Extract<RelayServerMessage, { type: Type }>) => boolean = () => true,
  ): Promise<Extract<RelayServerMessage, { type: Type }>> {
    return this.until(() => {
      for (const message of this.messages) {
        if (hasType(message, type) && matches(message)) return message;
      }
      return undefined;
    }, `message ${type}`);
  }

  async take<Type extends RelayServerMessage["type"]>(
    type: Type,
    matches: (message: Extract<RelayServerMessage, { type: Type }>) => boolean = () => true,
  ): Promise<Extract<RelayServerMessage, { type: Type }>> {
    const message = await this.message(type, matches);
    this.messages.splice(this.messages.indexOf(message), 1);
    return message;
  }

  forget(type: RelayServerMessage["type"]): void {
    for (let index = this.messages.length - 1; index >= 0; index -= 1) {
      if (this.messages[index]?.type === type) this.messages.splice(index, 1);
    }
  }

  sendJson(value: unknown): void {
    this.#socket.send(JSON.stringify(value));
  }

  sendJsonWhenOpen(value: unknown): void {
    if (this.#socket.readyState === WebSocket.OPEN) this.sendJson(value);
    else this.#socket.addEventListener("open", () => this.sendJson(value), { once: true });
  }

  sendBytes(bytes: Uint8Array): void {
    this.#socket.send(new Uint8Array(bytes));
  }

  bufferedAmount(): number {
    return this.#socket.bufferedAmount;
  }

  close(): void {
    this.#socket.close();
  }
}

interface HelloFields {
  role: RelayRole;
  hosting?: boolean;
  label?: string;
  features?: string[];
}

interface HelloChanges {
  signingKey?: string;
  nonce?: string;
  audience?: string;
}

interface ProvedSocket {
  peer: Peer;
  url: string;
  transcript: RelayServerProofTranscriptInput;
}

const provedSockets: ProvedSocket[] = [];

function serverProofProblem(socket: ProvedSocket, rootPem: string): string | null {
  const accepted = socket.peer.order.indexOf("welcome");
  if (accepted === -1) return null;
  const proofIndex = socket.peer.order.indexOf("server-proof");
  const proof = socket.peer.serverProof;
  if (proofIndex === -1 || proofIndex > accepted || !proof)
    return `no server-proof before ${socket.peer.order[accepted]}`;
  const certificate = new X509Certificate(proof.certificate);
  const root = new X509Certificate(rootPem);
  if (certificate.issuer !== root.subject || !certificate.verify(root.publicKey)) return "not issued by the root";
  if (certificate.checkHost(new URL(socket.url).hostname) === undefined) return "does not name the host";
  const signed = verify(
    "sha256",
    Buffer.from(relayServerProofTranscript(socket.transcript)),
    { key: certificate.publicKey, dsaEncoding: "ieee-p1363" },
    Buffer.from(proof.signature, "base64url"),
  );
  return signed ? null : "the signature does not verify";
}

function proofSignature(privateKey: string, transcript: string): string {
  return sign("sha256", Buffer.from(transcript), {
    key: createPrivateKey(privateKey),
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
}

async function hello(
  url: string,
  rootPem: string,
  bundle: RelayIdentityBundle,
  fields: HelloFields,
  changes: HelloChanges = {},
  tlsRoot: string = rootPem,
): Promise<Peer> {
  const peer = new Peer(url, { ca: tlsRoot });
  const challenge = await peer.message("challenge");
  const audience = changes.audience ?? relayAudience(url);
  const clientNonce = randomBytes(32).toString("base64url");
  provedSockets.push({
    peer,
    url,
    transcript: {
      serverNonce: challenge.nonce,
      clientNonce,
      audience,
      role: fields.role,
      clientKeyId: keyId(bundle),
    },
  });
  const transcript = relayHelloTranscript({
    nonce: changes.nonce ?? challenge.nonce,
    clientNonce,
    audience,
    role: fields.role,
  });
  peer.sendJson({
    type: "hello",
    version: RELAY_PROTOCOL_VERSION,
    audience,
    clientNonce,
    certificate: bundle.certificate,
    chain: bundle.chain,
    signature: proofSignature(changes.signingKey ?? bundle.privateKey, transcript),
    features: [RELAY_SESSIONS_FEATURE],
    ...fields,
  });
  return peer;
}

function frame(session: number, payload: Uint8Array): Uint8Array {
  return encodeRelaySessionFrame(session, payload);
}

async function openData(url: string, rootPem: string, member: Peer): Promise<Peer> {
  member.sendJson({ type: "data-ticket", version: RELAY_PROTOCOL_VERSION });
  const { ticket } = await member.take("data-ticket");
  const data = new Peer(url, { ca: rootPem });
  data.sendJsonWhenOpen({ type: "data-hello", version: RELAY_PROTOCOL_VERSION, ticket });
  await data.message("challenge");
  return data;
}

function framesFor(peer: Peer, session: number): Uint8Array[] {
  return peer.binary.flatMap((bytes) => {
    const decoded = decodeRelaySessionFrame(bytes);
    return decoded && decoded.session === session ? [decoded.payload] : [];
  });
}

function sessionOpen(session: number, target: string, first?: string) {
  return { type: "session-open", version: RELAY_PROTOCOL_VERSION, session, target, ...(first ? { first } : {}) };
}

async function openSession(
  opener: Peer,
  target: Peer,
  targetKeyId: string,
  session: number,
): Promise<{ assigned: number; connectionId: string }> {
  opener.sendJson(sessionOpen(session, targetKeyId, "aGVsbG8"));
  const incoming = await target.take("session-incoming", (message) => message.first === "aGVsbG8");
  target.sendJson({
    type: "session-accept",
    version: RELAY_PROTOCOL_VERSION,
    session: incoming.session,
    first: "cmVwbHk",
  });
  const opened = await opener.take("session-opened", (message) => message.session === session);
  assert.equal(opened.connectionId, incoming.connectionId);
  assert.equal(opened.first, "cmVwbHk");
  return { assigned: incoming.session, connectionId: incoming.connectionId };
}

async function refusedWith(peer: Peer, code: string): Promise<void> {
  const error = await peer.message("error");
  assert.equal(error.code, code, error.message);
  await peer.closed;
}

async function waitForReady(url: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    if (child.exitCode !== null) throw new Error("The relay server stopped before it was ready.");
    const ready = await fetch(url).then(
      (response) => response.ok,
      () => false,
    );
    if (ready) return;
    if (Date.now() > deadline) throw new Error("The relay server was not ready in time.");
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
}

async function startServer(environment: Record<string, string>, extra: Record<string, string> = {}) {
  const [port, healthPort] = await Promise.all([freePort(), freePort()]);
  const url = `wss://localhost:${port}${RELAY_PATH}`;
  const log: string[] = [];
  const child = spawn("bun", [MAIN, "serve"], {
    cwd: ROOT,
    env: {
      ...process.env,
      ...environment,
      RELAY_HOST: "127.0.0.1",
      RELAY_PORT: String(port),
      RELAY_HEALTH_PORT: String(healthPort),
      RELAY_PUBLIC_URL: url,
      ...extra,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk: Buffer) => log.push(chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => log.push(chunk.toString()));
  await waitForReady(`http://127.0.0.1:${healthPort}/health/ready`, child);
  return { url, healthPort, child, log };
}

const work = mkdtempSync(join(tmpdir(), "openbot-relay-e2e-"));
const dataDirectory = join(work, "data");
const otherRootDirectory = join(work, "other-root");
const sealedDirectory = join(work, "sealed");
const environment = { RELAY_DATA_DIR: dataDirectory };
const servers: ChildProcess[] = [];

try {
  await check("The certificate commands make a root, two teams and a server certificate", () => {
    assert.equal(command(environment, "ca", "init").status, 0);
    assert.equal(command(environment, "ca", "team", "add", "Acme Team").status, 0);
    assert.equal(command(environment, "ca", "team", "add", "Other Team").status, 0);
    assert.equal(command(environment, "ca", "server", "--dns", "localhost", "--ip", "127.0.0.1").status, 0);
    const listed = command(environment, "ca", "list");
    assert.equal(listed.status, 0);
    assert.match(listed.output, /root +valid/u);
    assert.match(listed.output, /team +valid .* Acme Team/u);
    assert.match(listed.output, /server +valid/u);
  });

  await check("The certificate commands refuse a second root, a second team of one name and a bad name", () => {
    assert.notEqual(command(environment, "ca", "init").status, 0);
    assert.notEqual(command(environment, "ca", "team", "add", "Acme Team").status, 0);
    assert.notEqual(command(environment, "ca", "issue", "--team", "Acme Team", "--user", "bad=name").status, 0);
    assert.notEqual(command(environment, "ca", "issue", "--team", "No Team", "--user", "alice").status, 0);
  });

  await check("A passphrase encrypts the authority keys, and a command with no passphrase cannot sign", () => {
    const sealed = { RELAY_DATA_DIR: sealedDirectory, RELAY_CA_PASSPHRASE: randomBytes(18).toString("base64url") };
    assert.equal(command(sealed, "ca", "init").status, 0);
    assert.match(readFileSync(join(sealedDirectory, "ca/root.key"), "utf8"), /BEGIN ENCRYPTED PRIVATE KEY/u);
    assert.notEqual(command({ RELAY_DATA_DIR: sealedDirectory }, "ca", "team", "add", "Sealed").status, 0);
    assert.equal(command(sealed, "ca", "team", "add", "Sealed").status, 0);
  });

  await check("The one-file program loads no settings file from its working folder", () => {
    const program = join(work, "openbot-relay");
    const built = spawnSync("bun", [BUILD, "--outfile", program], { cwd: ROOT, encoding: "utf8" });
    assert.equal(built.status, 0, `${built.stdout}${built.stderr}`);
    const folder = join(work, "settings-files");
    mkdirSync(folder);
    writeFileSync(join(folder, ".env"), "RELAY_PORT=not-a-number\n");
    writeFileSync(join(folder, "bunfig.toml"), 'preload = ["./missing-preload.ts"]\n');
    const listed = spawnSync(program, ["ca", "list"], {
      cwd: folder,
      env: { ...process.env, ...environment },
      encoding: "utf8",
    });
    assert.equal(listed.status, 0, `${listed.stdout}${listed.stderr}`);
    assert.match(listed.stdout, /root +valid/u);
  });

  const rootPem = readFileSync(join(dataDirectory, "ca/root.crt"), "utf8");
  const alice = issue(environment, work, "Acme Team", "alice", "laptop");
  const bob = issue(environment, work, "Acme Team", "bob");
  const dave = issue(environment, work, "Acme Team", "dave", "desk");
  const carol = issue(environment, work, "Other Team", "carol", "server");

  const main = await startServer(environment, { RELAY_MAX_SESSIONS_PER_PAIR: String(SESSIONS_PER_PAIR) });
  servers.push(main.child);
  const { url } = main;

  await check("The health endpoint answers and the relay path refuses a plain request", async () => {
    const live = await fetch(`http://127.0.0.1:${main.healthPort}/health/live`);
    assert.equal(live.status, 200);
    const plain = await fetch(url.replace("wss:", "https:"), { tls: { ca: rootPem } });
    assert.equal(plain.status, 426);
  });

  let aliceMember = await hello(url, rootPem, alice, { role: "member", hosting: true, label: "Alice laptop" });
  await check("A member gets its user, device, team and the roster from its certificate", async () => {
    const welcome = await aliceMember.message("welcome");
    assert.deepEqual(welcome.self, { keyId: keyId(alice), user: "alice", device: "laptop" });
    assert.equal(welcome.team.name, "Acme Team");
    assert.deepEqual(
      welcome.members.map((member) => [member.user, member.hosting, member.label]),
      [["alice", true, "Alice laptop"]],
    );
  });

  const bobMember = await hello(url, rootPem, bob, { role: "member", hosting: false });
  await check("Members of one team see each other", async () => {
    const welcome = await bobMember.message("welcome");
    assert.deepEqual(
      welcome.members.map((member) => member.user),
      ["alice", "bob"],
    );
    const update = await aliceMember.message("members", (message) => message.members.length === 2);
    assert.deepEqual(
      update.members.map((member) => member.user),
      ["alice", "bob"],
    );
  });

  const carolMember = await hello(url, rootPem, carol, { role: "member", hosting: true });
  await check("A member of a different team gets a different team and sees no member of the first team", async () => {
    const welcome = await carolMember.message("welcome");
    const aliceWelcome = await aliceMember.message("welcome");
    assert.equal(welcome.team.name, "Other Team");
    assert.notEqual(welcome.team.id, aliceWelcome.team.id);
    assert.deepEqual(
      welcome.members.map((member) => member.user),
      ["carol"],
    );
    const seenByAlice = aliceMember.messages.flatMap((message) => (message.type === "members" ? message.members : []));
    assert.equal(
      seenByAlice.some((member) => member.user === "carol"),
      false,
    );
  });

  const aliceData = await openData(url, rootPem, aliceMember);
  const bobData = await openData(url, rootPem, bobMember);
  await check("A session passes bytes in both directions and names each side from its certificate", async () => {
    bobMember.sendJson(sessionOpen(1, keyId(alice), "aGVsbG8"));
    const incoming = await aliceMember.take("session-incoming", (message) => message.from.user === "bob");
    assert.equal(incoming.from.keyId, keyId(bob));
    assert.equal(new X509Certificate(incoming.from.certificate).subject.includes("CN=bob"), true);
    assert.ok(incoming.session >= RELAY_SESSION_ASSIGNED_ID_MIN, "The server numbers the session of the target.");
    assert.equal(incoming.first, "aGVsbG8");
    aliceMember.sendJson({
      type: "session-accept",
      version: RELAY_PROTOCOL_VERSION,
      session: incoming.session,
      first: "cmVwbHk",
    });
    const opened = await bobMember.take("session-opened", (message) => message.session === 1);
    assert.equal(opened.peer.keyId, keyId(alice));
    assert.equal(opened.connectionId, incoming.connectionId);
    assert.equal(opened.first, "cmVwbHk");
    bobData.sendBytes(frame(1, new TextEncoder().encode("ping")));
    await aliceData.until(() => (framesFor(aliceData, incoming.session).length > 0 ? true : undefined), "the ping");
    assert.equal(new TextDecoder().decode(framesFor(aliceData, incoming.session)[0]), "ping");
    aliceData.sendBytes(frame(incoming.session, new TextEncoder().encode("pong")));
    await bobData.until(() => (framesFor(bobData, 1).length > 0 ? true : undefined), "the pong");
    assert.equal(new TextDecoder().decode(framesFor(bobData, 1)[0]), "pong");
    bobMember.sendJson({ type: "session-close", version: RELAY_PROTOCOL_VERSION, session: 1 });
    await aliceMember.take("session-close", (message) => message.session === incoming.session);
  });

  await check(`A session keeps ${TRANSFER_BYTES} bytes complete and in order with credits of the window`, async () => {
    const { assigned } = await openSession(bobMember, aliceMember, keyId(alice), 2);
    const data = randomBytes(TRANSFER_BYTES);
    let sent = 0;
    let credit = RELAY_SESSION_WINDOW_BYTES;
    let received = 0;
    let granted = 0;
    while (received < TRANSFER_BYTES) {
      while (sent < TRANSFER_BYTES && credit > 0) {
        const size = Math.min(RELAY_SESSION_FRAME_PAYLOAD_LIMIT, credit, TRANSFER_BYTES - sent);
        bobData.sendBytes(frame(2, data.subarray(sent, sent + size)));
        sent += size;
        credit -= size;
      }
      received = await aliceData.until(() => {
        const total = framesFor(aliceData, assigned).reduce((sum, part) => sum + part.byteLength, 0);
        return total > received ? total : undefined;
      }, "more session bytes");
      if (received - granted >= RELAY_SESSION_WINDOW_BYTES / 4 || received === TRANSFER_BYTES) {
        aliceMember.sendJson({
          type: "session-credit",
          version: RELAY_PROTOCOL_VERSION,
          session: assigned,
          bytes: received - granted,
        });
        const forwarded = await bobMember.take("session-credit", (message) => message.session === 2);
        assert.equal(forwarded.bytes, received - granted);
        credit += forwarded.bytes;
        granted = received;
      }
    }
    const joined = Buffer.concat(framesFor(aliceData, assigned));
    assert.equal(joined.byteLength, TRANSFER_BYTES);
    assert.equal(createHash("sha256").update(joined).digest("hex"), createHash("sha256").update(data).digest("hex"));
    bobData.sendBytes(encodeRelaySessionEnd(2));
    await aliceData.until(
      () =>
        aliceData.binary.some((bytes) => {
          const decoded = decodeRelaySessionFrame(bytes);
          return decoded?.kind === "end" && decoded.session === assigned;
        })
          ? true
          : undefined,
      "the end of the session",
    );
    aliceData.binary.length = 0;
    bobData.binary.length = 0;
  });

  await check(
    "A data ticket works once, a bad ticket is refused, data on control is refused, and data closes with control",
    async () => {
      const daveControl = await hello(url, rootPem, dave, { role: "member", hosting: false });
      await daveControl.message("welcome");
      daveControl.sendJson({ type: "data-ticket", version: RELAY_PROTOCOL_VERSION });
      const { ticket } = await daveControl.take("data-ticket");
      const first = new Peer(url, { ca: rootPem });
      first.sendJsonWhenOpen({ type: "data-hello", version: RELAY_PROTOCOL_VERSION, ticket });
      await first.message("challenge");
      const again = new Peer(url, { ca: rootPem });
      again.sendJsonWhenOpen({ type: "data-hello", version: RELAY_PROTOCOL_VERSION, ticket });
      await refusedWith(again, "authentication_failed");
      const forged = new Peer(url, { ca: rootPem });
      forged.sendJsonWhenOpen({
        type: "data-hello",
        version: RELAY_PROTOCOL_VERSION,
        ticket: randomBytes(32).toString("base64url"),
      });
      await refusedWith(forged, "authentication_failed");
      daveControl.sendBytes(frame(1, new Uint8Array(4)));
      await refusedWith(daveControl, "protocol_error");
      await first.closed;
    },
  );

  await check("A session to a member of a different team, or to a member that does not host, fails", async () => {
    carolMember.sendJson(sessionOpen(1, keyId(alice)));
    assert.equal(
      (await carolMember.take("session-failed", (message) => message.session === 1)).code,
      "target_unavailable",
    );
    aliceMember.sendJson(sessionOpen(1, keyId(bob)));
    assert.equal(
      (await aliceMember.take("session-failed", (message) => message.session === 1)).code,
      "target_unavailable",
    );
    bobMember.sendJson(sessionOpen(3, keyId(bob)));
    assert.equal((await bobMember.take("session-failed", (message) => message.session === 3)).code, "invalid_message");
  });

  await check("A refusal of the target fails the session, and an answer on another socket is ignored", async () => {
    bobMember.sendJson(sessionOpen(4, keyId(alice), "aGVsbG8"));
    const incoming = await aliceMember.take("session-incoming", (message) => message.from.user === "bob");
    carolMember.sendJson({ type: "session-accept", version: RELAY_PROTOCOL_VERSION, session: incoming.session });
    aliceMember.sendJson({
      type: "session-refuse",
      version: RELAY_PROTOCOL_VERSION,
      session: incoming.session,
      code: "refused",
    });
    assert.equal((await bobMember.take("session-failed", (message) => message.session === 4)).code, "refused");
    assert.equal(
      bobMember.messages.some((message) => message.type === "session-opened" && message.session === 4),
      false,
    );
  });

  await check("The sessions of one pair are limited", async () => {
    for (let session = 10; session < 10 + SESSIONS_PER_PAIR; session += 1)
      bobMember.sendJson(sessionOpen(session, keyId(alice)));
    bobMember.sendJson(sessionOpen(10 + SESSIONS_PER_PAIR, keyId(alice)));
    const failed = await bobMember.take("session-failed", (message) => message.session === 10 + SESSIONS_PER_PAIR);
    assert.equal(failed.code, "rate_limited");
    for (let session = 10; session < 10 + SESSIONS_PER_PAIR; session += 1) {
      bobMember.sendJson({ type: "session-close", version: RELAY_PROTOCOL_VERSION, session });
    }
    for (let count = 0; count < SESSIONS_PER_PAIR; count += 1) await aliceMember.take("session-incoming");
    for (let count = 0; count < SESSIONS_PER_PAIR; count += 1) await aliceMember.take("session-close");
  });

  await check("Data beyond the window, an unknown session number and a reused number are refused", async () => {
    const daveMember = await hello(url, rootPem, dave, { role: "member", hosting: false });
    await daveMember.message("welcome");
    const daveData = await openData(url, rootPem, daveMember);
    daveData.sendBytes(frame(77, new Uint8Array(8)));
    const { assigned } = await openSession(daveMember, aliceMember, keyId(alice), 5);
    daveMember.sendJson(sessionOpen(5, keyId(alice)));
    await refusedWith(daveMember, "invalid_message");
    await daveData.closed;
    await aliceMember.take("session-close", (message) => message.session === assigned);
    const greedy = await hello(url, rootPem, dave, { role: "member", hosting: false });
    await greedy.message("welcome");
    const greedyData = await openData(url, rootPem, greedy);
    await openSession(greedy, aliceMember, keyId(alice), 1);
    for (let sent = 0; sent <= RELAY_SESSION_WINDOW_BYTES; sent += RELAY_SESSION_FRAME_PAYLOAD_LIMIT) {
      greedyData.sendBytes(frame(1, new Uint8Array(RELAY_SESSION_FRAME_PAYLOAD_LIMIT)));
    }
    await refusedWith(greedy, "protocol_error");
    await greedyData.closed;
    await aliceMember.take("session-close");
    aliceData.binary.length = 0;
  });

  await check("Frames for a member with no data socket wait, and the server asks for the data socket", async () => {
    const erin = await hello(url, rootPem, dave, { role: "member", hosting: false });
    await erin.message("welcome");
    const erinData = await openData(url, rootPem, erin);
    const { assigned } = await openSession(erin, aliceMember, keyId(alice), 1);
    aliceData.close();
    await aliceData.closed;
    erinData.sendBytes(frame(1, new TextEncoder().encode("waits")));
    await aliceMember.take("data-wanted");
    const reopened = await openData(url, rootPem, aliceMember);
    await reopened.until(() => (framesFor(reopened, assigned).length > 0 ? true : undefined), "the waiting frame");
    assert.equal(new TextDecoder().decode(framesFor(reopened, assigned)[0]), "waits");
    erin.close();
    await erinData.closed;
    await aliceMember.take("session-close", (message) => message.session === assigned);
    reopened.close();
  });

  await check("A hello for the removed tunnel roles is refused", async () => {
    const old = new Peer(url, { ca: rootPem });
    const challenge = await old.message("challenge");
    const clientNonce = randomBytes(32).toString("base64url");
    old.sendJson({
      type: "hello",
      version: RELAY_PROTOCOL_VERSION,
      audience: relayAudience(url),
      clientNonce,
      certificate: bob.certificate,
      chain: bob.chain,
      signature: proofSignature(
        bob.privateKey,
        relayHelloTranscript({ nonce: challenge.nonce, clientNonce, audience: relayAudience(url), role: "member" }),
      ),
      role: "client",
      target: keyId(alice),
    });
    await refusedWith(old, "invalid_message");
  });

  await check("A certificate of a different root is refused", async () => {
    const otherRoot = { RELAY_DATA_DIR: otherRootDirectory };
    assert.equal(command(otherRoot, "ca", "init").status, 0);
    assert.equal(command(otherRoot, "ca", "team", "add", "Acme Team").status, 0);
    const eve = issue(otherRoot, work, "Acme Team", "eve");
    await refusedWith(await hello(url, rootPem, eve, { role: "member", hosting: false }), "authentication_failed");
  });

  await check("A proof from a different private key is refused", async () => {
    await refusedWith(
      await hello(url, rootPem, alice, { role: "member", hosting: false }, { signingKey: bob.privateKey }),
      "authentication_failed",
    );
  });

  await check("A proof for a different nonce is refused", async () => {
    await refusedWith(
      await hello(
        url,
        rootPem,
        alice,
        { role: "member", hosting: false },
        { nonce: randomBytes(32).toString("base64url") },
      ),
      "authentication_failed",
    );
  });

  await check("A proof for a different server is refused", async () => {
    await refusedWith(
      await hello(url, rootPem, alice, { role: "member", hosting: false }, { audience: "wss://relay.example.com" }),
      "authentication_failed",
    );
  });

  const teamKeyFile = (team: string) => {
    const directory = join(dataDirectory, "ca/teams");
    const name = createHash("sha256").update(team).digest("base64url");
    assert.ok(readdirSync(directory).includes(`${name}.key`));
    return {
      certificate: readFileSync(join(directory, `${name}.crt`), "utf8"),
      privateKey: createPrivateKey(readFileSync(join(directory, `${name}.key`), "utf8")),
    };
  };
  const forged = (
    issuerTeam: string,
    subjectTeam: string,
    user: string,
    now: number,
    days: number,
  ): RelayIdentityBundle => {
    const issuer = teamKeyFile(issuerTeam);
    const key = generateSigningKey();
    const issued = issueCertificate({
      subject: { organization: subjectTeam, commonName: user },
      publicKey: key.publicKey,
      profile: { kind: "member" },
      days,
      issuer,
      now,
    });
    return {
      version: 1,
      relayUrl: null,
      team: subjectTeam,
      user,
      device: null,
      certificate: issued.certificate,
      chain: [issuer.certificate],
      root: rootPem,
      privateKey: key.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    };
  };

  await check("The authority of one team cannot make a member of a different team", async () => {
    const intruder = forged("Other Team", "Acme Team", "intruder", Date.now(), 30);
    await refusedWith(await hello(url, rootPem, intruder, { role: "member", hosting: false }), "authentication_failed");
  });

  await check("An expired certificate is refused", async () => {
    const old = forged("Acme Team", "Acme Team", "old", Date.now() - 3 * 24 * 60 * 60_000, 1);
    await refusedWith(await hello(url, rootPem, old, { role: "member", hosting: false }), "certificate_expired");
  });

  await check("Data before the proof, an invalid frame, and an unknown message close the socket", async () => {
    const early = new Peer(url, { ca: rootPem });
    await early.message("challenge");
    early.sendBytes(randomBytes(16));
    await refusedWith(early, "protocol_error");
    const invalid = await hello(url, rootPem, dave, { role: "member", hosting: false });
    await invalid.message("welcome");
    const invalidData = await openData(url, rootPem, invalid);
    invalidData.sendBytes(new Uint8Array([9, 9, 0, 0, 0, 1, 0]));
    await refusedWith(invalidData, "invalid_message");
    invalid.close();
    const unknown = new Peer(url, { ca: rootPem });
    await unknown.message("challenge");
    unknown.sendJson({ type: "hello", version: 2 });
    await refusedWith(unknown, "invalid_message");
  });

  await check("A newer connection of one certificate replaces the older one", async () => {
    bobMember.forget("members");
    const newer = await hello(url, rootPem, alice, { role: "member", hosting: true, label: "Alice laptop" });
    await newer.message("welcome");
    const error = await aliceMember.message("error");
    assert.equal(error.code, "replaced");
    assert.equal((await aliceMember.closed).code, RELAY_CLOSE_CODES.replaced);
    const roster = await bobMember.message("members");
    assert.equal(roster.members.filter((member) => member.user === "alice").length, 1);
    aliceMember = newer;
  });

  await check("The revoke command takes a key identifier that starts with a dash", () => {
    const dashed = `-${randomBytes(32).toString("base64url").slice(1)}`;
    const revoked = command(environment, "ca", "revoke", dashed);
    assert.equal(revoked.status, 0, revoked.output);
    assert.match(revoked.output, /Revoked 0 certificate/u);
    const separated = command(environment, "ca", "revoke", "--", dashed);
    assert.equal(separated.status, 0, separated.output);
  });

  await check("A revoked certificate loses its connection and its sessions and cannot connect again", async () => {
    const { assigned } = await openSession(bobMember, aliceMember, keyId(alice), 40);
    const revoked = command(environment, "ca", "revoke", keyId(bob));
    assert.equal(revoked.status, 0, revoked.output);
    const error = await bobMember.message("error");
    assert.equal(error.code, "certificate_revoked");
    await bobMember.closed;
    await aliceMember.take("session-close", (message) => message.session === assigned);
    await refusedWith(await hello(url, rootPem, bob, { role: "member", hosting: false }), "certificate_revoked");
    const roster = await aliceMember.message(
      "members",
      (message) => !message.members.some((member) => member.user === "bob"),
    );
    assert.deepEqual(
      roster.members.map((member) => member.user),
      ["alice"],
    );
  });

  await check("The server sent no message that the client decoder refuses", () => {
    assert.equal(aliceMember.undecoded + bobMember.undecoded + carolMember.undecoded, 0);
  });

  await check("A socket that sends no proof is closed", async () => {
    const silent = new Peer(url, { ca: rootPem });
    await silent.message("challenge");
    await refusedWith(silent, "authentication_failed");
  });

  await check("A hello with no client nonce is refused and gets no server proof", async () => {
    const peer = new Peer(url, { ca: rootPem });
    const challenge = await peer.message("challenge");
    const audience = relayAudience(url);
    peer.sendJson({
      type: "hello",
      version: RELAY_PROTOCOL_VERSION,
      audience,
      role: "member",
      hosting: false,
      certificate: alice.certificate,
      chain: alice.chain,
      signature: proofSignature(
        alice.privateKey,
        relayHelloTranscript({ nonce: challenge.nonce, clientNonce: "", audience, role: "member" }),
      ),
    });
    await refusedWith(peer, "invalid_message");
    assert.equal(peer.serverProof, null);
  });

  await check("A server with a TLS certificate of a different root proves with its root-signed identity", async () => {
    const otherRoot = { RELAY_DATA_DIR: otherRootDirectory };
    assert.equal(command(otherRoot, "ca", "server", "--dns", "localhost", "--ip", "127.0.0.1").status, 0);
    const otherRootPem = readFileSync(join(otherRootDirectory, "ca/root.crt"), "utf8");
    const tlsCertificate = join(otherRootDirectory, "tls/server.crt");
    const separate = await startServer(environment, {
      RELAY_TLS_CERT_PATH: tlsCertificate,
      RELAY_TLS_KEY_PATH: join(otherRootDirectory, "tls/server.key"),
    });
    servers.push(separate.child);
    const member = await hello(separate.url, rootPem, alice, { role: "member", hosting: false }, {}, otherRootPem);
    await member.message("welcome");
    const socket = provedSockets.find((entry) => entry.peer === member);
    assert.ok(socket && member.serverProof);
    assert.equal(serverProofProblem(socket, rootPem), null);
    assert.equal(serverProofProblem(socket, otherRootPem), "not issued by the root");
    assert.notEqual(
      new X509Certificate(member.serverProof.certificate).fingerprint256,
      new X509Certificate(readFileSync(tlsCertificate, "utf8")).fingerprint256,
    );
    member.close();
    separate.child.kill("SIGTERM");
  });

  const serveOnce = async (directory: string) => {
    const [port, healthPort] = await Promise.all([freePort(), freePort()]);
    const result = spawnSync("bun", [MAIN, "serve"], {
      cwd: ROOT,
      env: {
        ...process.env,
        RELAY_DATA_DIR: directory,
        RELAY_HOST: "127.0.0.1",
        RELAY_PORT: String(port),
        RELAY_HEALTH_PORT: String(healthPort),
        RELAY_TLS_DISABLED: "true",
        RELAY_PUBLIC_URL: "wss://localhost/v1/relay",
      },
      encoding: "utf8",
      timeout: WAIT_MS,
    });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  };

  await check(
    "serve refuses to start with no server identity, one of a different root, and one for a different host",
    async () => {
      const lonelyDirectory = join(work, "no-identity");
      assert.equal(command({ RELAY_DATA_DIR: lonelyDirectory }, "ca", "init").status, 0);
      const missing = await serveOnce(lonelyDirectory);
      assert.equal(missing.status, 1, missing.output);
      assert.match(missing.output, /No server identity certificate is at/u);
      mkdirSync(join(lonelyDirectory, "tls"), { recursive: true });
      for (const file of ["server.crt", "server.key"]) {
        copyFileSync(join(otherRootDirectory, "tls", file), join(lonelyDirectory, "tls", file));
      }
      const foreign = await serveOnce(lonelyDirectory);
      assert.equal(foreign.status, 1, foreign.output);
      assert.match(foreign.output, /did not issue the server identity certificate/u);
      assert.equal(
        command({ RELAY_DATA_DIR: lonelyDirectory }, "ca", "server", "--dns", "other.example.com").status,
        0,
      );
      const otherHost = await serveOnce(lonelyDirectory);
      assert.equal(otherHost.status, 1, otherHost.output);
      assert.match(otherHost.output, /does not name the host of RELAY_PUBLIC_URL/u);
    },
  );

  const gated = await startServer(environment, { RELAY_TLS_CLIENT_CERTIFICATES: "required" });
  servers.push(gated.child);

  await check("With the TLS switch on, a socket with no certificate gets no challenge", async () => {
    const stranger = new Peer(gated.url, { ca: rootPem });
    await stranger.closed;
    assert.equal(stranger.messages.length, 0);
  });

  await check("With the TLS switch on, a team certificate connects", async () => {
    const peer = new Peer(gated.url, {
      ca: rootPem,
      cert: `${alice.certificate}${alice.chain.join("")}`,
      key: alice.privateKey,
    });
    const challenge = await peer.message("challenge");
    const audience = relayAudience(gated.url);
    const clientNonce = randomBytes(32).toString("base64url");
    provedSockets.push({
      peer,
      url: gated.url,
      transcript: { serverNonce: challenge.nonce, clientNonce, audience, role: "member", clientKeyId: keyId(alice) },
    });
    peer.sendJson({
      type: "hello",
      version: RELAY_PROTOCOL_VERSION,
      audience,
      clientNonce,
      role: "member",
      hosting: false,
      certificate: alice.certificate,
      chain: alice.chain,
      signature: proofSignature(
        alice.privateKey,
        relayHelloTranscript({ nonce: challenge.nonce, clientNonce, audience, role: "member" }),
      ),
    });
    const welcome = await peer.message("welcome");
    assert.equal(welcome.self.user, "alice");
    peer.close();
  });

  const webClientDirectory = join(work, "web-client");
  const webClientSecret = "relay-e2e-secret-outside-the-web-client";
  mkdirSync(join(webClientDirectory, "assets"), { recursive: true });
  mkdirSync(join(work, "outside"), { recursive: true });
  writeFileSync(join(work, "outside", "secret.txt"), webClientSecret);
  writeFileSync(join(work, "secret.txt"), webClientSecret);
  writeFileSync(
    join(webClientDirectory, "index.html"),
    '<!doctype html><html><head><script type="module" src="/app/assets/index-AbCdEf12.js"></script></head><body>relay-e2e-index</body></html>',
  );
  writeFileSync(join(webClientDirectory, "assets", "index-AbCdEf12.js"), "export const relayE2e = 1;\n");
  writeFileSync(join(webClientDirectory, "assets", "index-AbCdEf12.css"), "body{margin:0}\n");
  writeFileSync(join(webClientDirectory, "assets", "inter-AbCdEf12.woff2"), new Uint8Array([119, 79, 70, 50]));
  symlinkSync(join(work, "outside", "secret.txt"), join(webClientDirectory, "assets", "leak-AbCdEf12.txt"));
  symlinkSync(join(work, "outside"), join(webClientDirectory, "linked"));
  const web = await startServer(environment, { RELAY_WEB_CLIENT_DIR: webClientDirectory });
  servers.push(web.child);
  const webOrigin = web.url.replace("wss:", "https:").replace(RELAY_PATH, "");
  const webGet = (path: string, init: RequestInit = {}) =>
    fetch(`${webOrigin}${path}`, { ...init, tls: { ca: rootPem } });
  const rawGet = (path: string) =>
    new Promise<{ status: number; head: string; body: string }>((resolveRaw, reject) => {
      const socket = connectTls({
        host: "127.0.0.1",
        port: Number(new URL(web.url).port),
        servername: "localhost",
        ca: rootPem,
      });
      const chunks: Buffer[] = [];
      socket.once("secureConnect", () =>
        socket.write(`GET ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`),
      );
      socket.on("data", (chunk: Buffer) => chunks.push(chunk));
      socket.once("error", reject);
      socket.once("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        const split = text.indexOf("\r\n\r\n");
        const head = split < 0 ? text : text.slice(0, split);
        resolveRaw({ status: Number(head.split(" ", 2)[1]), head, body: split < 0 ? "" : text.slice(split + 4) });
      });
    });

  await check(
    "With RELAY_WEB_CLIENT_DIR, /app serves index.html and the files of the folder with types and cache rules",
    async () => {
      for (const path of ["/app", "/app/"]) {
        const index = await webGet(path);
        assert.equal(index.status, 200, path);
        assert.equal(index.headers.get("content-type"), "text/html; charset=utf-8");
        assert.equal(index.headers.get("cache-control"), "no-cache");
        assert.match(await index.text(), /relay-e2e-index/u);
      }
      const expected: Array<[string, string]> = [
        ["/app/assets/index-AbCdEf12.js", "text/javascript; charset=utf-8"],
        ["/app/assets/index-AbCdEf12.css", "text/css; charset=utf-8"],
        ["/app/assets/inter-AbCdEf12.woff2", "font/woff2"],
      ];
      for (const [path, type] of expected) {
        const asset = await webGet(path);
        assert.equal(asset.status, 200, path);
        assert.equal(asset.headers.get("content-type"), type, path);
        assert.equal(asset.headers.get("cache-control"), "public, max-age=31536000, immutable", path);
        await asset.arrayBuffer();
      }
      const head = await webGet("/app/assets/index-AbCdEf12.js", { method: "HEAD" });
      assert.equal(head.status, 200);
      const post = await webGet("/app", { method: "POST" });
      assert.equal(post.status, 405);
    },
  );

  await check("An unknown path under /app gets index.html, and a missing file gets 404", async () => {
    const route = await webGet("/app/agents/some-agent");
    assert.equal(route.status, 200);
    assert.equal(route.headers.get("cache-control"), "no-cache");
    assert.match(await route.text(), /relay-e2e-index/u);
    for (const path of ["/app/assets/missing-AbCdEf12.js", "/app/missing.png", "/app/assets"]) {
      const missing = await webGet(path);
      assert.equal(missing.status, 404, path);
      assert.doesNotMatch(await missing.text(), /relay-e2e-index/u, path);
    }
  });

  await check(
    "A path out of the web client folder is refused: dot segments, encoded slashes and symlinks",
    async () => {
      for (const path of [
        "/app/../secret.txt",
        "/app/assets/../../secret.txt",
        "/app/%2e%2e/secret.txt",
        "/app/%2e%2e%2fsecret.txt",
        "/app/..%2f..%2fsecret.txt",
        "/app/assets/%2e%2e%5c%2e%2e%5csecret.txt",
        "/app/assets/leak-AbCdEf12.txt",
        "/app/linked/secret.txt",
        "/app/%00",
      ]) {
        const answer = await rawGet(path);
        assert.ok(answer.status === 404 || answer.status === 400, `${path}: ${answer.status}`);
        assert.doesNotMatch(answer.body, new RegExp(webClientSecret, "u"), path);
      }
      const linked = await rawGet("/app/linked");
      assert.doesNotMatch(linked.body, new RegExp(webClientSecret, "u"));
    },
  );

  await check("Web client responses have the strict security headers, also on a refusal", async () => {
    for (const path of ["/app/", "/app/assets/index-AbCdEf12.js", "/app/missing.png"]) {
      const answer = await webGet(path);
      await answer.arrayBuffer();
      const policy = answer.headers.get("content-security-policy") ?? "";
      for (const directive of [
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "connect-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "form-action 'none'",
      ]) {
        assert.ok(policy.split("; ").includes(directive), `${path}: ${directive} in ${policy}`);
      }
      assert.doesNotMatch(policy, /unsafe-eval/u);
      assert.equal(answer.headers.get("x-content-type-options"), "nosniff", path);
      assert.equal(answer.headers.get("referrer-policy"), "no-referrer", path);
    }
  });

  await check("With the web client on, the relay path and the health endpoint answer as before", async () => {
    const plain = await webGet(RELAY_PATH);
    assert.equal(plain.status, 426);
    const other = await webGet("/application");
    assert.equal(other.status, 404);
    const live = await fetch(`http://127.0.0.1:${web.healthPort}/health/live`);
    assert.equal(live.status, 200);
    const member = await hello(web.url, rootPem, alice, { role: "member", hosting: false });
    await member.message("welcome");
    member.close();
  });

  await check("serve refuses to start when RELAY_WEB_CLIENT_DIR has no index.html", async () => {
    const emptyDirectory = join(work, "empty-web-client");
    mkdirSync(emptyDirectory, { recursive: true });
    const [port, healthPort] = await Promise.all([freePort(), freePort()]);
    const result = spawnSync("bun", [MAIN, "serve"], {
      cwd: ROOT,
      env: {
        ...process.env,
        ...environment,
        RELAY_HOST: "127.0.0.1",
        RELAY_PORT: String(port),
        RELAY_HEALTH_PORT: String(healthPort),
        RELAY_PUBLIC_URL: `wss://localhost:${port}${RELAY_PATH}`,
        RELAY_WEB_CLIENT_DIR: emptyDirectory,
      },
      encoding: "utf8",
      timeout: WAIT_MS,
    });
    assert.equal(result.status, 1, `${result.stdout}${result.stderr}`);
    assert.match(`${result.stdout}${result.stderr}`, /RELAY_WEB_CLIENT_DIR has no index\.html/u);
  });
  web.child.kill("SIGTERM");

  await check("A stop signal ends the server while a member is connected", async () => {
    const stopping = await startServer(environment);
    servers.push(stopping.child);
    const member = await hello(stopping.url, rootPem, alice, { role: "member", hosting: true });
    await member.message("welcome");
    const exited = new Promise<number | null>((resolveExit) =>
      stopping.child.once("exit", (code) => resolveExit(code)),
    );
    stopping.child.kill("SIGTERM");
    const result = await Promise.race([
      exited.then((code) => ({ code })),
      new Promise<null>((resolveGuard) => setTimeout(() => resolveGuard(null), WAIT_MS)),
    ]);
    assert.ok(result, "The server did not exit after the stop signal.");
    assert.equal(result.code, 0);
    await member.closed;
  });

  await check("Each authenticated socket got a server proof first, and each proof verifies with the root", () => {
    const accepted = provedSockets.filter((socket) => socket.peer.order.some((type) => type === "welcome"));
    assert.ok(accepted.length >= 8, `Only ${accepted.length} sockets were accepted.`);
    for (const socket of accepted) {
      assert.equal(serverProofProblem(socket, rootPem), null, `${socket.transcript.role} socket`);
    }
  });
} finally {
  for (const child of servers) child.kill("SIGTERM");
  rmSync(work, { recursive: true, force: true });
}

mkdirSync(OUT, { recursive: true });
const report = {
  service: "remote/api relay",
  passed: checks.filter((entry) => entry.passed).length,
  failed: checks.filter((entry) => !entry.passed).length,
  checks,
};
writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
for (const failed of checks.filter((entry) => !entry.passed))
  process.stderr.write(`FAIL ${failed.name}: ${failed.error}\n`);
process.stdout.write(`Wrote .openbot-build/relay-e2e/report.json: ${report.passed} passed, ${report.failed} failed.\n`);
process.exit(report.failed === 0 ? 0 : 1);
