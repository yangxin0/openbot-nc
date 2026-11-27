import {
  decodeRelayHubFrame,
  RELAY_HUB_BULK_KIND,
  RELAY_HUB_FRAME_TYPES,
  type RelayHubHello,
  type RelayHubMember,
  type RelayHubServerMessage,
  type RelayHubUndeliverableCode,
  relayKeyIdBytes,
} from "@openbot/contracts/relay-protocol/hub";
import {
  RELAY_CLOSE_CODES,
  RELAY_HELLO_DEADLINE_MS,
  RELAY_PROTOCOL_VERSION,
  RELAY_TEAM_MEMBERS_LIMIT,
  type RelayErrorCode,
} from "@openbot/contracts/relay-protocol/messages";
import { isRevoked, type RelayIdentity, type RelayTrust, verifyRelayProof } from "./identity";
import { decodeRelayClientMessage, encodeRelayServerMessage } from "./protocol";
import { type RelayServerIdentity, serverProofMessage } from "./server-identity";

export interface RelaySocket {
  readonly id: string;
  readonly ip: string;
  sendText(message: string): void;
  sendBinary(data: Uint8Array): void;
  bufferedBytes(): number;
  close(code: number, reason: string): void;
}

export interface RelayLimits {
  socketsPerIp: number;
  presenceUpdatesPerMinute: number;
  infoPerMinute: number;
  highWaterBytes: number;
  queueBytes: number;
  clientHeartbeatTimeoutMs: number;
  suspendedTimeoutMs: number;
  helloWindowMs: number;
}

interface RelayMetrics {
  sockets: number;
  teams: number;
  members: number;
  queuedBytes: number;
  delivered: number;
  undeliverable: number;
}

export interface RelayLiveMember {
  fingerprint: string;
  keyId: string;
  team: string;
  hosting: boolean;
  label: string | null;
  connectedAt: number;
}

type Deadline = ReturnType<typeof setTimeout>;

interface HelloPhase {
  kind: "hello";
  deadline: Deadline;
}

interface Lane {
  items: Uint8Array[];
  bytes: number;
}

interface MemberPhase {
  kind: "member";
  identity: RelayIdentity;
  keyIdBytes: Uint8Array;
  record: RelayHubMember;
  presenceUpdates: number[];
  infoRequests: number[];
  priority: Lane;
  bulk: Lane;
}

interface SocketState {
  socket: RelaySocket;
  phase: HelloPhase | MemberPhase;
}

const RATE_WINDOW_MS = 60_000;
const NONCE_CACHE_LIMIT = 100_000;
const SWEEP_MIN_MS = 100;
const SWEEP_MAX_MS = 1_000;
const version = RELAY_PROTOCOL_VERSION;

