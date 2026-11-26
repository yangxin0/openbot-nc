import { EventEmitter } from "node:events";
import type { Duplex } from "node:stream";
import type { RelayPeerCertificate } from "@openbot/contracts/relay-protocol/messages";
import {
  encodeRelayV2Chunks,
  encodeRelayV2TunnelControl,
  encodeRelayV2TunnelRecord,
  RELAY_V2_TUNNEL_CHANNELS,
  RELAY_V2_TUNNEL_VERSION,
  RelayV2ChunkDecoder,
  type RelayV2RefusalCode,
  type RelayV2TunnelChannel,
} from "@openbot/contracts/relay-protocol/v2-tunnel";
import { RelayV2ChannelWriter } from "@openbot/team-client/relay-v2-channels";
import { encodeTeamV2Payload, TeamV2PayloadDecoder } from "@openbot/team-client/v2-framing";
import { Effect, Fiber, Result } from "effect";
import type { RelaySendProgress } from "./relay/stream";
import { RemoteWorkflowError } from "./remote-service-effects";
import { type TeamStore, TeamStoreError } from "./team-store";
import type { TeamV2Channel, TeamV2ChannelTransport, TeamV2ChannelTransportEvents } from "./team-v2-channel-transport";
import { TeamV2HostPeer } from "./team-v2-host-peer";

const CONNECTIONS_PER_PEER = 8;
const CONNECTIONS_LIMIT = 64;
const CHANNEL_QUEUE_LOW_BYTES = 256 * 1024;

interface RelayV2SessionServer {
  readonly port: number | null;
  bindRelaySession(sessionId: string, peer: RelayPeerCertificate): void;
  releaseRelaySession(sessionId: string): void;
}

interface RelayV2TunnelHostOptions {
  store: TeamStore;
  server: RelayV2SessionServer;
  appVersion: string;
  transferDirectory: string;
  closeSession?: (sessionId: string) => Effect.Effect<void, RemoteWorkflowError>;
}

interface RelayV2Session {
  id: string;
  token: string;
}

type RelayV2ConnectionState = "opening" | "ready" | "closed";

