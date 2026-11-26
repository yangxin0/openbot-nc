import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { RelayHubMember } from "@openbot/contracts/relay-protocol/hub";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import {
  decodeTeamProtocolV2EventFrame,
  decodeTeamProtocolV2RpcFrame,
  encodeTeamProtocolV2Frame,
  type TeamProtocolV2Json,
  type TeamProtocolV2RpcFrame,
} from "@openbot/contracts/team-protocol/v2";
import type { RelayHubMessage } from "@openbot/team-client/relay-hub";
import { Effect } from "effect";
import type { RemoteEventSocket } from "../remote-server-event-stream";
import { TeamV2FileTransfer } from "../team-v2-file-transfer";
import type { RelayControl } from "./control";
import { RelayHubPeerTransport, relayHubDirection } from "./hub-transport";
import { RelaySocketError } from "./socket";

const RAW_HTTP_OPERATION = "http.raw";
const REQUEST_TIMEOUT_MS = 10 * 60_000 + 30_000;
const EVENT_ACK_DELAY_MS = 50;
const SOCKET_STATES = { connecting: 0, open: 1, closing: 2, closed: 3 } as const;
const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const EMPTY_BODY_STATUSES = new Set([101, 204, 205, 304]);

type RawMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface PendingRequest {
  resolve: (frame: TeamProtocolV2RpcFrame) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class RelayHostClient {
  readonly keyId: string;
  readonly #control: RelayControl;
  readonly #transport: RelayHubPeerTransport;
  readonly #files: TeamV2FileTransfer;
  readonly #pending = new Map<string, PendingRequest>();
  #events: RelayHubEventSocket | null = null;
  #lastEventSequence = 0;
  #eventAckTimer: ReturnType<typeof setTimeout> | null = null;
  #disposed = false;

  constructor(control: RelayControl, keyId: string, transferDirectory: string) {
    this.#control = control;
    this.keyId = keyId;
    this.#transport = new RelayHubPeerTransport(control, keyId, "to-host", () => control.member(keyId) !== null);
    this.#files = new TeamV2FileTransfer(this.#transport, transferDirectory);
    this.#files.setPeerAuthenticated(keyId, true);
    this.#transport.on("data", this.#onData);
    control.on("message", this.#onMessage);
    control.on("roster", this.#onRoster);
  }

  readonly #onMessage = (message: RelayHubMessage): void => {
    if (this.#disposed || message.from !== this.keyId || relayHubDirection(message.plaintext) !== "to-client") return;
    this.#transport.receive(message.kind, message.plaintext);
  };

  readonly #onRoster = (members: readonly RelayHubMember[]): void => {
    this.setOnline(members.some((member) => member.keyId === this.keyId));
  };

  setOnline(online: boolean): void {
    if (online) return;
    this.#failPending(hostOffline());
    this.#events?.closeFromHost(1006);
  }

  hasActiveTransfers(): boolean {
    return this.#files.hasActiveTransfers();
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#transport.off("data", this.#onData);
    this.#control.off("message", this.#onMessage);
    this.#control.off("roster", this.#onRoster);
    this.#failPending(new RelaySocketError({ code: "closed", message: "The relay connection closed." }));
    this.#events?.closeFromHost(1001);
    if (this.#eventAckTimer) clearTimeout(this.#eventAckTimer);
    await Effect.runPromise(this.#files.stop());
  }

  async fetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (!isRawMethod(method)) throw new TypeError("fetch failed", { cause: new Error("The method is not supported.") });
    if (!this.#control.member(this.keyId)) throw new TypeError("fetch failed", { cause: hostOffline() });
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, name) => {
      headers[name] = value;
    });
    const body = init.body ?? null;
    let text: string | null = null;
    let bodyTransferId: string | undefined;
    if (isString(body)) text = body;
    else if (body instanceof URLSearchParams) text = body.toString();
    else if (body !== null) {
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      bodyTransferId = await Effect.runPromise(
        this.#files.send(this.keyId, {
          name: "request-body",
          mimeType: headers["content-type"] ?? "application/octet-stream",
          bytes,
        }),
      ).catch((cause: unknown) => {
        throw new TypeError("fetch failed", { cause });
      });
    }
    const requestId = randomUUID();
    const frame = encodeTeamProtocolV2Frame({
      version: 2,
      type: "request",
      requestId,
      operation: RAW_HTTP_OPERATION,
      payload: {
        method,
        path: `${url.pathname}${url.search}`,
        headers,
        body: text,
        ...(bodyTransferId === undefined ? {} : { bodyTransferId }),
      },
    });
    const answer = new Promise<TeamProtocolV2RpcFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(requestId);
        reject(new RelaySocketError({ code: "deadline_exceeded", message: "The host did not answer in time." }));
      }, REQUEST_TIMEOUT_MS);
      this.#pending.set(requestId, { resolve, reject, timer });
      init.signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          this.#pending.delete(requestId);
          reject(init.signal?.reason ?? new Error("The request was stopped."));
        },
        { once: true },
      );
    });
    answer.catch(() => undefined);
    await Effect.runPromise(this.#transport.send(this.keyId, "rpc", frame)).catch((cause: unknown) => {
      this.#pending.get(requestId)?.reject(new TypeError("fetch failed", { cause }));
    });
    let response: TeamProtocolV2RpcFrame;
    try {
      response = await answer;
    } catch (cause) {
      if (cause instanceof TypeError) throw cause;
      throw new TypeError("fetch failed", { cause });
    }
    return this.#response(response);
  }

  openEventSocket(): RemoteEventSocket {
    this.#events?.closeFromHost(1000);
    const socket = new RelayHubEventSocket(
      (control) => this.#sendEventFrame(control),
      () => {
        if (this.#events === socket) this.#events = null;
      },
    );
    this.#events = socket;
    this.#lastEventSequence = 0;
    setImmediate(() => {
      if (socket.readyState !== SOCKET_STATES.connecting) return;
      void Effect.runPromise(
        this.#transport.send(
          this.keyId,
          "events",
          encodeTeamProtocolV2Frame({ version: 2, type: "event-ack", throughSequence: 0 }),
        ),
      ).then(
        () => socket.opened(),
        () => socket.closeFromHost(1006),
      );
    });
    return socket;
  }

  async #response(frame: TeamProtocolV2RpcFrame): Promise<Response> {
    if (frame.type !== "response") throw new TypeError("fetch failed");
    if ("error" in frame) {
      const status = frame.error.status ?? 502;
      return Response.json({ error: frame.error.message, code: frame.error.code }, { status });
    }
    const result = frame.result;
    if (!isDynamicRecord(result) || !isNumber(result.status) || !isDynamicRecord(result.headers)) {
      throw new TypeError("fetch failed", { cause: new Error("The host answer is not valid.") });
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(result.headers)) if (isString(value)) headers.set(name, value);
    const status = result.status;
    if (EMPTY_BODY_STATUSES.has(status)) return new Response(null, { status, headers });
    const file = result.file;
    if (isDynamicRecord(file) && isString(file.transferId)) {
      const received = await Effect.runPromise(this.#files.consume(this.keyId, file.transferId)).catch(
        (cause: unknown) => {
          throw new TypeError("fetch failed", { cause });
        },
      );
      return new Response(new Uint8Array(received.bytes), { status, headers });
    }
    return new Response(isString(result.body) ? result.body : null, { status, headers });
  }

  readonly #onData = (_peerId: string, channel: string, data: string | ArrayBuffer): void => {
    if (!isString(data)) return;
    if (channel === "rpc") {
      let frame: TeamProtocolV2RpcFrame;
      try {
        frame = decodeTeamProtocolV2RpcFrame(data);
      } catch {
        return;
      }
      const pending = this.#pending.get(frame.requestId);
      if (!pending || frame.type !== "response") return;
      this.#pending.delete(frame.requestId);
      clearTimeout(pending.timer);
      pending.resolve(frame);
      return;
    }
    if (channel === "events") this.#onEvent(data);
  };

  #onEvent(data: string): void {
    const socket = this.#events;
    if (!socket || socket.readyState !== SOCKET_STATES.open) return;
    let frame: ReturnType<typeof decodeTeamProtocolV2EventFrame>;
    try {
      frame = decodeTeamProtocolV2EventFrame(data);
    } catch {
      socket.closeFromHost(1011);
      return;
    }
    if (frame.type === "event-reset") {
      if (socket.received) {
        socket.closeFromHost(1012);
        return;
      }
      this.#lastEventSequence = frame.nextSequence - 1;
      this.#scheduleEventAck();
      return;
    }
    if (frame.type !== "event") return;
    if (frame.sequence <= this.#lastEventSequence) return;
    if (frame.sequence !== this.#lastEventSequence + 1) {
      socket.closeFromHost(1011);
      return;
    }
    this.#lastEventSequence = frame.sequence;
    socket.deliver(frame.payload);
    this.#scheduleEventAck();
  }

  #scheduleEventAck(): void {
    if (this.#eventAckTimer) return;
    this.#eventAckTimer = setTimeout(() => {
      this.#eventAckTimer = null;
      if (!this.#events) return;
      this.#sendEventFrame(
        encodeTeamProtocolV2Frame({ version: 2, type: "event-ack", throughSequence: this.#lastEventSequence }),
      );
    }, EVENT_ACK_DELAY_MS);
  }

  #sendEventFrame(frame: string): void {
    void Effect.runPromise(this.#transport.send(this.keyId, "events", frame)).catch(() => undefined);
  }

  #failPending(error: Error): void {
    for (const [requestId, pending] of [...this.#pending]) {
      clearTimeout(pending.timer);
      this.#pending.delete(requestId);
      pending.reject(new TypeError("fetch failed", { cause: error }));
    }
  }
}

