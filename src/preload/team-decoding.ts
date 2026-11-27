import {
  type DirectConversationPage,
  type DirectConversationReadState,
  type DirectConversationSnapshot,
  type DirectMessage,
  type DirectThreadSummary,
  type HostStatus,
  isAvatarColor,
  type ScopedDirectMessageEvent,
  type ScopedDirectTypingEvent,
  type ScopedTeamPresenceSnapshot,
  SERVER_NOTIFICATION_LEVELS,
  type ServerCompatibility,
  type ServerConnectionIssue,
  type ServerRelayHost,
  type ServerSummary,
  type TeamMemberSummary,
  type TeamPresenceMember,
  type TeamPresenceSnapshot,
  type TeamRole,
  type TeamSessionSummary,
} from "@openbot/contracts/ipc";
import {
  decodeList,
  decodeRecord,
  nullableNumber,
  nullableString,
  optionalHistoryExtent,
  requiredBoolean,
  requiredNumber,
  requiredString,
} from "@openbot/contracts/ipc-decoding";
import { type DynamicRecord, isBoolean, isNumber, isOneOf, isString } from "@openbot/contracts/runtime-values";
import { type ServerAppearance, serverAppearanceOrNull } from "@openbot/contracts/team-protocol/host-appearance-v1";

const HOST_PHASES = ["unconfigured", "idle", "starting", "online", "stopping", "error"] as const;
const TEAM_ROLES = ["owner", "admin", "member"] as const;
const SERVER_KINDS = ["local", "remote"] as const;
const SERVER_STATES = ["online", "connecting", "offline", "error", "incompatible"] as const;
const SERVER_ISSUE_CODES = [
  "client_update_required",
  "host_update_required",
  "protocol_error",
  "server_safe_mode",
  "authentication_required",
  "network_unavailable",
] as const;

export function decodeServer(value: unknown): ServerSummary {
  return server(decodeRecord(value, "server"));
}

export function decodeServers(value: unknown): ServerSummary[] {
  return decodeList(value, "server list", server);
}

export function decodeHostStatus(value: unknown): HostStatus {
  const status = decodeRecord(value, "host status");
  if (!isOneOf(HOST_PHASES, status.phase)) throw new Error("Invalid phase.");
  return {
    phase: status.phase,
    configured: requiredBoolean(status, "configured"),
    enabledOnLaunch: requiredBoolean(status, "enabledOnLaunch"),
    serverId: nullableString(status, "serverId"),
    serverName: nullableString(status, "serverName"),
    apiUrl: nullableString(status, "apiUrl"),
    logoUrl: nullableString(status, "logoUrl"),
    appearance: serverAppearance(status.appearance),
    apiOnline: requiredBoolean(status, "apiOnline"),
    message: nullableString(status, "message"),
  };
}

export function decodeTeamMember(value: unknown): TeamMemberSummary {
  return teamMember(decodeRecord(value, "team member"));
}

export function decodeTeamMembers(value: unknown): TeamMemberSummary[] {
  return decodeList(value, "team member list", teamMember);
}

export function decodeTeamPresenceSnapshot(value: unknown): TeamPresenceSnapshot {
  const snapshot = decodeRecord(value, "team presence");
  return {
    serverId: nullableString(snapshot, "serverId"),
    members: decodeList(snapshot.members, "team presence member list", presenceMember),
    updatedAt: requiredString(snapshot, "updatedAt"),
  };
}

export function decodeScopedTeamPresence(value: unknown): ScopedTeamPresenceSnapshot {
  const scoped = decodeRecord(value, "server presence");
  return { serverId: requiredString(scoped, "serverId"), snapshot: decodeTeamPresenceSnapshot(scoped.snapshot) };
}

export function decodeTeamSessions(value: unknown): TeamSessionSummary[] {
  return decodeList(value, "team session list", (session) => ({
    id: requiredString(session, "id"),
    memberId: requiredString(session, "memberId"),
    username: requiredString(session, "username"),
    createdAt: requiredString(session, "createdAt"),
    expiresAt: requiredString(session, "expiresAt"),
  }));
}

export function decodeDirectThreads(value: unknown): DirectThreadSummary[] {
  return decodeList(value, "direct thread list", (thread) => ({
    threadId: requiredString(thread, "threadId"),
    otherMemberId: requiredString(thread, "otherMemberId"),
    lastMessage: decodeDirectMessage(thread.lastMessage),
    unreadCount: requiredNumber(thread, "unreadCount"),
    updatedAt: requiredString(thread, "updatedAt"),
  }));
}

export function decodeDirectConversation(value: unknown): DirectConversationSnapshot {
  const conversation = decodeRecord(value, "direct conversation");
  return {
    threadId: requiredString(conversation, "threadId"),
    otherMemberId: requiredString(conversation, "otherMemberId"),
    messages: decodeList(conversation.messages, "direct message list", directMessage),
    revision: requiredNumber(conversation, "revision"),
    ...optionalReadState(conversation),
  };
}