class RelayV2Connection extends EventEmitter<TeamV2ChannelTransportEvents> implements TeamV2ChannelTransport {
  readonly peerId: string;
  readonly writer: RelayV2ChannelWriter;
  readonly #chunks = new RelayV2ChunkDecoder();
  readonly #payloads = new Map<RelayV2TunnelChannel, TeamV2PayloadDecoder>(
    RELAY_V2_TUNNEL_CHANNELS.map((channel) => [channel, new TeamV2PayloadDecoder()]),
  );
  #rest: Uint8Array;
  state: RelayV2ConnectionState = "opening";
  hostPeer: TeamV2HostPeer | null = null;
  session: RelayV2Session | null = null;

  constructor(
    readonly key: number,
    readonly peer: RelayPeerCertificate,
    readonly stream: Duplex,
    progress: RelaySendProgress,
    rest: Uint8Array,
    readonly disconnect: (connection: RelayV2Connection) => void,
  ) {
    super();
    this.peerId = `relay-v2:${key}`;
    this.#rest = rest;
    this.writer = new RelayV2ChannelWriter({
      write: (bytes) => {
        if (stream.writable) stream.write(bytes);
      },
      queuedBytes: () => progress.queuedBytes(),
      unacknowledgedBytes: () => progress.unacknowledgedBytes(),
      onProgress: (listener) => progress.onProgress(listener),
    });
  }

  send(peerId: string, channel: TeamV2Channel, data: string | ArrayBuffer): Effect.Effect<void, RemoteWorkflowError> {
    return Effect.suspend(() => {
      const name = relayChannel(channel);
      if (peerId !== this.peerId || this.state !== "ready" || !name || !this.stream.writable) {
        return Effect.fail(new RemoteWorkflowError({ cause: new Error("The relay tunnel is not open.") }));
      }
      return Effect.try({
        try: () => encodeTeamV2Payload(data, Number.POSITIVE_INFINITY).map(encodeRelayV2TunnelRecord),
        catch: (cause) => new RemoteWorkflowError({ cause }),
      }).pipe(Effect.flatMap((records) => this.#enqueue(name, records)));
    });
  }

  disconnectPeer(peerId: string): Effect.Effect<void, RemoteWorkflowError> {
    return Effect.sync(() => {
      if (peerId === this.peerId) this.disconnect(this);
    });
  }

  read(): void {
    const rest = this.#rest;
    this.#rest = new Uint8Array(0);
    if (rest.byteLength > 0) this.#receive(rest);
    this.stream.on("data", (chunk: Buffer) => this.#receive(chunk));
    this.stream.resume();
  }

  #enqueue(channel: RelayV2TunnelChannel, records: readonly Uint8Array[]): Effect.Effect<void, RemoteWorkflowError> {
    for (const record of records) this.writer.enqueue(channel, record);
    if (this.writer.bufferedAmount(channel) <= CHANNEL_QUEUE_LOW_BYTES) return Effect.void;
    return Effect.callback<void, RemoteWorkflowError>((resume) => {
      const release = () => {
        stopProgress();
        this.stream.off("close", check);
      };
      const check = () => {
        if (this.state === "closed" || !this.stream.writable) {
          release();
          resume(Effect.fail(new RemoteWorkflowError({ cause: new Error("The relay tunnel closed.") })));
        } else if (this.writer.bufferedAmount(channel) <= CHANNEL_QUEUE_LOW_BYTES) {
          release();
          resume(Effect.void);
        }
      };
      const stopProgress = this.writer.onProgress(check);
      this.stream.once("close", check);
      return Effect.sync(release);
    });
  }

  #receive(bytes: Uint8Array): void {
    if (this.state !== "ready") return;
    const payloads: Array<{ channel: RelayV2TunnelChannel; payload: string | ArrayBuffer }> = [];
    try {
      for (const { channel, message } of this.#chunks.push(bytes)) {
        const payload = this.#payloads.get(channel)?.push(message);
        if (payload !== undefined) payloads.push({ channel, payload });
      }
    } catch {
      this.disconnect(this);
      return;
    }
    for (const { channel, payload } of payloads) {
      if (this.state !== "ready") return;
      this.emit("data", this.peerId, channel, payload);
    }
  }
}

export class RelayV2TunnelHost {
  readonly #options: RelayV2TunnelHostOptions;
  readonly #connections = new Map<number, RelayV2Connection>();
  readonly #operations = new Set<Fiber.Fiber<void>>();
  #stopped = false;
  #nextKey = 0;

  constructor(options: RelayV2TunnelHostOptions) {
    this.#options = options;
  }

