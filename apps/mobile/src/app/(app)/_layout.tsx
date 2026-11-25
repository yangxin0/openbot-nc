import { router, useGlobalSearchParams, useSegments } from "expo-router";
import { Stack } from "expo-router/stack";
import { useThemeColor } from "heroui-native/hooks";
import { type PropsWithChildren, useCallback, useEffect, useRef } from "react";
import { TextInput } from "react-native";
import { useCSSVariable } from "uniwind";
import { ChatListPaneProvider } from "@/features/agents/components/chat-list-pane-context";
import { ConnectedScreen } from "@/features/agents/screens/connected-screen";
import { whenUnlocked } from "@/features/app-lock/model/app-lock";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { AudioWaveformHost } from "@/features/chat/components/audio-waveform-host";
import { MermaidRendererHost } from "@/features/chat/components/mermaid-renderer-host";
import { OutboxProvider } from "@/features/chat/context/outbox-context";
import { QueuedMessagesProvider } from "@/features/chat/context/queued-messages-context";
import { HomeOnboardingProvider, useHomeOnboarding } from "@/features/onboarding/context/home-onboarding-context";
import type { QuickActionTarget } from "@/features/quick-actions/model/quick-action-items";
import { setQuickActionNavigator } from "@/features/quick-actions/quick-actions-native";
import { requestHomeSearch } from "@/features/search/model/home-search-request";
import { AppDrawerShell, useAppDrawer } from "@/features/servers/components/app-drawer-shell";
import { watchAndroidShares } from "@/features/share/model/android-share-watch";
import { setShareSheetOpener } from "@/features/share/model/share-sheet-opener";
import {
  MobileWorkspaceProvider,
  useMobileWorkspaceReader,
} from "@/features/workspace/context/mobile-workspace-context";
import { findChatAgent } from "@/features/workspace/model/directory-agents";
import { AdaptiveSplit, useSplitLayout } from "@/shared/components/adaptive-split";
import { androidBackOptions } from "@/shared/components/android-header-button";
import { headerFontOptions } from "@/shared/lib/app-font";
import { useReducedMotion } from "@/shared/lib/motion";
import { isAndroid, isIOS } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";

const refocusNameField = isAndroid
  ? {
      transitionEnd: (event: { data: { closing: boolean } }) => {
        if (event.data.closing) return;
        const input = TextInput.State.currentlyFocusedInput();
        if (!input) return;
        input.blur();
        input.focus();
      },
    }
  : undefined;

export const unstable_settings = {
  anchor: "connected",
};

