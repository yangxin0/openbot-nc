import { join } from "node:path";
import { isRelayUrl } from "@openbot/contracts/relay-protocol/identity-bundle";
import { RELAY_PATH, relayAudience } from "@openbot/contracts/relay-protocol/messages";
import { tlsPaths } from "./certificate-authority";
import type { RelayLimits } from "./service";

interface RelayTlsConfig {
  certificatePath: string;
  privateKeyPath: string;
  clientCertificatesRequired: boolean;
}

export interface RelayConfig {
  host: string;
  port: number;
  healthHost: string;
  healthPort: number;
  dataDirectory: string;
  caPassphrase: string | null;
  publicUrl: string | null;
  audiences: ReadonlySet<string> | null;
  tls: RelayTlsConfig | null;
  trustProxy: boolean;
  metricsToken: string | null;
  limits: RelayLimits;
  sourceCommit: string;
}

type Environment = Record<string, string | undefined>;

export function readRelayConfig(environment: Environment = process.env): RelayConfig {
  const dataDirectory = optional(environment.RELAY_DATA_DIR) ?? join(process.cwd(), "relay-data");
  const tlsDisabled = environment.RELAY_TLS_DISABLED === "true";
  const defaultTls = tlsPaths(dataDirectory);
  const publicUrl = optional(environment.RELAY_PUBLIC_URL);
  if (publicUrl !== null && !isRelayUrl(publicUrl)) {
    throw new Error("RELAY_PUBLIC_URL must be a ws: or wss: URL with no user name or password.");
  }
  if (publicUrl !== null && new URL(publicUrl).pathname !== RELAY_PATH) {
    throw new Error(`RELAY_PUBLIC_URL must end with ${RELAY_PATH}.`);
  }
  const clientCertificates = optional(environment.RELAY_TLS_CLIENT_CERTIFICATES) ?? "off";
  if (clientCertificates !== "off" && clientCertificates !== "required") {
    throw new Error("RELAY_TLS_CLIENT_CERTIFICATES must be off or required.");
  }
  if (tlsDisabled && clientCertificates === "required") {
    throw new Error("RELAY_TLS_CLIENT_CERTIFICATES=required needs TLS in this process.");
  }
  return {
    host: optional(environment.RELAY_HOST) ?? "0.0.0.0",
    port: positiveInteger(environment.RELAY_PORT, tlsDisabled ? 8081 : 8443, "RELAY_PORT"),
    healthHost: optional(environment.RELAY_HEALTH_HOST) ?? "127.0.0.1",
    healthPort: positiveInteger(environment.RELAY_HEALTH_PORT, 8080, "RELAY_HEALTH_PORT"),
    dataDirectory,
    caPassphrase: optional(environment.RELAY_CA_PASSPHRASE),
    publicUrl,
    audiences: publicUrl === null ? null : new Set([relayAudience(publicUrl)]),
    tls: tlsDisabled
      ? null
      : {
          certificatePath: optional(environment.RELAY_TLS_CERT_PATH) ?? defaultTls.certificate,
          privateKeyPath: optional(environment.RELAY_TLS_KEY_PATH) ?? defaultTls.privateKey,
          clientCertificatesRequired: clientCertificates === "required",
        },
    trustProxy: environment.RELAY_TRUST_PROXY === "true",
    metricsToken: optional(environment.RELAY_METRICS_TOKEN),
    limits: {
      socketsPerIp: positiveInteger(environment.RELAY_MAX_SOCKETS_PER_IP, 128, "RELAY_MAX_SOCKETS_PER_IP"),
      tunnelsPerMember: positiveInteger(environment.RELAY_MAX_TUNNELS_PER_MEMBER, 64, "RELAY_MAX_TUNNELS_PER_MEMBER"),
      pendingPerTarget: positiveInteger(environment.RELAY_MAX_PENDING_PER_MEMBER, 32, "RELAY_MAX_PENDING_PER_MEMBER"),
      presenceUpdatesPerMinute: 30,
      highWaterBytes: positiveInteger(environment.RELAY_HIGH_WATER_BYTES, 1024 * 1024, "RELAY_HIGH_WATER_BYTES"),
    },
    sourceCommit: optional(environment.OPENBOT_SOURCE_COMMIT) ?? "unknown",
  };
}

function optional(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  const text = optional(value);
  if (text === null) return fallback;
  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}
