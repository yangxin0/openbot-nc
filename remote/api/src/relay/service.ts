import { randomBytes } from "node:crypto";
import {
  RELAY_ACCEPT_DEADLINE_MS,
  RELAY_CLOSE_CODES,
  RELAY_CONTROL_MESSAGE_BYTES_LIMIT,
  RELAY_HELLO_DEADLINE_MS,
  RELAY_PROTOCOL_VERSION,
  RELAY_TEAM_MEMBERS_LIMIT,
  type RelayErrorCode,
  type RelayServerMessage,
  type RelayTeamMember,
} from "@openbot/contracts/relay-protocol/messages";
import { isRevoked, peerCertificate, type RelayIdentity, type RelayTrust, verifyRelayProof } from "./identity";
import { type DecodedRelayClientMessage, decodeRelayClientMessage, encodeRelayServerMessage } from "./protocol";
import { type RelayServerIdentity, serverProofMessage } from "./server-identity";

export interface RelaySocket {
  readonly id: string;
  readonly ip: string;
  sendText(message: string): void;
  sendBinary(data: Uint8Array): void;
  bufferedBytes(): number;
  pauseReading(): void;
  resumeReading(): void;
  close(code: number, reason: string): void;
}

export interface RelayLimits {
  socketsPerIp: number;
  tunnelsPerMember: number;
  pendingPerTarget: number;
  presenceUpdatesPerMinute: number;
  highWaterBytes: number;
}

interface RelayMetrics {
  sockets: number;
  teams: number;
  members: number;
  tunnels: number;
  pendingConnections: number;
}

type Deadline = ReturnType<typeof setTimeout>;
type Hello = Extract<DecodedRelayClientMessage, { type: "hello" }>;
type Presence = Extract<DecodedRelayClientMessage, { type: "presence" }>;

interface ChallengePhase {
  kind: "challenge";
  nonce: string;
  deadline: Deadline;
}

interface MemberPhase {
  kind: "member";
  identity: RelayIdentity;
  hosting: boolean;
  label: string | null;
  connectedAt: number;
  presenceUpdates: number[];
}

interface WaitingPhase {
  kind: "waiting";
  identity: RelayIdentity;
  target: string;
}

interface PendingPhase {
  kind: "pending";
  identity: RelayIdentity;
  connectionId: string;
}

interface TunnelPhase {
  kind: "tunnel";
  identity: RelayIdentity;
  connectionId: string;
  peerSocketId: string;
  readingPaused: boolean;
}

type Phase = ChallengePhase | MemberPhase | WaitingPhase | PendingPhase | TunnelPhase;

interface SocketState {
  socket: RelaySocket;
  phase: Phase;
}

interface PendingConnection {
  clientSocketId: string;
  teamId: string;
  target: string;
  deadline: Deadline;
}

const PRESENCE_WINDOW_MS = 60_000;
const VERSION = RELAY_PROTOCOL_VERSION;

export class RelayService {
  readonly #sockets = new Map<string, SocketState>();
  readonly #socketsByIp = new Map<string, number>();
  readonly #teams = new Map<string, Map<string, string>>();
  readonly #pending = new Map<string, PendingConnection>();
  readonly #limits: RelayLimits;
  readonly #now: () => number;
  #trust: RelayTrust;
  #serverIdentity: RelayServerIdentity;

  constructor(
    trust: RelayTrust,
    serverIdentity: RelayServerIdentity,
    limits: RelayLimits,
    now: () => number = Date.now,
  ) {
    this.#trust = trust;
    this.#serverIdentity = serverIdentity;
    this.#limits = limits;
    this.#now = now;
  }

