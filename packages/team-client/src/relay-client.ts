import type { RelayTeamMember } from "@openbot/contracts/relay-protocol/messages";
import type { TeamProtocolSupportV1 } from "@openbot/contracts/team-protocol";
import type { RelayCrypto } from "./relay-crypto";
import { webRelayCrypto } from "./relay-crypto";
import { RelayHubClient, type RelayHubOptions, type RelayHubSnapshot, type RelayHubState } from "./relay-hub";
import { type RelayHubProvider, relayHubTunnelTransport } from "./relay-hub-channels";
import {
  createIndexedDbRelayIdentityKeyStore,
  type RelayBrowserIdentity,
  type RelayIdentityKeyStore,
  type RelayIdentityReadOptions,
  readRelayIdentityFile,
  readRelayIdentityText,
} from "./relay-identity";
import type { RemoteTeamHost } from "./remote-directory";
import { createRemoteTeamPeer, type RemoteHostProtocols, type RemoteTeamPeerActions } from "./remote-peer";

export type { RelayCrypto, RelayPrivateKey } from "./relay-crypto";
export { webRelayCrypto } from "./relay-crypto";
export type {
  RelayHubLog,
  RelayHubMessage,
  RelayHubOptions,
  RelayHubSnapshot,
  RelayHubSocket,
  RelayHubSocketEvents,
  RelayHubSocketFactory,
  RelayHubState,
  RelayHubUndeliverable,
  RelaySocketErrorCode,
} from "./relay-hub";
export {
  browserRelayHubSocket,
  RELAY_HUB_RESUME_ANSWER_MS,
  RelayHubClient,
  RelayHubSendError,
  RelaySocketError,
} from "./relay-hub";
export type { RelayHubLinkErrorCode, RelayHubProvider } from "./relay-hub-channels";
export { RelayHubLinkError, relayHubTunnelTransport, whenHubOnline } from "./relay-hub-channels";
export type {
  IndexedDbRelayIdentityOptions,
  RelayBrowserIdentity,
  RelayIdentityErrorCode,
  RelayIdentityKeyStore,
  RelayIdentityReadOptions,
} from "./relay-identity";
export { RelayIdentityError } from "./relay-identity";
export { createIndexedDbRelayIdentityKeyStore };

export type RelayControlSnapshot = RelayHubSnapshot;
export type RelayControlState = RelayHubState;
export type RelayBrowserControl = RelayHubClient;
export type RelayControlOptions = Omit<RelayHubOptions, "identity" | "sign">;

const RELAY_HOST_ID_PREFIX = "relay:";

export type RelayTeamPeerActions = RemoteTeamPeerActions;

export interface RelayTeamPeerOptions {
  hostProtocols?: RemoteHostProtocols;
  clientProtocol?: TeamProtocolSupportV1["protocol"];
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

export function startRelayControl(identity: RelayBrowserIdentity, options: RelayControlOptions = {}): RelayHubClient {
  const crypto = options.crypto ?? webRelayCrypto;
  const hub = new RelayHubClient({
    ...options,
    crypto,
    identity,
    sign: (data) => crypto.sign(identity.privateKey, data),
  });
  hub.start();
  return hub;
}

export function relayRosterHosts(control: RelayHubClient): RelayTeamMember[] {
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
  hub: RelayHubClient | RelayHubProvider,
  actions: { current: RelayTeamPeerActions },
  options: RelayTeamPeerOptions = {},
) {
  return createRemoteTeamPeer(actions, {
    ...(options.hostProtocols ? { hostProtocols: options.hostProtocols } : {}),
    ...(options.clientProtocol ? { clientProtocol: options.clientProtocol } : {}),
    ...(options.crypto ? { randomBytes: options.crypto.randomBytes } : {}),
    tunnels: relayHubTunnelTransport(hub),
  });
}
