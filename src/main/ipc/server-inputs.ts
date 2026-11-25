import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  ConfigureHostInput,
  DirectTypingInput,
  MarkDirectReadInput,
  ReadDirectConversationPageInput,
  ReorderServersInput,
  SendDirectMessageInput,
  SetServerHiddenInput,
  SetServerMutedInput,
  SetServerNotificationLevelInput,
  SetTeamTypingInput,
  UpdateHostIdentityInput,
  UpdateTeamMemberInput,
} from "@openbot/contracts/ipc";
import { SERVER_MUTE_DURATIONS_MS, SERVER_NOTIFICATION_LEVELS } from "@openbot/contracts/ipc";
import { isBoolean, isNumber, isOneOf, isString } from "@openbot/contracts/runtime-values";
import { type ServerAppearance, serverAppearanceOrNull } from "@openbot/contracts/team-protocol/host-appearance-v1";
import { parseAvatarImage } from "./avatar-inputs";
import { isObject, requireString } from "./validation";

export function parseReadDirectConversationPage(value: unknown): ReadDirectConversationPageInput {
  if (!isObject(value)) throw new Error("Invalid direct-message page request.");
  const anchor = value.anchor;
  let parsedAnchor: ReadDirectConversationPageInput["anchor"] = { type: "latest" };
  if (anchor !== undefined) {
    if (!isObject(anchor) || !isString(anchor.type)) throw new Error("Invalid direct-message page anchor.");
    if (anchor.type === "before") {
      parsedAnchor = { type: "before", cursor: requireString(anchor.cursor, "cursor", 2048) };
    } else if (anchor.type === "around") {
      parsedAnchor = {
        type: "around",
        messageId: requireString(anchor.messageId, "messageId", INPUT_LIMITS.identifier),
      };
    } else if (anchor.type !== "latest") {
      throw new Error("Invalid direct-message page anchor.");
    }
  }
  const limit = value.limit ?? 50;
  if (!isNumber(limit) || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("The direct-message page limit must be between 1 and 100.");
  }
  return {
    memberId: requireString(value.memberId, "memberId", INPUT_LIMITS.identifier),
    anchor: parsedAnchor,
    limit,
  };
}

export function parseHostConfig(value: unknown): ConfigureHostInput {
  if (!isObject(value)) throw new Error("Host configuration is required.");
  const serverName = requireString(value.serverName, "serverName", INPUT_LIMITS.serverName);
  if (serverName.trim().length < INPUT_LIMITS.serverNameMin) {
    throw new Error(`Server name must contain at least ${INPUT_LIMITS.serverNameMin} characters.`);
  }
  return {
    serverName,
    ...(value.logo === undefined ? {} : { logo: parseAvatarImage(value.logo) }),
  };
}

export function parseHostIdentity(value: unknown): UpdateHostIdentityInput {
  if (!isObject(value)) throw new Error("Host identity is required.");
  if (value.serverName === undefined && value.logo === undefined && value.appearance === undefined) {
    throw new Error("A host identity change is required.");
  }
  const serverName =
    value.serverName === undefined ? undefined : requireString(value.serverName, "serverName", INPUT_LIMITS.serverName);
  if (serverName !== undefined && serverName.trim().length < INPUT_LIMITS.serverNameMin) {
    throw new Error(`Server name must contain at least ${INPUT_LIMITS.serverNameMin} characters.`);
  }
  return {
    ...(serverName === undefined ? {} : { serverName }),
    ...(value.logo === undefined ? {} : { logo: parseAvatarImage(value.logo) }),
    ...(value.appearance === undefined ? {} : { appearance: parseServerAppearance(value.appearance) }),
  };
}

function parseServerAppearance(value: unknown): ServerAppearance | null {
  if (value === null) return null;
  const appearance = serverAppearanceOrNull(value);
  if (!appearance) throw new Error("Invalid server appearance.");
  return appearance;
}

