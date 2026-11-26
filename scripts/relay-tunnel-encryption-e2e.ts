import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
  createECDH,
  createHash,
  createPrivateKey,
  type KeyObject,
  randomBytes,
  sign,
  X509Certificate,
} from "node:crypto";
import { EventEmitter, once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpsServer } from "node:https";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Duplex } from "node:stream";
import { inspect } from "node:util";
import { AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import { decodeRelayIdentityBundle, type RelayIdentityBundle } from "@openbot/contracts/relay-protocol/identity-bundle";
import {
  RELAY_PATH,
  RELAY_PROTOCOL_VERSION,
  type RelayPeerCertificate,
  type RelayRole,
  relayServerProofTranscript,
} from "@openbot/contracts/relay-protocol/messages";
import { RELAY_TUNNEL_RECORD_HEADER_BYTES } from "@openbot/contracts/relay-protocol/tunnel-crypto";
import {
  decodeRelayV2TunnelControl,
  encodeRelayV2TunnelMarker,
  encodeRelayV2TunnelRecord,
  RELAY_V2_TUNNEL_CHANNELS,
  RELAY_V2_TUNNEL_VERSION,
  type RelayV2TunnelChannel,
  type RelayV2TunnelMessage,
  RelayV2TunnelRecordDecoder,
} from "@openbot/contracts/relay-protocol/v2-tunnel";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  encodeTeamCapabilitiesV10,
  TEAM_APP_VERSION_HEADER,
  TEAM_CURRENT_CAPABILITIES,
  TEAM_PROTOCOL_V10,
  TEAM_PROTOCOL_VERSION_HEADER,
  teamCapabilityHeaders,
} from "@openbot/contracts/team-protocol";
import {
  decodeTeamProtocolV2EventFrame,
  decodeTeamProtocolV2RpcFrame,
  encodeTeamProtocolV2Frame,
  type TeamProtocolV2Json,
} from "@openbot/contracts/team-protocol/v2";
import { encodeTeamV2Payload, TeamV2PayloadDecoder } from "@openbot/team-client/v2-framing";
import { Effect, Option, Result, Schema } from "effect";
import WebSocket, { WebSocketServer } from "ws";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { AgentService as AgentServiceInstance } from "../src/backend/agent-service";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { OpenBotDatabase as OpenBotDatabaseInstance } from "../src/backend/openbot-database";
import type { HostService as HostServiceInstance } from "../src/main/host-service";
import type { LocalProfile } from "../src/main/local-profile-store";
import { RelayAcceptor } from "../src/main/relay/acceptor";
import { publicKeyId, subjectNames } from "../src/main/relay/certificates";
import { RelayControl, type RelayControlState } from "../src/main/relay/control";
import { RelayDialer } from "../src/main/relay/dialer";
import { createRelayFetch } from "../src/main/relay/fetch";
import { type RelayCipher, RelayIdentityStore } from "../src/main/relay/identity-store";
import { openRelayTunnelSocket, RelaySocketError } from "../src/main/relay/socket";
import type { RelayStream } from "../src/main/relay/stream";
import type { TeamApiBrowser } from "../src/main/team-api/dependencies";
import { rawDataBytes, rawDataText } from "../src/main/ws-raw-data";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, ".openbot-build/relay-tunnel-encryption-e2e");
const MAIN = resolve(ROOT, "remote/api/src/relay/main.ts");
const PHONE = resolve(ROOT, "scripts/relay-tunnel-encryption-e2e-phone.ts");
const WAIT_MS = 30_000;
const TRANSFER_BYTES = 8 * 1024 * 1024;
const READY_LINE = "OpenBot relay is ready";
const APP_VERSION = "0.0.0-e2e";
const TEAM = "Acme";
const HOST_USER = "host-user";
const HELLO_FRAME_BYTES = RELAY_TUNNEL_RECORD_HEADER_BYTES + 99;
const FINISH_FRAME_BYTES = RELAY_TUNNEL_RECORD_HEADER_BYTES + 66;
const REPLY_FRAME_BYTES = RELAY_TUNNEL_RECORD_HEADER_BYTES + 163;
const REPLY_EPHEMERAL_OFFSET = RELAY_TUNNEL_RECORD_HEADER_BYTES + 2;
const FIRST_RECORD_TAMPER_OFFSET = RELAY_TUNNEL_RECORD_HEADER_BYTES + 2;

interface Check {
  name: string;
  passed: boolean;
  error?: string;
}

