import type { RelayTeamMember } from "@openbot/contracts/relay-protocol/messages";
import type { TeamProtocolSupportV1 } from "@openbot/contracts/team-protocol";
import { RelayBrowserControl, type RelayControlOptions } from "./relay-control";
import type { RelayCrypto } from "./relay-crypto";
import {
  createIndexedDbRelayIdentityKeyStore,
  type RelayBrowserIdentity,
  type RelayIdentityKeyStore,
  type RelayIdentityReadOptions,
  readRelayIdentityFile,
  readRelayIdentityText,
} from "./relay-identity";
import { relayTeamTunnelTransport } from "./relay-v2-tunnels";
import type { RemoteTeamHost } from "./remote-directory";
import { createRemoteTeamPeer, type RemoteHostProtocols, type RemoteTeamPeerActions } from "./remote-peer";

export type { RelayControlOptions, RelayControlSnapshot, RelayControlState } from "./relay-control";
export { RelayBrowserControl } from "./relay-control";
export type { RelayCrypto, RelayPrivateKey } from "./relay-crypto";
export { webRelayCrypto } from "./relay-crypto";
export type {
  IndexedDbRelayIdentityOptions,
  RelayBrowserIdentity,
  RelayIdentityErrorCode,
  RelayIdentityKeyStore,
  RelayIdentityReadOptions,
} from "./relay-identity";
export { RelayIdentityError } from "./relay-identity";
export type { RelaySocketErrorCode } from "./relay-socket";
export { RelaySocketError } from "./relay-socket";
export type { RelayV2TunnelErrorCode } from "./relay-v2-tunnels";
export { openRelayV2Tunnels, RelayV2TunnelError } from "./relay-v2-tunnels";
export { createIndexedDbRelayIdentityKeyStore };

const RELAY_HOST_ID_PREFIX = "relay:";

export type RelayTeamPeerActions = RemoteTeamPeerActions;

export interface RelayTeamPeerOptions {
  hostProtocols?: RemoteHostProtocols;
  clientProtocol?: TeamProtocolSupportV1["protocol"];
  readyDeadlineMs?: number;
  crypto?: RelayCrypto;
}

export function createRelayIdentityFromText(
  text: string,
  options: RelayIdentityReadOptions = {},
): Promise<RelayBrowserIdentity> {
  return readRelayIdentityText(text, options);
}

export function createRelayIdentityFromFile(
  file: Blob,
  options: RelayIdentityReadOptions = {},
): Promise<RelayBrowserIdentity> {
  return readRelayIdentityFile(file, options);
}

export function loadRelayIdentity(store: RelayIdentityKeyStore): Promise<RelayBrowserIdentity | null> {
  return store.load();
}

export function saveRelayIdentity(store: RelayIdentityKeyStore, identity: RelayBrowserIdentity): Promise<void> {
  return store.save(identity);
}

export function removeRelayIdentity(store: RelayIdentityKeyStore): Promise<void> {
  return store.remove();
}

export function startRelayControl(
  identity: RelayBrowserIdentity,
  options: RelayControlOptions = {},
): RelayBrowserControl {
  const control = new RelayBrowserControl(identity, options);
  control.start();
  return control;
}

export function relayRosterHosts(control: RelayBrowserControl): RelayTeamMember[] {
  return control.hosts();
}

export function relayTeamHostId(member: Pick<RelayTeamMember, "user" | "device">): string {
  return `${RELAY_HOST_ID_PREFIX}${encodeURIComponent(member.user)}:${encodeURIComponent(member.device ?? "")}`;
}

export function relayTeamHost(member: RelayTeamMember, role: RemoteTeamHost["role"]): RemoteTeamHost {
  return {
    hostId: relayTeamHostId(member),
    name: member.label ?? member.user,
    logoKey: null,
    devicePublicKey: member.keyId,
    membershipId: member.keyId,
    role,
    relayHost: { user: member.user, device: member.device },
  };
}

export function createRelayTeamPeer(
  identity: RelayBrowserIdentity,
  actions: { current: RelayTeamPeerActions },
  options: RelayTeamPeerOptions = {},
) {
  return createRemoteTeamPeer(actions, {
    ...(options.hostProtocols ? { hostProtocols: options.hostProtocols } : {}),
    ...(options.clientProtocol ? { clientProtocol: options.clientProtocol } : {}),
    ...(options.crypto ? { randomBytes: options.crypto.randomBytes } : {}),
    tunnels: relayTeamTunnelTransport(identity, {
      ...(options.readyDeadlineMs === undefined ? {} : { readyDeadlineMs: options.readyDeadlineMs }),
      ...(options.crypto ? { crypto: options.crypto } : {}),
    }),
  });
}
