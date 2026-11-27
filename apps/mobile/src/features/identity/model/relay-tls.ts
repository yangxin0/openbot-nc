import { base64ToBytes, bytesToBase64 } from "@openbot/team-client/base64";
import type { RelayHubSocketEvents, RelayHubSocketFactory } from "@openbot/team-client/relay-client";
import { type RelayJoinTls, relayJoinError } from "@openbot/team-client/relay-join";
import { type NativeModule, requireOptionalNativeModule } from "expo";

interface RelayTlsRequest {
  method: string;
  headers: Record<string, string>;
  body: string | null;
  root: string | null;
  verify: boolean;
  limit: number;
  timeoutMs: number;
}

interface RelayTlsAnswer {
  status: number;
  body: string;
}

type RelayTlsEvents = {
  onSocketOpen(event: { id: string }): void;
  onSocketText(event: { id: string; text: string }): void;
  onSocketBinary(event: { id: string; data: string }): void;
  onSocketSent(event: { id: string; units: number }): void;
  onSocketClose(event: { id: string; code: number; reason: string }): void;
};

declare class RelayTlsModule extends NativeModule<RelayTlsEvents> {
  request(url: string, options: RelayTlsRequest): Promise<RelayTlsAnswer>;
  openSocket(id: string, url: string, root: string | null): void;
  sendText(id: string, text: string): void;
  sendBinary(id: string, data: string): void;
  closeSocket(id: string, code: number, reason: string): void;
}

interface OpenSocket {
  events: RelayHubSocketEvents;
  buffered: number;
}

const ENROLL_RESPONSE_BYTES_LIMIT = 64 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const NORMAL_CLOSE = 1000;
const LOWEST_STATUS = 200;
const HIGHEST_STATUS = 599;

const native = requireOptionalNativeModule<RelayTlsModule>("OpenBotRelayTls");
const sockets = new Map<string, OpenSocket>();
let listening = false;
let nextSocket = 0;

export const phoneRelayJoinTls: RelayJoinTls | undefined = native
  ? {
      readWithoutTrust: (url, limit) =>
        native
          .request(url, {
            method: "GET",
            headers: { accept: "application/x-pem-file" },
            body: null,
            root: null,
            verify: false,
            limit,
            timeoutMs: REQUEST_TIMEOUT_MS,
          })
          .then((answer) => ({ status: answer.status, text: answer.body })),
      fetchTrusting: (root) => async (url, init) => {
        let answer: RelayTlsAnswer;
        try {
          answer = await native.request(url, {
            method: init.method ?? "GET",
            headers: Object.fromEntries(new Headers(init.headers).entries()),
            body: typeof init.body === "string" ? init.body : null,
            root,
            verify: true,
            limit: ENROLL_RESPONSE_BYTES_LIMIT,
            timeoutMs: REQUEST_TIMEOUT_MS,
          });
        } catch (error) {
          throw relayJoinError(untrustedServer(error) ? "server_untrusted" : "network");
        }
        if (answer.status < LOWEST_STATUS || answer.status > HIGHEST_STATUS) throw relayJoinError("network");
        return new Response(answer.body, { status: answer.status });
      },
    }
  : undefined;

export function phoneRelaySocketFactory(root: string): RelayHubSocketFactory | undefined {
  const module = native;
  if (!module) return undefined;
  return (url, events) => {
    listen(module);
    nextSocket += 1;
    const id = `relay-${nextSocket}`;
    const socket: OpenSocket = { events, buffered: 0 };
    sockets.set(id, socket);
    module.openSocket(id, url, root);
    return {
      get bufferedAmount() {
        return socket.buffered;
      },
      send: (data) => {
        if (!sockets.has(id)) return;
        if (typeof data === "string") {
          socket.buffered += data.length;
          module.sendText(id, data);
        } else {
          socket.buffered += data.byteLength;
          module.sendBinary(id, bytesToBase64(data));
        }
      },
      close: (code, reason) => {
        if (sockets.has(id)) module.closeSocket(id, code ?? NORMAL_CLOSE, reason ?? "");
      },
    };
  };
}

function listen(module: RelayTlsModule): void {
  if (listening) return;
  listening = true;
  module.addListener("onSocketOpen", ({ id }) => sockets.get(id)?.events.open());
  module.addListener("onSocketText", ({ id, text }) => sockets.get(id)?.events.text(text));
  module.addListener("onSocketBinary", ({ id, data }) => sockets.get(id)?.events.binary(base64ToBytes(data)));
  module.addListener("onSocketSent", ({ id, units }) => {
    const socket = sockets.get(id);
    if (socket) socket.buffered = Math.max(0, socket.buffered - units);
  });
  module.addListener("onSocketClose", ({ id, code, reason }) => {
    const socket = sockets.get(id);
    if (!socket) return;
    sockets.delete(id);
    socket.events.closed(code, reason);
  });
}

function untrustedServer(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ERR_RELAY_TLS";
}
