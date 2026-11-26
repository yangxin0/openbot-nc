import { createHash, randomBytes } from "node:crypto";
import {
  RELAY_ACCEPT_DEADLINE_MS,
  RELAY_CLOSE_CODES,
  RELAY_CONTROL_MESSAGE_BYTES_LIMIT,
  RELAY_DATA_TICKET_TTL_MS,
  RELAY_HELLO_DEADLINE_MS,
  RELAY_PROTOCOL_VERSION,
  RELAY_SESSION_ASSIGNED_ID_MIN,
  RELAY_SESSION_ID_MAX,
  RELAY_SESSION_WINDOW_BYTES,
  RELAY_SESSIONS_FEATURE,
  RELAY_TEAM_MEMBERS_LIMIT,
  type RelayErrorCode,
  type RelayServerMessage,
  type RelaySessionFailureCode,
  type RelayTeamMember,
} from "@openbot/contracts/relay-protocol/messages";
import {
  decodeRelaySessionFrame,
  isRelayOpenerSessionId,
  type RelaySessionFrame,
  rewriteRelaySessionFrame,
} from "@openbot/contracts/relay-protocol/sessions";
import { isRevoked, peerCertificate, type RelayIdentity, type RelayTrust, verifyRelayProof } from "./identity";
import { type DecodedRelayClientMessage, decodeRelayClientMessage, encodeRelayServerMessage } from "./protocol";
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
  sessionsPerSocket: number;
  sessionsPerPair: number;
  pendingPerTarget: number;
  presenceUpdatesPerMinute: number;
  highWaterBytes: number;
}

interface RelayMetrics {
  sockets: number;
  teams: number;
  members: number;
  dataSockets: number;
  sessions: number;
  pendingSessions: number;
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
type Hello = Extract<DecodedRelayClientMessage, { type: "hello" }>;
type Presence = Extract<DecodedRelayClientMessage, { type: "presence" }>;
type SessionOpen = Extract<DecodedRelayClientMessage, { type: "session-open" }>;
type SessionMessage = Extract<
  DecodedRelayClientMessage,
  { type: "session-accept" | "session-refuse" | "session-close" | "session-credit" }
>;

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
  sessionsFeature: boolean;
  dataSocketId: string | null;
  dataWanted: boolean;
}

interface DataPhase {
  kind: "data";
  ownerId: string;
}

type Phase = ChallengePhase | MemberPhase | DataPhase;

type OutboxItem = Uint8Array;

interface DataTicket {
  ownerId: string;
  keyId: string;
  expiresAt: number;
}

interface SocketState {
  socket: RelaySocket;
  phase: Phase;
  sessions: Map<number, RelaySessionRecord>;
  nextSessionId: number;
  outbox: Map<number, OutboxItem[]>;
  order: number[];
}

interface SessionEnd {
  socketId: string;
  session: number;
  credit: number;
}

interface RelaySessionRecord {
  connectionId: string;
  teamId: string;
  opener: SessionEnd;
  target: SessionEnd;
  openerKeyId: string;
  targetKeyId: string;
  open: boolean;
  deadline: Deadline | null;
}

const PRESENCE_WINDOW_MS = 60_000;
const TICKETS_PER_MEMBER = 4;
const VERSION = RELAY_PROTOCOL_VERSION;

