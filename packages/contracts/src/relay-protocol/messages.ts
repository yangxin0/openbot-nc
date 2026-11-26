export const RELAY_PROTOCOL_VERSION = 2;
export type RelayProtocolVersion = typeof RELAY_PROTOCOL_VERSION;

export const RELAY_PATH = "/v1/relay";

export const RELAY_CONTROL_MESSAGE_BYTES_LIMIT = 64 * 1024;
export const RELAY_CLIENT_HEARTBEAT_TIMEOUT_MS = 30_000;
export const RELAY_SUSPENDED_TIMEOUT_MS = 300_000;
export const RELAY_HELLO_WINDOW_MS = 60_000;
export const RELAY_HELLO_DEADLINE_MS = 10_000;
export const RELAY_PING_ID_MAX = 0x7fff_ffff;
export const RELAY_CERTIFICATE_PEM_LIMIT = 16 * 1024;
export const RELAY_CHAIN_LIMIT = 2;
export const RELAY_LABEL_LIMIT = 80;
export const RELAY_AUDIENCE_LIMIT = 256;
export const RELAY_TEAM_MEMBERS_LIMIT = 256;
export const RELAY_CAPABILITIES_LIMIT = 16;

export const RELAY_KEY_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
export const RELAY_TEAM_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
export const RELAY_NONCE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
export const RELAY_SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{1,1024}$/u;
export const RELAY_MESSAGE_KEY_PATTERN = /^[A-Za-z0-9_-]{87}$/u;
export const RELAY_CAPABILITY_PATTERN = /^[a-z0-9-]{1,32}$/u;
export const RELAY_SUBJECT_NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ._@-]{0,62}[\p{L}\p{N}]$|^[\p{L}\p{N}]$/u;

const RELAY_TEAM_ID_CONTEXT = "openbot-relay-team-v1";

export const RELAY_SUBJECT_FIELDS = { team: "O", user: "CN", device: "OU" } as const;

export const RELAY_ERROR_CODES = [
  "authentication_failed",
  "certificate_expired",
  "certificate_revoked",
  "heartbeat_timeout",
  "invalid_message",
  "protocol_error",
  "rate_limited",
  "replaced",
  "target_unavailable",
  "team_full",
] as const;
export type RelayErrorCode = (typeof RELAY_ERROR_CODES)[number];

export const RELAY_CLOSE_CODES = {
  normal: 1000,
  policy: 1008,
  unavailable: 1013,
  replaced: 4001,
} as const;

export interface RelayTeam {
  id: string;
  name: string;
}

export interface RelayPeer {
  keyId: string;
  user: string;
  device: string | null;
}

export interface RelayPeerCertificate extends RelayPeer {
  certificate: string;
}

export interface RelayTeamMember extends RelayPeer {
  label: string | null;
  hosting: boolean;
  connectedAt: number;
}

export function relayTeamIdStatement(input: { rootKeyId: string; teamName: string }): string {
  return JSON.stringify([RELAY_TEAM_ID_CONTEXT, input.rootKeyId, input.teamName]);
}

export function relayAudience(relayUrl: string): string {
  const url = new URL(relayUrl);
  return `${url.protocol}//${url.host}`;
}
