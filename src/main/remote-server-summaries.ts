import type { ServerSummary } from "@openbot/contracts/ipc";
import { LOCAL_SERVER_ID } from "@openbot/contracts/ipc";
import type { RemoteServerConnectionStatus } from "./remote-server-connection-status";
import type { StoredRemoteServerView } from "./remote-server-store";
import { remoteServerLogoUrl } from "./remote-server-urls";

export function remoteServerSummaries(
  servers: readonly StoredRemoteServerView[],
  activeServerId: string,
  statusFor: (serverId: string) => RemoteServerConnectionStatus,
  isThisComputer: (serverId: string) => boolean = () => false,
  keyChangedAt: (serverId: string) => number | undefined = () => undefined,
): ServerSummary[] {
  const localKeyChangedAt = keyChangedAt(LOCAL_SERVER_ID);
  return [
    {
      id: LOCAL_SERVER_ID,
      notificationsMuted: false,
      notificationsMutedUntil: null,
      notificationLevel: "all",
      name: "Local",
      kind: "local",
      state: "online",
      apiUrl: null,
      logoUrl: null,
      role: null,
      active: activeServerId === LOCAL_SERVER_ID,
      ...(localKeyChangedAt === undefined ? {} : { keyChangedAt: localKeyChangedAt }),
      compatibility: null,
      issue: null,
    },
    ...servers.map((server) => {
      const status = statusFor(server.id);
      const changedAt = keyChangedAt(server.id);
      return {
        id: server.id,
        notificationsMuted: false,
        notificationsMutedUntil: null,
        notificationLevel: "all" as const,
        name: server.name,
        kind: "remote" as const,
        state: status.state,
        apiUrl: server.transport === undefined ? server.apiUrl : null,
        logoUrl: server.logoVersion ? remoteServerLogoUrl(server.id, server.logoVersion) : null,
        ...(server.appearance === undefined ? {} : { appearance: server.appearance }),
        role: server.role,
        active: activeServerId === server.id,
        ...(server.restartAvailable === undefined ? {} : { restartAvailable: server.restartAvailable }),
        ...(changedAt === undefined ? {} : { keyChangedAt: changedAt }),
        ...(isThisComputer(server.id) ? { thisComputer: true as const } : {}),
        compatibility: status.compatibility,
        issue: status.issue,
        connectionSequence: status.connectionSequence,
        ...(status.capabilitiesPending ? { capabilitiesPending: true as const } : {}),
        hostRestart: status.hostRestart ?? null,
        ...(server.transport === "relay" && server.relayUser !== undefined
          ? { relayHost: { user: server.relayUser, device: server.relayDevice ?? null } }
          : {}),
      };
    }),
  ];
}
