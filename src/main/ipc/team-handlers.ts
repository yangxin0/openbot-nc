import { type HostStatus, LOCAL_SERVER_ID, type ServerSummary } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { HostService } from "../host-service";
import type { LocalServers } from "../local-servers/local-servers";
import type { RelayService } from "../relay-service";
import type { RemoteServerManager } from "../remote-server-manager";
import { agentRequest } from "./agent-inputs";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { routeToServer } from "./route-to-server";
import {
  parseDirectTyping,
  parseHostConfig,
  parseHostIdentity,
  parseMarkDirectRead,
  parseReadDirectConversationPage,
  parseReorderServers,
  parseSendDirectMessage,
  parseSetServerHidden,
  parseSetServerMuted,
  parseSetServerNotificationLevel,
  parseSetTeamTyping,
  parseUpdateTeamMember,
} from "./server-inputs";
import { stringPayload } from "./validation";

interface TeamIpcDependencies {
  host: HostService;
  localServers: LocalServers | null;
  relayHosting: Pick<RelayService, "publishHost" | "unpublishHost">;
  remoteServers: RemoteServerManager;
}

export function teamIpcHandlers({
  host,
  localServers,
  relayHosting,
  remoteServers,
}: TeamIpcDependencies): Pick<IpcGroupHandlers, "servers" | "host"> {
  return {
    servers: {
      setMuted: payloadHandler(parseSetServerMuted, ({ serverId, muted, durationMs }) =>
        runCauseEffect(remoteServers.setMuted(serverId, muted, durationMs)).then((servers) =>
          withLocalHostSummary(servers, host.getStatus()),
        ),
      ),
      setHidden: payloadHandler(parseSetServerHidden, ({ serverId, hidden }) =>
        runCauseEffect(remoteServers.setHidden(serverId, hidden)).then((servers) =>
          withLocalHostSummary(servers, host.getStatus()),
        ),
      ),
      setNotificationLevel: payloadHandler(parseSetServerNotificationLevel, ({ serverId, level }) =>
        runCauseEffect(remoteServers.setNotificationLevel(serverId, level)).then((servers) =>
          withLocalHostSummary(servers, host.getStatus()),
        ),
      ),
      list: handler(() => withLocalHostSummary(remoteServers.list(), host.getStatus())),
      select: payloadHandler(stringPayload("serverId"), (serverId) =>
        runCauseEffect(remoteServers.select(serverId)).then((servers) =>
          withLocalHostSummary(servers, host.getStatus()),
        ),
      ),
      reorder: payloadHandler(parseReorderServers, (request) =>
        runCauseEffect(remoteServers.reorder(request.serverIds)).then((servers) =>
          withLocalHostSummary(servers, host.getStatus()),
        ),
      ),
      retryConnection: payloadHandler(stringPayload("serverId"), (serverId) =>
        runCauseEffect(
          (localServers?.startStopped(serverId) ?? Effect.succeed(null)).pipe(
            Effect.flatMap((started) => (started ? Effect.succeed(started) : remoteServers.retryConnection(serverId))),
          ),
        ),
      ),
      remove: payloadHandler(stringPayload("serverId"), (serverId) => runCauseEffect(remoteServers.remove(serverId))),
      getPresence: handler(() =>
        routeToServer(remoteServers.activeServerId, {
          local: () => host.getPresence(),
          remote: () => remoteServers.getPresence(),
        }),
      ),
      getPresenceFor: payloadHandler(stringPayload("serverId"), (serverId) =>
        routeToServer(serverId, {
          local: () => host.getPresence(),
          remote: (target) => runCauseEffect(remoteServers.getPresenceFor(target)),
        }),
      ),
      refreshIdentity: payloadHandler(stringPayload("serverId"), (serverId) =>
        runCauseEffect(remoteServers.refreshIdentity(serverId)),
      ),
      listMembers: payloadHandler(stringPayload("serverId"), (serverId) =>
        runCauseEffect(remoteServers.listMembers(serverId)),
      ),
      updateMember: payloadHandler(agentRequest(parseUpdateTeamMember), ({ serverId, payload }) =>
        runCauseEffect(remoteServers.updateMember(serverId, payload)),
      ),
      removeMember: payloadHandler(agentRequest(stringPayload("memberId")), ({ serverId, payload }) =>
        runCauseEffect(remoteServers.removeMember(serverId, payload)),
      ),
      setTyping: payloadHandler(parseSetTeamTyping, (parsed) =>
        routeToServer<void>(remoteServers.activeServerId, {
          local: () => host.setTyping(parsed),
          remote: () => runCauseEffect(remoteServers.setTyping(parsed)),
        }),
      ),
      listDirectThreads: handler(() =>
        routeToServer(remoteServers.activeServerId, {
          local: () => host.listDirectThreads(),
          remote: () => runCauseEffect(remoteServers.listDirectThreads()),
        }),
      ),
      readDirectConversation: payloadHandler(stringPayload("memberId"), (memberId) =>
        routeToServer(remoteServers.activeServerId, {
          local: () => host.readDirectConversation(memberId),
          remote: () => runCauseEffect(remoteServers.readDirectConversation(memberId)),
        }),
      ),
      readDirectConversationPage: payloadHandler(parseReadDirectConversationPage, (parsed) =>
        routeToServer(remoteServers.activeServerId, {
          local: () => host.readDirectConversationPage(parsed.memberId, parsed.anchor, parsed.limit),
          remote: () =>
            runCauseEffect(remoteServers.readDirectConversationPage(parsed.memberId, parsed.anchor, parsed.limit)),
        }),
      ),
      sendDirectMessage: payloadHandler(parseSendDirectMessage, (parsed) =>
        routeToServer(remoteServers.activeServerId, {
          local: () => host.sendDirectMessage(parsed),
          remote: () => runCauseEffect(remoteServers.sendDirectMessage(parsed)),
        }),
      ),
      markDirectRead: payloadHandler(parseMarkDirectRead, (parsed) =>
        routeToServer(remoteServers.activeServerId, {
          local: () => host.markDirectRead(parsed),
          remote: () => runCauseEffect(remoteServers.markDirectRead(parsed)),
        }),
      ),
      setDirectTyping: payloadHandler(parseDirectTyping, (parsed) =>
        routeToServer<void>(remoteServers.activeServerId, {
          local: () => host.setDirectTyping(parsed),
          remote: () => runCauseEffect(remoteServers.setDirectTyping(parsed)),
        }),
      ),
    },
    host: {
      getStatus: handler(() => host.getStatus()),
      configure: payloadHandler(parseHostConfig, (config) => runCauseEffect(host.configure(config))),
      updateIdentity: payloadHandler(parseHostIdentity, (identity) => runCauseEffect(host.updateIdentity(identity))),
      getPresence: handler(() => host.getPresence()),
      start: handler(() => runCauseEffect(relayHosting.publishHost())),
      stop: handler(() => runCauseEffect(relayHosting.unpublishHost())),
      listMembers: handler(() => runCauseEffect(host.listMembers())),
      updateMember: payloadHandler(parseUpdateTeamMember, (update) => runCauseEffect(host.updateMember(update))),
      removeMember: payloadHandler(stringPayload("memberId"), (memberId) =>
        runCauseEffect(host.removeMember(memberId)),
      ),
      listSessions: handler(() => host.listSessions()),
      revokeSession: payloadHandler(stringPayload("sessionId"), (sessionId) =>
        runCauseEffect(host.revokeSession(sessionId)),
      ),
    },
  };
}

export function withLocalHostSummary(servers: ServerSummary[], status: HostStatus): ServerSummary[] {
  return servers.map((server) =>
    server.id === LOCAL_SERVER_ID
      ? {
          ...server,
          name: status.serverName ?? "Local",
          logoUrl: status.logoUrl,
          appearance: status.appearance,
          apiUrl: status.apiUrl,
          state: status.phase === "error" ? "error" : "online",
          role: status.configured ? "owner" : null,
        }
      : server,
  );
}