class RelayHubEventSocket implements RemoteEventSocket {
  readonly protocol = "openbot-team-v1";
  readonly #emitter = new EventEmitter();
  readonly #sendControl: (frame: string) => void;
  readonly #released: () => void;
  #state: number = SOCKET_STATES.connecting;
  received = false;

  constructor(sendControl: (frame: string) => void, released: () => void) {
    this.#sendControl = sendControl;
    this.#released = released;
    this.#emitter.on("error", () => undefined);
  }

  get readyState(): number {
    return this.#state;
  }

  addEventListener(type: "open" | "error", listener: () => void, options?: { once?: boolean }): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "close", listener: (event: { code: number }) => void, options?: { once?: boolean }): void;
  addEventListener(
    type: "open" | "error" | "message" | "close",
    listener: (() => void) | ((event: { data: unknown }) => void) | ((event: { code: number }) => void),
    options?: { once?: boolean },
  ): void {
    if (options?.once) this.#emitter.once(type, listener);
    else this.#emitter.on(type, listener);
  }

  send(data: string): void {
    if (this.#state !== SOCKET_STATES.open) return;
    let control: unknown;
    try {
      control = JSON.parse(data);
    } catch {
      return;
    }
    if (!isDynamicRecord(control) || control.type === "agent-event-scope") return;
    let frame: string;
    try {
      frame = encodeTeamProtocolV2Frame({ version: 2, type: "event-control", control: eventControl(control) });
    } catch {
      return;
    }
    this.#sendControl(frame);
  }

  close(code = 1000): void {
    this.closeFromHost(code);
  }

  opened(): void {
    if (this.#state !== SOCKET_STATES.connecting) return;
    this.#state = SOCKET_STATES.open;
    this.#emitter.emit("open");
  }

  deliver(payload: TeamProtocolV2Json): void {
    this.received = true;
    this.#emitter.emit("message", { data: JSON.stringify(payload) });
  }

  closeFromHost(code: number): void {
    if (this.#state === SOCKET_STATES.closed) return;
    this.#state = SOCKET_STATES.closed;
    this.#released();
    this.#emitter.emit("close", { code });
  }
}

function eventControl(value: unknown) {
  if (!isDynamicRecord(value)) throw new Error("The event control is not an object.");
  if (value.type === "runtime-snapshot-request") return { type: "runtime-snapshot-request" } as const;
  if (
    value.type === "team-typing" &&
    (value.botId === null || isString(value.botId)) &&
    typeof value.typing === "boolean"
  )
    return { type: "team-typing", botId: value.botId, typing: value.typing } as const;
  if (value.type === "team-direct-typing" && isString(value.recipientMemberId) && typeof value.typing === "boolean")
    return { type: "team-direct-typing", recipientMemberId: value.recipientMemberId, typing: value.typing } as const;
  throw new Error("The event control is not supported.");
}

function isRawMethod(method: string): method is RawMethod {
  return METHODS.has(method);
}

function hostOffline(): RelaySocketError {
  return new RelaySocketError({ code: "target_unavailable", message: "The member is offline or does not host." });
}
