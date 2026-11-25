import { strict as assert } from "node:assert";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash, createPrivateKey, randomBytes, sign, verify, X509Certificate } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { decodeRelayServerMessage } from "@openbot/contracts/relay-protocol/decode";
import { decodeRelayIdentityBundle, type RelayIdentityBundle } from "@openbot/contracts/relay-protocol/identity-bundle";
import {
  RELAY_CLOSE_CODES,
  RELAY_PATH,
  RELAY_PROTOCOL_VERSION,
  type RelayRole,
  type RelayServerMessage,
  type RelayServerProofTranscriptInput,
  relayAudience,
  relayHelloTranscript,
  relayServerProofTranscript,
} from "@openbot/contracts/relay-protocol/messages";
import { generateSigningKey, issueCertificate } from "../api/src/relay/x509";

const ROOT = resolve(import.meta.dirname, "../..");
const OUT = resolve(ROOT, ".openbot-build/relay-e2e");
const MAIN = resolve(ROOT, "remote/api/src/relay/main.ts");
const BUILD = resolve(ROOT, "remote/scripts/build-relay.ts");
const WAIT_MS = 15_000;
const TRANSFER_BYTES = 8 * 1024 * 1024;
const TRANSFER_CHUNK_BYTES = 64 * 1024;

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
  target?: string;
  waitForTarget?: boolean;
  connectionId?: string;
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
  const accepted = socket.peer.order.findIndex((type) => type === "welcome" || type === "waiting" || type === "open");
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
      target: fields.target,
      connectionId: fields.connectionId,
    },
  });
  const transcript = relayHelloTranscript({
    nonce: changes.nonce ?? challenge.nonce,
    clientNonce,
    audience,
    role: fields.role,
    target: fields.target,
    connectionId: fields.connectionId,
  });
  peer.sendJson({
    type: "hello",
    version: RELAY_PROTOCOL_VERSION,
    audience,
    clientNonce,
    certificate: bundle.certificate,
    chain: bundle.chain,
    signature: proofSignature(changes.signingKey ?? bundle.privateKey, transcript),
    ...fields,
  });
  return peer;
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

  const main = await startServer(environment);
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

  await check("A connection passes bytes in both directions and names each side from its certificate", async () => {
    const client = await hello(url, rootPem, bob, { role: "client", target: keyId(alice) });
    const incoming = await aliceMember.take("incoming", (message) => message.from.user === "bob");
    assert.equal(incoming.from.keyId, keyId(bob));
    assert.equal(new X509Certificate(incoming.from.certificate).subject.includes("CN=bob"), true);
    const accept = await hello(url, rootPem, alice, { role: "accept", connectionId: incoming.connectionId });
    const [clientOpen, acceptOpen] = await Promise.all([client.message("open"), accept.message("open")]);
    assert.equal(clientOpen.peer.user, "alice");
    assert.equal(acceptOpen.peer.user, "bob");
    assert.equal(clientOpen.connectionId, incoming.connectionId);
    const request = randomBytes(1_000);
    const answer = randomBytes(70_000);
    client.sendBytes(request);
    accept.sendBytes(answer);
    const [received] = await accept.until(
      () => (accept.binary.length > 0 ? accept.binary : undefined),
      "bytes at host",
    );
    const [returned] = await client.until(
      () => (client.binary.length > 0 ? client.binary : undefined),
      "bytes at client",
    );
    assert.equal(Buffer.compare(Buffer.from(received ?? []), request), 0);
    assert.equal(Buffer.compare(Buffer.from(returned ?? []), answer), 0);
    client.close();
    const closed = await accept.closed;
    assert.equal(closed.code, RELAY_CLOSE_CODES.peerClosed);
  });

  await check(`A connection keeps ${TRANSFER_BYTES} bytes complete and in order`, async () => {
    const client = await hello(url, rootPem, bob, { role: "client", target: keyId(alice) });
    const incoming = await aliceMember.take("incoming", (message) => message.from.user === "bob");
    const accept = await hello(url, rootPem, alice, { role: "accept", connectionId: incoming.connectionId });
    await Promise.all([client.message("open"), accept.message("open")]);
    const sent = createHash("sha256");
    for (let offset = 0; offset < TRANSFER_BYTES; offset += TRANSFER_CHUNK_BYTES) {
      const chunk = randomBytes(TRANSFER_CHUNK_BYTES);
      sent.update(chunk);
      client.sendBytes(chunk);
    }
    const total = () => accept.binary.reduce((bytes, chunk) => bytes + chunk.byteLength, 0);
    await accept.until(() => (total() >= TRANSFER_BYTES ? true : undefined), "all bytes at host");
    const received = createHash("sha256");
    for (const chunk of accept.binary) received.update(chunk);
    assert.equal(total(), TRANSFER_BYTES);
    assert.equal(received.digest("hex"), sent.digest("hex"));
    accept.close();
    await client.closed;
  });

  await check("A member cannot connect to a member of a different team", async () => {
    await refusedWith(await hello(url, rootPem, carol, { role: "client", target: keyId(alice) }), "target_unavailable");
  });

  await check("A member that does not host cannot be a target", async () => {
    await refusedWith(await hello(url, rootPem, alice, { role: "client", target: keyId(bob) }), "target_unavailable");
  });

  await check("A client waits for a target, and connects when the target starts to host", async () => {
    const client = await hello(url, rootPem, dave, { role: "client", target: keyId(bob), waitForTarget: true });
    await client.message("waiting");
    bobMember.sendJson({ type: "presence", version: RELAY_PROTOCOL_VERSION, hosting: true, label: "Bob" });
    const incoming = await bobMember.take("incoming", (message) => message.from.user === "dave");
    const accept = await hello(url, rootPem, bob, { role: "accept", connectionId: incoming.connectionId });
    const open = await client.message("open");
    assert.equal(open.peer.user, "bob");
    await aliceMember.message("members", (message) =>
      message.members.some((member) => member.user === "bob" && member.hosting && member.label === "Bob"),
    );
    accept.close();
    await client.closed;
  });

  await check("Only the target can accept a connection", async () => {
    const client = await hello(url, rootPem, dave, { role: "client", target: keyId(bob) });
    const incoming = await bobMember.take("incoming", (message) => message.from.user === "dave");
    await refusedWith(
      await hello(url, rootPem, alice, { role: "accept", connectionId: incoming.connectionId }),
      "protocol_error",
    );
    await refusedWith(
      await hello(url, rootPem, carol, { role: "accept", connectionId: incoming.connectionId }),
      "protocol_error",
    );
    client.close();
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

  await check("Data before a connection is open, and an unknown message, close the socket", async () => {
    const early = new Peer(url, { ca: rootPem });
    await early.message("challenge");
    early.sendBytes(randomBytes(16));
    await refusedWith(early, "protocol_error");
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

  await check("A revoked certificate loses its connection and cannot connect again", async () => {
    const revoked = command(environment, "ca", "revoke", keyId(bob));
    assert.equal(revoked.status, 0, revoked.output);
    const error = await bobMember.message("error");
    assert.equal(error.code, "certificate_revoked");
    await bobMember.closed;
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
    const accepted = provedSockets.filter((socket) =>
      socket.peer.order.some((type) => type === "welcome" || type === "waiting" || type === "open"),
    );
    assert.ok(accepted.length >= 10, `Only ${accepted.length} sockets were accepted.`);
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
