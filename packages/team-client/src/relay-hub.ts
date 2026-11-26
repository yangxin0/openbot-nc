import { decodeRelayHubServerMessage } from "@openbot/contracts/relay-protocol/decode";
import {
  decodeRelayHubFrame,
  encodeRelayHubFrame,
  RELAY_HUB_BULK_KIND,
  RELAY_HUB_IDLE_PING_MS,
  RELAY_HUB_MESSAGE_ID_MAX,
  RELAY_HUB_PING_ANSWER_MS,
  type RelayHubClientMessage,
  type RelayHubHello,
  type RelayHubKind,
  type RelayHubMember,
  type RelayHubServerMessage,
  type RelayHubUndeliverableCode,
  relayHelloTranscript,
} from "@openbot/contracts/relay-protocol/hub";
import {
  createRelayMessageKey,
  deriveRelayPairKeys,
  openRelayMessage,
  RelayMessageCounters,
  type RelayMessageCryptoErrorCode,
  type RelayMessageKey,
  type RelayPairKeys,
  relayMessageCounter,
  sealRelayMessage,
  verifyRelayMessageKey,
} from "@openbot/contracts/relay-protocol/message-crypto";
import {
  RELAY_CLOSE_CODES,
  RELAY_ERROR_CODES,
  RELAY_LABEL_LIMIT,
  RELAY_PING_ID_MAX,
  RELAY_PROTOCOL_VERSION,
  type RelayTeam,
  relayAudience,
} from "@openbot/contracts/relay-protocol/messages";
import { Schema } from "effect";
import { bytesToBase64Url } from "./base64";
import { readRelayCertificate, relayPeerCertificateRefusal, relayServerProofRefusal } from "./relay-certificates";
import { type RelayCrypto, webRelayCrypto } from "./relay-crypto";

export const RELAY_CONNECT_DEADLINE_MS = 15_000;

const RELAY_SOCKET_ERROR_CODES = [
  ...RELAY_ERROR_CODES,
  "identity_unavailable",
  "relay_url_missing",
  "insecure_relay_url",
  "connect_failed",
  "deadline_exceeded",
  "peer_refused",
  "server_refused",
  "closed",
] as const;
export type RelaySocketErrorCode = (typeof RELAY_SOCKET_ERROR_CODES)[number];

export class RelaySocketError extends Schema.TaggedError<RelaySocketError>()("RelaySocketError", {
  code: Schema.Literals(RELAY_SOCKET_ERROR_CODES),
  message: Schema.String,
}) {}

const RELAY_HUB_SEND_ERROR_CODES = ["not_connected", "offline", "unverified", "too_large", "closed"] as const;
export type RelayHubSendErrorCode = (typeof RELAY_HUB_SEND_ERROR_CODES)[number];

export class RelayHubSendError extends Schema.TaggedError<RelayHubSendError>()("RelayHubSendError", {
  code: Schema.Literals(RELAY_HUB_SEND_ERROR_CODES),
  message: Schema.String,
}) {}

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;
const RECONNECT_JITTER = 0.2;
const HEALTHY_AFTER_MS = 30_000;
const LIVENESS_TICK_MS = 500;
const BULK_LOW_WATER_BYTES = 256 * 1024;
const BULK_WAIT_MS = 5;
const INFO_TIMEOUT_MS = 10_000;
const RTT_SAMPLES = 5;
const SERVER_MESSAGE_CHARACTERS_LIMIT = 4 * 1024 * 1024;
const FINAL_CODES: ReadonlySet<RelaySocketErrorCode> = new Set([
  "replaced",
  "certificate_revoked",
  "certificate_expired",
  "authentication_failed",
  "identity_unavailable",
  "relay_url_missing",
  "insecure_relay_url",
  "server_refused",
]);

export interface RelayHubIdentity {
  relayUrl: string | null;
  team: string;
  keyId: string;
  certificate: string;
  chain: readonly string[];
  root: string;
}

export interface RelayHubSocket {
  readonly bufferedAmount: number;
  send(data: string | Uint8Array<ArrayBuffer>): void;
  close(code?: number, reason?: string): void;
}