export class RelayService {
  readonly #sockets = new Map<string, SocketState>();
  readonly #socketsByIp = new Map<string, number>();
  readonly #teams = new Map<string, Map<string, string>>();
  readonly #nonces = new Map<string, number>();
  readonly #limits: RelayLimits;
  readonly #now: () => number;
  readonly #sweep: ReturnType<typeof setInterval>;
  #trust: RelayTrust;
  #serverIdentity: RelayServerIdentity;
  #delivered = 0;
  #undeliverable = 0;

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
    const shortest = Math.min(limits.clientHeartbeatTimeoutMs, limits.suspendedTimeoutMs);
    this.#sweep = setInterval(
      () => this.#checkLiveness(),
      Math.max(SWEEP_MIN_MS, Math.min(SWEEP_MAX_MS, Math.floor(shortest / 4))),
    );
    this.#sweep.unref?.();
  }

  connect(socket: RelaySocket): void {
    const fromSameAddress = (this.#socketsByIp.get(socket.ip) ?? 0) + 1;
    this.#socketsByIp.set(socket.ip, fromSameAddress);
    const deadline = setTimeout(
      () => this.#fail(socket.id, "authentication_failed", "No hello arrived in time."),
      RELAY_HELLO_DEADLINE_MS,
    );
    this.#sockets.set(socket.id, { socket, phase: { kind: "hello", deadline } });
    if (fromSameAddress > this.#limits.socketsPerIp) {
      this.#fail(socket.id, "rate_limited", "Too many connections come from this address.");
    }
  }

  receiveText(socketId: string, text: string): void {
    const state = this.#sockets.get(socketId);
    if (!state) return;
    const message = decodeRelayClientMessage(text);
    if (!message) {
      this.#fail(socketId, "invalid_message", "The message is invalid.");
      return;
    }
    const phase = state.phase;
    if (phase.kind === "hello") {
      if (message.type === "hello") this.#authenticate(state, phase, message);
      else this.#fail(socketId, "protocol_error", "The first message must be hello.");
      return;
    }
    phase.record.lastHeardAt = this.#now();
    if (message.type === "ping") this.#send(state.socket, { type: "pong", version, id: message.id });
    else if (message.type === "presence") this.#updatePresence(state, phase, message.hosting, message.label);
    else if (message.type === "info") this.#answerInfo(state, phase, message.id, message.about);
    else this.#fail(socketId, "protocol_error", "The message is not expected now.");
  }

  receiveBinary(socketId: string, data: Uint8Array): void {
    const state = this.#sockets.get(socketId);
    if (!state) return;
    const phase = state.phase;
    if (phase.kind !== "member") {
      this.#fail(socketId, "protocol_error", "The first message must be hello.");
      return;
    }
    phase.record.lastHeardAt = this.#now();
    const frame = decodeRelayHubFrame(data);
    if (frame?.type !== "send" || frame.id === 0) {
      this.#fail(socketId, "invalid_message", "The frame is invalid.");
      return;
    }
    if (frame.peer === phase.identity.keyId) {
      this.#refuse(state, frame.id, frame.peer, "not_member");
      return;
    }
    const target = this.#member(phase.identity.team.id, frame.peer);
    if (!target) {
      this.#refuse(state, frame.id, frame.peer, "offline");
      return;
    }
    const lane = frame.kind === RELAY_HUB_BULK_KIND ? target.phase.bulk : target.phase.priority;
    if (lane.bytes + data.byteLength > this.#limits.queueBytes) {
      this.#refuse(state, frame.id, frame.peer, "busy");
      return;
    }
    const deliver = new Uint8Array(data);
    deliver[0] = RELAY_HUB_FRAME_TYPES.deliver;
    deliver.set(phase.keyIdBytes, 6);
    lane.items.push(deliver);
    lane.bytes += deliver.byteLength;
    this.#delivered += 1;
    this.#flush(target.state, target.phase);
  }

  drained(socketId: string): void {
    const state = this.#sockets.get(socketId);
    if (state?.phase.kind === "member") this.#flush(state, state.phase);
  }

  disconnect(socketId: string, _code: number = RELAY_CLOSE_CODES.normal): void {
    this.#release(socketId);
  }

  applyTrust(trust: RelayTrust): void {
    this.#trust = trust;
    for (const state of [...this.#sockets.values()]) {
      if (state.phase.kind === "member" && isRevoked(state.phase.identity, trust.revoked)) {
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
      if (state.phase.kind === "member" && state.phase.identity.expiresAt <= now) {
        this.#fail(state.socket.id, "certificate_expired", "The certificate is expired.");
      }
    }
  }

  close(): void {
    clearInterval(this.#sweep);
    for (const state of [...this.#sockets.values()]) {
      this.#release(state.socket.id);
      state.socket.close(RELAY_CLOSE_CODES.unavailable, "The server stops.");
    }
  }

  liveMembers(): RelayLiveMember[] {
    const members: RelayLiveMember[] = [];
    for (const state of this.#sockets.values()) {
      if (state.phase.kind !== "member") continue;
      const { identity, record } = state.phase;
      members.push({
        fingerprint: identity.fingerprint,
        keyId: identity.keyId,
        team: identity.team.name,
        hosting: record.hosting,
        label: record.label,
        connectedAt: record.connectedAt,
      });
    }
    return members;
  }

  metrics(): RelayMetrics {
    let members = 0;
    let queuedBytes = 0;
    for (const state of this.#sockets.values()) {
      if (state.phase.kind !== "member") continue;
      members += 1;
      queuedBytes += state.phase.priority.bytes + state.phase.bulk.bytes;
    }
    return {
      sockets: this.#sockets.size,
      teams: this.#teams.size,
      members,
      queuedBytes,
      delivered: this.#delivered,
      undeliverable: this.#undeliverable,
    };
  }

  #authenticate(state: SocketState, phase: HelloPhase, hello: RelayHubHello): void {
    clearTimeout(phase.deadline);
    const now = this.#now();
    if (Math.abs(now - hello.timestamp) > this.#limits.helloWindowMs) {
      this.#refuseSignIn(state, "authentication_failed", "The time of the hello is outside the permitted window.");
      return;
    }
    const check = verifyRelayProof(hello, this.#trust, now);
    if (!check.ok) {
      this.#refuseSignIn(state, check.code, check.message);
      return;
    }
    const nonce = `${check.identity.keyId}:${hello.clientNonce}`;
    if (this.#nonces.has(nonce)) {
      this.#refuseSignIn(state, "authentication_failed", "The hello was used before.");
      return;
    }
    this.#rememberNonce(nonce, hello.timestamp + this.#limits.helloWindowMs, now);
    this.#send(
      state.socket,
      serverProofMessage(this.#serverIdentity, {
        clientNonce: hello.clientNonce,
        audience: hello.audience,
        clientKeyId: check.identity.keyId,
      }),
    );
    this.#admit(state, check.identity, hello, now);
  }

  #rememberNonce(nonce: string, expiresAt: number, now: number): void {
    if (this.#nonces.size >= NONCE_CACHE_LIMIT) this.#pruneNonces(now);
    while (this.#nonces.size >= NONCE_CACHE_LIMIT) {
      const oldest = this.#nonces.keys().next().value;
      if (oldest === undefined) break;
      this.#nonces.delete(oldest);
    }
    this.#nonces.set(nonce, expiresAt);
  }

  #pruneNonces(now: number): void {
    for (const [nonce, expiresAt] of this.#nonces) if (expiresAt < now) this.#nonces.delete(nonce);
  }

  #admit(state: SocketState, identity: RelayIdentity, hello: RelayHubHello, now: number): void {
    const keyIdBytes = relayKeyIdBytes(identity.keyId);
    if (!keyIdBytes) {
      this.#fail(state.socket.id, "authentication_failed", "The key identifier cannot be read.");
      return;
    }
    const teamId = identity.team.id;
    const members = this.#teams.get(teamId) ?? new Map<string, string>();
    const replacedSocketId = members.get(identity.keyId);
    if (replacedSocketId === undefined && members.size >= RELAY_TEAM_MEMBERS_LIMIT) {
      this.#fail(state.socket.id, "team_full", "The team has the maximum number of connected members.");
      return;
    }
    const record: RelayHubMember = {
      keyId: identity.keyId,
      user: identity.user,
      device: identity.device,
      label: normalizedLabel(hello.label),
      hosting: hello.hosting,
      capabilities: hello.capabilities,
      suspendable: hello.suspendable,
      certificate: identity.certificate,
      messageKey: hello.messageKey,
      messageKeySignature: hello.messageKeySignature,
      keyTimestamp: hello.timestamp,
      connectedAt: now,
      lastHeardAt: now,
    };
    state.phase = {
      kind: "member",
      identity,
      keyIdBytes,
      record,
      presenceUpdates: [],
      infoRequests: [],
      priority: { items: [], bytes: 0 },
      bulk: { items: [], bytes: 0 },
    };
    members.set(identity.keyId, state.socket.id);
    this.#teams.set(teamId, members);
    if (replacedSocketId !== undefined) {
      console.log(`A newer connection of the key ${identity.keyId.slice(0, 8)} replaced its older connection.`);
      this.#fail(replacedSocketId, "replaced", "A newer connection of this certificate replaced this one.");
    }
    this.#send(state.socket, {
      type: "welcome",
      version,
      self: { ...record },
      team: identity.team,
      roster: this.#roster(teamId),
    });
    this.#broadcast(teamId, identity.keyId, { type: "online", version, member: { ...record } });
  }

  #updatePresence(state: SocketState, phase: MemberPhase, hosting: boolean, label: string | null): void {
    if (!this.#withinRate(phase.presenceUpdates, this.#limits.presenceUpdatesPerMinute)) {
      this.#fail(state.socket.id, "rate_limited", "Too many presence updates arrived.");
      return;
    }
    phase.record.hosting = hosting;
    phase.record.label = normalizedLabel(label);
    this.#broadcast(phase.identity.team.id, null, {
      type: "online",
      version,
      member: { ...phase.record },
    });
  }

  #answerInfo(state: SocketState, phase: MemberPhase, id: number, about: string): void {
    if (!this.#withinRate(phase.infoRequests, this.#limits.infoPerMinute)) {
      this.#fail(state.socket.id, "rate_limited", "Too many questions arrived.");
      return;
    }
    const target = this.#member(phase.identity.team.id, about);
    this.#send(state.socket, { type: "info", version, id, member: target ? { ...target.phase.record } : null });
  }

  #withinRate(times: number[], limit: number): boolean {
    const now = this.#now();
    while (times.length > 0 && now - (times[0] ?? now) >= RATE_WINDOW_MS) times.shift();
    if (times.length >= limit) return false;
    times.push(now);
    return true;
  }

  #refuse(state: SocketState, id: number, to: string, code: RelayHubUndeliverableCode): void {
    this.#undeliverable += 1;
    this.#send(state.socket, { type: "undeliverable", version, id, to, code });
  }

  #member(teamId: string, keyId: string): { state: SocketState; phase: MemberPhase } | null {
    const socketId = this.#teams.get(teamId)?.get(keyId);
    const state = socketId === undefined ? undefined : this.#sockets.get(socketId);
    return state?.phase.kind === "member" ? { state, phase: state.phase } : null;
  }

  #flush(state: SocketState, phase: MemberPhase): void {
    while (state.socket.bufferedBytes() < this.#limits.highWaterBytes) {
      const lane = phase.priority.items.length > 0 ? phase.priority : phase.bulk;
      const item = lane.items.shift();
      if (!item) return;
      lane.bytes -= item.byteLength;
      state.socket.sendBinary(item);
    }
  }

  #roster(teamId: string): RelayHubMember[] {
    const roster: RelayHubMember[] = [];
    for (const socketId of this.#teams.get(teamId)?.values() ?? []) {
      const state = this.#sockets.get(socketId);
      if (state?.phase.kind === "member") roster.push({ ...state.phase.record });
    }
    return roster;
  }

  #broadcast(teamId: string, except: string | null, message: RelayHubServerMessage): void {
    const text = encodeRelayServerMessage(message);
    for (const [keyId, socketId] of this.#teams.get(teamId) ?? []) {
      if (keyId === except) continue;
      this.#sockets.get(socketId)?.socket.sendText(text);
    }
  }

  #checkLiveness(): void {
    const now = this.#now();
    this.#pruneNonces(now);
    for (const state of [...this.#sockets.values()]) {
      if (state.phase.kind !== "member") continue;
      const { record } = state.phase;
      const timeout = record.suspendable ? this.#limits.suspendedTimeoutMs : this.#limits.clientHeartbeatTimeoutMs;
      if (now - record.lastHeardAt >= timeout) {
        this.#fail(state.socket.id, "heartbeat_timeout", "Nothing arrived from the app in time.");
      }
    }
  }

  #send(socket: RelaySocket, message: RelayHubServerMessage): void {
    socket.sendText(encodeRelayServerMessage(message));
  }

  #refuseSignIn(state: SocketState, code: RelayErrorCode, message: string): void {
    console.log(`The relay refused a sign-in from ${state.socket.ip} (${code}): ${message}`);
    this.#fail(state.socket.id, code, message);
  }

  #fail(socketId: string, code: RelayErrorCode, message: string): void {
    const state = this.#sockets.get(socketId);
    if (!state) return;
    this.#send(state.socket, { type: "error", version, code, message });
    this.#release(socketId);
    state.socket.close(closeCode(code), message);
  }

  #release(socketId: string): void {
    const state = this.#sockets.get(socketId);
    if (!state) return;
    this.#sockets.delete(socketId);
    const remaining = (this.#socketsByIp.get(state.socket.ip) ?? 1) - 1;
    if (remaining > 0) this.#socketsByIp.set(state.socket.ip, remaining);
    else this.#socketsByIp.delete(state.socket.ip);
    const phase = state.phase;
    if (phase.kind === "hello") {
      clearTimeout(phase.deadline);
      return;
    }
    phase.priority = { items: [], bytes: 0 };
    phase.bulk = { items: [], bytes: 0 };
    const teamId = phase.identity.team.id;
    const members = this.#teams.get(teamId);
    if (members?.get(phase.identity.keyId) !== socketId) return;
    members.delete(phase.identity.keyId);
    if (members.size === 0) this.#teams.delete(teamId);
    this.#broadcast(teamId, phase.identity.keyId, { type: "offline", version, keyId: phase.identity.keyId });
  }
}

function normalizedLabel(label: string | null): string | null {
  return label?.trim() || null;
}

function closeCode(code: RelayErrorCode): (typeof RELAY_CLOSE_CODES)[keyof typeof RELAY_CLOSE_CODES] {
  if (code === "replaced") return RELAY_CLOSE_CODES.replaced;
  if (code === "target_unavailable" || code === "team_full") return RELAY_CLOSE_CODES.unavailable;
  return RELAY_CLOSE_CODES.policy;
}
