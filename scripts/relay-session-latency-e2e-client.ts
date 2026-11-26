import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import type { RelaySessionSource, RelayTeamPeerActions } from "@openbot/team-client/relay-client";
import { openRelayV2Tunnels } from "@openbot/team-client/relay-v2-tunnels";

const REQUEST_SAMPLES = 5;
const TRANSFER_SAMPLES = 5;

interface Peer {
  execute(command: {
    id: string;
    type: "connect" | "request" | "disconnect";
    hostId?: string;
    hostPublicKey?: string;
    method?: string;
    path?: string;
    body?: unknown;
    upload?: { name: string; mimeType: string; base64: string };
  }): Promise<{ ok: boolean; status?: number; error?: string }>;
  dispose(): Promise<void>;
}

export interface TeamClientMeasureInput {
  sessions: RelaySessionSource;
  createPeer: (actions: { current: RelayTeamPeerActions }) => Peer;
  hostKeyId: string;
  uploadBase64: string;
  sessionOpens: () => number;
  sockets: () => number;
  waitMs: number;
}

export interface TeamClientMeasurements {
  readonly tunnelsReadyMs: number;
  readonly sessionOpensForTunnels: number;
  readonly connectMs: number;
  readonly sessionOpensForConnect: number;
  readonly requestMs: readonly number[];
  readonly requestStatuses: readonly number[];
  readonly duringUploadMs: readonly number[];
  readonly duringUploadActive: readonly boolean[];
  readonly uploadMs: number;
  readonly uploadStatus: number;
  readonly sockets: number;
}

let commands = 0;

function commandId(): string {
  commands += 1;
  return `latency-${commands}`;
}

function deadline<T>(description: string, promise: Promise<T>, waitMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out: ${description}.`)), waitMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function measureTeamClient(input: TeamClientMeasureInput): Promise<TeamClientMeasurements> {
  const { hostKeyId, waitMs } = input;
  const opensBeforeTunnels = input.sessionOpens();
  const tunnelsStarted = performance.now();
  const tunnels = await deadline("the V2 tunnels", openRelayV2Tunnels(input.sessions, hostKeyId), waitMs);
  const tunnelsReadyMs = performance.now() - tunnelsStarted;
  const sessionOpensForTunnels = input.sessionOpens() - opensBeforeTunnels;
  tunnels.close();

  const progress: { sent: number; total: number; waiters: Set<() => void> } = { sent: 0, total: 0, waiters: new Set() };
  const peer = input.createPeer({
    current: {
      onConnectionUpdate: async () => undefined,
      onTeamEvent: async () => undefined,
      onUploadProgress: async (update) => {
        progress.sent = update.sent;
        progress.total = update.total;
        for (const waiter of [...progress.waiters]) waiter();
      },
    },
  });
  try {
    const opensBeforeConnect = input.sessionOpens();
    const connectStarted = performance.now();
    const connected = await deadline(
      "the peer connection",
      peer.execute({ id: commandId(), type: "connect", hostId: hostKeyId, hostPublicKey: hostKeyId }),
      waitMs,
    );
    if (!connected.ok) throw new Error(`The peer did not connect: ${connected.error ?? "no error"}`);
    const connectMs = performance.now() - connectStarted;
    const sessionOpensForConnect = input.sessionOpens() - opensBeforeConnect;

    const request = async () => {
      const started = performance.now();
      const result = await deadline(
        "a request",
        peer.execute({
          id: commandId(),
          type: "request",
          method: "GET",
          path: TEAM_API_ROUTES.compatibility,
          body: {},
        }),
        waitMs,
      );
      return { ms: performance.now() - started, status: result.status ?? 0 };
    };
    const requestMs: number[] = [];
    const requestStatuses: number[] = [];
    for (let index = 0; index < REQUEST_SAMPLES; index += 1) {
      const sample = await request();
      requestMs.push(sample.ms);
      requestStatuses.push(sample.status);
    }

    const uploadState = { done: false };
    const uploadStarted = performance.now();
    const uploading = peer
      .execute({
        id: commandId(),
        type: "request",
        method: "POST",
        path: `${TEAM_API_ROUTES.attachments}?name=latency.bin&mime=application%2Foctet-stream`,
        body: null,
        upload: { name: "latency.bin", mimeType: "application/octet-stream", base64: input.uploadBase64 },
      })
      .finally(() => {
        uploadState.done = true;
      });
    await deadline(
      "the upload starts",
      new Promise<void>((resolve) => {
        const look = () => {
          if (progress.sent <= 0 && !uploadState.done) return;
          progress.waiters.delete(look);
          resolve();
        };
        progress.waiters.add(look);
        look();
      }),
      waitMs,
    );
    const duringUploadMs: number[] = [];
    const duringUploadActive: boolean[] = [];
    for (let index = 0; index < TRANSFER_SAMPLES && !uploadState.done; index += 1) {
      const sample = await request();
      duringUploadMs.push(sample.ms);
      duringUploadActive.push(!uploadState.done);
    }
    const uploaded = await deadline("the upload", uploading, waitMs);
    const uploadMs = performance.now() - uploadStarted;
    return {
      tunnelsReadyMs,
      sessionOpensForTunnels,
      connectMs,
      sessionOpensForConnect,
      requestMs,
      requestStatuses,
      duringUploadMs,
      duringUploadActive,
      uploadMs,
      uploadStatus: uploaded.status ?? 0,
      sockets: input.sockets(),
    };
  } finally {
    await peer.dispose();
  }
}

export interface WebSocketCounts {
  sockets: number;
  sessionOpens: number;
}

class ShimCloseEvent extends Event {
  constructor(
    readonly code: number,
    readonly reason: string,
  ) {
    super("close");
  }
}

export function installCountingWebSocket(WsSocket: typeof import("ws").default, ca: string): WebSocketCounts {
  const counts: WebSocketCounts = { sockets: 0, sessionOpens: 0 };
  class CountingWebSocket extends EventTarget {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readyState = CountingWebSocket.CONNECTING;
    binaryType = "arraybuffer";
    readonly #socket: InstanceType<typeof WsSocket>;

    constructor(url: string) {
      super();
      counts.sockets += 1;
      this.#socket = new WsSocket(url, { ca, perMessageDeflate: false });
      this.#socket.on("open", () => {
        this.readyState = CountingWebSocket.OPEN;
        this.dispatchEvent(new Event("open"));
      });
      this.#socket.on("message", (data, isBinary) => {
        const bytes = Buffer.concat(
          Array.isArray(data) ? data : [Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data)],
        );
        const payload = isBinary
          ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
          : bytes.toString("utf8");
        this.dispatchEvent(new MessageEvent("message", { data: payload }));
      });
      this.#socket.on("error", () => {
        this.readyState = CountingWebSocket.CLOSED;
        this.dispatchEvent(new Event("error"));
      });
      this.#socket.on("close", (code, reason) => {
        this.readyState = CountingWebSocket.CLOSED;
        this.dispatchEvent(new ShimCloseEvent(code, reason.toString("utf8")));
      });
    }

    get bufferedAmount(): number {
      return this.#socket.bufferedAmount;
    }

    send(data: string | Uint8Array): void {
      if (typeof data === "string" && data.includes('"type":"session-open"')) counts.sessionOpens += 1;
      this.#socket.send(data);
    }

    close(code?: number, reason?: string): void {
      this.#socket.close(code ?? 1000, reason);
    }
  }
  Object.defineProperty(globalThis, "WebSocket", { value: CountingWebSocket, configurable: true, writable: true });
  return counts;
}