export function parseReorderServers(value: unknown): ReorderServersInput {
  if (!isObject(value) || !Array.isArray(value.serverIds)) {
    throw new Error("Invalid server order.");
  }
  const serverIds = value.serverIds.map((serverId) => requireString(serverId, "serverId", INPUT_LIMITS.identifier));
  if (new Set(serverIds).size !== serverIds.length) {
    throw new Error("Duplicate server ids.");
  }
  return { serverIds };
}

export function parseUpdateTeamMember(value: unknown): UpdateTeamMemberInput {
  if (!isObject(value)) throw new Error("Invalid team member update.");
  const role = value.role;
  const disabled = value.disabled;
  if (role !== undefined && role !== "admin" && role !== "member") {
    throw new Error("Invalid team member role.");
  }
  if (disabled !== undefined && !isBoolean(disabled)) {
    throw new Error("Invalid team member state.");
  }
  return {
    memberId: requireString(value.memberId, "memberId"),
    ...(role ? { role } : {}),
    ...(disabled === undefined ? {} : { disabled }),
  };
}

export function parseSetTeamTyping(value: unknown): SetTeamTypingInput {
  if (!isObject(value) || !isBoolean(value.typing)) {
    throw new Error("Invalid typing state.");
  }
  if (value.agentId !== null && !isString(value.agentId)) {
    throw new Error("Invalid typing agent.");
  }
  if (value.typing && !value.agentId) throw new Error("A typing agent is required.");
  return {
    agentId: value.agentId === null ? null : requireString(value.agentId, "agentId", INPUT_LIMITS.identifier),
    typing: value.typing,
  };
}

export function parseSendDirectMessage(value: unknown): SendDirectMessageInput {
  if (!isObject(value)) throw new Error("Direct message details are required.");
  return {
    memberId: requireString(value.memberId, "memberId", INPUT_LIMITS.identifier),
    text: requireString(value.text, "text", INPUT_LIMITS.directMessageText),
    clientMessageId: requireString(value.clientMessageId, "clientMessageId", INPUT_LIMITS.identifier),
  };
}

export function parseMarkDirectRead(value: unknown): MarkDirectReadInput {
  if (!isObject(value) || !isNumber(value.throughSequence)) {
    throw new Error("Invalid direct-message read request.");
  }
  if (!Number.isSafeInteger(value.throughSequence) || value.throughSequence < 0) {
    throw new Error("Invalid direct-message read boundary.");
  }
  return {
    memberId: requireString(value.memberId, "memberId", INPUT_LIMITS.identifier),
    throughSequence: value.throughSequence,
  };
}

export function parseDirectTyping(value: unknown): DirectTypingInput {
  if (!isObject(value) || !isBoolean(value.typing)) {
    throw new Error("Invalid direct typing state.");
  }
  return {
    memberId: requireString(value.memberId, "memberId", INPUT_LIMITS.identifier),
    typing: value.typing,
  };
}

export function parseSetServerMuted(value: unknown): SetServerMutedInput {
  if (!isObject(value) || !isBoolean(value.muted)) throw new Error("Invalid server mute setting.");
  const serverId = requireString(value.serverId, "serverId", INPUT_LIMITS.identifier);
  if (value.durationMs === undefined) return { serverId, muted: value.muted };
  if (!value.muted || !isOneOf(SERVER_MUTE_DURATIONS_MS, value.durationMs)) {
    throw new Error("Invalid server mute duration.");
  }
  return { serverId, muted: true, durationMs: value.durationMs };
}

export function parseSetServerHidden(value: unknown): SetServerHiddenInput {
  if (!isObject(value) || !isBoolean(value.hidden)) throw new Error("Invalid server hidden setting.");
  return { serverId: requireString(value.serverId, "serverId", INPUT_LIMITS.identifier), hidden: value.hidden };
}

export function parseSetServerNotificationLevel(value: unknown): SetServerNotificationLevelInput {
  if (!isObject(value) || !isOneOf(SERVER_NOTIFICATION_LEVELS, value.level)) {
    throw new Error("Invalid server notification level.");
  }
  return { serverId: requireString(value.serverId, "serverId", INPUT_LIMITS.identifier), level: value.level };
}