export interface RelayHubSocketEvents {
  open(): void;
  text(data: string): void;
  binary(data: Uint8Array): void;
  closed(code: number, reason: string): void;
}

export type RelayHubSocketFactory = (url: string, events: RelayHubSocketEvents) => RelayHubSocket;

export type RelayHubState =
  | { status: "connecting" }
  | { status: "online"; rttMs?: number }
  | { status: "offline"; code: RelaySocketErrorCode | "stopped"; message: string; retryInMs: number | null };

export interface RelayHubSnapshot {
  state: RelayHubState;
  roster: readonly RelayHubMember[];
  self: RelayHubMember | null;
  team: RelayTeam | null;
}

export interface RelayHubMessage {
  from: string;
  kind: RelayHubKind;
  id: number;
  plaintext: Uint8Array<ArrayBuffer>;
}

export interface RelayHubUndeliverable {
  id: number;
  to: string;
  code: RelayHubUndeliverableCode;
}

export type RelayHubLog = (level: "info" | "warn", line: string) => void;

export interface RelayHubOptions {
  identity: RelayHubIdentity;
  sign: (data: Uint8Array<ArrayBuffer>) => Promise<Uint8Array | null>;
  crypto?: RelayCrypto;
  openSocket?: RelayHubSocketFactory;
  label?: string | null;
  hosting?: boolean;
  capabilities?: readonly string[];
  suspendable?: boolean;
  reconnect?: { baseMs?: number; maxMs?: number };
  connectDeadlineMs?: number;
  liveness?: { idleMs?: number; answerMs?: number };
  log?: RelayHubLog;
  now?: () => number;
}

interface Connection {
  readonly socket: RelayHubSocket;
  readonly startedAt: number;
  readonly clientNonce: string;
  readonly audience: string;
  readonly relayUrl: string;
  messageKey: RelayMessageKey | null;
  openedAt: number | null;
  welcomedAt: number | null;
  helloSent: boolean;
  proven: boolean;
  closed: boolean;
  lastSentAt: number;
  lastReceivedAt: number;
  ping: { id: number; sentAt: number; answerBy: number } | null;
  inbound: Promise<void>;
  bulk: Promise<void>;
  priority: Promise<void>;
  bulkWaiting: number;
  deadline: ReturnType<typeof setTimeout> | null;
  finish: (error: RelaySocketError) => void;
}

interface PeerKeys {
  member: RelayHubMember;
  pair: Promise<RelayPairKeys | null>;
  counters: RelayMessageCounters;
  inbound: Promise<void>;
}

