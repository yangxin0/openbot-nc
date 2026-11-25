import type {
  AgentProviderId,
  NotificationOpenedEvent,
  ServerSummary,
  WorkflowNotificationOpenedEvent,
} from "@openbot/contracts/ipc";
import { onSettled } from "solid-js";
import { usePlatform } from "../../platform";
import { createSimpleContext } from "../../simple-context";
import { useAgents } from "../agents/agents-context";
import { useConversationController } from "../conversation/conversation-controller-context";
import { useDirectMessages } from "../conversation/direct-messages-context";
import { useSetup } from "../onboarding/onboarding-context";
import { useWindowPage } from "../window/window-page-context";
import { useServerSwitch } from "./server-switch";
import { useServers } from "./servers-context";
import { serversPort } from "./servers-port";

const ServerSelection = createSimpleContext({
  name: "Server selection",
  init: () => {
    const { servers, setServers, beginServerSelection } = useServers();
    const { saveSetup } = useSetup();
    const {
      setBrowserVisibilitySuspended,
      setPendingAgentSelection,
      setPendingChannelSelection,
      setPendingThreadSelection,
      setPreviousServerId,
    } = useServerSwitch();
    const { agentSetupOpen, creatingAgent } = useAgents();
    const { stopComposerTyping } = useConversationController();
    const { setDirectTyping } = useDirectMessages();
    const { chatWindow } = usePlatform();
    const windowPage = useWindowPage();

    async function selectServer(serverId: string, recoverAuthoritativeServer = true): Promise<boolean> {
      if (agentSetupOpen() && creatingAgent()) return false;
      if (chatWindow) return false;
      const selectionIsCurrent = beginServerSelection();
      const previousServerId = servers().find((server) => server.active)?.id;
      const switchingServers = Boolean(previousServerId && previousServerId !== serverId);
      if (switchingServers) setBrowserVisibilitySuspended(true);
      try {
        if (switchingServers) {
          stopComposerTyping();
          setDirectTyping(false);
          await serversPort()
            .browser.setVisible({ visible: false })
            .catch(() => undefined);
          if (!selectionIsCurrent()) return false;
        }
        let nextServers: ServerSummary[];
        try {
          nextServers = await serversPort().servers.select(serverId);
          if (!selectionIsCurrent()) return false;
          const authoritativeServerId = nextServers.find((server) => server.active)?.id;
          if (authoritativeServerId !== serverId) {
            if (authoritativeServerId) await selectServer(authoritativeServerId, false);
            return false;
          }
        } catch (error) {
          if (!selectionIsCurrent()) return false;
          if (recoverAuthoritativeServer) {
            const authoritativeServers = await serversPort()
              .servers.list()
              .catch(() => null);
            if (!selectionIsCurrent()) return false;
            const authoritativeServerId = authoritativeServers?.find((server) => server.active)?.id;
            if (authoritativeServerId && authoritativeServerId !== previousServerId) {
              await selectServer(authoritativeServerId, false);
            }
          }
          throw error;
        }
        if (switchingServers && previousServerId) setPreviousServerId(previousServerId);
        setServers(nextServers);
        return true;
      } finally {
        if (selectionIsCurrent()) setBrowserVisibilitySuspended(false);
      }
    }

    async function openNotifiedAgent(event: NotificationOpenedEvent): Promise<void> {
      const onServer = servers().find((server) => server.active)?.id === event.serverId;
      if (!onServer && !(await selectServer(event.serverId))) return;
      if (event.channelId) {
        setPendingChannelSelection(event.channelId);
        return;
      }
      if (event.threadId) setPendingThreadSelection({ agentId: event.agentId, threadId: event.threadId });
      setPendingAgentSelection(event.agentId);
    }

    onSettled(() =>
      serversPort().notifications.onOpened((event) => {
        void openNotifiedAgent(event).catch(() => undefined);
      }),
    );

    async function openNotifiedWorkflow(event: WorkflowNotificationOpenedEvent): Promise<void> {
      const onServer = servers().find((server) => server.active)?.id === event.serverId;
      if (!onServer && !(await selectServer(event.serverId))) return;
      windowPage.openWorkflows(null, event);
    }

    onSettled(() =>
      serversPort().notifications.onWorkflowOpened((event) => {
        void openNotifiedWorkflow(event).catch(() => undefined);
      }),
    );

    async function createLocalServer(name: string): Promise<void> {
      const server = await serversPort().localServers.create(name);
      await selectServer(server.id);
    }

    async function openServerDuringSetup(serverId: string, provider: AgentProviderId): Promise<boolean> {
      const previousServerId = servers().find((server) => server.active)?.id ?? "local";
      if (!(await selectServer(serverId))) return false;
      try {
        await saveSetup(provider, null);
      } catch (error) {
        await selectServer(previousServerId).catch(() => false);
        throw error;
      }
      return true;
    }

    return {
      selectServer,
      createLocalServer,
      openServerDuringSetup,
    };
  },
});

export const ServerSelectionProvider = ServerSelection.provider;
export const useServerSelection = ServerSelection.use;