const Measured = Schema.Struct({
  bytes: Schema.Number,
  milliseconds: Schema.Number,
  mebibytesPerSecond: Schema.Number,
});
const RelayHello = Schema.Struct({
  type: Schema.Literal("hello"),
  role: Schema.Literals(["member", "client", "accept"]),
  certificate: Schema.String,
  clientNonce: Schema.String,
  audience: Schema.String,
  target: Schema.optional(Schema.String),
  connectionId: Schema.optional(Schema.String),
  hosting: Schema.optional(Schema.Boolean),
  label: Schema.optional(Schema.String),
});
const RelayPresence = Schema.Struct({ type: Schema.Literal("presence"), hosting: Schema.Boolean });
const PhoneResult = Schema.Struct({
  subtleMissing: Schema.Boolean,
  checks: Schema.Array(
    Schema.Struct({ name: Schema.String, passed: Schema.Boolean, error: Schema.optional(Schema.String) }),
  ),
  meStatus: Schema.NullOr(Schema.Number),
  meRole: Schema.NullOr(Schema.String),
  throughput: Schema.NullOr(Measured),
});
const decodeHello = Schema.decodeUnknownOption(Schema.fromJsonString(RelayHello));
const decodePresence = Schema.decodeUnknownOption(Schema.fromJsonString(RelayPresence));
const decodePhoneResult = Schema.decodeUnknownSync(Schema.fromJsonString(PhoneResult));
const decodeSession = Schema.decodeUnknownSync(Schema.Struct({ sessionToken: Schema.String }));
const decodeAttachment = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }));
type RelayHelloMessage = typeof RelayHello.Type;
type MeasuredTransfer = typeof Measured.Type;

interface Observed {
  desktopHttpBytes?: number;
  v2Bytes?: number;
  phoneBytes?: number;
  phone?: typeof PhoneResult.Type;
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
  let unsubscribe = () => {};
  const promise = new Promise<T>((resolveValue) => {
    unsubscribe = subscribe((value) => {
      unsubscribe();
      resolveValue(value);
    });
  });
  return deadline(description, promise).finally(() => unsubscribe());
}

async function ok<A, E>(operation: Effect.Effect<A, E>): Promise<A> {
  const result = await Effect.runPromise(Effect.result(operation));
  if (Result.isFailure(result)) throw new Error(`Unexpected failure: ${inspect(result.failure)}`);
  return result.success;
}

async function failureOf<A, E>(operation: Effect.Effect<A, E>): Promise<E> {
  const result = await Effect.runPromise(Effect.result(operation));
  if (Result.isSuccess(result)) throw new Error("The operation must fail.");
  return result.failure;
}

function codeOf(error: unknown): string {
  return error instanceof RelaySocketError ? error.code : inspect(error);
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") resolvePort(address.port);
        else reject(new Error("No free port."));
      });
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
  return publicKeyId(new X509Certificate(bundle.certificate).publicKey);
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
  const exited = new Promise<void>((resolveExit) => child.once("exit", () => resolveExit()));
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

interface TamperMode {
  flipClientToHostAt?: number;
  flipHostToClientAt?: number;
  replaceHostEphemeral?: boolean;
  replayReply?: Buffer;
  splice?: boolean;
}

interface MitmTunnel {
  clientPeer: RelayPeerCertificate;
  clientKeyId: string;
  hostKeyId: string;
  connectionId: string;
  mode: TamperMode;
  client: WebSocket;
  accept: WebSocket | null;
  clientToHost: Buffer[];
  hostToClient: Buffer[];
  clientToHostBytes: number;
  hostToClientBytes: number;
  closed: boolean;
}

interface MitmMember {
  socket: WebSocket;
  peer: RelayPeerCertificate;
  hosting: boolean;
  label: string | null;
}

class MitmRelay extends EventEmitter<{ closed: [tunnel: MitmTunnel] }> {
  readonly tunnels: MitmTunnel[] = [];
  readonly #members = new Map<string, MitmMember>();
  readonly #pending = new Map<string, MitmTunnel>();
  readonly #server;
  readonly #sockets;
  #mode: TamperMode = {};
  url = "";

  constructor(
    tls: { cert: string; key: string },
    readonly proof: { certificate: string; privateKey: KeyObject },
  ) {
    super();
    this.#server = createHttpsServer(tls);
    this.#sockets = new WebSocketServer({ server: this.#server, path: RELAY_PATH, maxPayload: 2 * 1024 * 1024 });
    this.#sockets.on("connection", (socket) => this.#connected(socket));
  }