export class RelayHubClient {
  readonly #options: RelayHubOptions;
  readonly #crypto: RelayCrypto;
  readonly #now: () => number;
  readonly #log: RelayHubLog;
  readonly #listeners = new Set<(snapshot: RelayHubSnapshot) => void>();
  readonly #messageListeners = new Set<(message: RelayHubMessage) => void>();
  readonly #undeliverableListeners = new Set<(undeliverable: RelayHubUndeliverable) => void>();
  readonly #roster = new Map<string, RelayHubMember>();
  readonly #peers = new Map<string, PeerKeys>();
  readonly #verified = new Map<string, Promise<Uint8Array | null>>();
  readonly #infos = new Map<number, (member: RelayHubMember | null) => void>();
  readonly #refusals = new Map<RelayMessageCryptoErrorCode | "unknown_sender", number>();
  readonly #rtts: number[] = [];
  #presence: { hosting: boolean; label: string | null };
  #connection: Connection | null = null;
  #running = false;
  #failures = 0;
  #retryTimer: ReturnType<typeof setTimeout> | null = null;
  #livenessTimer: ReturnType<typeof setInterval> | null = null;
  #nextMessageId = 0;
  #nextPingId = 0;
  #nextInfoId = 0;
  #socketsOpened = 0;
  #snapshot: RelayHubSnapshot = {
    state: { status: "offline", code: "stopped", message: "Not started.", retryInMs: null },
    roster: [],
    self: null,
    team: null,
  };

  constructor(options: RelayHubOptions) {
    this.#options = options;
    this.#crypto = options.crypto ?? webRelayCrypto;
    this.#now = options.now ?? Date.now;
    this.#log = options.log ?? (() => undefined);
    this.#presence = { hosting: options.hosting ?? false, label: relayLabel(options.label ?? null) };
  }

  get keyId(): string {
    return this.#options.identity.keyId;
  }

  get running(): boolean {
    return this.#running;
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#failures = 0;
    this.#livenessTimer = setInterval(() => this.#checkLiveness(), LIVENESS_TICK_MS);
    this.#connect();
  }

  stop(): void {
    if (!this.#running) return;
    this.#running = false;
    if (this.#retryTimer) clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
    if (this.#livenessTimer) clearInterval(this.#livenessTimer);
    this.#livenessTimer = null;
    const connection = this.#connection;
    this.#connection = null;
    if (connection) {
      connection.closed = true;
      if (connection.deadline) clearTimeout(connection.deadline);
      connection.socket.close(RELAY_CLOSE_CODES.normal, "The app stops.");
    }
    this.#forgetTeam();
    this.#update({ state: { status: "offline", code: "stopped", message: "Stopped.", retryInMs: null } });
  }

  snapshot(): RelayHubSnapshot {
    return this.#snapshot;
  }

  subscribe(listener: (snapshot: RelayHubSnapshot) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  onMessage(listener: (message: RelayHubMessage) => void): () => void {
    this.#messageListeners.add(listener);
    return () => this.#messageListeners.delete(listener);
  }

  onUndeliverable(listener: (undeliverable: RelayHubUndeliverable) => void): () => void {
    this.#undeliverableListeners.add(listener);
    return () => this.#undeliverableListeners.delete(listener);
  }

  members(): RelayHubMember[] {
    return this.#sortedRoster();
  }

  hosts(): RelayHubMember[] {
    return this.members().filter((member) => member.hosting);
  }

  member(keyId: string): RelayHubMember | null {
    return this.#roster.get(keyId) ?? null;
  }

  heartbeatRttMs(): number | null {
    if (this.#rtts.length === 0) return null;
    const sorted = [...this.#rtts].sort((first, second) => first - second);
    return sorted[Math.floor(sorted.length / 2)] ?? null;
  }

  socketsOpened(): number {
    return this.#socketsOpened;
  }

  refusals(): ReadonlyMap<RelayMessageCryptoErrorCode | "unknown_sender", number> {
    return this.#refusals;
  }

  setPresence(presence: { hosting: boolean; label?: string | null }): void {
    this.#presence = {
      hosting: presence.hosting,
      label: presence.label === undefined ? this.#presence.label : relayLabel(presence.label),
    };
    const connection = this.#connection;
    if (connection?.welcomedAt !== null && connection) {
      this.#sendControl(connection, {
        type: "presence",
        version: RELAY_PROTOCOL_VERSION,
        hosting: this.#presence.hosting,
        label: this.#presence.label,
      });
    }
  }

  checkLiveness(timeoutMs: number = RELAY_HUB_PING_ANSWER_MS): void {
    const connection = this.#connection;
    if (!connection || connection.welcomedAt === null) return;
    this.#ping(connection, timeoutMs);
  }

  info(keyId: string): Promise<RelayHubMember | null> {
    const connection = this.#connection;
    if (!connection || connection.welcomedAt === null) {
      return Promise.reject(new RelayHubSendError({ code: "not_connected", message: "The relay is not connected." }));
    }
    this.#nextInfoId = this.#nextInfoId >= RELAY_HUB_MESSAGE_ID_MAX ? 1 : this.#nextInfoId + 1;
    const id = this.#nextInfoId;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#infos.delete(id);
        resolve(null);
      }, INFO_TIMEOUT_MS);
      this.#infos.set(id, (member) => {
        clearTimeout(timer);
        resolve(member);
      });
      this.#sendControl(connection, { type: "info", version: RELAY_PROTOCOL_VERSION, id, about: keyId });
    });
  }

  send(to: string, kind: RelayHubKind, plaintext: Uint8Array<ArrayBuffer>): Promise<number> {
    const connection = this.#connection;
    if (!connection || connection.welcomedAt === null || !connection.messageKey) {
      return Promise.reject(new RelayHubSendError({ code: "not_connected", message: "The relay is not connected." }));
    }
    const member = this.#roster.get(to);
    if (!member) {
      return Promise.reject(new RelayHubSendError({ code: "offline", message: "The member is offline." }));
    }
    const peer = this.#peerFor(member, connection);
    this.#nextMessageId = this.#nextMessageId >= RELAY_HUB_MESSAGE_ID_MAX ? 1 : this.#nextMessageId + 1;
    const id = this.#nextMessageId;
    const bulk = kind === RELAY_HUB_BULK_KIND;
    const messageKey = connection.messageKey;
    const step = async (): Promise<number> => {
      const keys = await peer.pair;
      if (!keys) throw new RelayHubSendError({ code: "unverified", message: "The member key cannot be verified." });
      const counter = peer.counters.next(kind);
      if (counter === null) throw new RelayHubSendError({ code: "closed", message: "The message counter is used up." });
      const binding = { from: this.keyId, to, id, kind };
      const payload = await sealRelayMessage(this.#crypto, keys.send, binding, counter, plaintext);
      const frame = encodeRelayHubFrame({ type: "send", kind, id, peer: to, payload });
      if (!frame) throw new RelayHubSendError({ code: "too_large", message: "The message is too large." });
      if (bulk) await this.#bulkReady(connection);
      if (connection.closed || connection.messageKey !== messageKey) {
        throw new RelayHubSendError({ code: "closed", message: "The relay connection closed." });
      }
      connection.socket.send(frame);
      connection.lastSentAt = this.#now();
      return id;
    };
    const run = (bulk ? connection.bulk : connection.priority).then(step, step);
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    if (bulk) connection.bulk = settled;
    else connection.priority = settled;
    return run;
  }

  #connect(): void {
    if (!this.#running) return;
    const { identity } = this.#options;
    const relayUrl = identity.relayUrl;
    this.#update({ state: { status: "connecting" } });
    const refusal = relayUrlRefusal(relayUrl);
    if (refusal || relayUrl === null) {
      this.#closed(null, refusal ?? new RelaySocketError({ code: "relay_url_missing", message: "No relay address." }));
      return;
    }
    const startedAt = this.#now();
    const clientNonce = bytesToBase64Url(this.#crypto.randomBytes(32));
    let connection: Connection | null = null;
    const events: RelayHubSocketEvents = {
      open: () => {
        if (!connection || connection.closed) return;
        connection.openedAt = this.#now();
        void this.#sendHello(connection);
      },
      text: (data) => {
        if (!connection || connection.closed) return;
        connection.lastReceivedAt = this.#now();
        const message = decodeText(data);
        if (!message) {
          connection.finish(
            new RelaySocketError({ code: "protocol_error", message: "The relay sent an invalid message." }),
          );
          return;
        }
        const current = connection;
        current.inbound = current.inbound.then(() => this.#receive(current, message));
      },
      binary: (data) => {
        if (!connection || connection.closed) return;
        connection.lastReceivedAt = this.#now();
        this.#deliver(connection, data);
      },
      closed: (code, reason) => {
        if (!connection || connection.closed) return;
        connection.finish(closeError(code, reason, connection.openedAt !== null));
      },
    };
    let socket: RelayHubSocket;
    try {
      socket = (this.#options.openSocket ?? browserRelayHubSocket)(relayUrl, events);
    } catch {
      this.#closed(
        null,
        new RelaySocketError({ code: "connect_failed", message: "The relay socket cannot be opened." }),
      );
      return;
    }
    this.#socketsOpened += 1;
    const created: Connection = {
      socket,
      startedAt,
      clientNonce,
      audience: relayAudience(relayUrl),
      relayUrl,
      messageKey: null,
      openedAt: null,
      welcomedAt: null,
      helloSent: false,
      proven: false,
      closed: false,
      lastSentAt: startedAt,
      lastReceivedAt: startedAt,
      ping: null,
      inbound: Promise.resolve(),
      bulk: Promise.resolve(),
      priority: Promise.resolve(),
      bulkWaiting: 0,
      deadline: null,
      finish: (error) => {
        if (created.closed) return;
        created.closed = true;
        if (created.deadline) clearTimeout(created.deadline);
        created.socket.close(RELAY_CLOSE_CODES.normal, "The app closes the connection.");
        this.#closed(created, error);
      },
    };
    connection = created;
    this.#connection = created;
    created.deadline = setTimeout(
      () =>
        created.finish(
          new RelaySocketError({ code: "deadline_exceeded", message: "The relay did not answer in time." }),
        ),
      this.#options.connectDeadlineMs ?? RELAY_CONNECT_DEADLINE_MS,
    );
    void this.#prepareKey(created);
  }

  async #prepareKey(connection: Connection): Promise<void> {
    const key = await createRelayMessageKey(this.#crypto, {
      keyId: this.keyId,
      timestamp: this.#now(),
      sign: (data) => this.#options.sign(data).catch(() => null),
    }).catch(() => null);
    if (connection.closed) return;
    if (!key) {
      connection.finish(
        new RelaySocketError({ code: "identity_unavailable", message: "The relay identity cannot sign." }),
      );
      return;
    }
    connection.messageKey = key;
    if (connection.openedAt !== null) await this.#sendHello(connection);
  }

  async #sendHello(connection: Connection): Promise<void> {
    const key = connection.messageKey;
    if (!key || connection.openedAt === null || connection.closed || connection.helloSent) return;
    connection.helloSent = true;
    const fields: Omit<RelayHubHello, "type" | "certificate" | "chain" | "signature"> = {
      version: RELAY_PROTOCOL_VERSION,
      audience: connection.audience,
      timestamp: key.timestamp,
      clientNonce: connection.clientNonce,
      label: this.#presence.label,
      hosting: this.#presence.hosting,
      capabilities: [...(this.#options.capabilities ?? [])],
      suspendable: this.#options.suspendable ?? false,
      messageKey: key.text,
      messageKeySignature: key.signature,
    };
    const signature = await this.#options.sign(relayHelloTranscript(fields)).catch(() => null);
    if (connection.closed) return;
    if (!signature) {
      connection.finish(
        new RelaySocketError({ code: "identity_unavailable", message: "The relay identity cannot sign." }),
      );
      return;
    }
    const { identity } = this.#options;
    this.#sendControl(connection, {
      type: "hello",
      ...fields,
      certificate: identity.certificate,
      chain: [...identity.chain],
      signature: bytesToBase64Url(signature),
    });
  }

  async #receive(connection: Connection, message: RelayHubServerMessage): Promise<void> {
    if (connection.closed) return;
    if (connection.ping && message.type === "pong" && message.id === connection.ping.id) {
      this.#rtts.push(this.#now() - connection.ping.sentAt);
      if (this.#rtts.length > RTT_SAMPLES) this.#rtts.shift();
    }
    connection.ping = null;
    if (message.type === "error") {
      connection.finish(new RelaySocketError({ code: message.code, message: message.message }));
      return;
    }
    if (!connection.proven) {
      if (message.type !== "server-proof") {
        connection.finish(
          new RelaySocketError({
            code: "server_refused",
            message: "The relay did not prove that it belongs to the team.",
          }),
        );
        return;
      }
      const refusal = await relayServerProofRefusal({
        certificate: message.certificate,
        signature: message.signature,
        root: this.#options.identity.root,
        relayUrl: connection.relayUrl,
        transcript: { clientNonce: connection.clientNonce, audience: connection.audience, clientKeyId: this.keyId },
        now: this.#now(),
        crypto: this.#crypto,
      });
      if (refusal !== null) {
        connection.finish(
          new RelaySocketError({
            code: "server_refused",
            message: `The relay server did not prove that it belongs to the team (${refusal}).`,
          }),
        );
        return;
      }
      connection.proven = true;
      return;
    }
    if (connection.welcomedAt === null) {
      if (message.type !== "welcome") {
        connection.finish(new RelaySocketError({ code: "protocol_error", message: "The relay did not send welcome." }));
        return;
      }
      connection.welcomedAt = this.#now();
      if (connection.deadline) clearTimeout(connection.deadline);
      connection.deadline = null;
      this.#roster.clear();
      for (const member of message.roster) this.#roster.set(member.keyId, member);
      for (const member of message.roster) void this.#verify(member);
      const opened = connection.openedAt ?? connection.welcomedAt;
      this.#log(
        "info",
        `relay connected in ${connection.welcomedAt - connection.startedAt} ms (TCP+TLS+WebSocket open ${
          opened - connection.startedAt
        } ms, hello to welcome ${connection.welcomedAt - opened} ms)`,
      );
      this.#update({
        state: { status: "online" },
        self: message.self,
        team: message.team,
        roster: this.#sortedRoster(),
      });
      return;
    }
    switch (message.type) {
      case "online": {
        const previous = this.#roster.get(message.member.keyId);
        this.#roster.set(message.member.keyId, message.member);
        if (previous && previous.messageKey !== message.member.messageKey) this.#peers.delete(previous.keyId);
        void this.#verify(message.member);
        this.#update({ roster: this.#sortedRoster() });
        return;
      }
      case "offline":
        this.#roster.delete(message.keyId);
        this.#peers.delete(message.keyId);
        this.#update({ roster: this.#sortedRoster() });
        return;
      case "info":
        this.#infos.get(message.id)?.(message.member);
        this.#infos.delete(message.id);
        return;
      case "undeliverable":
        for (const listener of this.#undeliverableListeners)
          listener({ id: message.id, to: message.to, code: message.code });
        return;
      case "pong":
        if (this.#snapshot.state.status === "online") {
          const rttMs = this.heartbeatRttMs();
          if (rttMs !== null) this.#snapshot = { ...this.#snapshot, state: { status: "online", rttMs } };
        }
        return;
      default:
        connection.finish(
          new RelaySocketError({ code: "protocol_error", message: "The relay message is not expected." }),
        );
    }
  }

  #deliver(connection: Connection, data: Uint8Array): void {
    const frame = decodeRelayHubFrame(data);
    if (frame?.type !== "deliver" || connection.welcomedAt === null) {
      connection.finish(new RelaySocketError({ code: "protocol_error", message: "The relay sent an invalid frame." }));
      return;
    }
    const member = this.#roster.get(frame.peer);
    if (!member) {
      this.#refuse("unknown_sender");
      return;
    }
    const peer = this.#peerFor(member, connection);
    peer.inbound = peer.inbound.then(async () => {
      const keys = await peer.pair;
      if (connection.closed) return;
      if (!keys) {
        this.#refuse("message_unverified");
        return;
      }
      const counter = relayMessageCounter(frame.payload);
      if (counter === null || !peer.counters.fresh(frame.kind, counter)) {
        this.#refuse(counter === null ? "message_integrity_failed" : "message_replayed");
        return;
      }
      const binding = { from: frame.peer, to: this.keyId, id: frame.id, kind: frame.kind };
      const opened = await openRelayMessage(this.#crypto, keys.receive, binding, frame.payload);
      if (!opened || !peer.counters.accept(frame.kind, opened.counter)) {
        this.#refuse(opened ? "message_replayed" : "message_integrity_failed");
        return;
      }
      const message = { from: frame.peer, kind: frame.kind, id: frame.id, plaintext: opened.plaintext };
      for (const listener of this.#messageListeners) listener(message);
    });
  }

  #refuse(code: RelayMessageCryptoErrorCode | "unknown_sender"): void {
    this.#refusals.set(code, (this.#refusals.get(code) ?? 0) + 1);
    this.#log("warn", `relay message refused (${code})`);
  }

  #verify(member: RelayHubMember): Promise<Uint8Array | null> {
    const cacheKey = `${member.keyId}\n${member.messageKey}\n${member.messageKeySignature}\n${member.keyTimestamp}`;
    const cached = this.#verified.get(cacheKey);
    if (cached) return cached;
    const { identity } = this.#options;
    const verified = (async () => {
      const refusal = await relayPeerCertificateRefusal(
        member,
        { team: identity.team, root: identity.root, chain: identity.chain },
        this.#now(),
        this.#crypto,
      );
      if (refusal !== null) return null;
      const certificate = await readRelayCertificate(member.certificate, this.#crypto);
      if (!certificate) return null;
      return verifyRelayMessageKey(this.#crypto, {
        keyId: member.keyId,
        messageKey: member.messageKey,
        signature: member.messageKeySignature,
        timestamp: member.keyTimestamp,
        spki: certificate.spki,
      });
    })().catch(() => null);
    this.#verified.set(cacheKey, verified);
    return verified;
  }

  #peerFor(member: RelayHubMember, connection: Connection): PeerKeys {
    const existing = this.#peers.get(member.keyId);
    if (existing && existing.member.messageKey === member.messageKey) return existing;
    const messageKey = connection.messageKey;
    const pair =
      messageKey === null
        ? Promise.resolve(null)
        : this.#verify(member).then((point) =>
            point === null
              ? null
              : deriveRelayPairKeys(this.#crypto, {
                  selfKeyId: this.keyId,
                  selfMessageKey: messageKey,
                  peerKeyId: member.keyId,
                  peerMessageKey: new Uint8Array(point),
                }),
          );
    const peer: PeerKeys = { member, pair, counters: new RelayMessageCounters(), inbound: Promise.resolve() };
    this.#peers.set(member.keyId, peer);
    return peer;
  }

  async #bulkReady(connection: Connection): Promise<void> {
    while (!connection.closed && connection.socket.bufferedAmount > BULK_LOW_WATER_BYTES) {
      await new Promise((resolve) => setTimeout(resolve, BULK_WAIT_MS));
    }
  }

  #checkLiveness(): void {
    const connection = this.#connection;
    if (!connection || connection.closed || connection.welcomedAt === null) return;
    const now = this.#now();
    const answerMs = this.#options.liveness?.answerMs ?? RELAY_HUB_PING_ANSWER_MS;
    if (connection.ping) {
      if (now >= connection.ping.answerBy && connection.lastReceivedAt < connection.ping.sentAt) {
        this.#log("warn", "relay heartbeat missed; closing the socket");
        connection.finish(
          new RelaySocketError({ code: "heartbeat_timeout", message: "The relay did not answer in time." }),
        );
      }
      return;
    }
    const idleMs = this.#options.liveness?.idleMs ?? RELAY_HUB_IDLE_PING_MS;
    if (now - connection.lastSentAt >= idleMs || now - connection.lastReceivedAt >= idleMs)
      this.#ping(connection, answerMs);
  }

  #ping(connection: Connection, timeoutMs: number): void {
    this.#nextPingId = this.#nextPingId >= RELAY_PING_ID_MAX ? 1 : this.#nextPingId + 1;
    const sentAt = this.#now();
    connection.ping = { id: this.#nextPingId, sentAt, answerBy: sentAt + timeoutMs };
    this.#sendControl(connection, { type: "ping", version: RELAY_PROTOCOL_VERSION, id: this.#nextPingId });
  }

  #sendControl(connection: Connection, message: RelayHubClientMessage): void {
    if (connection.closed) return;
    connection.socket.send(JSON.stringify(message));
    connection.lastSentAt = this.#now();
  }

  #closed(connection: Connection | null, error: RelaySocketError): void {
    if (connection && this.#connection !== connection) return;
    const healthy = connection?.welcomedAt != null && this.#now() - connection.welcomedAt >= HEALTHY_AFTER_MS;
    this.#connection = null;
    for (const resolve of this.#infos.values()) resolve(null);
    this.#infos.clear();
    this.#forgetTeam();
    if (connection?.welcomedAt != null) {
      this.#log("info", `relay closed (${error.code}) after ${this.#now() - connection.welcomedAt} ms`);
    }
    if (!this.#running) return;
    if (FINAL_CODES.has(error.code)) {
      this.#running = false;
      if (this.#livenessTimer) clearInterval(this.#livenessTimer);
      this.#livenessTimer = null;
      this.#update({ state: { status: "offline", code: error.code, message: error.message, retryInMs: null } });
      return;
    }
    const atOnce = healthy || error.code === "heartbeat_timeout";
    this.#failures = atOnce ? 0 : this.#failures + 1;
    const delay = atOnce ? 0 : this.#retryDelay(this.#failures);
    this.#update({ state: { status: "offline", code: error.code, message: error.message, retryInMs: delay } });
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = null;
      this.#connect();
    }, delay);
  }

  #sortedRoster(): RelayHubMember[] {
    return [...this.#roster.values()].sort(
      (first, second) => first.connectedAt - second.connectedAt || (first.keyId < second.keyId ? -1 : 1),
    );
  }

  #forgetTeam(): void {
    this.#roster.clear();
    this.#peers.clear();
    this.#update({ roster: [] });
  }

  #retryDelay(failures: number): number {
    const base = this.#options.reconnect?.baseMs ?? RECONNECT_BASE_MS;
    const max = this.#options.reconnect?.maxMs ?? RECONNECT_MAX_MS;
    const delay = Math.min(max, base * 2 ** Math.max(0, failures - 1));
    return Math.round(delay * (1 - RECONNECT_JITTER + Math.random() * RECONNECT_JITTER * 2));
  }

  #update(change: Partial<RelayHubSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...change };
    for (const listener of this.#listeners) listener(this.#snapshot);
  }
}