  connect(socket: RelaySocket): void {
    const fromSameAddress = (this.#socketsByIp.get(socket.ip) ?? 0) + 1;
    this.#socketsByIp.set(socket.ip, fromSameAddress);
    const nonce = randomBytes(32).toString("base64url");
    const deadline = setTimeout(
      () => this.#fail(socket.id, "authentication_failed", "No certificate proof arrived in time."),
      RELAY_HELLO_DEADLINE_MS,
    );
    this.#sockets.set(socket.id, { socket, phase: { kind: "challenge", nonce, deadline } });
    if (fromSameAddress > this.#limits.socketsPerIp) {
      this.#fail(socket.id, "rate_limited", "Too many connections come from this address.");
      return;
    }
    this.#send(socket, { type: "challenge", version: VERSION, nonce });
  }

  receiveText(socketId: string, text: string): void {
    const state = this.#sockets.get(socketId);
    if (!state) return;
    const message = Buffer.byteLength(text) > RELAY_CONTROL_MESSAGE_BYTES_LIMIT ? null : decodeRelayClientMessage(text);
    if (!message) {
      this.#fail(socketId, "invalid_message", "The message is invalid.");
      return;
    }
    if (state.phase.kind === "challenge" && message.type === "hello") {
      this.#authenticate(state, state.phase, message);
      return;
    }
    if (state.phase.kind === "member" && message.type === "presence") {
      this.#updatePresence(state, state.phase, message);
      return;
    }
    this.#fail(socketId, "protocol_error", "The message is not expected now.");
  }

  receiveBinary(socketId: string, data: Uint8Array): void {
    const state = this.#sockets.get(socketId);
    if (!state) return;
    if (state.phase.kind !== "tunnel") {
      this.#fail(socketId, "protocol_error", "Data is permitted only on an open connection.");
      return;
    }
    const peer = this.#sockets.get(state.phase.peerSocketId);
    if (!peer) return;
    peer.socket.sendBinary(data);
    if (state.phase.readingPaused || peer.socket.bufferedBytes() <= this.#limits.highWaterBytes) return;
    state.phase.readingPaused = true;
    state.socket.pauseReading();
    this.#send(state.socket, { type: "pause", version: VERSION });
  }

  drained(socketId: string): void {
    const state = this.#sockets.get(socketId);
    if (state?.phase.kind !== "tunnel") return;
    const peer = this.#sockets.get(state.phase.peerSocketId);
    if (peer?.phase.kind !== "tunnel" || !peer.phase.readingPaused) return;
    peer.phase.readingPaused = false;
    peer.socket.resumeReading();
    this.#send(peer.socket, { type: "resume", version: VERSION });
  }

  disconnect(socketId: string): void {
    this.#release(socketId);
  }

  applyTrust(trust: RelayTrust): void {
    this.#trust = trust;
    for (const state of [...this.#sockets.values()]) {
      if (state.phase.kind !== "challenge" && isRevoked(state.phase.identity, trust.revoked)) {
        this.#fail(state.socket.id, "certificate_revoked", "The certificate is revoked.");
      }
    }
  }

  applyServerIdentity(serverIdentity: RelayServerIdentity): void {
    this.#serverIdentity = serverIdentity;
  }

  expire(): void {
    const now = this.#now();
    for (const state of [...this.#sockets.values()]) {
      if (state.phase.kind !== "challenge" && state.phase.identity.expiresAt <= now) {
        this.#fail(state.socket.id, "certificate_expired", "The certificate is expired.");
      }
    }
  }

  close(): void {
    for (const state of [...this.#sockets.values()]) {
      this.#release(state.socket.id);
      state.socket.close(RELAY_CLOSE_CODES.unavailable, "The server stops.");
    }
  }

  metrics(): RelayMetrics {
    let members = 0;
    let tunnelSockets = 0;
    for (const state of this.#sockets.values()) {
      if (state.phase.kind === "member") members += 1;
      if (state.phase.kind === "tunnel") tunnelSockets += 1;
    }
    return {
      sockets: this.#sockets.size,
      teams: this.#teams.size,
      members,
      tunnels: tunnelSockets / 2,
      pendingConnections: this.#pending.size,
    };
  }

  #authenticate(state: SocketState, phase: ChallengePhase, hello: Hello): void {
    clearTimeout(phase.deadline);
    const target = hello.role === "client" ? hello.target : undefined;
    const connectionId = hello.role === "accept" ? hello.connectionId : undefined;
    const check = verifyRelayProof(
      {
        nonce: phase.nonce,
        clientNonce: hello.clientNonce,
        audience: hello.audience,
        role: hello.role,
        target,
        connectionId,
        certificate: hello.certificate,
        chain: hello.chain ?? [],
        signature: hello.signature,
      },
      this.#trust,
      this.#now(),
    );
    if (!check.ok) {
      this.#fail(state.socket.id, check.code, check.message);
      return;
    }
    this.#send(
      state.socket,
      serverProofMessage(this.#serverIdentity, {
        serverNonce: phase.nonce,
        clientNonce: hello.clientNonce,
        audience: hello.audience,
        role: hello.role,
        clientKeyId: check.identity.keyId,
        target,
        connectionId,
      }),
    );
    if (hello.role === "member") this.#admitMember(state, check.identity, hello);
    else if (hello.role === "client") this.#admitClient(state, check.identity, hello);
    else this.#admitAccept(state, check.identity, hello.connectionId);
  }

  #admitMember(state: SocketState, identity: RelayIdentity, hello: Extract<Hello, { role: "member" }>): void {
    const teamId = identity.team.id;
    const members = this.#teams.get(teamId) ?? new Map<string, string>();
    const replacedSocketId = members.get(identity.keyId);
    if (replacedSocketId === undefined && members.size >= RELAY_TEAM_MEMBERS_LIMIT) {
      this.#fail(state.socket.id, "team_full", "The team has the maximum number of connected members.");
      return;
    }
    state.phase = {
      kind: "member",
      identity,
      hosting: hello.hosting,
      label: normalizedLabel(hello.label),
      connectedAt: this.#now(),
      presenceUpdates: [],
    };
    members.set(identity.keyId, state.socket.id);
    this.#teams.set(teamId, members);
    if (replacedSocketId !== undefined) {
      this.#fail(replacedSocketId, "replaced", "A newer connection of this certificate replaced this one.");
    }
    this.#send(state.socket, {
      type: "welcome",
      version: VERSION,
      self: { keyId: identity.keyId, user: identity.user, device: identity.device },
      team: identity.team,
      members: this.#roster(teamId),
    });
    this.#broadcastRoster(teamId, state.socket.id);
    if (hello.hosting) this.#offerWaitingClients(state);
  }

  #updatePresence(state: SocketState, phase: MemberPhase, presence: Presence): void {
    const now = this.#now();
    phase.presenceUpdates = phase.presenceUpdates.filter((time) => now - time < PRESENCE_WINDOW_MS);
    if (phase.presenceUpdates.length >= this.#limits.presenceUpdatesPerMinute) {
      this.#fail(state.socket.id, "rate_limited", "Too many presence updates arrived.");
      return;
    }
    phase.presenceUpdates.push(now);
    const stoppedHosting = phase.hosting && !presence.hosting;
    phase.hosting = presence.hosting;
    phase.label = normalizedLabel(presence.label);
    const teamId = phase.identity.team.id;
    if (stoppedHosting) this.#failPendingFor(teamId, phase.identity.keyId, "The member stopped hosting.");
    this.#broadcastRoster(teamId, null);
    if (presence.hosting) this.#offerWaitingClients(state);
  }

  #admitClient(state: SocketState, identity: RelayIdentity, hello: Extract<Hello, { role: "client" }>): void {
    if (hello.target === identity.keyId) {
      this.#fail(state.socket.id, "invalid_message", "A member cannot connect to itself.");
      return;
    }
    if (this.#tunnelSocketCount(identity) >= this.#limits.tunnelsPerMember) {
      this.#fail(state.socket.id, "rate_limited", "This certificate has too many open connections.");
      return;
    }
    const target = this.#hostingMember(identity.team.id, hello.target);
    if (target) {
      this.#offer(state, identity, target);
      return;
    }
    if (hello.waitForTarget !== true) {
      this.#fail(state.socket.id, "target_unavailable", "The member is offline or does not host.");
      return;
    }
    state.phase = { kind: "waiting", identity, target: hello.target };
    this.#send(state.socket, { type: "waiting", version: VERSION });
  }

  #admitAccept(state: SocketState, identity: RelayIdentity, connectionId: string): void {
    const pending = this.#pending.get(connectionId);
    const client = pending ? this.#sockets.get(pending.clientSocketId) : undefined;
    if (
      !pending ||
      pending.teamId !== identity.team.id ||
      pending.target !== identity.keyId ||
      client?.phase.kind !== "pending"
    ) {
      this.#fail(state.socket.id, "protocol_error", "The connection is not available.");
      return;
    }
    clearTimeout(pending.deadline);
    this.#pending.delete(connectionId);
    const clientIdentity = client.phase.identity;
    client.phase = {
      kind: "tunnel",
      identity: clientIdentity,
      connectionId,
      peerSocketId: state.socket.id,
      readingPaused: false,
    };
    state.phase = { kind: "tunnel", identity, connectionId, peerSocketId: client.socket.id, readingPaused: false };
    this.#send(client.socket, { type: "open", version: VERSION, connectionId, peer: peerCertificate(identity) });
    this.#send(state.socket, { type: "open", version: VERSION, connectionId, peer: peerCertificate(clientIdentity) });
  }

  #offer(client: SocketState, identity: RelayIdentity, target: SocketState & { phase: MemberPhase }): void {
    const teamId = identity.team.id;
    const targetKeyId = target.phase.identity.keyId;
    let pendingForTarget = 0;
    for (const pending of this.#pending.values()) {
      if (pending.teamId === teamId && pending.target === targetKeyId) pendingForTarget += 1;
    }
    if (pendingForTarget >= this.#limits.pendingPerTarget) {
      this.#fail(client.socket.id, "target_unavailable", "The member has too many connections that wait.");
      return;
    }
    const connectionId = randomBytes(16).toString("base64url");
    const deadline = setTimeout(
      () => this.#fail(client.socket.id, "target_unavailable", "The member did not accept the connection in time."),
      RELAY_ACCEPT_DEADLINE_MS,
    );
    this.#pending.set(connectionId, { clientSocketId: client.socket.id, teamId, target: targetKeyId, deadline });
    client.phase = { kind: "pending", identity, connectionId };
    this.#send(target.socket, { type: "incoming", version: VERSION, connectionId, from: peerCertificate(identity) });
  }

  #offerWaitingClients(target: SocketState): void {
    if (target.phase.kind !== "member") return;
    const { team, keyId } = target.phase.identity;
    for (const state of [...this.#sockets.values()]) {
      const current = this.#sockets.get(target.socket.id);
      if (current?.phase.kind !== "member" || !current.phase.hosting) return;
      if (state.phase.kind !== "waiting") continue;
      if (state.phase.identity.team.id !== team.id || state.phase.target !== keyId) continue;
      this.#offer(state, state.phase.identity, { socket: current.socket, phase: current.phase });
    }
  }

  #hostingMember(teamId: string, keyId: string): (SocketState & { phase: MemberPhase }) | null {
    const socketId = this.#teams.get(teamId)?.get(keyId);
    const state = socketId === undefined ? undefined : this.#sockets.get(socketId);
    if (state?.phase.kind !== "member" || !state.phase.hosting) return null;
    return { socket: state.socket, phase: state.phase };
  }

  #tunnelSocketCount(identity: RelayIdentity): number {
    let count = 0;
    for (const state of this.#sockets.values()) {
      const phase = state.phase;
      if (phase.kind === "challenge" || phase.kind === "member") continue;
      if (phase.identity.team.id === identity.team.id && phase.identity.keyId === identity.keyId) count += 1;
    }
    return count;
  }

  #roster(teamId: string): RelayTeamMember[] {
    const members: RelayTeamMember[] = [];
    for (const socketId of this.#teams.get(teamId)?.values() ?? []) {
      const phase = this.#sockets.get(socketId)?.phase;
      if (phase?.kind !== "member") continue;
      members.push({
        keyId: phase.identity.keyId,
        user: phase.identity.user,
        device: phase.identity.device,
        label: phase.label,
        hosting: phase.hosting,
        connectedAt: phase.connectedAt,
      });
    }
    return members.sort(
      (left, right) =>
        left.user.localeCompare(right.user) ||
        (left.device ?? "").localeCompare(right.device ?? "") ||
        left.keyId.localeCompare(right.keyId),
    );
  }

  #broadcastRoster(teamId: string, exceptSocketId: string | null): void {
    const socketIds = [...(this.#teams.get(teamId)?.values() ?? [])];
    if (socketIds.length === 0) return;
    const message = encodeRelayServerMessage({ type: "members", version: VERSION, members: this.#roster(teamId) });
    for (const socketId of socketIds) {
      if (socketId !== exceptSocketId) this.#sockets.get(socketId)?.socket.sendText(message);
    }
  }

  #failPendingFor(teamId: string, target: string, message: string): void {
    for (const pending of [...this.#pending.values()]) {
      if (pending.teamId === teamId && pending.target === target) {
        this.#fail(pending.clientSocketId, "target_unavailable", message);
      }
    }
  }

  #send(socket: RelaySocket, message: RelayServerMessage): void {
    socket.sendText(encodeRelayServerMessage(message));
  }

  #fail(socketId: string, code: RelayErrorCode, message: string): void {
    const state = this.#sockets.get(socketId);
    if (!state) return;
    this.#send(state.socket, { type: "error", version: VERSION, code, message });
    this.#release(socketId);
    state.socket.close(closeCode(code), message);
  }

  #release(socketId: string): void {
    const state = this.#sockets.get(socketId);
    if (!state) return;
    this.#sockets.delete(socketId);
    const fromSameAddress = (this.#socketsByIp.get(state.socket.ip) ?? 1) - 1;
    if (fromSameAddress > 0) this.#socketsByIp.set(state.socket.ip, fromSameAddress);
    else this.#socketsByIp.delete(state.socket.ip);
    const phase = state.phase;
    if (phase.kind === "challenge") {
      clearTimeout(phase.deadline);
      return;
    }
    if (phase.kind === "member") {
      const teamId = phase.identity.team.id;
      const members = this.#teams.get(teamId);
      if (members?.get(phase.identity.keyId) !== socketId) return;
      members.delete(phase.identity.keyId);
      if (members.size === 0) this.#teams.delete(teamId);
      this.#failPendingFor(teamId, phase.identity.keyId, "The member went offline.");
      this.#broadcastRoster(teamId, null);
      return;
    }
    if (phase.kind === "pending") {
      const pending = this.#pending.get(phase.connectionId);
      if (pending) clearTimeout(pending.deadline);
      this.#pending.delete(phase.connectionId);
      return;
    }
    if (phase.kind === "tunnel") {
      const peer = this.#sockets.get(phase.peerSocketId);
      if (!peer) return;
      this.#release(peer.socket.id);
      peer.socket.close(RELAY_CLOSE_CODES.peerClosed, "The other side closed the connection.");
    }
  }
}

function normalizedLabel(label: string | undefined): string | null {
  return label?.trim() || null;
}

function closeCode(code: RelayErrorCode) {
  if (code === "replaced") return RELAY_CLOSE_CODES.replaced;
  if (code === "target_unavailable" || code === "team_full") return RELAY_CLOSE_CODES.unavailable;
  return RELAY_CLOSE_CODES.policy;
}
