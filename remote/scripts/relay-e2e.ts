import { strict as assert } from "node:assert";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  verify,
  X509Certificate,
} from "node:crypto";
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
import { decodeRelayHubServerMessage } from "@openbot/contracts/relay-protocol/decode";
import {
  decodeRelayHubFrame,
  encodeRelayHubFrame,
  type RelayHubHello,
  type RelayHubServerMessage,
  type RelayServerProofTranscriptInput,
  relayHelloTranscript,
  relayMessageKeyTranscript,
  relayServerProofTranscript,
} from "@openbot/contracts/relay-protocol/hub";
import { decodeRelayIdentityBundle, type RelayIdentityBundle } from "@openbot/contracts/relay-protocol/identity-bundle";
import {
  RELAY_CLOSE_CODES,
  RELAY_PATH,
  RELAY_PROTOCOL_VERSION,
  relayAudience,
} from "@openbot/contracts/relay-protocol/messages";
import { generateSigningKey, issueCertificate } from "../api/src/relay/x509";

const ROOT = resolve(import.meta.dirname, "../..");
const OUT = resolve(ROOT, ".openbot-build/relay-e2e");
const MAIN = resolve(ROOT, "remote/api/src/relay/main.ts");
const BUILD = resolve(ROOT, "remote/scripts/build-relay.ts");
const WAIT_MS = 15_000;

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

function hasType<Type extends RelayHubServerMessage["type"]>(
  message: RelayHubServerMessage,
  type: Type,
): message is Extract<RelayHubServerMessage, { type: Type }> {
  return message.type === type;
}

class Peer {
  readonly messages: RelayHubServerMessage[] = [];
  readonly order: RelayHubServerMessage["type"][] = [];
  readonly binary: Uint8Array[] = [];
  serverProof: Extract<RelayHubServerMessage, { type: "server-proof" }> | null = null;
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
        const message = decodeRelayHubServerMessage(JSON.parse(event.data));
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

  message<Type extends RelayHubServerMessage["type"]>(
    type: Type,
    matches: (message: Extract<RelayHubServerMessage, { type: Type }>) => boolean = () => true,
  ): Promise<Extract<RelayHubServerMessage, { type: Type }>> {
    return this.until(() => {
      for (const message of this.messages) {
        if (hasType(message, type) && matches(message)) return message;
      }
      return undefined;
    }, `message ${type}`);
  }

  async take<Type extends RelayHubServerMessage["type"]>(
    type: Type,
    matches: (message: Extract<RelayHubServerMessage, { type: Type }>) => boolean = () => true,
  ): Promise<Extract<RelayHubServerMessage, { type: Type }>> {
    const message = await this.message(type, matches);
    this.messages.splice(this.messages.indexOf(message), 1);
    return message;
  }

