export const RELAY_PROTOCOL_VERSION = 1;
export type RelayProtocolVersion = typeof RELAY_PROTOCOL_VERSION;

export const RELAY_PATH = "/v1/relay";

export const RELAY_CONTROL_MESSAGE_BYTES_LIMIT = 64 * 1024;
export const RELAY_SESSION_FRAME_HEADER_BYTES = 6;
export const RELAY_SESSION_FRAME_PAYLOAD_LIMIT = 64 * 1024;
export const RELAY_SOCKET_MESSAGE_BYTES_LIMIT = RELAY_SESSION_FRAME_HEADER_BYTES + RELAY_SESSION_FRAME_PAYLOAD_LIMIT;
export const RELAY_SESSION_WINDOW_BYTES = 1024 * 1024;
export const RELAY_SESSION_OPENER_ID_MAX = 0x7fff_ffff;
export const RELAY_SESSION_ASSIGNED_ID_MIN = 0x8000_0000;
export const RELAY_SESSION_ID_MAX = 0xffff_ffff;
export const RELAY_SESSIONS_FEATURE = "sessions-v2";
export const RELAY_HEARTBEAT_FEATURE = "heartbeat";
export const RELAY_HEARTBEAT_INTERVAL_MS = 10_000;
export const RELAY_HEARTBEAT_TIMEOUT_MS = 3_000;
export const RELAY_RESUME_CHECK_TIMEOUT_MS = 1_500;
export const RELAY_CLIENT_HEARTBEAT_TIMEOUT_MS = 30_000;
export const RELAY_PING_ID_MAX = 0x7fff_ffff;
export const RELAY_DATA_TICKET_TTL_MS = 60_000;
export const RELAY_DATA_IDLE_MS = 300_000;
export const RELAY_FEATURES_LIMIT = 16;
export const RELAY_CERTIFICATE_PEM_LIMIT = 16 * 1024;
export const RELAY_CHAIN_LIMIT = 2;
export const RELAY_LABEL_LIMIT = 80;
export const RELAY_AUDIENCE_LIMIT = 256;
export const RELAY_TEAM_MEMBERS_LIMIT = 256;

export const RELAY_HELLO_DEADLINE_MS = 10_000;
export const RELAY_ACCEPT_DEADLINE_MS = 15_000;

export const RELAY_KEY_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
export const RELAY_TEAM_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
export const RELAY_NONCE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
export const RELAY_CONNECTION_ID_PATTERN = /^[A-Za-z0-9_-]{22,64}$/u;
export const RELAY_SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{1,1024}$/u;
export const RELAY_FEATURE_PATTERN = /^[a-z0-9-]{1,32}$/u;
export const RELAY_SESSION_FIRST_PATTERN = /^[A-Za-z0-9_-]{1,1400}$/u;
export const RELAY_DATA_TICKET_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
export const RELAY_SUBJECT_NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ._@-]{0,62}[\p{L}\p{N}]$|^[\p{L}\p{N}]$/u;

const RELAY_HELLO_CONTEXT = "openbot-relay-hello-v1";
const RELAY_SERVER_PROOF_CONTEXT = "openbot-relay-server-proof-v1";
const RELAY_TEAM_ID_CONTEXT = "openbot-relay-team-v1";

export const RELAY_SUBJECT_FIELDS = { team: "O", user: "CN", device: "OU" } as const;

export type RelayRole = "member";

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

export const RELAY_SESSION_FAILURE_CODES = [
  "target_unavailable",
  "refused",
  "rate_limited",
  "invalid_message",
] as const;
export type RelaySessionFailureCode = (typeof RELAY_SESSION_FAILURE_CODES)[number];

export const RELAY_SESSION_REFUSAL_CODES = ["refused", "rate_limited"] as const;
export type RelaySessionRefusalCode = (typeof RELAY_SESSION_REFUSAL_CODES)[number];

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

