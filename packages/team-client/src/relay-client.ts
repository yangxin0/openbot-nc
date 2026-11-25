import type { RelayTeamMember } from "@openbot/contracts/relay-protocol/messages";
import type { TeamProtocolSupportV1 } from "@openbot/contracts/team-protocol";
import { RelayBrowserControl, type RelayControlOptions } from "./relay-control";
import {
  createIndexedDbRelayIdentityKeyStore,
  type RelayBrowserIdentity,
  type RelayIdentityKeyStore,
  readRelayIdentityFile,
  readRelayIdentityText,
} from "./relay-identity";
import { relayTeamTunnelTransport } from "./relay-v2-tunnels";
import type { RemoteTeamHost } from "./remote-directory";
import { createRemoteTeamPeer, type RemoteHostProtocols, type RemoteTeamPeerActions } from "./remote-peer";

export type { RelayControlSnapshot, RelayControlState } from "./relay-control";
export { RelayBrowserControl } from "./relay-control";
export type {
  IndexedDbRelayIdentityOptions,
  RelayBrowserIdentity,
  RelayIdentityErrorCode,
  RelayIdentityKeyStore,
} from "./relay-identity";
export { RelayIdentityError } from "./relay-identity";
export type { RelaySocketErrorCode } from "./relay-socket";
export { RelaySocketError } from "./relay-socket";
export type { RelayV2TunnelErrorCode } from "./relay-v2-tunnels";
export { openRelayV2Tunnels, RelayV2TunnelError } from "./relay-v2-tunnels";
export { createIndexedDbRelayIdentityKeyStore };

const RELAY_HOST_ID_PREFIX = "relay:";

export type RelayTeamPeerActions = Omit<RemoteTeamPeerActions, "getBootstrap" | "endSession">;

export interface RelayTeamPeerOptions {
  hostProtocols?: RemoteHostProtocols;
  clientProtocol?: TeamProtocolSupportV1["protocol"];
  readyDeadlineMs?: number;
}

export function createRelayIdentityFromText(text: string): Promise<RelayBrowserIdentity> {
  return readRelayIdentityText(text);
}

export function createRelayIdentityFromFile(file: Blob): Promise<RelayBrowserIdentity> {
  return readRelayIdentityFile(file);
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
  const peerActions = {
    get current(): RemoteTeamPeerActions {
      return { ...actions.current, getBootstrap: relayBootstrapUnavailable, endSession: relaySessionEnded };
    },
  };
  return createRemoteTeamPeer(peerActions, {
    ...(options.hostProtocols ? { hostProtocols: options.hostProtocols } : {}),
    ...(options.clientProtocol ? { clientProtocol: options.clientProtocol } : {}),
    tunnels: relayTeamTunnelTransport(
      identity,
      options.readyDeadlineMs === undefined ? {} : { readyDeadlineMs: options.readyDeadlineMs },
    ),
  });
}

function relayBootstrapUnavailable(): Promise<never> {
  return Promise.reject(new Error("A relay connection does not use an account bootstrap."));
}

function relaySessionEnded(): Promise<void> {
  return Promise.resolve();
}
