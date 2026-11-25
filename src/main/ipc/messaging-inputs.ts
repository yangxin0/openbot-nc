import type {
  AddTelegramOrchestratorInput,
  AnswerWhatsAppRequestInput,
  MessagingWorkspaceInput,
  RemoveWhatsAppSenderInput,
  SetMessagingEnabledInput,
  SetWhatsAppOwnNumberInput,
  SetWhatsAppSenderReadOnlyInput,
  SetWhatsAppStatusReactionsInput,
  SetWhatsAppWorkingMessageInput,
  StartWhatsAppLinkInput,
  WhatsAppSenderInput,
} from "@openbot/contracts/ipc";
import {
  isAgentModel,
  isAgentProvider,
  isReasoningEffort,
  isWhatsAppSender,
  parseWhatsAppPhoneNumber,
  parseWhatsAppRequestCode,
} from "@openbot/contracts/ipc";
import { isBoolean } from "@openbot/contracts/runtime-values";
import { isObject, requireString } from "./validation";

export function parseMessagingWorkspaceInput(value: unknown): MessagingWorkspaceInput {
  if (!isObject(value)) throw new Error("A messaging request is invalid.");
  return { workspaceId: requireString(value.workspaceId, "Workspace id") };
}

export function parseSetMessagingEnabledInput(value: unknown): SetMessagingEnabledInput {
  if (!isObject(value) || !isBoolean(value.enabled)) throw new Error("A messaging request is invalid.");
  return { workspaceId: requireString(value.workspaceId, "Workspace id"), enabled: value.enabled };
}

export function parseAddTelegramOrchestratorInput(value: unknown): AddTelegramOrchestratorInput {
  if (!isObject(value)) throw new Error("A messaging request is invalid.");
  const result: AddTelegramOrchestratorInput = {};
  if (value.provider !== undefined) {
    if (!isAgentProvider(value.provider)) throw new Error("A messaging request is invalid.");
    result.provider = value.provider;
  }
  if (value.model !== undefined) {
    if (!isAgentModel(value.model)) throw new Error("A messaging request is invalid.");
    result.model = value.model;
  }
  if (value.reasoningEffort !== undefined) {
    if (!isReasoningEffort(value.reasoningEffort)) throw new Error("A messaging request is invalid.");
    result.reasoningEffort = value.reasoningEffort;
  }
  return result;
}

export function parseStartWhatsAppLinkInput(value: unknown): StartWhatsAppLinkInput {
  if (!isObject(value) || (value.method !== "qr" && value.method !== "code") || !isBoolean(value.ownNumber))
    throw new Error("A messaging request is invalid.");
  if (value.method === "qr") return { method: "qr", phoneNumber: null, ownNumber: value.ownNumber };
  const phoneNumber = parseWhatsAppPhoneNumber(value.phoneNumber);
  if (!phoneNumber) throw new Error("A messaging request is invalid.");
  return { method: "code", phoneNumber, ownNumber: value.ownNumber };
}

export function parseWhatsAppSenderInput(value: unknown): WhatsAppSenderInput {
  if (!isObject(value)) throw new Error("A messaging request is invalid.");
  const sender =
    isObject(value.sender) && value.sender.kind === "contact"
      ? { ...value.sender, id: parseWhatsAppPhoneNumber(value.sender.id) ?? "" }
      : value.sender;
  if (!isWhatsAppSender(sender)) throw new Error("A messaging request is invalid.");
  return {
    workspaceId: requireString(value.workspaceId, "Workspace id"),
    sender: { id: sender.id, kind: sender.kind, name: sender.name.trim() || sender.id },
  };
}

export function parseRemoveWhatsAppSenderInput(value: unknown): RemoveWhatsAppSenderInput {
  if (!isObject(value)) throw new Error("A messaging request is invalid.");
  return {
    workspaceId: requireString(value.workspaceId, "Workspace id"),
    senderId: requireString(value.senderId, "Sender id"),
  };
}

export function parseAnswerWhatsAppRequestInput(value: unknown): AnswerWhatsAppRequestInput {
  if (!isObject(value) || !isBoolean(value.approve)) throw new Error("A messaging request is invalid.");
  const code = parseWhatsAppRequestCode(value.code);
  if (!code) throw new Error("A messaging request is invalid.");
  return { workspaceId: requireString(value.workspaceId, "Workspace id"), code, approve: value.approve };
}

export function parseSetWhatsAppOwnNumberInput(value: unknown): SetWhatsAppOwnNumberInput {
  if (!isObject(value) || !isBoolean(value.ownNumber)) throw new Error("A messaging request is invalid.");
  return { workspaceId: requireString(value.workspaceId, "Workspace id"), ownNumber: value.ownNumber };
}

export function parseSetWhatsAppWorkingMessageInput(value: unknown): SetWhatsAppWorkingMessageInput {
  if (!isObject(value) || !isBoolean(value.workingMessage)) throw new Error("A messaging request is invalid.");
  return { workspaceId: requireString(value.workspaceId, "Workspace id"), workingMessage: value.workingMessage };
}

export function parseSetWhatsAppStatusReactionsInput(value: unknown): SetWhatsAppStatusReactionsInput {
  if (!isObject(value) || !isBoolean(value.statusReactions)) throw new Error("A messaging request is invalid.");
  return { workspaceId: requireString(value.workspaceId, "Workspace id"), statusReactions: value.statusReactions };
}

export function parseSetWhatsAppSenderReadOnlyInput(value: unknown): SetWhatsAppSenderReadOnlyInput {
  if (!isObject(value) || !isBoolean(value.readOnly)) throw new Error("A messaging request is invalid.");
  return {
    workspaceId: requireString(value.workspaceId, "Workspace id"),
    senderId: requireString(value.senderId, "Sender id"),
    readOnly: value.readOnly,
  };
}