export function browserRelayHubSocket(url: string, events: RelayHubSocketEvents): RelayHubSocket {
  const socket = new WebSocket(url);
  socket.binaryType = "arraybuffer";
  socket.addEventListener("open", () => events.open());
  socket.addEventListener("message", (event: MessageEvent<string | ArrayBuffer>) => {
    if (typeof event.data === "string") events.text(event.data);
    else if (event.data instanceof ArrayBuffer) events.binary(new Uint8Array(event.data));
  });
  socket.addEventListener("close", (event) => events.closed(event.code, event.reason));
  return {
    get bufferedAmount() {
      return Number.isFinite(socket.bufferedAmount) ? socket.bufferedAmount : 0;
    },
    send: (data) => socket.send(data),
    close: (code, reason) => {
      try {
        socket.close(code, reason);
      } catch {
        socket.close();
      }
    },
  };
}

function relayUrlRefusal(relayUrl: string | null): RelaySocketError | null {
  if (relayUrl === null) {
    return new RelaySocketError({ code: "relay_url_missing", message: "The identity does not name a relay server." });
  }
  let url: URL;
  try {
    url = new URL(relayUrl);
  } catch {
    return new RelaySocketError({ code: "relay_url_missing", message: "The relay address is not valid." });
  }
  if (url.protocol !== "wss:" && !(url.protocol === "ws:" && isLoopback(url.hostname))) {
    return new RelaySocketError({
      code: "insecure_relay_url",
      message: "A relay server on a different computer must use TLS.",
    });
  }
  return null;
}

function relayLabel(label: string | null): string | null {
  const trimmed = label?.trim() ?? "";
  return trimmed ? trimmed.slice(0, RELAY_LABEL_LIMIT) : null;
}

function decodeText(text: string): RelayHubServerMessage | null {
  if (text.length > SERVER_MESSAGE_CHARACTERS_LIMIT) return null;
  try {
    return decodeRelayHubServerMessage(JSON.parse(text));
  } catch {
    return null;
  }
}

function closeError(code: number, reason: string, opened: boolean): RelaySocketError {
  if (!opened) return new RelaySocketError({ code: "connect_failed", message: "The relay socket cannot be opened." });
  if (code === RELAY_CLOSE_CODES.replaced) {
    return new RelaySocketError({ code: "replaced", message: reason || "A newer connection replaced this one." });
  }
  return new RelaySocketError({ code: "closed", message: reason || "The relay connection closed." });
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}
