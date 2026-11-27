import type { OpenBotDesktopApi, ServerSummary } from "@openbot/contracts/ipc";

export interface ServersPort {
  agent: Pick<
    OpenBotDesktopApi["agent"],
    | "getStatus"
    | "listAgents"
    | "listConversationReads"
    | "listHiddenAgents"
    | "listAgentNotificationLevels"
    | "listMcpServers"
    | "listModels"
    | "removeMcpServer"
    | "saveMcpServer"
    | "setMcpServerEnabled"
    | "testMcpServer"
    | "signInMcpServer"
    | "mcpSignInPage"
    | "mcpSignInRelay"
    | "openMcpSignInRelay"
    | "completeMcpSignInRelay"
    | "cancelMcpSignIn"
    | "signOutMcpServer"
    | "listMcpSignIns"
    | "mcpSignInApp"
    | "saveMcpSignInApp"
    | "removeMcpSignInApp"
  >;
  events: OpenBotDesktopApi["events"];
  browser: Pick<OpenBotDesktopApi["browser"], "setVisible">;
  hostAdmin: Pick<
    OpenBotDesktopApi["hostAdmin"],
    "cancelUpdate" | "getUpdateStatus" | "restartHost" | "startUpdate" | "updateIdentity"
  >;
  localServers: OpenBotDesktopApi["localServers"];
  host: Pick<OpenBotDesktopApi["host"], "configure" | "getStatus" | "onEvent" | "start" | "stop" | "updateIdentity">;
  notifications: Pick<OpenBotDesktopApi["notifications"], "onOpened" | "onWorkflowOpened">;
  servers: Pick<
    OpenBotDesktopApi["servers"],
    | "getPresenceFor"
    | "list"
    | "onEvent"
    | "onPresence"
    | "refreshIdentity"
    | "remove"
    | "reorder"
    | "retryConnection"
    | "select"
    | "setMuted"
    | "setNotificationLevel"
  >;
}

export function serversPort(): ServersPort {
  return window.openbot;
}

export type ServerMemberPort = Pick<
  OpenBotDesktopApi["host"],
  "getPresence" | "listMembers" | "updateMember" | "removeMember"
>;

export function serverMemberPort(server: Pick<ServerSummary, "id" | "kind">): ServerMemberPort {
  if (server.kind === "local") return window.openbot.host;
  const serverId = server.id;
  return {
    getPresence: () => window.openbot.servers.getPresenceFor(serverId),
    listMembers: () => window.openbot.servers.listMembers(serverId),
    updateMember: (input) => window.openbot.servers.updateMember(input, serverId),
    removeMember: (memberId) => window.openbot.servers.removeMember(memberId, serverId),
  };
}
