import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { RELAY_ENROLL_PATH } from "@openbot/contracts/relay-protocol/enrollment";
import { RELAY_PATH, RELAY_TUNNEL_MESSAGE_BYTES_LIMIT } from "@openbot/contracts/relay-protocol/messages";
import type { ServerWebSocket } from "bun";
import type { RelayConfig } from "./config";
import type { EnrollHandler } from "./enroll-route";
import type { RelayService, RelaySocket } from "./service";
import { createWebClientHandler, isWebClientPath } from "./web-client";

interface SocketData {
  socket: RelaySocket | null;
  id: string;
  ip: string;
}

const IDLE_TIMEOUT_SECONDS = 120;
const BACKPRESSURE_LIMIT_FACTOR = 16;

interface RelayServer {
  port: number;
  stop(): Promise<void>;
}

export function startRelayServer(
  config: RelayConfig,
  service: RelayService,
  clientAuthorities: string[],
  enroll: EnrollHandler | null = null,
): RelayServer {
  const tls = config.tls;
  const webClient = config.webClientDirectory === null ? null : createWebClientHandler(config.webClientDirectory);
  const server = Bun.serve<SocketData>({
    hostname: config.host,
    port: config.port,
    ...(tls
      ? {
          tls: {
            cert: Bun.file(tls.certificatePath),
            key: Bun.file(tls.privateKeyPath),
            ...(tls.clientCertificatesRequired
              ? { ca: clientAuthorities, requestCert: true, rejectUnauthorized: true }
              : {}),
          },
        }
      : {}),
    fetch(request, bunServer) {
      const { pathname } = new URL(request.url);
      if (webClient && isWebClientPath(pathname)) return webClient(request);
      if (pathname !== RELAY_PATH && (pathname !== RELAY_ENROLL_PATH || enroll === null)) {
        return new Response("Not found", { status: 404 });
      }
      const ip = clientIp(
        bunServer.requestIP(request)?.address,
        request.headers.get("x-forwarded-for"),
        config.trustProxy,
      );
      if (pathname === RELAY_ENROLL_PATH && enroll !== null) return enroll(request, ip);
      if (bunServer.upgrade(request, { data: { socket: null, id: randomUUID(), ip } })) return undefined;
      return new Response("Upgrade required", { status: 426 });
    },
    websocket: {
      idleTimeout: IDLE_TIMEOUT_SECONDS,
      maxPayloadLength: RELAY_TUNNEL_MESSAGE_BYTES_LIMIT,
      backpressureLimit:
        Math.max(config.limits.highWaterBytes, RELAY_TUNNEL_MESSAGE_BYTES_LIMIT) * BACKPRESSURE_LIMIT_FACTOR,
      closeOnBackpressureLimit: true,
      perMessageDeflate: false,
      sendPings: true,
      open(ws) {
        ws.binaryType = "uint8array";
        const socket = socketAdapter(ws);
        ws.data.socket = socket;
        service.connect(socket);
      },
      message(ws, message) {
        if (typeof message === "string") service.receiveText(ws.data.id, message);
        else service.receiveBinary(ws.data.id, message);
      },
      drain(ws) {
        service.drained(ws.data.id);
      },
      close(ws) {
        service.disconnect(ws.data.id);
      },
    },
  });
  const health = Bun.serve({
    hostname: config.healthHost,
    port: config.healthPort,
    routes: {
      "/health/live": () => Response.json({ service: "openbot-relay", status: "live", commit: config.sourceCommit }),
      "/health/ready": () => Response.json({ service: "openbot-relay", status: "ready" }),
      "/metrics": (request) => {
        const authorization = request.headers.get("Authorization") ?? "";
        if (!config.metricsToken || !sameSecret(authorization, `Bearer ${config.metricsToken}`)) {
          return new Response("Not found", { status: 404 });
        }
        return new Response(prometheusMetrics(service), { headers: { "Content-Type": "text/plain; version=0.0.4" } });
      },
    },
    fetch: () => new Response("Not found", { status: 404 }),
  });
  return {
    port: server.port ?? config.port,
    async stop() {
      service.close();
      await server.stop(true);
      await health.stop(true);
    },
  };
}

function socketAdapter(ws: ServerWebSocket<SocketData>): RelaySocket {
  return {
    id: ws.data.id,
    ip: ws.data.ip,
    sendText: (message) => {
      ws.send(message);
    },
    sendBinary: (data) => {
      ws.send(data);
    },
    bufferedBytes: () => ws.getBufferedAmount(),
    pauseReading: () => {
      if (typeof ws.pause === "function") ws.pause();
    },
    resumeReading: () => {
      if (typeof ws.resume === "function") ws.resume();
    },
    close: (code, reason) => ws.close(code, reason.slice(0, 123)),
  };
}

function clientIp(remoteAddress: string | undefined, forwardedFor: string | null, trustProxy: boolean): string {
  if (!trustProxy) return remoteAddress ?? "unknown";
  return forwardedFor?.split(",", 1)[0]?.trim() || remoteAddress || "unknown";
}

function prometheusMetrics(service: RelayService): string {
  const metrics = service.metrics();
  return [
    `openbot_relay_sockets ${metrics.sockets}`,
    `openbot_relay_teams ${metrics.teams}`,
    `openbot_relay_members ${metrics.members}`,
    `openbot_relay_tunnels ${metrics.tunnels}`,
    `openbot_relay_pending_connections ${metrics.pendingConnections}`,
    "",
  ].join("\n");
}

function sameSecret(actual: string, expected: string): boolean {
  return timingSafeEqual(createHash("sha256").update(actual).digest(), createHash("sha256").update(expected).digest());
}