  async start(): Promise<void> {
    this.#server.listen(0, "127.0.0.1");
    await once(this.#server, "listening");
    const address = this.#server.address();
    if (!address || typeof address !== "object") throw new Error("The relay in the middle has no port.");
    this.url = `wss://127.0.0.1:${address.port}${RELAY_PATH}`;
  }

  stop(): void {
    for (const client of this.#sockets.clients) client.terminate();
    this.#sockets.close();
    this.#server.close();
  }

  tamperNext(mode: TamperMode): void {
    this.#mode = mode;
  }

  untilClosed(tunnel: MitmTunnel): Promise<void> {
    return until<void>("the relay in the middle sees the tunnel close", (done) => {
      const listener = (closed: MitmTunnel) => {
        if (closed === tunnel) done();
      };
      this.on("closed", listener);
      if (tunnel.closed) done();
      return () => this.off("closed", listener);
    });
  }

  #connected(socket: WebSocket): void {
    const serverNonce = randomBytes(32).toString("base64url");
    let state: { role: RelayRole; peer: RelayPeerCertificate; tunnel: MitmTunnel | null } | null = null;
    socket.send(JSON.stringify({ type: "challenge", version: RELAY_PROTOCOL_VERSION, nonce: serverNonce }));
    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        if (state?.tunnel) this.#forward(state.tunnel, socket, Buffer.from(rawDataBytes(data)));
        return;
      }
      const text = rawDataText(data);
      if (state === null) {
        const hello = decodeHello(text);
        state = Option.isSome(hello) ? this.#hello(socket, serverNonce, hello.value) : null;
        return;
      }
      const presence = decodePresence(text);
      const member = state.role === "member" ? this.#members.get(state.peer.keyId) : undefined;
      if (member && Option.isSome(presence)) member.hosting = presence.value.hosting;
    });
    socket.on("close", () => {
      if (state?.role === "member" && this.#members.get(state.peer.keyId)?.socket === socket) {
        this.#members.delete(state.peer.keyId);
      }
      const tunnel = state?.tunnel;
      if (!tunnel) return;
      for (const other of [tunnel.client, tunnel.accept]) {
        if (other && other !== socket && other.readyState === WebSocket.OPEN) other.close(4002);
      }
      if (!tunnel.closed) {
        tunnel.closed = true;
        this.emit("closed", tunnel);
      }
    });
  }

  #hello(socket: WebSocket, serverNonce: string, hello: RelayHelloMessage) {
    const role = hello.role;
    const certificate = new X509Certificate(hello.certificate);
    const names = subjectNames(certificate.subject);
    if (!names) return null;
    const peer: RelayPeerCertificate = {
      keyId: publicKeyId(certificate.publicKey),
      user: names.user,
      device: names.device,
      certificate: hello.certificate,
    };
    const { target, connectionId } = hello;
    const transcript = relayServerProofTranscript({
      serverNonce,
      clientNonce: hello.clientNonce,
      audience: hello.audience,
      role,
      clientKeyId: peer.keyId,
      target,
      connectionId,
    });
    const signature = sign("sha256", Buffer.from(transcript), {
      key: this.proof.privateKey,
      dsaEncoding: "ieee-p1363",
    }).toString("base64url");
    socket.send(
      JSON.stringify({
        type: "server-proof",
        version: RELAY_PROTOCOL_VERSION,
        certificate: this.proof.certificate,
        signature,
      }),
    );
    if (role === "member") {
      this.#members.set(peer.keyId, {
        socket,
        peer,
        hosting: hello.hosting === true,
        label: hello.label ?? null,
      });
      socket.send(
        JSON.stringify({
          type: "welcome",
          version: RELAY_PROTOCOL_VERSION,
          self: { keyId: peer.keyId, user: peer.user, device: peer.device },
          team: { id: "t".repeat(43), name: TEAM },
          members: [...this.#members.values()].map((member) => ({
            keyId: member.peer.keyId,
            user: member.peer.user,
            device: member.peer.device,
            label: member.label,
            hosting: member.hosting,
            connectedAt: Date.now(),
          })),
        }),
      );
      return { role, peer, tunnel: null };
    }
    if (role === "client") {
      const member = target === undefined ? undefined : this.#members.get(target);
      if (!member?.hosting) {
        socket.send(
          JSON.stringify({
            type: "error",
            version: RELAY_PROTOCOL_VERSION,
            code: "target_unavailable",
            message: "No host.",
          }),
        );
        socket.close(1013);
        return { role, peer, tunnel: null };
      }
      const tunnel: MitmTunnel = {
        clientPeer: peer,
        clientKeyId: peer.keyId,
        hostKeyId: member.peer.keyId,
        connectionId: randomBytes(16).toString("base64url"),
        mode: this.#mode,
        client: socket,
        accept: null,
        clientToHost: [],
        hostToClient: [],
        clientToHostBytes: 0,
        hostToClientBytes: 0,
        closed: false,
      };
      this.#mode = {};
      this.tunnels.push(tunnel);
      this.#pending.set(tunnel.connectionId, tunnel);
      member.socket.send(
        JSON.stringify({
          type: "incoming",
          version: RELAY_PROTOCOL_VERSION,
          connectionId: tunnel.connectionId,
          from: peer,
        }),
      );
      return { role, peer, tunnel };
    }
    const tunnel = connectionId === undefined ? undefined : this.#pending.get(connectionId);
    if (!tunnel) {
      socket.close(1008);
      return null;
    }
    this.#pending.delete(tunnel.connectionId);
    tunnel.accept = socket;
    const hostPeer = this.#members.get(tunnel.hostKeyId)?.peer;
    const clientConnectionId = tunnel.mode.splice ? randomBytes(16).toString("base64url") : tunnel.connectionId;
    tunnel.client.send(
      JSON.stringify({
        type: "open",
        version: RELAY_PROTOCOL_VERSION,
        connectionId: clientConnectionId,
        peer: hostPeer,
      }),
    );
    socket.send(
      JSON.stringify({
        type: "open",
        version: RELAY_PROTOCOL_VERSION,
        connectionId: tunnel.connectionId,
        peer: tunnel.clientPeer,
      }),
    );
    return { role, peer, tunnel };
  }

  #forward(tunnel: MitmTunnel, from: WebSocket, data: Buffer): void {
    const towardHost = from === tunnel.client;
    const target = towardHost ? tunnel.accept : tunnel.client;
    const offset = towardHost ? tunnel.clientToHostBytes : tunnel.hostToClientBytes;
    let bytes = Buffer.from(data);
    const flipAt = towardHost ? tunnel.mode.flipClientToHostAt : tunnel.mode.flipHostToClientAt;
    if (flipAt !== undefined && flipAt >= offset && flipAt < offset + bytes.byteLength) {
      bytes[flipAt - offset] = (bytes[flipAt - offset] ?? 0) ^ 0x01;
    }
    if (!towardHost && offset === 0 && bytes.byteLength >= REPLY_FRAME_BYTES) {
      if (tunnel.mode.replaceHostEphemeral) {
        const forged = createECDH("prime256v1");
        forged.generateKeys();
        forged.getPublicKey().copy(bytes, REPLY_EPHEMERAL_OFFSET);
      }
      if (tunnel.mode.replayReply) bytes = Buffer.concat([tunnel.mode.replayReply, bytes.subarray(REPLY_FRAME_BYTES)]);
    }
    if (towardHost) {
      tunnel.clientToHost.push(Buffer.from(data));
      tunnel.clientToHostBytes += data.byteLength;
    } else {
      tunnel.hostToClient.push(Buffer.from(data));
      tunnel.hostToClientBytes += data.byteLength;
    }
    if (target?.readyState === WebSocket.OPEN) target.send(bytes);
  }
}