  forget(type: RelayHubServerMessage["type"]): void {
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
  hosting?: boolean;
  label?: string;
  suspendable?: boolean;
  version?: number;
}

interface HelloChanges {
  signingKey?: string;
  audience?: string;
  timestamp?: number;
  clientNonce?: string;
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

function helloText(url: string, bundle: RelayIdentityBundle, fields: HelloFields, changes: HelloChanges = {}) {
  const audience = changes.audience ?? relayAudience(url);
  const clientNonce = changes.clientNonce ?? randomBytes(32).toString("base64url");
  const timestamp = changes.timestamp ?? Date.now();
  const signingKey = createPrivateKey(changes.signingKey ?? bundle.privateKey);
  const agreement = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const point = agreement.publicKey.export({ type: "spki", format: "der" }).subarray(-65);
  const signWith = (data: Uint8Array) =>
    sign("sha256", data, { key: signingKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
  const body: Omit<RelayHubHello, "type" | "certificate" | "chain" | "signature"> = {
    version: RELAY_PROTOCOL_VERSION,
    audience,
    timestamp,
    clientNonce,
    label: fields.label ?? null,
    hosting: fields.hosting ?? false,
    capabilities: [],
    suspendable: fields.suspendable ?? false,
    messageKey: Buffer.from(point).toString("base64url"),
    messageKeySignature: signWith(relayMessageKeyTranscript({ keyId: keyId(bundle), messageKey: point, timestamp })),
  };
  return {
    transcript: { clientNonce, audience, clientKeyId: keyId(bundle) },
    message: {
      type: "hello",
      ...body,
      ...(fields.version === undefined ? {} : { version: fields.version }),
      certificate: bundle.certificate,
      chain: bundle.chain,
      signature: signWith(relayHelloTranscript(body)),
    },
  };
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
  const { transcript, message } = helloText(url, bundle, fields, changes);
  provedSockets.push({ peer, url, transcript });
  peer.sendJsonWhenOpen(message);
  return peer;
}

function sendTo(sender: Peer, to: string, id: number, payload: Uint8Array, kind: "rpc" | "files" = "rpc"): void {
  const frame = encodeRelayHubFrame({ type: "send", kind, id, peer: to, payload: new Uint8Array(payload) });
  assert.ok(frame, "The frame cannot be encoded.");
  sender.sendBytes(frame);
}

function delivered(peer: Peer): Array<{ from: string; id: number; text: string }> {
  return peer.binary.flatMap((bytes) => {
    const frame = decodeRelayHubFrame(bytes);
    return frame?.type === "deliver"
      ? [{ from: frame.peer, id: frame.id, text: new TextDecoder().decode(frame.payload) }]
      : [];
  });
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
  await check("The certificate commands make a root with the team Default, two teams and a server certificate", () => {
    const initialized = command(environment, "ca", "init");
    assert.equal(initialized.status, 0, initialized.output);
    assert.match(initialized.output, /The team "Default" is ready/u);
    assert.equal(command(environment, "ca", "team", "add", "Acme Team").status, 0);
    assert.equal(command(environment, "ca", "team", "add", "Other Team").status, 0);
    assert.equal(command(environment, "ca", "server", "--dns", "localhost", "--ip", "127.0.0.1").status, 0);
    const listed = command(environment, "ca", "list");
    assert.equal(listed.status, 0);
    assert.match(listed.output, /root +valid/u);
    assert.match(listed.output, /team +valid .* Acme Team/u);
    assert.match(listed.output, /team +valid .* Default/u);
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

  let aliceMember = await hello(url, rootPem, alice, { hosting: true, label: "Alice laptop" });
  await check("A member gets its user, device, team and the roster from its certificate", async () => {
    const welcome = await aliceMember.message("welcome");
    assert.deepEqual([welcome.self.keyId, welcome.self.user, welcome.self.device], [keyId(alice), "alice", "laptop"]);
    assert.equal(welcome.team.name, "Acme Team");
    assert.deepEqual(
      welcome.roster.map((member) => [member.user, member.hosting, member.label]),
      [["alice", true, "Alice laptop"]],
    );
  });

  const bobMember = await hello(url, rootPem, bob, { hosting: false });
  await check("Members of one team see each other", async () => {
    const welcome = await bobMember.message("welcome");
    assert.deepEqual(
      welcome.roster.map((member) => member.user),
      ["alice", "bob"],
    );
    const update = await aliceMember.message("online", (message) => message.member.user === "bob");
    assert.equal(update.member.keyId, keyId(bob));
  });

  const carolMember = await hello(url, rootPem, carol, { hosting: true });
  await check("A member of a different team gets a different team and sees no member of the first team", async () => {
    const welcome = await carolMember.message("welcome");
    const aliceWelcome = await aliceMember.message("welcome");
    assert.equal(welcome.team.name, "Other Team");
    assert.notEqual(welcome.team.id, aliceWelcome.team.id);
    assert.deepEqual(
      welcome.roster.map((member) => member.user),
      ["carol"],
    );
    const seenByAlice = aliceMember.messages.flatMap((message) => (message.type === "online" ? [message.member] : []));
    assert.equal(
      seenByAlice.some((member) => member.user === "carol"),
      false,
    );
  });

  await check("A member sends a message to another member and the server delivers it with the sender key", async () => {
    sendTo(bobMember, keyId(alice), 7, new TextEncoder().encode("ping"));
    const seen = await aliceMember.until(
      () => delivered(aliceMember).find((entry) => entry.text === "ping"),
      "the delivered message",
    );
    assert.deepEqual([seen.from, seen.id], [keyId(bob), 7]);
  });

  await check(
    "A message to an offline key, to itself or to a member of a different team gets undeliverable at once",
    async () => {
      const offlineKey = randomBytes(32).toString("base64url");
      sendTo(bobMember, offlineKey, 8, new Uint8Array(4));
      assert.equal((await bobMember.take("undeliverable", (message) => message.id === 8)).code, "offline");
      sendTo(bobMember, keyId(bob), 9, new Uint8Array(4));
      assert.equal((await bobMember.take("undeliverable", (message) => message.id === 9)).code, "not_member");
      sendTo(carolMember, keyId(alice), 10, new Uint8Array(4));
      assert.equal((await carolMember.take("undeliverable", (message) => message.id === 10)).code, "offline");
      assert.equal(
        delivered(aliceMember).some((entry) => entry.id === 10),
        false,
      );
    },
  );

  await check("The server answers info from the record, and null for a member it does not know", async () => {
    bobMember.sendJson({ type: "info", version: RELAY_PROTOCOL_VERSION, id: 1, about: keyId(alice) });
    const known = await bobMember.take("info", (message) => message.id === 1);
    assert.deepEqual([known.member?.user, known.member?.hosting], ["alice", true]);
    carolMember.sendJson({ type: "info", version: RELAY_PROTOCOL_VERSION, id: 2, about: keyId(alice) });
    assert.equal((await carolMember.take("info", (message) => message.id === 2)).member, null);
  });

  await check("A hello of an older protocol version is refused", async () => {
    const old = await hello(url, rootPem, dave, { version: 1 });
    await refusedWith(old, "invalid_message");
  });

  await check("A certificate of a different root is refused", async () => {
    const otherRoot = { RELAY_DATA_DIR: otherRootDirectory };
    assert.equal(command(otherRoot, "ca", "init").status, 0);
    assert.equal(command(otherRoot, "ca", "team", "add", "Acme Team").status, 0);
    const eve = issue(otherRoot, work, "Acme Team", "eve");
    await refusedWith(await hello(url, rootPem, eve, { hosting: false }), "authentication_failed");
  });

  await check("A proof from a different private key is refused", async () => {
    await refusedWith(
      await hello(url, rootPem, alice, { hosting: false }, { signingKey: bob.privateKey }),
      "authentication_failed",
    );
  });

  await check("A hello with an old time, or with a nonce that the server saw, is refused", async () => {
    await refusedWith(
      await hello(url, rootPem, dave, { hosting: false }, { timestamp: Date.now() - 120_000 }),
      "authentication_failed",
    );
    const clientNonce = randomBytes(32).toString("base64url");
    const first = await hello(url, rootPem, dave, { hosting: false }, { clientNonce });
    await first.message("welcome");
    first.close();
    await refusedWith(await hello(url, rootPem, dave, { hosting: false }, { clientNonce }), "authentication_failed");
  });

  await check("A proof for a different server is refused", async () => {
    await refusedWith(
      await hello(url, rootPem, alice, { hosting: false }, { audience: "wss://relay.example.com" }),
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
    await refusedWith(await hello(url, rootPem, intruder, { hosting: false }), "authentication_failed");
  });

  await check("An expired certificate is refused", async () => {
    const old = forged("Acme Team", "Acme Team", "old", Date.now() - 3 * 24 * 60 * 60_000, 1);
    await refusedWith(await hello(url, rootPem, old, { hosting: false }), "certificate_expired");
  });

  await check("Data before the proof, an invalid frame, and an unknown message close the socket", async () => {
    const early = new Peer(url, { ca: rootPem });
    early.sendJsonWhenOpen({ type: "ping", version: RELAY_PROTOCOL_VERSION, id: 1 });
    await refusedWith(early, "protocol_error");
    const invalid = await hello(url, rootPem, dave, { hosting: false });
    await invalid.message("welcome");
    invalid.sendBytes(new Uint8Array([9, 9, 0, 0, 0, 1, 0]));
    await refusedWith(invalid, "invalid_message");
    const unknown = new Peer(url, { ca: rootPem });
    unknown.sendJsonWhenOpen({ type: "hello", version: RELAY_PROTOCOL_VERSION });
    await refusedWith(unknown, "invalid_message");
  });

  await check("A newer connection of one certificate replaces the older one", async () => {
    bobMember.forget("online");
    const newer = await hello(url, rootPem, alice, { hosting: true, label: "Alice laptop" });
    await newer.message("welcome");
    const error = await aliceMember.message("error");
    assert.equal(error.code, "replaced");
    assert.equal((await aliceMember.closed).code, RELAY_CLOSE_CODES.replaced);
    const online = await bobMember.message("online", (message) => message.member.user === "alice");
    assert.equal(online.member.keyId, keyId(alice));
    assert.equal(
      bobMember.messages.some((message) => message.type === "offline" && message.keyId === keyId(alice)),
      false,
    );
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
    await aliceMember.message("offline", (message) => message.keyId === keyId(bob));
    await refusedWith(await hello(url, rootPem, bob, { hosting: false }), "certificate_revoked");
  });

  await check("The server sent no message that the client decoder refuses", () => {
    assert.equal(aliceMember.undecoded + bobMember.undecoded + carolMember.undecoded, 0);
  });

  await check("A socket that sends no proof is closed", async () => {
    const silent = new Peer(url, { ca: rootPem });
    await refusedWith(silent, "authentication_failed");
  });

  await check("A hello with no client nonce is refused and gets no server proof", async () => {
    const peer = new Peer(url, { ca: rootPem });
    const { message } = helloText(url, alice, { hosting: false });
    peer.sendJsonWhenOpen({ ...message, clientNonce: "" });
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
    const member = await hello(separate.url, rootPem, alice, { hosting: false }, {}, otherRootPem);
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
    const { transcript, message } = helloText(gated.url, alice, { hosting: false });
    provedSockets.push({ peer, url: gated.url, transcript });
    peer.sendJsonWhenOpen(message);
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
    const member = await hello(web.url, rootPem, alice, { hosting: false });
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
    const member = await hello(stopping.url, rootPem, alice, { hosting: true });
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
      assert.equal(serverProofProblem(socket, rootPem), null, `${socket.transcript.clientKeyId} socket`);
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
