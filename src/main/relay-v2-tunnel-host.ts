import { EventEmitter } from "node:events";
import type { Duplex } from "node:stream";
import type { RelayPeerCertificate } from "@openbot/contracts/relay-protocol/messages";
import {
  encodeRelayV2TunnelControl,
  encodeRelayV2TunnelRecord,
  RELAY_V2_CONNECTION_DEADLINE_MS,
  RELAY_V2_TUNNEL_CHANNELS,
  RELAY_V2_TUNNEL_VERSION,
  type RelayV2RefusalCode,
  type RelayV2TunnelChannel,
  type RelayV2TunnelMarker,
  RelayV2TunnelRecordDecoder,
} from "@openbot/contracts/relay-protocol/v2-tunnel";
import { encodeTeamV2Payload, TeamV2PayloadDecoder } from "@openbot/team-client/v2-framing";
import { Effect, Fiber, Result } from "effect";
import { RemoteWorkflowError } from "./remote-service-effects";
import { type TeamStore, TeamStoreError } from "./team-store";
import type { TeamV2Channel, TeamV2ChannelTransport, TeamV2ChannelTransportEvents } from "./team-v2-channel-transport";
import { TeamV2HostPeer } from "./team-v2-host-peer";

const CONNECTIONS_PER_PEER = 8;
const CONNECTIONS_LIMIT = 64;

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
  connectionDeadlineMs?: number;
}

interface RelayV2Tunnel {
  channel: RelayV2TunnelChannel;
  stream: Duplex;
  rest: Uint8Array;
  records: RelayV2TunnelRecordDecoder;
  payloads: TeamV2PayloadDecoder;
}

interface RelayV2Session {
  id: string;
  token: string;
}

type RelayV2ConnectionState = "gathering" | "opening" | "ready" | "closed";

class RelayV2Connection extends EventEmitter<TeamV2ChannelTransportEvents> implements TeamV2ChannelTransport {
  readonly tunnels = new Map<RelayV2TunnelChannel, RelayV2Tunnel>();
  readonly peerId: string;
  state: RelayV2ConnectionState = "gathering";
  timer: ReturnType<typeof setTimeout> | null = null;
  hostPeer: TeamV2HostPeer | null = null;
  session: RelayV2Session | null = null;

  constructor(
    readonly key: string,
    readonly peer: RelayPeerCertificate,
    readonly disconnect: (connection: RelayV2Connection) => void,
  ) {
    super();
    this.peerId = `relay-v2:${key}`;
  }

  send(peerId: string, channel: TeamV2Channel, data: string | ArrayBuffer): Effect.Effect<void, RemoteWorkflowError> {
    return Effect.suspend(() => {
      const name = relayChannel(channel);
      const tunnel = peerId === this.peerId && this.state === "ready" && name ? this.tunnels.get(name) : undefined;
      if (!tunnel?.stream.writable) {
        return Effect.fail(new RemoteWorkflowError({ cause: new Error("The relay tunnel is not open.") }));
      }
      return Effect.try({
        try: () => encodeTeamV2Payload(data, Number.POSITIVE_INFINITY).map(encodeRelayV2TunnelRecord),
        catch: (cause) => new RemoteWorkflowError({ cause }),
      }).pipe(Effect.flatMap((records) => writeRecords(tunnel.stream, records)));
    });
  }

  disconnectPeer(peerId: string): Effect.Effect<void, RemoteWorkflowError> {
    return Effect.sync(() => {
      if (peerId === this.peerId) this.disconnect(this);
    });
  }

  read(): void {
    for (const tunnel of this.tunnels.values()) {
      const rest = tunnel.rest;
      tunnel.rest = new Uint8Array(0);
      if (rest.byteLength > 0) this.#receive(tunnel, rest);
      tunnel.stream.on("data", (chunk: Buffer) => this.#receive(tunnel, chunk));
      tunnel.stream.resume();
    }
  }

  #receive(tunnel: RelayV2Tunnel, bytes: Uint8Array): void {
    if (this.state !== "ready") return;
    const payloads: Array<string | ArrayBuffer> = [];
    try {
      for (const message of tunnel.records.push(bytes)) {
        const payload = tunnel.payloads.push(message);
        if (payload !== undefined) payloads.push(payload);
      }
    } catch {
      this.disconnect(this);
      return;
    }
    for (const payload of payloads) {
      if (this.state !== "ready") return;
      this.emit("data", this.peerId, tunnel.channel, payload);
    }
  }
}

