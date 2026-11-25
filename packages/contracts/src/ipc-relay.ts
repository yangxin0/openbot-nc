import { RELAY_ERROR_CODES } from "./relay-protocol/messages";

export const RELAY_CONNECTION_CODES = [
  ...RELAY_ERROR_CODES,
  "identity_unavailable",
  "relay_url_missing",
  "insecure_relay_url",
  "connect_failed",
  "deadline_exceeded",
  "peer_refused",
  "closed",
  "stopped",
] as const;
export type RelayConnectionCode = (typeof RELAY_CONNECTION_CODES)[number];

export interface RelayIdentitySummary {
  team: string;
  user: string;
  device: string | null;
  keyId: string;
  relayUrl: string | null;
  expiresAt: number;
}

export type RelayConnectionState =
  | { status: "connecting" }
  | { status: "online" }
  | { status: "offline"; code: RelayConnectionCode; message: string | null; retryInMs: number | null };

export interface RelayMemberSummary {
  keyId: string;
  user: string;
  device: string | null;
  label: string | null;
  hosting: boolean;
  self: boolean;
  serverId: string | null;
  hidden: boolean;
}

export const RELAY_HOSTING_STATUSES = ["off", "no_identity", "starting", "online", "offline", "error"] as const;
export type RelayHostingStatus = (typeof RELAY_HOSTING_STATUSES)[number];

export interface RelayHostingState {
  status: RelayHostingStatus;
  message: string | null;
}

export interface RelayState {
  identity: RelayIdentitySummary | null;
  identityIssue: string | null;
  control: RelayConnectionState;
  members: RelayMemberSummary[];
  hosting: boolean;
  hostingState: RelayHostingState;
}

export type RelayImportResult = { status: "canceled" } | { status: "imported"; state: RelayState };
