import {
  MESSAGING_LIMITS,
  type MessagingConnection,
  type MessagingDesktopApi,
  parseWhatsAppPhoneNumber,
  type StartWhatsAppLinkInput,
  type WhatsAppAccount,
  type WhatsAppGroup,
  type WhatsAppLinkState,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { clone } from "./mock-support";

const WHATSAPP_REQUEST_MS = 1_500;
const WHATSAPP_LINK_READS = 4;
const WHATSAPP_QR_READS = 2;

const PREVIEW_WHATSAPP_GROUPS: readonly WhatsAppGroup[] = [
  { id: "120363000000000001@g.us", name: "Family" },
  { id: "120363000000000002@g.us", name: "Book club" },
  { id: "120363000000000003@g.us", name: "Acme team" },
];

const PREVIEW_WHATSAPP_STRANGER = { senderId: "447700900555", name: "Grace Hopper" };

export function createMockMessaging(orchestrator: () => string): MessagingDesktopApi {
  const numbers = new Map<string, MessagingConnection>();
  const accounts = new Map<string, WhatsAppAccount>();
  let whatsappOrchestrator: string | null = null;
  let linkedNumbers = 0;
  let link: { state: WhatsAppLinkState; input: StartWhatsAppLinkInput; reads: number } | null = null;
  const previewQr = (rotation: number) =>
    `2@openbot-preview-${linkedNumbers + 1}-${rotation},openbot-preview-noise-key,openbot-preview-identity-key,preview`;
  const changeNumber = (workspaceId: string, update: Partial<MessagingConnection>) => {
    const current = numbers.get(workspaceId);
    if (!current) throw new Error(sourceText("error.messaging.whatsappNotConnected"));
    numbers.set(workspaceId, { ...current, ...update });
  };
  const account = (workspaceId: string) => {
    const current = accounts.get(workspaceId);
    if (!current) throw new Error(sourceText("error.messaging.whatsappNotConnected"));
    return current;
  };
  const linkNumber = (input: StartWhatsAppLinkInput): string => {
    linkedNumbers += 1;
    const count = linkedNumbers;
    const workspaceId = input.phoneNumber ?? `4477009001${String(count).padStart(2, "0")}`;
    numbers.set(workspaceId, {
      workspaceId,
      platform: "whatsapp",
      enabled: true,
      state: "connected",
      workspaceName: count === 1 ? "Preview phone" : `Preview phone ${count}`,
      botUserId: workspaceId,
      missingScopes: [],
      retryAt: null,
      credentials: "saved",
      orchestratorAgentId: whatsappOrchestrator,
    });
    const before = accounts.get(workspaceId);
    accounts.set(workspaceId, {
      workspaceId,
      ownNumber: input.ownNumber,
      workingMessage: before?.workingMessage ?? true,
      statusReactions: before?.statusReactions ?? true,
      allowedSenders: before?.allowedSenders ?? [],
      pendingRequests: [],
    });
    if (!input.ownNumber)
      setTimeout(() => {
        const current = accounts.get(workspaceId);
        if (!current || current.ownNumber) return;
        accounts.set(workspaceId, {
          ...current,
          pendingRequests: [
            {
              ...PREVIEW_WHATSAPP_STRANGER,
              code: `K7Q${String(count).padStart(3, "0")}`,
              expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
            },
          ],
        });
      }, WHATSAPP_REQUEST_MS);
    return workspaceId;
  };
  const api: Omit<MessagingDesktopApi, `host${string}`> = {
    getWhatsAppOverview: async () => clone({ connections: [...numbers.values()], accounts: [...accounts.values()] }),
    startWhatsAppLink: async (input) => {
      link = {
        input: clone(input),
        reads: 0,
        state: {
          status: "waiting",
          qr: input.method === "qr" ? previewQr(0) : null,
          code: input.method === "code" ? `PRVW${String(linkedNumbers + 1).padStart(4, "0")}` : null,
          workspaceId: null,
          error: null,
        },
      };
      return clone(link.state);
    },
    getWhatsAppLinkState: async () => {
      if (!link) return { status: "idle", qr: null, code: null, workspaceId: null, error: null };
      if (link.state.status === "waiting") {
        link.reads += 1;
        if (link.reads >= WHATSAPP_LINK_READS)
          link.state = { status: "linked", qr: null, code: null, workspaceId: linkNumber(link.input), error: null };
        else if (link.state.qr !== null)
          link.state = { ...link.state, qr: previewQr(Math.floor(link.reads / WHATSAPP_QR_READS)) };
      }
      return clone(link.state);
    },
    cancelWhatsAppLink: async () => {
      link = null;
    },
    disconnectWhatsAppNumber: async ({ workspaceId }) => {
      numbers.delete(workspaceId);
      accounts.delete(workspaceId);
    },
    reconnectWhatsAppNumber: async ({ workspaceId }) =>
      changeNumber(workspaceId, { enabled: true, state: "connected" }),
    setWhatsAppEnabled: async ({ workspaceId, enabled }) =>
      changeNumber(workspaceId, { enabled, state: enabled ? "connected" : "paused" }),
    addWhatsAppOrchestrator: async () => {
      const agentId = orchestrator();
      whatsappOrchestrator = agentId;
      for (const workspaceId of numbers.keys()) changeNumber(workspaceId, { orchestratorAgentId: agentId });
      return { agentId, sectionId: null };
    },
    listWhatsAppGroups: async ({ workspaceId }) => {
      account(workspaceId);
      return clone({ groups: [...PREVIEW_WHATSAPP_GROUPS] });
    },
    addWhatsAppSender: async ({ workspaceId, sender }) => {
      const current = account(workspaceId);
      const id = sender.kind === "contact" ? parseWhatsAppPhoneNumber(sender.id) : sender.id;
      if (!id) throw new Error("A messaging request is invalid.");
      const others = current.allowedSenders.filter((allowed) => allowed.id !== id);
      if (others.length >= MESSAGING_LIMITS.allowedSenders)
        throw new Error(sourceText("error.messaging.whatsappTooManySenders"));
      accounts.set(workspaceId, {
        ...current,
        allowedSenders: [...others, { id, kind: sender.kind, name: sender.name.trim() || id, readOnly: false }],
      });
    },
    removeWhatsAppSender: async ({ workspaceId, senderId }) => {
      const current = account(workspaceId);
      accounts.set(workspaceId, {
        ...current,
        allowedSenders: current.allowedSenders.filter((sender) => sender.id !== senderId),
      });
    },
    answerWhatsAppRequest: async ({ workspaceId, code, approve }) => {
      const current = account(workspaceId);
      const request = current.pendingRequests.find((pending) => pending.code === code);
      if (!request) throw new Error(sourceText("error.messaging.whatsappRequestEnded"));
      accounts.set(workspaceId, {
        ...current,
        pendingRequests: current.pendingRequests.filter((pending) => pending.code !== code),
        allowedSenders: approve
          ? [
              ...current.allowedSenders.filter((sender) => sender.id !== request.senderId),
              { id: request.senderId, kind: "contact", name: request.name || request.senderId, readOnly: false },
            ]
          : current.allowedSenders,
      });
    },
    setWhatsAppOwnNumber: async ({ workspaceId, ownNumber }) => {
      accounts.set(workspaceId, { ...account(workspaceId), ownNumber });
    },
    setWhatsAppWorkingMessage: async ({ workspaceId, workingMessage }) => {
      accounts.set(workspaceId, { ...account(workspaceId), workingMessage });
    },
    setWhatsAppStatusReactions: async ({ workspaceId, statusReactions }) => {
      accounts.set(workspaceId, { ...account(workspaceId), statusReactions });
    },
    setWhatsAppSenderReadOnly: async ({ workspaceId, senderId, readOnly }) => {
      const current = account(workspaceId);
      if (!current.allowedSenders.some((sender) => sender.id === senderId))
        throw new Error(sourceText("error.messaging.whatsappSenderNotFound"));
      accounts.set(workspaceId, {
        ...current,
        allowedSenders: current.allowedSenders.map((sender) =>
          sender.id === senderId ? { ...sender, readOnly } : sender,
        ),
      });
    },
  };
  return {
    ...api,
    hostGetWhatsAppOverview: () => api.getWhatsAppOverview(),
    hostStartWhatsAppLink: (input) => api.startWhatsAppLink(input),
    hostGetWhatsAppLinkState: () => api.getWhatsAppLinkState(),
    hostCancelWhatsAppLink: () => api.cancelWhatsAppLink(),
    hostDisconnectWhatsAppNumber: (input) => api.disconnectWhatsAppNumber(input),
    hostReconnectWhatsAppNumber: (input) => api.reconnectWhatsAppNumber(input),
    hostSetWhatsAppEnabled: (input) => api.setWhatsAppEnabled(input),
    hostAddWhatsAppOrchestrator: () => api.addWhatsAppOrchestrator({}),
    hostListWhatsAppGroups: (input) => api.listWhatsAppGroups(input),
    hostAddWhatsAppSender: (input) => api.addWhatsAppSender(input),
    hostRemoveWhatsAppSender: (input) => api.removeWhatsAppSender(input),
    hostAnswerWhatsAppRequest: (input) => api.answerWhatsAppRequest(input),
    hostSetWhatsAppOwnNumber: (input) => api.setWhatsAppOwnNumber(input),
    hostSetWhatsAppWorkingMessage: (input) => api.setWhatsAppWorkingMessage(input),
    hostSetWhatsAppStatusReactions: (input) => api.setWhatsAppStatusReactions(input),
    hostSetWhatsAppSenderReadOnly: (input) => api.setWhatsAppSenderReadOnly(input),
  };
}