export class RelayV2TunnelHost {
  readonly #options: RelayV2TunnelHostOptions;
  readonly #connections = new Map<string, RelayV2Connection>();
  readonly #operations = new Set<Fiber.Fiber<void>>();
  #stopped = false;

  constructor(options: RelayV2TunnelHostOptions) {
    this.#options = options;
  }

  accept(stream: Duplex, peer: RelayPeerCertificate, marker: RelayV2TunnelMarker, rest: Uint8Array): void {
    const existing = this.#connections.get(marker.connectionKey);
    const connection = this.#stopped ? null : (existing ?? this.#startConnection(marker.connectionKey, peer));
    const refusal = admissionRefusal(this.#stopped, existing, connection, peer, marker);
    if (refusal || !connection) {
      refuse(stream, refusal ?? "too_many_connections");
      return;
    }
    connection.tunnels.set(marker.channel, {
      channel: marker.channel,
      stream,
      rest,
      records: new RelayV2TunnelRecordDecoder(),
      payloads: new TeamV2PayloadDecoder(),
    });
    stream.once("close", () => this.#close(connection, null));
    if (connection.tunnels.size === RELAY_V2_TUNNEL_CHANNELS.length) {
      this.#run(
        this.#open(connection).pipe(
          Effect.catchCause(() => Effect.sync(() => this.#close(connection, "host_unavailable"))),
        ),
      );
    }
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

  #startConnection(key: string, peer: RelayPeerCertificate): RelayV2Connection | null {
    const fromPeer = [...this.#connections.values()].filter((connection) => connection.peer.keyId === peer.keyId);
    if (fromPeer.length >= CONNECTIONS_PER_PEER || this.#connections.size >= CONNECTIONS_LIMIT) return null;
    const connection = new RelayV2Connection(key, peer, (closing) => this.#close(closing, null));
    connection.timer = setTimeout(
      () => this.#close(connection, "connection_incomplete"),
      this.#options.connectionDeadlineMs ?? RELAY_V2_CONNECTION_DEADLINE_MS,
    );
    connection.timer.unref();
    this.#connections.set(key, connection);
    return connection;
  }

  readonly #open = Effect.fn("RelayV2TunnelHost.open")(function* (
    this: RelayV2TunnelHost,
    connection: RelayV2Connection,
  ) {
    connection.state = "opening";
    if (connection.timer) clearTimeout(connection.timer);
    connection.timer = null;
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
    if (connection.timer) clearTimeout(connection.timer);
    connection.timer = null;
    if (this.#connections.get(connection.key) === connection) this.#connections.delete(connection.key);
    for (const tunnel of connection.tunnels.values()) {
      if (refusal) refuse(tunnel.stream, refusal, message);
      else tunnel.stream.destroy();
    }
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
  stream.end(encodeRelayV2TunnelRecord(control));
  stream.resume();
}

function admissionRefusal(
  stopped: boolean,
  existing: RelayV2Connection | undefined,
  connection: RelayV2Connection | null,
  peer: RelayPeerCertificate,
  marker: RelayV2TunnelMarker,
): RelayV2RefusalCode | null {
  if (stopped) return "host_unavailable";
  if (existing && existing.peer.keyId !== peer.keyId) return "different_peer";
  if (existing && (existing.state !== "gathering" || existing.tunnels.has(marker.channel))) return "duplicate_channel";
  return connection ? null : "too_many_connections";
}

function refusalMessage(cause: unknown): string | null {
  return cause instanceof TeamStoreError && cause.message ? cause.message.slice(0, 500) : null;
}

function relayChannel(channel: TeamV2Channel): RelayV2TunnelChannel | undefined {
  return RELAY_V2_TUNNEL_CHANNELS.find((name) => name === channel);
}

function writeRecords(stream: Duplex, records: readonly Uint8Array[]): Effect.Effect<void, RemoteWorkflowError> {
  return Effect.callback<void, RemoteWorkflowError>((resume) => {
    let flowing = true;
    for (const record of records) flowing = stream.write(record);
    if (flowing) {
      resume(Effect.void);
      return;
    }
    const onDrain = () => {
      release();
      resume(Effect.void);
    };
    const onClose = () => {
      release();
      resume(Effect.fail(new RemoteWorkflowError({ cause: new Error("The relay tunnel closed.") })));
    };
    function release(): void {
      stream.off("drain", onDrain);
      stream.off("close", onClose);
    }
    stream.once("drain", onDrain);
    stream.once("close", onClose);
    return Effect.sync(release);
  });
}