  accept(stream: Duplex, progress: RelaySendProgress, peer: RelayPeerCertificate, rest: Uint8Array): void {
    if (this.#stopped) {
      refuse(stream, "host_unavailable");
      return;
    }
    const fromPeer = [...this.#connections.values()].filter((connection) => connection.peer.keyId === peer.keyId);
    if (fromPeer.length >= CONNECTIONS_PER_PEER || this.#connections.size >= CONNECTIONS_LIMIT) {
      refuse(stream, "too_many_connections");
      return;
    }
    this.#nextKey += 1;
    const connection = new RelayV2Connection(this.#nextKey, peer, stream, progress, rest, (closing) =>
      this.#close(closing, null),
    );
    this.#connections.set(connection.key, connection);
    stream.once("close", () => this.#close(connection, null));
    this.#run(
      this.#open(connection).pipe(
        Effect.catchCause(() => Effect.sync(() => this.#close(connection, "host_unavailable"))),
      ),
    );
  }

  revokeSession(sessionId: string): Effect.Effect<void> {
    return Effect.sync(() => {
      for (const connection of [...this.#connections.values()]) {
        if (connection.session?.id === sessionId) this.#close(connection, "session_revoked");
      }
    });
  }

  hasActiveTransfers(): boolean {
    return [...this.#connections.values()].some((connection) => connection.hostPeer?.hasActiveTransfers() ?? false);
  }

  readonly stop = Effect.fn("RelayV2TunnelHost.stop")(function* (this: RelayV2TunnelHost) {
    this.#stopped = true;
    for (const connection of [...this.#connections.values()]) this.#close(connection, "host_unavailable");
    yield* Fiber.awaitAll([...this.#operations]);
  }).bind(this);

  readonly #open = Effect.fn("RelayV2TunnelHost.open")(function* (
    this: RelayV2TunnelHost,
    connection: RelayV2Connection,
  ) {
    const { store, server } = this.#options;
    const login = yield* Effect.result(
      store.loginWithRelayPeer({
        keyId: connection.peer.keyId,
        user: connection.peer.user,
        device: connection.peer.device,
      }),
    );
    if (Result.isFailure(login)) {
      this.#close(connection, "sign_in_refused", refusalMessage(login.failure.cause));
      return;
    }
    const { member, sessionToken, sessionExpiresAt } = login.success;
    const sessionId = store.authenticateSession(sessionToken)?.sessionId ?? null;
    const port = server.port;
    if (connection.state !== "opening" || sessionId === null || port === null) {
      yield* store.logout(sessionToken).pipe(Effect.ignore);
      this.#close(connection, "host_unavailable");
      return;
    }
    connection.session = { id: sessionId, token: sessionToken };
    server.bindRelaySession(sessionId, connection.peer);
    const hostPeer = new TeamV2HostPeer(
      { store, appVersion: this.#options.appVersion, transferDirectory: this.#options.transferDirectory },
      {
        peerId: connection.peerId,
        localApiPort: port,
        transport: connection,
      },
    );
    connection.hostPeer = hostPeer;
    yield* hostPeer.adoptSession({
      sessionId,
      sessionToken,
      membershipId: member.id,
      expiresAt: Date.parse(sessionExpiresAt),
    });
    if (connection.state !== "opening") return;
    connection.state = "ready";
    yield* connection.send(
      connection.peerId,
      "rpc",
      encodeRelayV2TunnelControl({ type: "relay-v2-ready", version: RELAY_V2_TUNNEL_VERSION }),
    );
    connection.read();
  });

  #close(connection: RelayV2Connection, refusal: RelayV2RefusalCode | null, message: string | null = null): void {
    if (connection.state === "closed") return;
    connection.state = "closed";
    if (this.#connections.get(connection.key) === connection) this.#connections.delete(connection.key);
    connection.writer.close();
    if (refusal) refuse(connection.stream, refusal, message);
    else connection.stream.destroy();
    const { hostPeer, session } = connection;
    connection.hostPeer = null;
    connection.session = null;
    if (hostPeer) connection.emit("disconnected", connection.peerId);
    if (hostPeer || session) this.#run(this.#release(hostPeer, session));
  }

  readonly #release = Effect.fn("RelayV2TunnelHost.release")(function* (
    this: RelayV2TunnelHost,
    hostPeer: TeamV2HostPeer | null,
    session: RelayV2Session | null,
  ) {
    if (hostPeer) yield* hostPeer.dispose();
    if (!session) return;
    this.#options.server.releaseRelaySession(session.id);
    if (this.#options.closeSession) yield* this.#options.closeSession(session.id).pipe(Effect.ignore);
    yield* this.#options.store.logout(session.token).pipe(Effect.ignore);
  });

  #run(operation: Effect.Effect<void>): void {
    const fiber = Effect.runFork(operation);
    this.#operations.add(fiber);
    fiber.addObserver(() => this.#operations.delete(fiber));
  }
}

function refuse(stream: Duplex, code: RelayV2RefusalCode, message: string | null = null): void {
  if (!stream.writable) {
    stream.destroy();
    return;
  }
  const control = encodeRelayV2TunnelControl({
    type: "relay-v2-refused",
    version: RELAY_V2_TUNNEL_VERSION,
    code,
    message,
  });
  for (const chunk of encodeRelayV2Chunks("rpc", encodeRelayV2TunnelRecord(control))) stream.write(chunk);
  stream.end();
  stream.resume();
}

function refusalMessage(cause: unknown): string | null {
  return cause instanceof TeamStoreError && cause.message ? cause.message.slice(0, 500) : null;
}

function relayChannel(channel: TeamV2Channel): RelayV2TunnelChannel | undefined {
  return RELAY_V2_TUNNEL_CHANNELS.find((name) => name === channel);
}