export function decodeDirectConversationPage(value: unknown): DirectConversationPage {
  const page = decodeRecord(value, "direct conversation page");
  const pageInfo = decodeRecord(page.pageInfo, "direct conversation page info");
  return {
    threadId: requiredString(page, "threadId"),
    otherMemberId: requiredString(page, "otherMemberId"),
    messages: decodeList(page.messages, "direct message list", directMessage),
    revision: requiredNumber(page, "revision"),
    pageInfo: {
      hasOlder: requiredBoolean(pageInfo, "hasOlder"),
      olderCursor: nullableString(pageInfo, "olderCursor"),
      ...optionalHistoryExtent(pageInfo),
    },
    ...optionalReadState(page),
  };
}

export function decodeDirectMessage(value: unknown): DirectMessage {
  return directMessage(decodeRecord(value, "direct message"));
}

export function decodeDirectReadState(value: unknown): DirectConversationReadState {
  const state = decodeRecord(value, "direct read state");
  return {
    unreadCount: requiredNumber(state, "unreadCount"),
    firstUnreadMessageId: nullableString(state, "firstUnreadMessageId"),
    throughSequence: requiredNumber(state, "throughSequence"),
  };
}

export function decodeScopedDirectMessage(value: unknown): ScopedDirectMessageEvent {
  const scoped = decodeRecord(value, "direct message event");
  const event = decodeRecord(scoped.event, "direct message event");
  if (event.type !== "team-direct-message") throw new Error("Invalid direct message event.");
  const memberIds = Array.isArray(event.memberIds) ? event.memberIds : [];
  const [senderMemberId, recipientMemberId] = memberIds;
  if (memberIds.length !== 2 || !isString(senderMemberId) || !isString(recipientMemberId)) {
    throw new Error("Invalid memberIds.");
  }
  return {
    serverId: requiredString(scoped, "serverId"),
    event: {
      type: event.type,
      message: decodeDirectMessage(event.message),
      memberIds: [senderMemberId, recipientMemberId],
    },
  };
}

export function decodeScopedDirectTyping(value: unknown): ScopedDirectTypingEvent {
  const scoped = decodeRecord(value, "direct typing event");
  const event = decodeRecord(scoped.event, "direct typing event");
  if (event.type !== "team-direct-typing") throw new Error("Invalid direct typing event.");
  return {
    serverId: requiredString(scoped, "serverId"),
    event: {
      type: event.type,
      senderMemberId: requiredString(event, "senderMemberId"),
      recipientMemberId: requiredString(event, "recipientMemberId"),
      typing: requiredBoolean(event, "typing"),
    },
  };
}

function server(summary: DynamicRecord): ServerSummary {
  const {
    notificationLevel,
    kind,
    state,
    role,
    compatibility,
    issue,
    connectionSequence,
    capabilitiesPending,
    hostRestart,
    restartAvailable,
    keyChangedAt,
    thisComputer,
    appearance,
    relayHost,
    username,
  } = summary;
  if (!isOneOf(SERVER_NOTIFICATION_LEVELS, notificationLevel)) throw new Error("Invalid notificationLevel.");
  if (!isOneOf(SERVER_KINDS, kind)) throw new Error("Invalid kind.");
  if (!isOneOf(SERVER_STATES, state)) throw new Error("Invalid state.");
  if (connectionSequence !== undefined && !isNumber(connectionSequence)) throw new Error("Invalid connectionSequence.");
  if (restartAvailable !== undefined && !isBoolean(restartAvailable)) throw new Error("Invalid restartAvailable.");
  if (
    keyChangedAt !== undefined &&
    !(isNumber(keyChangedAt) && Number.isSafeInteger(keyChangedAt) && keyChangedAt >= 0)
  ) {
    throw new Error("Invalid keyChangedAt.");
  }
  if (thisComputer !== undefined && thisComputer !== true) throw new Error("Invalid thisComputer.");
  if (username !== undefined && !isString(username)) throw new Error("Invalid username.");
  if (capabilitiesPending !== undefined && capabilitiesPending !== true) {
    throw new Error("Invalid capabilitiesPending.");
  }
  return {
    notificationsMuted: requiredBoolean(summary, "notificationsMuted"),
    notificationsMutedUntil: nullableNumber(summary, "notificationsMutedUntil"),
    notificationLevel,
    id: requiredString(summary, "id"),
    name: requiredString(summary, "name"),
    kind,
    state,
    apiUrl: nullableString(summary, "apiUrl"),
    logoUrl: nullableString(summary, "logoUrl"),
    ...(appearance === undefined ? {} : { appearance: serverAppearance(appearance) }),
    role: role === null ? null : teamRole(role),
    ...(username === undefined ? {} : { username }),
    active: requiredBoolean(summary, "active"),
    ...(compatibility === undefined
      ? {}
      : { compatibility: compatibility === null ? null : serverCompatibility(compatibility) }),
    ...(issue === undefined ? {} : { issue: issue === null ? null : serverIssue(issue) }),
    ...(connectionSequence === undefined ? {} : { connectionSequence }),
    ...(capabilitiesPending === undefined ? {} : { capabilitiesPending }),
    ...(hostRestart === undefined ? {} : { hostRestart: hostRestart === null ? null : serverHostRestart(hostRestart) }),
    ...(restartAvailable === undefined ? {} : { restartAvailable }),
    ...(keyChangedAt === undefined ? {} : { keyChangedAt }),
    ...(thisComputer === undefined ? {} : { thisComputer }),
    ...(relayHost === undefined ? {} : { relayHost: serverRelayHost(relayHost) }),
  };
}

