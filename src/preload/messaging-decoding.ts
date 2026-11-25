import {
  type AddMessagingOrchestratorResult,
  isAddMessagingOrchestratorResult,
  isWhatsAppGroupList,
  isWhatsAppLinkState,
  isWhatsAppOverview,
  type WhatsAppGroupList,
  type WhatsAppLinkState,
  type WhatsAppOverview,
} from "@openbot/contracts/ipc";

export function decodeAddOrchestratorReply(value: unknown): AddMessagingOrchestratorResult {
  if (!isAddMessagingOrchestratorResult(value)) throw new Error("Invalid messaging orchestrator response.");
  return value;
}

export function decodeWhatsAppOverviewReply(value: unknown): WhatsAppOverview {
  if (!isWhatsAppOverview(value)) throw new Error("Invalid WhatsApp overview response.");
  return value;
}

export function decodeWhatsAppLinkStateReply(value: unknown): WhatsAppLinkState {
  if (!isWhatsAppLinkState(value)) throw new Error("Invalid WhatsApp link response.");
  return value;
}

export function decodeWhatsAppGroupsReply(value: unknown): WhatsAppGroupList {
  if (!isWhatsAppGroupList(value)) throw new Error("Invalid WhatsApp groups response.");
  return value;
}