function recorded(tunnels: readonly MitmTunnel[]): Buffer {
  return Buffer.concat(tunnels.flatMap((tunnel) => [...tunnel.clientToHost, ...tunnel.hostToClient]));
}

function assertNoPlaintext(tunnels: readonly MitmTunnel[], secrets: readonly string[]): number {
  assert.ok(tunnels.length > 0, "The relay in the middle saw no tunnel.");
  const bytes = recorded(tunnels);
  for (const secret of secrets) {
    assert.equal(
      bytes.includes(Buffer.from(secret)),
      false,
      `The relay saw the plaintext ${JSON.stringify(secret.slice(0, 24))}.`,
    );
  }
  return bytes.byteLength;
}

interface EchoStream {
  received: number;
  error: string | null;
  closed: boolean;
}

class EchoHost extends EventEmitter<{ changed: [] }> {
  readonly streams: EchoStream[] = [];
  readonly refusals: string[] = [];
  readonly control: RelayControl;
  readonly acceptor: RelayAcceptor;

  constructor(identity: RelayIdentityStore, mode: "echo" | "hash") {
    super();
    this.control = new RelayControl({ identity, hosting: true, label: "echo", reconnect: { baseMs: 100, maxMs: 500 } });
    this.acceptor = new RelayAcceptor({
      identity,
      control: this.control,
      onStream: (stream) => this.#serve(stream, mode),
      onRefused: (error) => {
        this.refusals.push(error.code);
        this.emit("changed");
      },
    });
  }

  async start(): Promise<void> {
    await ok(this.acceptor.start());
    const online = until<void>("the echo host is online", (done) => {
      const listener = (state: RelayControlState) => {
        if (state.status === "online") done();
      };
      this.control.on("state", listener);
      return () => this.control.off("state", listener);
    });
    await ok(this.control.start());
    await online;
  }

  async stop(): Promise<void> {
    await ok(this.acceptor.stop());
    await ok(this.control.stop());
  }

  until<T>(description: string, pick: () => T | null): Promise<T> {
    return until<T>(description, (done) => {
      const look = () => {
        const value = pick();
        if (value !== null) done(value);
      };
      this.on("changed", look);
      look();
      return () => this.off("changed", look);
    });
  }

  #serve(stream: RelayStream, mode: "echo" | "hash"): void {
    const entry: EchoStream = { received: 0, error: null, closed: false };
    this.streams.push(entry);
    const hash = createHash("sha256");
    stream.on("data", (chunk: Buffer) => {
      entry.received += chunk.byteLength;
      if (mode === "echo") stream.write(chunk);
      else {
        hash.update(chunk);
        if (entry.received === TRANSFER_BYTES) stream.write(`${hash.digest("hex")}\n`);
      }
      this.emit("changed");
    });
    stream.on("error", (error) => {
      entry.error = codeOf(error);
      this.emit("changed");
    });
    stream.on("close", () => {
      entry.closed = true;
      this.emit("changed");
    });
    this.emit("changed");
  }
}

function untilStreamEnds(stream: Duplex): Promise<{ data: Buffer; error: string | null }> {
  const chunks: Buffer[] = [];
  let error: string | null = null;
  stream.on("data", (chunk: Buffer) => chunks.push(chunk));
  stream.on("error", (failure) => {
    error = codeOf(failure);
  });
  return deadline(
    "the stream closes",
    new Promise((resolveEnd) => stream.once("close", () => resolveEnd({ data: Buffer.concat(chunks), error }))),
  );
}

