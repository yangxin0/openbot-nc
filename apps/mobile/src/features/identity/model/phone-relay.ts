import type { RelayTeamMember } from "@openbot/contracts/relay-protocol/messages";
import { TEAM_WEB_CLIENT_PROTOCOL } from "@openbot/contracts/team-protocol/current";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import {
  createRelayTeamPeer,
  type RelayBrowserControl,
  type RelayBrowserIdentity,
  type RelayControlSnapshot,
  type RelayCrypto,
  type RelaySocketErrorCode,
  type RelayTeamPeerActions,
  relayTeamHost,
  relayTeamHostId,
  startRelayControl,
} from "@openbot/team-client/relay-client";
import type { RemoteTeamHost } from "@openbot/team-client/remote-directory";

export type PhoneRelayPeer = ReturnType<typeof createRelayTeamPeer>;

export interface PhoneRelay {
  readonly identity: RelayBrowserIdentity;
  readonly crypto: RelayCrypto;
}

export const PHONE_RELAY_LABEL = "OpenBot-NC phone";

const ENDING_CODES: ReadonlySet<RelaySocketErrorCode> = new Set(["certificate_revoked", "certificate_expired"]);

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

const RELAY_STATE_KEYS = {
  certificate_revoked: "mobile.identity.relay.revoked",
  certificate_expired: "mobile.identity.relay.expired",
  authentication_failed: "mobile.identity.relay.refused",
  identity_unavailable: "mobile.identity.relay.unusable",
  relay_url_missing: "mobile.identity.error.relayUrlMissing",
  insecure_relay_url: "mobile.identity.relay.insecure",
  server_refused: "mobile.identity.relay.serverRefused",
  replaced: "mobile.identity.relay.replaced",
  rate_limited: "mobile.identity.relay.rateLimited",
  team_full: "mobile.identity.relay.teamFull",
  protocol_error: "mobile.identity.relay.protocol",
  invalid_message: "mobile.identity.relay.protocol",
  connect_failed: "mobile.identity.relay.unreachable",
  closed: "mobile.identity.relay.unreachable",
  deadline_exceeded: "mobile.identity.relay.unreachable",
  target_unavailable: "mobile.identity.relay.unreachable",
  peer_refused: "mobile.identity.relay.unreachable",
  tunnel_handshake_failed: "mobile.identity.relay.unreachable",
  tunnel_peer_unverified: "mobile.identity.relay.unreachable",
  tunnel_integrity_failed: "mobile.identity.relay.unreachable",
  tunnel_counter_exhausted: "mobile.identity.relay.unreachable",
  tunnel_identity_unusable: "mobile.identity.relay.unusable",
} as const satisfies Record<RelaySocketErrorCode, MobileTextKey>;

export type RelayStateKey = (typeof RELAY_STATE_KEYS)[RelaySocketErrorCode];

export function startPhoneRelayControl(
  relay: PhoneRelay,
  options: { reconnect?: { baseMs?: number; maxMs?: number } } = {},
): RelayBrowserControl {
  return startRelayControl(relay.identity, {
    label: PHONE_RELAY_LABEL,
    crypto: relay.crypto,
    ...(options.reconnect ? { reconnect: options.reconnect } : {}),
  });
}

export function relayStateKey(code: RelaySocketErrorCode): RelayStateKey {
  return RELAY_STATE_KEYS[code];
}

export function relayFinalCode(snapshot: RelayControlSnapshot): RelaySocketErrorCode | null {
  const { state } = snapshot;
  return state.status === "offline" && state.code !== "stopped" && FINAL_CODES.has(state.code) ? state.code : null;
}

export function relayEndsIdentity(snapshot: RelayControlSnapshot): boolean {
  const code = relayFinalCode(snapshot);
  return code !== null && ENDING_CODES.has(code);
}

export function rosterHosts(snapshot: RelayControlSnapshot, identity: RelayBrowserIdentity): RelayTeamMember[] {
  const selfKeyId = snapshot.self?.keyId ?? identity.keyId;
  const hosts = new Map<string, RelayTeamMember>();
  for (const member of snapshot.roster) {
    if (!member.hosting || member.keyId === selfKeyId) continue;
    const hostId = relayTeamHostId(member);
    if (!hosts.has(hostId)) hosts.set(hostId, member);
  }
  return [...hosts.values()];
}

export function mergeRelayHosts(
  known: readonly RemoteTeamHost[],
  snapshot: RelayControlSnapshot,
  identity: RelayBrowserIdentity,
): RemoteTeamHost[] {
  const previous = new Map(known.map((host) => [host.hostId, host]));
  const merged = new Map(previous);
  for (const member of rosterHosts(snapshot, identity)) {
    const hostId = relayTeamHostId(member);
    const old = previous.get(hostId);
    const listed = relayTeamHost(member, old?.role ?? "member");
    merged.set(hostId, old?.hidden ? { ...listed, hidden: true } : listed);
  }
  return [...merged.values()];
}

export function createPhoneRelayPeer(relay: PhoneRelay, actions: { current: RelayTeamPeerActions }): PhoneRelayPeer {
  return createRelayTeamPeer(relay.identity, actions, {
    crypto: relay.crypto,
    clientProtocol: TEAM_WEB_CLIENT_PROTOCOL,
  });
}

export function phoneRelayScope(identity: Pick<RelayBrowserIdentity, "relayUrl" | "keyId">): string {
  return `${identity.relayUrl ?? ""}#${identity.keyId}`;
}