export class RelayService {
  readonly #sockets = new Map<string, SocketState>();
  readonly #socketsByIp = new Map<string, number>();
  readonly #teams = new Map<string, Map<string, string>>();
  readonly #tickets = new Map<string, DataTicket>();
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
    this.#sockets.set(socket.id, {
      socket,
      phase: { kind: "challenge", nonce, deadline },
      sessions: new Map(),
      nextSessionId: RELAY_SESSION_ASSIGNED_ID_MIN,
      outbox: new Map(),
      order: [],
    });
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
    if (state.phase.kind === "challenge" && message.type === "data-hello") {
      this.#bindData(state, state.phase, message.ticket);
      return;
    }
    if (state.phase.kind !== "member" || message.type === "hello" || message.type === "data-hello") {
      this.#fail(socketId, "protocol_error", "The message is not expected now.");
      return;
    }
    if (message.type === "presence") this.#updatePresence(state, state.phase, message);
    else if (message.type === "data-ticket") this.#issueTicket(state, state.phase);
    else if (message.type === "session-open") this.#openSession(state, state.phase, message);
    else this.#sessionMessage(state, message);
  }

  receiveBinary(socketId: string, data: Uint8Array): void {
    const state = this.#sockets.get(socketId);
    if (!state) return;
    if (state.phase.kind !== "data") {
      this.#fail(socketId, "protocol_error", "Session data travels only on a data socket.");
      return;
    }
    const owner = this.#sockets.get(state.phase.ownerId);
    if (owner?.phase.kind !== "member") return;
    const frame = decodeRelaySessionFrame(data);
    if (!frame) {
      this.#fail(socketId, "invalid_message", "The frame is invalid.");
      return;
    }
    this.#routeFrame(owner, frame, data);
  }

  drained(socketId: string): void {
    const state = this.#sockets.get(socketId);
    if (state?.phase.kind !== "data") return;
    const owner = this.#sockets.get(state.phase.ownerId);
    if (owner) this.#flush(owner);
  }

  disconnect(socketId: string, code: number = RELAY_CLOSE_CODES.normal): void {
    this.#release(socketId, code === RELAY_CLOSE_CODES.normal);
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
    for (const [hash, ticket] of [...this.#tickets]) if (ticket.expiresAt <= now) this.#tickets.delete(hash);
    for (const state of [...this.#sockets.values()]) {
      if (state.phase.kind === "member" && state.phase.identity.expiresAt <= now) {
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

  liveMembers(): RelayLiveMember[] {
    const members: RelayLiveMember[] = [];
    for (const state of this.#sockets.values()) {
      if (state.phase.kind !== "member") continue;
      members.push({
        fingerprint: state.phase.identity.fingerprint,
        keyId: state.phase.identity.keyId,
        team: state.phase.identity.team.name,
        hosting: state.phase.hosting,
        label: state.phase.label,
        connectedAt: state.phase.connectedAt,
      });
    }
    return members;
  }

  metrics(): RelayMetrics {
    let members = 0;
    let dataSockets = 0;
    let sessions = 0;
    let pendingSessions = 0;
    for (const state of this.#sockets.values()) {
      if (state.phase.kind === "member") members += 1;
      if (state.phase.kind === "data") dataSockets += 1;
      for (const record of state.sessions.values()) {
        if (record.opener.socketId !== state.socket.id) continue;
        if (record.open) sessions += 1;
        else pendingSessions += 1;
      }
    }
    return { sockets: this.#sockets.size, teams: this.#teams.size, members, dataSockets, sessions, pendingSessions };
  }

  #authenticate(state: SocketState, phase: ChallengePhase, hello: Hello): void {
    clearTimeout(phase.deadline);
    const check = verifyRelayProof(
      {
        nonce: phase.nonce,
        clientNonce: hello.clientNonce,
        audience: hello.audience,
        role: hello.role,
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
      }),
    );
    this.#admitMember(state, check.identity, hello);
  }

  #admitMember(state: SocketState, identity: RelayIdentity, hello: Hello): void {
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
      sessionsFeature: hello.features?.includes(RELAY_SESSIONS_FEATURE) ?? false,
      dataSocketId: null,
      dataWanted: false,
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
      features: [RELAY_SESSIONS_FEATURE],
    });
    this.#broadcastRoster(teamId, state.socket.id);
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
    if (stoppedHosting) this.#failPendingFor(state);
    this.#broadcastRoster(teamId, null);
  }

  #issueTicket(state: SocketState, phase: MemberPhase): void {
    const now = this.#now();
    const own = [...this.#tickets].filter(([, ticket]) => ticket.ownerId === state.socket.id);
    for (const [hash] of own.slice(0, Math.max(0, own.length - TICKETS_PER_MEMBER + 1))) this.#tickets.delete(hash);
    const ticket = randomBytes(32).toString("base64url");
    this.#tickets.set(ticketHash(ticket), {
      ownerId: state.socket.id,
      keyId: phase.identity.keyId,
      expiresAt: now + RELAY_DATA_TICKET_TTL_MS,
    });
    this.#send(state.socket, { type: "data-ticket", version: VERSION, ticket });
  }

  #bindData(state: SocketState, phase: ChallengePhase, ticket: string): void {
    clearTimeout(phase.deadline);
    const hash = ticketHash(ticket);
    const entry = this.#tickets.get(hash);
    this.#tickets.delete(hash);
    const owner = entry ? this.#sockets.get(entry.ownerId) : undefined;
    if (
      !entry ||
      entry.expiresAt <= this.#now() ||
      owner?.phase.kind !== "member" ||
      owner.phase.identity.keyId !== entry.keyId
    ) {
      this.#fail(state.socket.id, "authentication_failed", "The data ticket is not valid.");
      return;
    }
    const previous = owner.phase.dataSocketId === null ? undefined : this.#sockets.get(owner.phase.dataSocketId);
    state.phase = { kind: "data", ownerId: owner.socket.id };
    owner.phase.dataSocketId = state.socket.id;
    owner.phase.dataWanted = false;
    if (previous) {
      this.#release(previous.socket.id, true);
      previous.socket.close(RELAY_CLOSE_CODES.normal, "A newer data socket replaced this one.");
    }
    this.#flush(owner);
  }

  #routeFrame(owner: SocketState, frame: RelaySessionFrame, data: Uint8Array): void {
    const record = owner.sessions.get(frame.session);
    if (!record) return;
    const fromOpener = record.opener.socketId === owner.socket.id && record.opener.session === frame.session;
    const [own, other] = fromOpener ? [record.opener, record.target] : [record.target, record.opener];
    if (!record.open) {
      this.#fail(owner.socket.id, "protocol_error", "Data is permitted only on an open session.");
      return;
    }
    if (frame.payload.byteLength > own.credit) {
      this.#fail(owner.socket.id, "protocol_error", "The session sent more than its window.");
      return;
    }
    own.credit -= frame.payload.byteLength;
    if (frame.kind === "end") this.#forgetSession(record);
    const peer = this.#sockets.get(other.socketId);
    if (peer) this.#queue(peer, other.session, rewriteRelaySessionFrame(data, other.session));
  }

  #openSession(state: SocketState, phase: MemberPhase, message: SessionOpen): void {
    if (!isRelayOpenerSessionId(message.session) || state.sessions.has(message.session)) {
      this.#fail(state.socket.id, "invalid_message", "The session number is not valid.");
      return;
    }
    const identity = phase.identity;
    const target = this.#hostingMember(identity.team.id, message.target);
    const refusal = this.#sessionRefusal(state, identity.keyId, message.target, target);
    if (refusal !== null || !target) {
      this.#send(state.socket, {
        type: "session-failed",
        version: VERSION,
        session: message.session,
        code: refusal ?? "target_unavailable",
      });
      return;
    }
    const assigned = target.state.nextSessionId;
    target.state.nextSessionId += 1;
    const record: RelaySessionRecord = {
      connectionId: randomBytes(16).toString("base64url"),
      teamId: identity.team.id,
      opener: { socketId: state.socket.id, session: message.session, credit: RELAY_SESSION_WINDOW_BYTES },
      target: { socketId: target.state.socket.id, session: assigned, credit: RELAY_SESSION_WINDOW_BYTES },
      openerKeyId: identity.keyId,
      targetKeyId: message.target,
      open: false,
      deadline: null,
    };
    record.deadline = setTimeout(() => this.#endSession(record, "target_unavailable"), RELAY_ACCEPT_DEADLINE_MS);
    state.sessions.set(message.session, record);
    target.state.sessions.set(assigned, record);
    this.#send(target.state.socket, {
      type: "session-incoming",
      version: VERSION,
      session: assigned,
      connectionId: record.connectionId,
      from: peerCertificate(identity),
      ...(message.first === undefined ? {} : { first: message.first }),
    });
  }

  #sessionMessage(state: SocketState, message: SessionMessage): void {
    const record = state.sessions.get(message.session);
    if (!record) return;
    const isTarget = record.target.socketId === state.socket.id && record.target.session === message.session;
    const own = isTarget ? record.target : record.opener;
    const other = isTarget ? record.opener : record.target;
    if (message.type === "session-credit") {
      if (!record.open) {
        this.#fail(state.socket.id, "protocol_error", "Credit is permitted only on an open session.");
        return;
      }
      other.credit += message.bytes;
      if (other.credit > RELAY_SESSION_WINDOW_BYTES) {
        this.#fail(state.socket.id, "protocol_error", "The credit is larger than the window.");
        return;
      }
      const peer = this.#sockets.get(other.socketId);
      if (peer)
        this.#send(peer.socket, {
          type: "session-credit",
          version: VERSION,
          session: other.session,
          bytes: message.bytes,
        });
      return;
    }
    if (message.type === "session-close") {
      this.#endSession(record, record.open || !isTarget ? null : "refused", own);
      return;
    }
    if (!isTarget || record.open) {
      this.#fail(state.socket.id, "protocol_error", "The session answer is not expected now.");
      return;
    }
    if (message.type === "session-refuse") {
      this.#endSession(record, message.code, own);
      return;
    }
    if (record.deadline) clearTimeout(record.deadline);
    record.deadline = null;
    record.open = true;
    const opener = this.#sockets.get(record.opener.socketId);
    const targetPhase = state.phase;
    if (!opener || targetPhase.kind !== "member") return;
    this.#send(opener.socket, {
      type: "session-opened",
      version: VERSION,
      session: record.opener.session,
      connectionId: record.connectionId,
      peer: peerCertificate(targetPhase.identity),
      ...(message.first === undefined ? {} : { first: message.first }),
    });
  }

  #sessionRefusal(
    state: SocketState,
    keyId: string,
    targetKeyId: string,
    target: { state: SocketState; phase: MemberPhase } | null,
  ): RelaySessionFailureCode | null {
    if (targetKeyId === keyId) return "invalid_message";
    if (state.sessions.size >= this.#limits.sessionsPerSocket) return "rate_limited";
    if (!target?.phase.sessionsFeature) return "target_unavailable";
    let pair = 0;
    for (const record of state.sessions.values()) {
      if (record.opener.socketId === state.socket.id && record.targetKeyId === targetKeyId) pair += 1;
    }
    if (pair >= this.#limits.sessionsPerPair) return "rate_limited";
    let pending = 0;
    for (const record of target.state.sessions.values()) {
      if (!record.open && record.target.socketId === target.state.socket.id) pending += 1;
    }
    if (pending >= this.#limits.pendingPerTarget) return "rate_limited";
    if (target.state.sessions.size >= this.#limits.sessionsPerSocket) return "rate_limited";
    return target.state.nextSessionId > RELAY_SESSION_ID_MAX ? "target_unavailable" : null;
  }

  #forgetSession(record: RelaySessionRecord): void {
    if (record.deadline) clearTimeout(record.deadline);
    record.deadline = null;
    for (const end of [record.opener, record.target]) {
      const state = this.#sockets.get(end.socketId);
      if (state?.sessions.get(end.session) === record) state.sessions.delete(end.session);
    }
  }

  #endSession(
    record: RelaySessionRecord,
    failure: RelaySessionFailureCode | null,
    closedBy: SessionEnd | null = null,
  ): void {
    this.#forgetSession(record);
    for (const end of [record.opener, record.target]) {
      const state = this.#sockets.get(end.socketId);
      if (!state) continue;
      this.#drop(state, end.session);
      if (end === closedBy) continue;
      if (!record.open && end === record.opener && failure !== null) {
        this.#send(state.socket, { type: "session-failed", version: VERSION, session: end.session, code: failure });
      } else {
        this.#send(state.socket, { type: "session-close", version: VERSION, session: end.session });
      }
    }
  }

  #drop(state: SocketState, session: number): void {
    if (!state.outbox.delete(session)) return;
    const index = state.order.indexOf(session);
    if (index >= 0) state.order.splice(index, 1);
  }

  #queue(state: SocketState, session: number, item: OutboxItem): void {
    const items = state.outbox.get(session);
    if (items) items.push(item);
    else {
      state.outbox.set(session, [item]);
      state.order.push(session);
    }
    this.#flush(state);
  }

  #flush(state: SocketState): void {
    if (state.phase.kind !== "member" || state.order.length === 0) return;
    const data = state.phase.dataSocketId === null ? undefined : this.#sockets.get(state.phase.dataSocketId);
    if (!data) {
      if (!state.phase.dataWanted) this.#send(state.socket, { type: "data-wanted", version: VERSION });
      state.phase.dataWanted = true;
      return;
    }
    while (state.order.length > 0 && data.socket.bufferedBytes() < this.#limits.highWaterBytes) {
      const session = state.order.shift();
      if (session === undefined) break;
      const items = state.outbox.get(session);
      const item = items?.shift();
      if (item) data.socket.sendBinary(item);
      if (items && items.length > 0) state.order.push(session);
      else state.outbox.delete(session);
    }
  }

  #hostingMember(teamId: string, keyId: string): { state: SocketState; phase: MemberPhase } | null {
    const socketId = this.#teams.get(teamId)?.get(keyId);
    const state = socketId === undefined ? undefined : this.#sockets.get(socketId);
    if (state?.phase.kind !== "member" || !state.phase.hosting) return null;
    return { state, phase: state.phase };
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

  #failPendingFor(state: SocketState): void {
    for (const record of [...state.sessions.values()]) {
      if (!record.open && record.target.socketId === state.socket.id) this.#endSession(record, "target_unavailable");
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

  #release(socketId: string, graceful = false): void {
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
    if (phase.kind === "data") {
      const owner = this.#sockets.get(phase.ownerId);
      if (owner?.phase.kind !== "member" || owner.phase.dataSocketId !== socketId) return;
      owner.phase.dataSocketId = null;
      if (!graceful)
        for (const record of new Set(owner.sessions.values())) this.#endSession(record, "target_unavailable");
      else this.#flush(owner);
      return;
    }
    for (const [hash, ticket] of [...this.#tickets]) if (ticket.ownerId === socketId) this.#tickets.delete(hash);
    state.outbox.clear();
    state.order.length = 0;
    const records = new Set(state.sessions.values());
    state.sessions.clear();
    for (const record of records) {
      const closedBy = record.opener.socketId === socketId ? record.opener : record.target;
      this.#endSession(record, "target_unavailable", closedBy);
    }
    const data = phase.dataSocketId === null ? undefined : this.#sockets.get(phase.dataSocketId);
    if (data) {
      this.#release(data.socket.id, true);
      data.socket.close(RELAY_CLOSE_CODES.normal, "The control socket closed.");
    }
    const teamId = phase.identity.team.id;
    const members = this.#teams.get(teamId);
    if (members?.get(phase.identity.keyId) !== socketId) return;
    members.delete(phase.identity.keyId);
    if (members.size === 0) this.#teams.delete(teamId);
    this.#broadcastRoster(teamId, null);
  }
}

function ticketHash(ticket: string): string {
  return createHash("sha256").update(ticket).digest("hex");
}

function normalizedLabel(label: string | undefined): string | null {
  return label?.trim() || null;
}

function closeCode(code: RelayErrorCode) {
  if (code === "replaced") return RELAY_CLOSE_CODES.replaced;
  if (code === "target_unavailable" || code === "team_full") return RELAY_CLOSE_CODES.unavailable;
  return RELAY_CLOSE_CODES.policy;
}