function AuthenticatedStack() {
  const segments = useSegments();
  const pushAnimation = useReducedMotion() ? "fade" : "slide_from_right";
  const chatAnimation = useSplitLayout() ? "fade" : pushAnimation;
  const { t } = useText();
  const background = useThemeColor("background");
  const sheetBackground = String(useCSSVariable("--openbot-bg-sheet") ?? background);
  const nativeBarOptions = {
    headerShown: isIOS,
    headerBackVisible: false,
    scrollEdgeEffects: { top: "hidden" },
    title: "",
  } as const;
  const largeTitlePage = {
    animation: pushAnimation,
    contentStyle: { backgroundColor: sheetBackground },
    headerTransparent: true,
    scrollEdgeEffects: { top: "hidden", bottom: "soft" },
    title: "",
  } as const;
  const chatPage = {
    animation: chatAnimation,
    contentStyle: { backgroundColor: background },
    fullScreenGestureEnabled: true,
    gestureEnabled: true,
    ...nativeBarOptions,
  } as const;
  const routinePage = {
    animation: pushAnimation,
    contentStyle: { backgroundColor: sheetBackground },
    headerStyle: { backgroundColor: isIOS ? "transparent" : sheetBackground },
    headerBlurEffect: "none",
    scrollEdgeEffects: { top: "hidden", bottom: "soft" },
    title: t("mobile.app.route.routine"),
  } as const;
  const formSheet = (sheetAllowedDetents: number[]) =>
    ({
      contentStyle: { backgroundColor: sheetBackground },
      headerShown: false,
      scrollEdgeEffects: { top: "hidden", bottom: "soft" },
      presentation: "formSheet",
      sheetAllowedDetents,
      sheetGrabberVisible: true,
    }) as const;
  const { closeDrawer } = useAppDrawer();
  const {
    agentId: openAgentId,
    serverId: openServerId,
    taskId: openTaskId,
  } = useGlobalSearchParams<{ agentId?: string; serverId?: string; taskId?: string }>();
  const shown = useRef<{ agentId: string; serverId: string | null; taskId: string | null } | null>(null);
  const screen = segments.at(-2);
  const shownServerId = typeof openServerId === "string" && openServerId ? openServerId : null;
  shown.current =
    typeof openAgentId !== "string"
      ? null
      : screen === "chat"
        ? { agentId: openAgentId, serverId: shownServerId, taskId: null }
        : screen === "task" && typeof openTaskId === "string"
          ? { agentId: openAgentId, serverId: shownServerId, taskId: openTaskId }
          : null;
  const workspace = useMobileWorkspaceReader();
  const showsAgent = useCallback(
    (agentId: string, serverId: string | null) => {
      const current = shown.current;
      if (current?.agentId !== agentId) return false;
      if (serverId === null) return true;
      const state = workspace();
      const shownServer =
        current.serverId ?? findChatAgent(state.agents, agentId, undefined, state.activeServer.id)?.serverId;
      return shownServer === undefined || shownServer === serverId;
    },
    [workspace],
  );
  const showsChat = useCallback(
    (agentId: string, serverId: string | null = null) =>
      showsAgent(agentId, serverId) && shown.current?.taskId === null,
    [showsAgent],
  );
  const showChat = useCallback(
    (agentId: string | null, serverId: string | null = null) => {
      closeDrawer();
      if (agentId !== null && showsChat(agentId, serverId)) return;
      if (router.canDismiss()) router.dismissAll();
      if (agentId === null) return;
      router.push({ pathname: "/chat/[agentId]", params: serverId ? { agentId, serverId } : { agentId } });
    },
    [closeDrawer, showsChat],
  );
  const openFromOutside = useCallback(
    (agentId: string | null, serverId: string | null = null) => whenUnlocked(() => showChat(agentId, serverId)),
    [showChat],
  );
  const openQuickAction = useCallback(
    (target: QuickActionTarget) => {
      if (target.type === "chat") {
        openFromOutside(target.agentId);
        return;
      }
      whenUnlocked(() => {
        closeDrawer();
        if (router.canDismiss()) router.dismissAll();
        if (target.type === "routines")
          router.push({ pathname: "/server-routines", params: { serverId: target.serverId } });
        else if (target.type === "support") router.push("/settings/support");
        else requestHomeSearch();
      });
    },
    [closeDrawer, openFromOutside],
  );
  useEffect(() => setQuickActionNavigator(openQuickAction), [openQuickAction]);
  useEffect(() => setShareSheetOpener(() => whenUnlocked(() => router.push("/share"))), []);
  useEffect(() => (isAndroid ? watchAndroidShares() : undefined), []);

  return (
    <Stack
      screenOptions={(props) => ({
        ...androidBackOptions(props, { glass: true }),
        headerBackButtonDisplayMode: "minimal",
        ...headerFontOptions,
        headerShadowVisible: false,
        headerTransparent: isIOS,
        sheetExpandsWhenScrolledToEdge: false,
        ...(isAndroid && { sheetCornerRadius: 28 }),
      })}
    >
      <Stack.Screen name="connected" options={{ animation: "fade", gestureEnabled: false, title: "" }} />
      <Stack.Screen name="chat/[agentId]" options={chatPage} />
      <Stack.Screen name="side-question/[agentId]" options={chatPage} />
      <Stack.Screen name="task/[taskId]" options={chatPage} />
      <Stack.Screen
        name="code-preview/[previewId]"
        options={{
          animation: pushAnimation,
          contentStyle: { backgroundColor: background },
          fullScreenGestureEnabled: false,
          gestureEnabled: true,
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="image-gallery/[galleryId]"
        options={{
          animation: pushAnimation,
          contentStyle: { backgroundColor: background },
          fullScreenGestureEnabled: true,
          gestureEnabled: true,
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="browser/[agentId]"
        options={{
          animation: pushAnimation,
          contentStyle: { backgroundColor: background },
          fullScreenGestureEnabled: false,
          gestureEnabled: true,
          ...nativeBarOptions,
        }}
      />
      <Stack.Screen name="browser-tabs/[agentId]" options={formSheet([0.6])} />
      <Stack.Screen name="browser-help" options={formSheet([0.85])} />
      <Stack.Screen name="channel/[channelId]" options={chatPage} />
      <Stack.Screen name="channel-info/[channelId]" options={formSheet([0.85])} />
      <Stack.Screen name="context-usage/[agentId]" options={formSheet([0.6, 0.85])} />
      <Stack.Screen name="channel-actions/[channelId]" options={formSheet([0.6])} />
      <Stack.Screen name="add-channel" options={formSheet([0.85])} />
      <Stack.Screen name="add-agent" options={formSheet([0.85])} />
      <Stack.Screen name="agent-info/[agentId]" options={formSheet([0.85])} />
      <Stack.Screen name="section-form" listeners={refocusNameField} options={formSheet([0.85])} />
      <Stack.Screen name="library-folders" listeners={refocusNameField} options={formSheet([0.85])} />
      <Stack.Screen name="thread-rename" listeners={refocusNameField} options={formSheet([0.85])} />
      <Stack.Screen name="new-task" options={formSheet([0.85])} />
      <Stack.Screen name="add-server" options={formSheet([0.85])} />
      <Stack.Screen name="hidden-chats" options={formSheet([0.85])} />
      <Stack.Screen name="deleted-chats" options={formSheet([0.85])} />
      <Stack.Screen name="server-settings" options={formSheet([0.85])} />
      <Stack.Screen name="server-routines/index" options={largeTitlePage} />
      <Stack.Screen name="server-routines/agent-routine" options={routinePage} />
      <Stack.Screen name="server-routines/channel-routine" options={routinePage} />
      <Stack.Screen name="server-tasks" options={largeTitlePage} />
      <Stack.Screen name="server-workflows/index" options={largeTitlePage} />
      <Stack.Screen name="server-workflows/workflow" options={largeTitlePage} />
      <Stack.Screen name="server-workflows/runs" options={largeTitlePage} />
      <Stack.Screen name="server-workflows/run" options={largeTitlePage} />
      <Stack.Screen name="server-workflows/versions" options={largeTitlePage} />
      <Stack.Screen name="server-workflows/version" options={largeTitlePage} />
      <Stack.Screen name="server-workflows/github-events" options={largeTitlePage} />
      <Stack.Screen
        name="workflow-editor"
        options={{
          contentStyle: { backgroundColor: sheetBackground },
          headerShown: false,
          scrollEdgeEffects: { top: "hidden", bottom: "soft" },
          presentation: "card",
        }}
      />
      <Stack.Screen name="server-usage/index" options={largeTitlePage} />
      <Stack.Screen name="server-library" options={largeTitlePage} />
      <Stack.Screen name="share" options={formSheet([0.85])} />
      <Stack.Screen name="plan-limits" options={formSheet([0.85])} />
      <Stack.Screen name="message-actions" options={formSheet([0.6])} />
      <Stack.Screen name="pinned-messages" options={formSheet([0.6, 0.85])} />
      <Stack.Screen name="queued-messages" options={formSheet([0.85])} />
      <Stack.Screen name="vault-request" options={formSheet([0.85])} />
      <Stack.Screen name="turn-thinking" options={formSheet([0.85])} />
      <Stack.Screen name="subagent" options={formSheet([0.85])} />
      <Stack.Screen name="memory-changes" options={formSheet([0.85])} />
      <Stack.Screen name="settings" options={formSheet([0.85])} />
    </Stack>
  );
}

function AuthenticatedSplit({ children }: PropsWithChildren) {
  const onboarding = useHomeOnboarding();
  const { t } = useText();
  return (
    <AdaptiveSplit
      enabled={!onboarding.active}
      resizeLabel={t("mobile.agent.home.chatListWidth")}
      pane={
        <ChatListPaneProvider>
          <ConnectedScreen variant="pane" />
        </ChatListPaneProvider>
      }
    >
      {children}
    </AdaptiveSplit>
  );
}

export default function AuthenticatedLayout() {
  const { session } = useMobileSession();
  const workspaceKey = session ? `${session.relayUrl}:${session.user.id}` : "signed-out";

  return (
    <MobileWorkspaceProvider key={workspaceKey}>
      <HomeOnboardingProvider>
        <OutboxProvider>
          <AppDrawerShell>
            <QueuedMessagesProvider>
              <AuthenticatedSplit>
                <AuthenticatedStack />
              </AuthenticatedSplit>
              <MermaidRendererHost />
              <AudioWaveformHost />
            </QueuedMessagesProvider>
          </AppDrawerShell>
        </OutboxProvider>
      </HomeOnboardingProvider>
    </MobileWorkspaceProvider>
  );
}
