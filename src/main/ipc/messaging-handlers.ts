import {
  type AddMessagingOrchestratorResult,
  decodeHostWhatsAppLinkState,
  decodeHostWhatsAppOverview,
  isAddMessagingOrchestratorResult,
  isWhatsAppGroupList,
  isWhatsAppReadOnlyList,
  isWhatsAppStatusReactionsList,
  isWhatsAppWorkingMessageList,
  type WhatsAppGroupList,
  type WhatsAppReadOnlyList,
  type WhatsAppStatusReactionsList,
  type WhatsAppWorkingMessageList,
  withWhatsAppReadOnly,
  withWhatsAppStatusReactions,
  withWhatsAppWorkingMessages,
} from "@openbot/contracts/ipc";
import type { TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";
import type { TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import {
  WHATSAPP_CONNECTOR_CAPABILITY,
  WHATSAPP_CONNECTOR_ROUTES,
} from "@openbot/contracts/team-protocol/whatsapp-connector-v1";
import {
  WHATSAPP_READ_ONLY_CAPABILITY,
  WHATSAPP_READ_ONLY_ROUTES,
} from "@openbot/contracts/team-protocol/whatsapp-read-only-v1";
import {
  WHATSAPP_STATUS_REACTIONS_CAPABILITY,
  WHATSAPP_STATUS_REACTIONS_ROUTES,
} from "@openbot/contracts/team-protocol/whatsapp-status-reactions-v1";
import {
  WHATSAPP_WORKING_MESSAGE_CAPABILITY,
  WHATSAPP_WORKING_MESSAGE_ROUTES,
} from "@openbot/contracts/team-protocol/whatsapp-working-message-v1";
import { sourceText } from "@openbot/i18n/source";
import type { Effect } from "effect";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { MessagingService } from "../../backend/messaging/messaging-service";
import type { ResponseDecoder } from "../remote-host-decoding";
import type { RemoteRequestInit } from "../remote-server-client";
import type { RemoteWorkflowError } from "../remote-service-effects";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import {
  parseAddTelegramOrchestratorInput,
  parseAnswerWhatsAppRequestInput,
  parseMessagingWorkspaceInput,
  parseRemoveWhatsAppSenderInput,
  parseSetMessagingEnabledInput,
  parseSetWhatsAppOwnNumberInput,
  parseSetWhatsAppSenderReadOnlyInput,
  parseSetWhatsAppStatusReactionsInput,
  parseSetWhatsAppWorkingMessageInput,
  parseStartWhatsAppLinkInput,
  parseWhatsAppSenderInput,
} from "./messaging-inputs";
import { scopedHandler, scopedQueryHandler } from "./scoped-handler";

interface MessagingIpcDependencies {
  messaging: Pick<
    MessagingService,
    | "reconnect"
    | "setEnabled"
    | "whatsappOverview"
    | "whatsappLinkState"
    | "startWhatsAppLink"
    | "cancelWhatsAppLink"
    | "disconnectWhatsAppNumber"
    | "addWhatsAppOrchestrator"
    | "listWhatsAppGroups"
    | "addWhatsAppSender"
    | "removeWhatsAppSender"
    | "answerWhatsAppRequest"
    | "setWhatsAppOwnNumber"
    | "setWhatsAppWorkingMessage"
    | "setWhatsAppStatusReactions"
    | "setWhatsAppSenderReadOnly"
  >;
  remoteServers: {
    supportsCapability(serverId: string, capability: TeamCurrentCapability): boolean;
    request<T>(
      serverId: string,
      path: string,
      decoder: ResponseDecoder<T>,
      init?: RemoteRequestInit,
    ): Effect.Effect<T, RemoteWorkflowError>;
  };
}

const decodeEmpty = (): null => null;

const decodeOrchestrator = (value: unknown): AddMessagingOrchestratorResult => {
  if (!isAddMessagingOrchestratorResult(value)) throw new Error("Invalid messaging orchestrator response.");
  return value;
};

const decodeWhatsAppWorkingMessages = (value: unknown): WhatsAppWorkingMessageList => {
  if (!isWhatsAppWorkingMessageList(value)) throw new Error("Invalid WhatsApp working message response.");
  return value;
};
const decodeWhatsAppReadOnly = (value: unknown): WhatsAppReadOnlyList => {
  if (!isWhatsAppReadOnlyList(value)) throw new Error("Invalid WhatsApp read-only response.");
  return value;
};
const decodeWhatsAppStatusReactions = (value: unknown): WhatsAppStatusReactionsList => {
  if (!isWhatsAppStatusReactionsList(value)) throw new Error("Invalid WhatsApp status reactions response.");
  return value;
};
const decodeWhatsAppGroups = (value: unknown): WhatsAppGroupList => {
  if (!isWhatsAppGroupList(value)) throw new Error("Invalid WhatsApp groups response.");
  return value;
};

export function messagingIpcHandlers({
  messaging,
  remoteServers,
}: MessagingIpcDependencies): Pick<IpcGroupHandlers, "messaging"> {
  function postWhatsApp<T>(serverId: string, path: string, decoder: ResponseDecoder<T>, body: TeamProtocolV2Json = {}) {
    if (!remoteServers.supportsCapability(serverId, WHATSAPP_CONNECTOR_CAPABILITY))
      throw new Error(sourceText("error.team.connectorsUnsupported"));
    return runCauseEffect(remoteServers.request(serverId, path, decoder, { method: "POST", body }));
  }
  return {
    messaging: {
      getWhatsAppOverview: handler(() => messaging.whatsappOverview()),
      startWhatsAppLink: payloadHandler(parseStartWhatsAppLinkInput, (input) =>
        runCauseEffect(messaging.startWhatsAppLink(input)),
      ),
      getWhatsAppLinkState: handler(() => messaging.whatsappLinkState()),
      cancelWhatsAppLink: handler(() => runCauseEffect(messaging.cancelWhatsAppLink())),
      disconnectWhatsAppNumber: payloadHandler(parseMessagingWorkspaceInput, ({ workspaceId }) =>
        runCauseEffect(messaging.disconnectWhatsAppNumber(workspaceId)),
      ),
      reconnectWhatsAppNumber: payloadHandler(parseMessagingWorkspaceInput, ({ workspaceId }) =>
        runCauseEffect(messaging.reconnect("whatsapp", workspaceId)),
      ),
      setWhatsAppEnabled: payloadHandler(parseSetMessagingEnabledInput, ({ workspaceId, enabled }) =>
        runCauseEffect(messaging.setEnabled("whatsapp", workspaceId, enabled)),
      ),
      addWhatsAppOrchestrator: payloadHandler(parseAddTelegramOrchestratorInput, (input) =>
        runCauseEffect(messaging.addWhatsAppOrchestrator(input)),
      ),
      listWhatsAppGroups: payloadHandler(parseMessagingWorkspaceInput, ({ workspaceId }) =>
        runCauseEffect(messaging.listWhatsAppGroups(workspaceId)),
      ),
      addWhatsAppSender: payloadHandler(parseWhatsAppSenderInput, ({ workspaceId, sender }) =>
        runCauseEffect(messaging.addWhatsAppSender(workspaceId, sender)),
      ),
      removeWhatsAppSender: payloadHandler(parseRemoveWhatsAppSenderInput, ({ workspaceId, senderId }) =>
        runCauseEffect(messaging.removeWhatsAppSender(workspaceId, senderId)),
      ),
      answerWhatsAppRequest: payloadHandler(parseAnswerWhatsAppRequestInput, ({ workspaceId, code, approve }) =>
        runCauseEffect(messaging.answerWhatsAppRequest(workspaceId, code, approve)),
      ),
      setWhatsAppOwnNumber: payloadHandler(parseSetWhatsAppOwnNumberInput, ({ workspaceId, ownNumber }) =>
        runCauseEffect(messaging.setWhatsAppOwnNumber(workspaceId, ownNumber)),
      ),
      setWhatsAppWorkingMessage: payloadHandler(
        parseSetWhatsAppWorkingMessageInput,
        ({ workspaceId, workingMessage }) =>
          runCauseEffect(messaging.setWhatsAppWorkingMessage(workspaceId, workingMessage)),
      ),
      setWhatsAppSenderReadOnly: payloadHandler(
        parseSetWhatsAppSenderReadOnlyInput,
        ({ workspaceId, senderId, readOnly }) =>
          runCauseEffect(messaging.setWhatsAppSenderReadOnly(workspaceId, senderId, readOnly)),
      ),
      setWhatsAppStatusReactions: payloadHandler(
        parseSetWhatsAppStatusReactionsInput,
        ({ workspaceId, statusReactions }) =>
          runCauseEffect(messaging.setWhatsAppStatusReactions(workspaceId, statusReactions)),
      ),
      hostGetWhatsAppOverview: scopedQueryHandler({
        local: () => messaging.whatsappOverview(),
        remote: async (serverId) => {
          const [overview, workingMessages, statusReactions, readOnly] = await Promise.all([
            postWhatsApp(serverId, WHATSAPP_CONNECTOR_ROUTES.overview, decodeHostWhatsAppOverview),
            remoteServers.supportsCapability(serverId, WHATSAPP_WORKING_MESSAGE_CAPABILITY)
              ? postWhatsApp(serverId, WHATSAPP_WORKING_MESSAGE_ROUTES.list, decodeWhatsAppWorkingMessages)
              : null,
            remoteServers.supportsCapability(serverId, WHATSAPP_STATUS_REACTIONS_CAPABILITY)
              ? postWhatsApp(serverId, WHATSAPP_STATUS_REACTIONS_ROUTES.list, decodeWhatsAppStatusReactions)
              : null,
            remoteServers.supportsCapability(serverId, WHATSAPP_READ_ONLY_CAPABILITY)
              ? postWhatsApp(serverId, WHATSAPP_READ_ONLY_ROUTES.list, decodeWhatsAppReadOnly)
              : null,
          ]);
          return withWhatsAppReadOnly(
            withWhatsAppStatusReactions(withWhatsAppWorkingMessages(overview, workingMessages), statusReactions),
            readOnly,
          );
        },
      }),
      hostStartWhatsAppLink: scopedHandler(parseStartWhatsAppLinkInput, {
        local: (input) => runCauseEffect(messaging.startWhatsAppLink(input)),
        remote: (input, serverId) =>
          postWhatsApp(serverId, WHATSAPP_CONNECTOR_ROUTES.linkStart, decodeHostWhatsAppLinkState, { ...input }),
      }),
      hostGetWhatsAppLinkState: scopedQueryHandler({
        local: () => messaging.whatsappLinkState(),
        remote: (serverId) => postWhatsApp(serverId, WHATSAPP_CONNECTOR_ROUTES.linkState, decodeHostWhatsAppLinkState),
      }),
      hostCancelWhatsAppLink: scopedQueryHandler({
        local: () => runCauseEffect(messaging.cancelWhatsAppLink()),
        remote: async (serverId) => {
          await postWhatsApp(serverId, WHATSAPP_CONNECTOR_ROUTES.linkCancel, decodeEmpty);
        },
      }),
      hostDisconnectWhatsAppNumber: scopedHandler(parseMessagingWorkspaceInput, {
        local: ({ workspaceId }) => runCauseEffect(messaging.disconnectWhatsAppNumber(workspaceId)),
        remote: async ({ workspaceId }, serverId) => {
          await postWhatsApp(serverId, WHATSAPP_CONNECTOR_ROUTES.disconnect, decodeEmpty, { workspaceId });
        },
      }),
      hostReconnectWhatsAppNumber: scopedHandler(parseMessagingWorkspaceInput, {
        local: ({ workspaceId }) => runCauseEffect(messaging.reconnect("whatsapp", workspaceId)),
        remote: async ({ workspaceId }, serverId) => {
          await postWhatsApp(serverId, WHATSAPP_CONNECTOR_ROUTES.reconnect, decodeEmpty, { workspaceId });
        },
      }),
      hostSetWhatsAppEnabled: scopedHandler(parseSetMessagingEnabledInput, {
        local: ({ workspaceId, enabled }) => runCauseEffect(messaging.setEnabled("whatsapp", workspaceId, enabled)),
        remote: async ({ workspaceId, enabled }, serverId) => {
          await postWhatsApp(serverId, WHATSAPP_CONNECTOR_ROUTES.enabled, decodeEmpty, { workspaceId, enabled });
        },
      }),
      hostAddWhatsAppOrchestrator: scopedQueryHandler({
        local: () => runCauseEffect(messaging.addWhatsAppOrchestrator({})),
        remote: (serverId) => postWhatsApp(serverId, WHATSAPP_CONNECTOR_ROUTES.orchestrator, decodeOrchestrator),
      }),
      hostListWhatsAppGroups: scopedHandler(parseMessagingWorkspaceInput, {
        local: ({ workspaceId }) => runCauseEffect(messaging.listWhatsAppGroups(workspaceId)),
        remote: ({ workspaceId }, serverId) =>
          postWhatsApp(serverId, WHATSAPP_CONNECTOR_ROUTES.groups, decodeWhatsAppGroups, { workspaceId }),
      }),
      hostAddWhatsAppSender: scopedHandler(parseWhatsAppSenderInput, {
        local: ({ workspaceId, sender }) => runCauseEffect(messaging.addWhatsAppSender(workspaceId, sender)),
        remote: async ({ workspaceId, sender }, serverId) => {
          await postWhatsApp(serverId, WHATSAPP_CONNECTOR_ROUTES.senderAdd, decodeEmpty, {
            workspaceId,
            sender: { id: sender.id, kind: sender.kind, name: sender.name },
          });
        },
      }),
      hostRemoveWhatsAppSender: scopedHandler(parseRemoveWhatsAppSenderInput, {
        local: ({ workspaceId, senderId }) => runCauseEffect(messaging.removeWhatsAppSender(workspaceId, senderId)),
        remote: async ({ workspaceId, senderId }, serverId) => {
          await postWhatsApp(serverId, WHATSAPP_CONNECTOR_ROUTES.senderRemove, decodeEmpty, { workspaceId, senderId });
        },
      }),
      hostAnswerWhatsAppRequest: scopedHandler(parseAnswerWhatsAppRequestInput, {
        local: ({ workspaceId, code, approve }) =>
          runCauseEffect(messaging.answerWhatsAppRequest(workspaceId, code, approve)),
        remote: async ({ workspaceId, code, approve }, serverId) => {
          await postWhatsApp(serverId, WHATSAPP_CONNECTOR_ROUTES.requestAnswer, decodeEmpty, {
            workspaceId,
            code,
            approve,
          });
        },
      }),
      hostSetWhatsAppOwnNumber: scopedHandler(parseSetWhatsAppOwnNumberInput, {
        local: ({ workspaceId, ownNumber }) => runCauseEffect(messaging.setWhatsAppOwnNumber(workspaceId, ownNumber)),
        remote: async ({ workspaceId, ownNumber }, serverId) => {
          await postWhatsApp(serverId, WHATSAPP_CONNECTOR_ROUTES.ownNumber, decodeEmpty, { workspaceId, ownNumber });
        },
      }),
      hostSetWhatsAppWorkingMessage: scopedHandler(parseSetWhatsAppWorkingMessageInput, {
        local: ({ workspaceId, workingMessage }) =>
          runCauseEffect(messaging.setWhatsAppWorkingMessage(workspaceId, workingMessage)),
        remote: async ({ workspaceId, workingMessage }, serverId) => {
          if (!remoteServers.supportsCapability(serverId, WHATSAPP_WORKING_MESSAGE_CAPABILITY))
            throw new Error(sourceText("error.team.connectorsUnsupported"));
          await postWhatsApp(serverId, WHATSAPP_WORKING_MESSAGE_ROUTES.update, decodeEmpty, {
            workspaceId,
            workingMessage,
          });
        },
      }),
      hostSetWhatsAppStatusReactions: scopedHandler(parseSetWhatsAppStatusReactionsInput, {
        local: ({ workspaceId, statusReactions }) =>
          runCauseEffect(messaging.setWhatsAppStatusReactions(workspaceId, statusReactions)),
        remote: async ({ workspaceId, statusReactions }, serverId) => {
          if (!remoteServers.supportsCapability(serverId, WHATSAPP_STATUS_REACTIONS_CAPABILITY))
            throw new Error(sourceText("error.team.connectorsUnsupported"));
          await postWhatsApp(serverId, WHATSAPP_STATUS_REACTIONS_ROUTES.update, decodeEmpty, {
            workspaceId,
            statusReactions,
          });
        },
      }),
      hostSetWhatsAppSenderReadOnly: scopedHandler(parseSetWhatsAppSenderReadOnlyInput, {
        local: ({ workspaceId, senderId, readOnly }) =>
          runCauseEffect(messaging.setWhatsAppSenderReadOnly(workspaceId, senderId, readOnly)),
        remote: async ({ workspaceId, senderId, readOnly }, serverId) => {
          if (!remoteServers.supportsCapability(serverId, WHATSAPP_READ_ONLY_CAPABILITY))
            throw new Error(sourceText("error.team.connectorsUnsupported"));
          await postWhatsApp(serverId, WHATSAPP_READ_ONLY_ROUTES.update, decodeEmpty, {
            workspaceId,
            senderId,
            readOnly,
          });
        },
      }),
    },
  };
}