function readLine(stream: Duplex): Promise<string> {
  return deadline(
    "a line from the stream",
    new Promise<string>((resolveLine, reject) => {
      let text = "";
      stream.on("data", (chunk: Buffer) => {
        text += chunk.toString("utf8");
        if (text.endsWith("\n")) resolveLine(text.trim());
      });
      stream.once("close", () => reject(new Error("The stream closed before a line.")));
    }),
  );
}

class V2Tunnel {
  readonly messages: RelayV2TunnelMessage[] = [];
  readonly #records = new RelayV2TunnelRecordDecoder();
  readonly #payloads = new TeamV2PayloadDecoder();
  readonly #changed = new EventEmitter<{ changed: [] }>();
  closed = false;

  constructor(readonly stream: RelayStream) {
    stream.on("data", (chunk: Buffer) => {
      for (const record of this.#records.push(chunk)) {
        const payload = this.#payloads.push(record);
        if (payload !== undefined) this.messages.push(payload);
      }
      this.#changed.emit("changed");
    });
    stream.on("close", () => {
      this.closed = true;
      this.#changed.emit("changed");
    });
    stream.on("error", () => stream.destroy());
  }

  send(data: RelayV2TunnelMessage): void {
    for (const frame of encodeTeamV2Payload(data, Number.POSITIVE_INFINITY)) {
      this.stream.write(encodeRelayV2TunnelRecord(frame));
    }
  }

  next<T>(description: string, pick: (message: RelayV2TunnelMessage) => T | null): Promise<T> {
    return until<T>(description, (done) => {
      const look = () => {
        for (const message of this.messages) {
          let value: T | null = null;
          try {
            value = pick(message);
          } catch {
            value = null;
          }
          if (value !== null) {
            done(value);
            return;
          }
        }
      };
      this.#changed.on("changed", look);
      look();
      return () => this.#changed.off("changed", look);
    });
  }
}

const work = mkdtempSync(join(tmpdir(), "openbot-relay-tunnel-encryption-e2e-"));
const dataDirectory = join(work, "data");
const storeDirectory = join(work, "stores");
const hostData = join(work, "host");
const fakeHome = join(work, "home");
const fakeCodex = join(work, "codex");
const fakeCodexLog = join(work, "codex.jsonl");
mkdirSync(storeDirectory);
mkdirSync(fakeHome);
mkdirSync(OUT, { recursive: true });
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
      const item = { type: "agentMessage", id: "message-" + turnId, text: "Encrypted reply " + turnId, phase: "final_answer" };
      write({ method: "item/completed", params: { threadId: params.threadId, turnId, item } });
      return write({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: turnId, status: "completed" } } });
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
const { TeamStore } = await import("../src/main/team-store");