function serverRelayHost(value: unknown): ServerRelayHost {
  const host = decodeRecord(value, "server relay host");
  return { user: requiredString(host, "user"), device: nullableString(host, "device") };
}

function serverAppearance(value: unknown): ServerAppearance | null {
  if (value === null) return null;
  const appearance = serverAppearanceOrNull(value);
  if (!appearance) throw new Error("Invalid appearance.");
  return appearance;
}

function serverHostRestart(value: unknown): NonNullable<ServerSummary["hostRestart"]> {
  const restart = decodeRecord(value, "server host restart");
  const { state } = restart;
  if (state !== "waiting" && state !== "restarting") throw new Error("Invalid hostRestart.");
  return { state, version: nullableString(restart, "version") };
}

function serverCompatibility(value: unknown): ServerCompatibility {
  const compatibility = decodeRecord(value, "server compatibility");
  const { capabilities, hostProtocol } = compatibility;
  if (!Array.isArray(capabilities) || !capabilities.every(isString)) throw new Error("Invalid capabilities.");
  return {
    localAppVersion: requiredString(compatibility, "localAppVersion"),
    hostAppVersion: nullableString(compatibility, "hostAppVersion"),
    localProtocol: protocolRange(compatibility.localProtocol),
    hostProtocol: hostProtocol === null ? null : protocolRange(hostProtocol),
    negotiatedProtocol: nullableNumber(compatibility, "negotiatedProtocol"),
    capabilities,
  };
}

function protocolRange(value: unknown): { minimum: number; maximum: number } {
  const range = decodeRecord(value, "protocol range");
  return { minimum: requiredNumber(range, "minimum"), maximum: requiredNumber(range, "maximum") };
}

function serverIssue(value: unknown): ServerConnectionIssue {
  const issue = decodeRecord(value, "server connection issue");
  if (!isOneOf(SERVER_ISSUE_CODES, issue.code)) throw new Error("Invalid code.");
  const { reference } = issue;
  if (reference !== undefined && !isString(reference)) throw new Error("Invalid reference.");
  return {
    code: issue.code,
    message: requiredString(issue, "message"),
    retryable: requiredBoolean(issue, "retryable"),
    ...(reference === undefined ? {} : { reference }),
  };
}

function directMessage(message: DynamicRecord): DirectMessage {
  return {
    id: requiredString(message, "id"),
    threadId: requiredString(message, "threadId"),
    senderMemberId: requiredString(message, "senderMemberId"),
    recipientMemberId: requiredString(message, "recipientMemberId"),
    text: requiredString(message, "text"),
    createdAt: requiredString(message, "createdAt"),
    sequence: requiredNumber(message, "sequence"),
  };
}

function optionalReadState(conversation: DynamicRecord): { readState?: DirectConversationReadState } {
  return conversation.readState === undefined ? {} : { readState: decodeDirectReadState(conversation.readState) };
}

function teamMember(member: DynamicRecord): TeamMemberSummary {
  const { avatarUrl, chatColor } = member;
  if (avatarUrl !== undefined && avatarUrl !== null && !isString(avatarUrl)) {
    throw new Error("Invalid avatarUrl.");
  }
  if (chatColor !== undefined && !isAvatarColor(chatColor)) throw new Error("Invalid chatColor.");
  return {
    id: requiredString(member, "id"),
    username: requiredString(member, "username"),
    email: nullableString(member, "email"),
    name: nullableString(member, "name"),
    ...(avatarUrl === undefined ? {} : { avatarUrl }),
    role: teamRole(member.role),
    createdAt: requiredString(member, "createdAt"),
    disabled: requiredBoolean(member, "disabled"),
    ...(chatColor === undefined ? {} : { chatColor }),
  };
}

function presenceMember(member: DynamicRecord): TeamPresenceMember {
  return {
    ...teamMember(member),
    online: requiredBoolean(member, "online"),
    typingAgentId: nullableString(member, "typingAgentId"),
  };
}

function teamRole(value: unknown): TeamRole {
  if (!isOneOf(TEAM_ROLES, value)) throw new Error("Invalid role.");
  return value;
}