interface RelayHello {
  type: "hello";
  version: RelayProtocolVersion;
  audience: string;
  clientNonce: string;
  certificate: string;
  chain?: string[];
  signature: string;
  role: RelayRole;
  hosting: boolean;
  label?: string;
  features?: string[];
}

export type RelayClientMessage =
  | RelayHello
  | { type: "presence"; version: RelayProtocolVersion; hosting: boolean; label?: string }
  | { type: "ping"; version: RelayProtocolVersion; id: number }
  | { type: "data-ticket"; version: RelayProtocolVersion }
  | { type: "data-hello"; version: RelayProtocolVersion; ticket: string }
  | { type: "session-open"; version: RelayProtocolVersion; session: number; target: string; first?: string }
  | { type: "session-accept"; version: RelayProtocolVersion; session: number; first?: string }
  | { type: "session-refuse"; version: RelayProtocolVersion; session: number; code: RelaySessionRefusalCode }
  | { type: "session-close"; version: RelayProtocolVersion; session: number }
  | { type: "session-credit"; version: RelayProtocolVersion; session: number; bytes: number };

export type RelayServerMessage =
  | { type: "challenge"; version: RelayProtocolVersion; nonce: string }
  | { type: "server-proof"; version: RelayProtocolVersion; certificate: string; signature: string }
  | {
      type: "welcome";
      version: RelayProtocolVersion;
      self: RelayPeer;
      team: RelayTeam;
      members: RelayTeamMember[];
      features: string[];
    }
  | { type: "members"; version: RelayProtocolVersion; members: RelayTeamMember[] }
  | { type: "pong"; version: RelayProtocolVersion; id: number }
  | { type: "data-ticket"; version: RelayProtocolVersion; ticket: string }
  | { type: "data-wanted"; version: RelayProtocolVersion }
  | {
      type: "session-incoming";
      version: RelayProtocolVersion;
      session: number;
      connectionId: string;
      from: RelayPeerCertificate;
      first?: string;
    }
  | {
      type: "session-opened";
      version: RelayProtocolVersion;
      session: number;
      connectionId: string;
      peer: RelayPeerCertificate;
      first?: string;
    }
  | { type: "session-failed"; version: RelayProtocolVersion; session: number; code: RelaySessionFailureCode }
  | { type: "session-close"; version: RelayProtocolVersion; session: number }
  | { type: "session-credit"; version: RelayProtocolVersion; session: number; bytes: number }
  | { type: "error"; version: RelayProtocolVersion; code: RelayErrorCode; message: string };

export function relayHelloTranscript(input: {
  nonce: string;
  clientNonce: string;
  audience: string;
  role: RelayRole;
  target?: string | undefined;
  connectionId?: string | undefined;
}): string {
  return JSON.stringify([
    RELAY_HELLO_CONTEXT,
    input.nonce,
    input.clientNonce,
    input.audience,
    input.role,
    input.target ?? "",
    input.connectionId ?? "",
  ]);
}

export interface RelayServerProofTranscriptInput {
  serverNonce: string;
  clientNonce: string;
  audience: string;
  role: RelayRole;
  clientKeyId: string;
  target?: string | undefined;
  connectionId?: string | undefined;
}

export function relayServerProofTranscript(input: RelayServerProofTranscriptInput): string {
  return JSON.stringify([
    RELAY_SERVER_PROOF_CONTEXT,
    input.serverNonce,
    input.clientNonce,
    input.audience,
    input.role,
    input.clientKeyId,
    input.target ?? "",
    input.connectionId ?? "",
  ]);
}

export function relayTeamIdStatement(input: { rootKeyId: string; teamName: string }): string {
  return JSON.stringify([RELAY_TEAM_ID_CONTEXT, input.rootKeyId, input.teamName]);
}

export function relayAudience(relayUrl: string): string {
  const url = new URL(relayUrl);
  return `${url.protocol}//${url.host}`;
}