const [relayPort, healthPort] = await Promise.all([freePort(), freePort()]);
const realRelayUrl = `wss://127.0.0.1:${relayPort}${RELAY_PATH}`;
const environment = {
  RELAY_DATA_DIR: dataDirectory,
  RELAY_HOST: "127.0.0.1",
  RELAY_PORT: String(relayPort),
  RELAY_HEALTH_PORT: String(healthPort),
  RELAY_PUBLIC_URL: realRelayUrl,
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
const localOwner: LocalProfile = { id: "local-profile-e2e", name: "Host Person", chatColor: null };

const throughput: { desktop: MeasuredTransfer | null; noble: MeasuredTransfer | null } = {
  desktop: null,
  noble: null,
};
const observed: Observed = {};
let relay: Relay | null = null;
let mitm: MitmRelay | null = null;
const echoHosts: EchoHost[] = [];
const closers: Array<() => void> = [];
let database: OpenBotDatabaseInstance | null = null;
let agents: AgentServiceInstance | null = null;
let host: HostServiceInstance | null = null;

try {
  await check("The certificate commands make a root, a server certificate and a team", () => {
    assert.equal(command(environment, "ca", "init").status, 0);
    assert.equal(command(environment, "ca", "server", "--dns", "localhost", "--ip", "127.0.0.1").status, 0);
    assert.equal(command(environment, "ca", "team", "add", TEAM).status, 0);
  });

  const hostBundle = issue(environment, work, HOST_USER, "server");
  const aliceBundle = issue(environment, work, "alice", "laptop");
  const echoBundle = issue(environment, work, "echo", "box");
  const phoneBundle = issue(environment, work, "phone-user", "phone");
  const hostKeyId = keyIdOf(hostBundle);
  const echoKeyId = keyIdOf(echoBundle);
  const aliceKeyId = keyIdOf(aliceBundle);
  const phoneKeyId = keyIdOf(phoneBundle);
  const serverTls = {
    cert: readFileSync(join(dataDirectory, "tls/server.crt"), "utf8"),
    key: readFileSync(join(dataDirectory, "tls/server.key"), "utf8"),
  };
  const middle = new MitmRelay(serverTls, { certificate: serverTls.cert, privateKey: createPrivateKey(serverTls.key) });
  await middle.start();
  mitm = middle;
  relay = await startRelay(environment);

  const store = async (name: string, bundle: RelayIdentityBundle, relayUrl: string) => {
    const identity = new RelayIdentityStore({ path: join(storeDirectory, `${name}.json`), cipher: testCipher });
    await ok(identity.importBundle({ ...bundle, relayUrl }));
    return identity;
  };
  const hostStore = await store("host", hostBundle, middle.url);
  const aliceStore = await store("alice", aliceBundle, middle.url);
  const aliceDialer = new RelayDialer({ identity: aliceStore });
  const echo = new EchoHost(await store("echo", echoBundle, middle.url), "echo");
  echoHosts.push(echo);
  await echo.start();
  const realEcho = new EchoHost(await store("echo-real", echoBundle, realRelayUrl), "hash");
  echoHosts.push(realEcho);
  await realEcho.start();

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
      name: "Encrypted relay fixture",
      description: "Synthetic agent for the relay encryption check",
      avatarSeed: "relay-tunnel-encryption",
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
    logDirectory: join(work, "logs"),
  });
  host = hostService;
  await ok(hostService.startRelayHosting(hostStore, { reconnect: { baseMs: 100, maxMs: 500 } }));
  await until<void>("the host is online at the relay in the middle", (done) => {
    const listener = () => {
      if (hostService.getStatus().apiOnline) done();
    };
    hostService.on("changed", listener);
    listener();
    return () => hostService.off("changed", listener);
  });

  const tunnelsOf = (clientKeyId: string, targetKeyId: string, from: number) =>
    middle.tunnels
      .slice(from)
      .filter((tunnel) => tunnel.clientKeyId === clientKeyId && tunnel.hostKeyId === targetKeyId);

  await check(
    "A desktop HTTP client signs in and moves a file through the relay, which sees no plaintext",
    async () => {
      const from = middle.tunnels.length;
      const fetcher = createRelayFetch({ dialer: aliceDialer, target: hostKeyId });
      closers.push(fetcher.close);
      const headers = (token: string | null) => ({
        [TEAM_PROTOCOL_VERSION_HEADER]: String(TEAM_PROTOCOL_V10),
        [TEAM_APP_VERSION_HEADER]: APP_VERSION,
        ...teamCapabilityHeaders(TEAM_PROTOCOL_V10, TEAM_CURRENT_CAPABILITIES),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      });
      const signIn = await deadline(
        "the relay sign-in",
        fetcher.fetch(`${fetcher.origin}${TEAM_API_ROUTES.auth.relay}`, { method: "POST", headers: headers(null) }),
      );
      assert.equal(signIn.status, 200);
      const token = decodeSession(await signIn.json()).sessionToken;
      const fileText = `OPENBOT-SECRET-FILE-CONTENT ${randomBytes(8).toString("hex")} `.repeat(512);
      const uploaded = await deadline(
        "the upload",
        fetcher.fetch(`${fetcher.origin}${TEAM_API_ROUTES.attachments}?name=secret.txt&mime=text%2Fplain`, {
          method: "POST",
          headers: { ...headers(token), "Content-Type": "text/plain" },
          body: fileText,
        }),
      );
      assert.equal(uploaded.status, 201);
      const attachment = decodeAttachment(await uploaded.json());
      const downloaded = await deadline(
        "the download",
        fetcher.fetch(`${fetcher.origin}${TEAM_API_ROUTES.attachment(attachment.id)}`, { headers: headers(token) }),
      );
      assert.equal(await downloaded.text(), fileText);
      observed.desktopHttpBytes = assertNoPlaintext(tunnelsOf(aliceKeyId, hostKeyId, from), [
        "HTTP/1.1",
        "POST ",
        "OPENBOT-SECRET-FILE-CONTENT",
        token,
        "secret.txt",
      ]);
    },
  );

  await check(
    "A V2 client sends a chat message and gets the reply, and the relay sees no V2 marker or text",
    async () => {
      const from = middle.tunnels.length;
      const key = randomBytes(16).toString("hex");
      const opened = await Promise.all(
        RELAY_V2_TUNNEL_CHANNELS.map(async (channel: RelayV2TunnelChannel) => {
          const stream = await ok(aliceDialer.dial(hostKeyId));
          closers.push(() => stream.destroy());
          const tunnel = new V2Tunnel(stream);
          stream.write(encodeRelayV2TunnelMarker({ version: RELAY_V2_TUNNEL_VERSION, channel, connectionKey: key }));
          return tunnel;
        }),
      );
      const [rpc, events] = opened;
      assert.ok(rpc && events);
      await rpc.next("relay-v2-ready", (message) =>
        isString(message) && decodeRelayV2TunnelControl(message)?.type === "relay-v2-ready" ? true : null,
      );
      events.send(encodeTeamProtocolV2Frame({ version: 2, type: "event-ack", throughSequence: 0 }));
      const text = `Secret chat text ${randomBytes(6).toString("hex")}`;
      const reply = events.next("the reply of the agent", (message) => {
        if (!isString(message)) return null;
        const frame = decodeTeamProtocolV2EventFrame(message);
        const json = frame.type === "event" ? JSON.stringify(frame.payload) : "";
        const match = /Encrypted reply turn-[0-9]+-[0-9]+/u.exec(json);
        return match ? match[0] : null;
      });
      const requestId = `request-${randomBytes(6).toString("hex")}`;
      const body: TeamProtocolV2Json = { agentId: fixture.id, text, timezone: "UTC" };
      rpc.send(
        encodeTeamProtocolV2Frame({
          version: 2,
          type: "request",
          requestId,
          operation: "http.request",
          payload: {
            method: "POST",
            path: TEAM_API_ROUTES.agent.messages(fixture.id),
            body,
            ...encodeTeamCapabilitiesV10(TEAM_CURRENT_CAPABILITIES),
          },
        }),
      );
      const status = await rpc.next("the answer to the message", (message) => {
        if (!isString(message)) return null;
        const frame = decodeTeamProtocolV2RpcFrame(message);
        if (frame.type !== "response" || frame.requestId !== requestId) return null;
        return "result" in frame && isDynamicRecord(frame.result) && isNumber(frame.result.status)
          ? frame.result.status
          : -1;
      });
      assert.ok(status >= 200 && status < 300, `The message answer was ${status}.`);
      const replyText = await reply;
      assert.ok(readFileSync(fakeCodexLog, "utf8").includes(text), "The provider did not get the message.");
      for (const tunnel of opened) tunnel.stream.destroy();
      observed.v2Bytes = assertNoPlaintext(tunnelsOf(aliceKeyId, hostKeyId, from), [
        "OPENBOT-V2",
        "relay-v2-ready",
        text,
        replyText,
        "http.request",
      ]);
    },
  );

  await check(
    "A phone with noble crypto and no crypto.subtle uses V2 tunnels and the relay sees no plaintext",
    async () => {
      const from = middle.tunnels.length;
      const configPath = join(work, "phone.json");
      const out = join(work, "phone-result.json");
      writeFileSync(
        configPath,
        JSON.stringify({
          mitmIdentityText: JSON.stringify({ ...phoneBundle, relayUrl: middle.url }),
          realIdentityText: JSON.stringify({ ...phoneBundle, relayUrl: realRelayUrl }),
          hostKeyId,
          echoKeyId,
          serverRoot: phoneBundle.root,
          transferBytes: TRANSFER_BYTES,
          waitMs: WAIT_MS * 2,
          out,
        }),
      );
      const child = spawn(process.execPath, ["--import", "tsx", PHONE, configPath], {
        cwd: ROOT,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const log: string[] = [];
      child.stdout.on("data", (chunk: Buffer) => log.push(chunk.toString()));
      child.stderr.on("data", (chunk: Buffer) => log.push(chunk.toString()));
      const [code] = await deadline("the phone process", once(child, "exit"));
      assert.equal(code, 0, log.join(""));
      const result = decodePhoneResult(readFileSync(out, "utf8"));
      observed.phone = result;
      assert.equal(result.subtleMissing, true);
      for (const entry of result.checks) assert.ok(entry.passed, inspect(entry));
      assert.equal(result.meStatus, 200);
      throughput.noble = result.throughput;
      const phoneTunnels = tunnelsOf(phoneKeyId, hostKeyId, from);
      assert.equal(phoneTunnels.length, RELAY_V2_TUNNEL_CHANNELS.length);
      observed.phoneBytes = assertNoPlaintext(phoneTunnels, ["OPENBOT-V2", "relay-v2-ready", "http.request", "/v1/me"]);
    },
  );

  await check(
    "A changed byte from the client closes the tunnel with the integrity error, and the app gets no data",
    async () => {
      const before = echo.streams.length;
      middle.tamperNext({ flipClientToHostAt: HELLO_FRAME_BYTES + FINISH_FRAME_BYTES + FIRST_RECORD_TAMPER_OFFSET });
      const stream = await ok(aliceDialer.dial(echoKeyId));
      const ended = untilStreamEnds(stream);
      stream.write("first application bytes");
      const entry = await echo.until("the echo host closes the changed tunnel", () => {
        const candidate = echo.streams[before];
        return candidate?.closed ? candidate : null;
      });
      assert.equal(entry.error, "tunnel_integrity_failed");
      assert.equal(entry.received, 0);
      const end = await ended;
      assert.equal(end.data.byteLength, 0);
    },
  );

  await check("A changed byte from the host closes the tunnel on the client with the integrity error", async () => {
    middle.tamperNext({ flipHostToClientAt: REPLY_FRAME_BYTES + FIRST_RECORD_TAMPER_OFFSET });
    const stream = await ok(aliceDialer.dial(echoKeyId));
    const ended = untilStreamEnds(stream);
    stream.write("echo me");
    const end = await ended;
    assert.equal(end.error, "tunnel_integrity_failed");
    assert.equal(end.data.byteLength, 0);
  });

  const refusedDial = async (mode: TamperMode) => {
    const before = echo.streams.length;
    const refusals = echo.refusals.length;
    const from = middle.tunnels.length;
    middle.tamperNext(mode);
    const error = await failureOf(aliceDialer.dial(echoKeyId));
    const [tunnel] = middle.tunnels.slice(from);
    assert.ok(tunnel, "The relay in the middle saw no tunnel.");
    await middle.untilClosed(tunnel);
    await echo.until("the echo host drops the tunnel", () => echo.refusals[refusals] ?? null);
    assert.equal(echo.streams.length, before, "The echo host must not get a stream.");
    return codeOf(error);
  };

  await check("A relay that replaces the host's ephemeral key is refused by the client", async () => {
    assert.equal(await refusedDial({ replaceHostEphemeral: true }), "tunnel_peer_unverified");
  });

  await check("A relay that replays an old reply of the host is refused by the client", async () => {
    const from = middle.tunnels.length;
    const index = echo.streams.length;
    const stream = await ok(aliceDialer.dial(echoKeyId));
    stream.write("ping");
    await echo.until("the echo host gets bytes", () => (echo.streams[index]?.received ? true : null));
    stream.destroy();
    const [earlier] = middle.tunnels.slice(from);
    const reply = earlier?.hostToClient[0]?.subarray(0, REPLY_FRAME_BYTES);
    assert.ok(reply && reply.byteLength === REPLY_FRAME_BYTES, "No reply was recorded.");
    assert.equal(await refusedDial({ replayReply: Buffer.from(reply) }), "tunnel_peer_unverified");
  });

  await check("A relay that splices a tunnel into another connection identifier is refused", async () => {
    assert.equal(await refusedDial({ splice: true }), "tunnel_peer_unverified");
  });

  await check("A peer that sends plain HTTP with no handshake is refused by the host and gets no answer", async () => {
    const plainRequest = Buffer.from("GET /v1/compatibility HTTP/1.1\r\nHost: relay\r\n\r\n");
    const sendPlain = async (target: string) => {
      const from = middle.tunnels.length;
      const { socket } = await ok(openRelayTunnelSocket(aliceStore, { role: "client", target, waitForTarget: false }));
      const closed = until<void>("the plain tunnel closes", (done) => {
        socket.attach({ message: () => {}, binary: () => {}, closed: () => done() });
        return () => {};
      });
      socket.sendBinary(plainRequest, () => {});
      await closed;
      const [tunnel] = middle.tunnels.slice(from);
      assert.ok(tunnel);
      await middle.untilClosed(tunnel);
      assert.equal(tunnel.hostToClientBytes, 0);
    };
    const refusals = echo.refusals.length;
    await sendPlain(echoKeyId);
    assert.equal(
      await echo.until("the echo host refuses the plain tunnel", () => echo.refusals[refusals] ?? null),
      "tunnel_handshake_failed",
    );
    await sendPlain(hostKeyId);
  });

  await check("8 MiB goes from a desktop client to a desktop host through the real relay, encrypted", async () => {
    const aliceReal = new RelayDialer({ identity: await store("alice-real", aliceBundle, realRelayUrl) });
    const stream = await ok(aliceReal.dial(echoKeyId));
    const payload = randomBytes(TRANSFER_BYTES);
    const started = performance.now();
    const line = readLine(stream);
    const chunkBytes = 64 * 1024;
    for (let offset = 0; offset < payload.byteLength; offset += chunkBytes) {
      if (!stream.write(payload.subarray(offset, offset + chunkBytes))) await once(stream, "drain");
    }
    assert.equal(await line, sha256(payload));
    const milliseconds = performance.now() - started;
    stream.destroy();
    throughput.desktop = {
      bytes: TRANSFER_BYTES,
      milliseconds: Math.round(milliseconds),
      mebibytesPerSecond: Number((TRANSFER_BYTES / 1024 / 1024 / (milliseconds / 1000)).toFixed(2)),
    };
  });
} finally {
  for (const close of closers.splice(0)) close();
  for (const echoHost of echoHosts) await echoHost.stop().catch(() => undefined);
  if (host) await runCauseEffect(host.shutdown()).catch(() => undefined);
  if (agents) await runCauseEffect(agents.stop()).catch(() => undefined);
  database?.close();
  mitm?.stop();
  relay?.child.kill("SIGKILL");
  if (relay) await relay.exited;
}

const failed = checks.filter((entry) => !entry.passed);
const report = {
  passed: failed.length === 0,
  runtime: `node ${process.version}`,
  checks,
  throughput,
  observed,
};
writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
rmSync(work, { recursive: true, force: true });
for (const entry of checks) {
  process.stdout.write(
    `${entry.passed ? "PASS" : "FAIL"} ${entry.name}${entry.error ? `\n     ${entry.error}` : ""}\n`,
  );
}
process.stdout.write(`Throughput: ${JSON.stringify(throughput)}\n`);
process.stdout.write(`Report: ${join(OUT, "report.json")}\n`);
process.exit(failed.length === 0 ? 0 : 1);
