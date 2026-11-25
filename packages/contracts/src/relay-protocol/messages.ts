export const RELAY_PROTOCOL_VERSION = 1;
export type RelayProtocolVersion = typeof RELAY_PROTOCOL_VERSION;

export const RELAY_PATH = "/v1/relay";

export const RELAY_CONTROL_MESSAGE_BYTES_LIMIT = 64 * 1024;
export const RELAY_TUNNEL_MESSAGE_BYTES_LIMIT = 1024 * 1024;
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
export const RELAY_SUBJECT_NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ._@-]{0,62}[\p{L}\p{N}]$|^[\p{L}\p{N}]$/u;

const RELAY_HELLO_CONTEXT = "openbot-relay-hello-v1";
const RELAY_SERVER_PROOF_CONTEXT = "openbot-relay-server-proof-v1";
const RELAY_TEAM_ID_CONTEXT = "openbot-relay-team-v1";

export const RELAY_SUBJECT_FIELDS = { team: "O", user: "CN", device: "OU" } as const;

const RELAY_ROLES = ["member", "client", "accept"] as const;
export type RelayRole = (typeof RELAY_ROLES)[number];

export const RELAY_ERROR_CODES = [
  "authentication_failed",
  "certificate_expired",
  "certificate_revoked",
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
  peerClosed: 4002,
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

interface RelayHelloProof {
  type: "hello";
  version: RelayProtocolVersion;
  audience: string;
  clientNonce: string;
  certificate: string;
  chain?: string[];
  signature: string;
}

type RelayHello =
  | (RelayHelloProof & { role: "member"; hosting: boolean; label?: string })
  | (RelayHelloProof & { role: "client"; target: string; waitForTarget?: boolean })
  | (RelayHelloProof & { role: "accept"; connectionId: string });

export type RelayClientMessage =
  | RelayHello
  | { type: "presence"; version: RelayProtocolVersion; hosting: boolean; label?: string };

export type RelayServerMessage =
  | { type: "challenge"; version: RelayProtocolVersion; nonce: string }
  | { type: "server-proof"; version: RelayProtocolVersion; certificate: string; signature: string }
  | {
      type: "welcome";
      version: RelayProtocolVersion;
      self: RelayPeer;
      team: RelayTeam;
      members: RelayTeamMember[];
    }
  | { type: "members"; version: RelayProtocolVersion; members: RelayTeamMember[] }
  | { type: "incoming"; version: RelayProtocolVersion; connectionId: string; from: RelayPeerCertificate }
  | { type: "waiting"; version: RelayProtocolVersion }
  | { type: "open"; version: RelayProtocolVersion; connectionId: string; peer: RelayPeerCertificate }
  | { type: "pause"; version: RelayProtocolVersion }
  | { type: "resume"; version: RelayProtocolVersion }
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
