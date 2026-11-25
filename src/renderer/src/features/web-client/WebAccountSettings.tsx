import { type AppAppearance, isAppAppearance } from "@openbot/contracts/app-appearance";
import type { AppLanguage } from "@openbot/contracts/app-language";
import type { RelayState } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { sourceText } from "@openbot/i18n/source";
import { relayTeamHostId } from "@openbot/team-client/relay-client";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Keyboard,
  KeyRound,
  SettingsSection,
  SlidersHorizontal,
  SwitchField,
  Tabs,
} from "@openbot/ui";
import { documentColorScheme } from "@openbot/ui/document-color-scheme";
import { AppearanceSelect } from "@openbot/ui/features/settings/AppearanceSelect";
import { ACTION_SOUND_CHOICES, TASK_SOUND_CHOICES } from "@openbot/ui/features/settings/app-settings";
import { ChatBackgroundSetting } from "@openbot/ui/features/settings/ChatBackgroundSetting";
import { ChatBubbleStyleSelect } from "@openbot/ui/features/settings/ChatBubbleStyleSelect";
import { LanguageSelect } from "@openbot/ui/features/settings/LanguageSelect";
import { NotificationMatrix, NotificationScopeTitle } from "@openbot/ui/features/settings/NotificationMatrix";
import { SendShortcutSelect } from "@openbot/ui/features/settings/SendShortcutSelect";
import { SettingsDialogShell, type SettingsPagePlacement } from "@openbot/ui/features/settings/SettingsDialogShell";
import { SettingsTeamTab, type TeamActionError } from "@openbot/ui/features/settings/SettingsTeamTab";
import { SidebarChatOrderSelect } from "@openbot/ui/features/settings/SidebarChatOrderSelect";
import { SoundChoiceSelect } from "@openbot/ui/features/settings/SoundChoiceSelect";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal, onCleanup } from "solid-js";
import { readActionSoundChoice, setActionSoundChoice } from "../../action-sounds";
import { setShowAgentSteps, useShowAgentSteps } from "../../agent-steps-preference";
import { setChatBubbleStyle, useChatBubbleStyle } from "../../chat-bubble-style-preference";
import { setCompactMessageActions, useCompactMessageActions } from "../../compact-message-actions-preference";
import { playSoundChoice, readTaskSound, setTaskSound } from "../../completion-sound";
import { useLayout } from "../../layout";
import { currentDevicePlatform, setSendShortcutMode, useSendShortcutMode } from "../../send-shortcut-preference";
import { ChatBackdropSetting } from "../settings/ChatBackdropSetting";
import { MotionSwitches } from "../settings/MotionSwitches";
import { SettingsKeyboardTab } from "../settings/SettingsKeyboardTab";
import { relaySnapshotSignal } from "./WebRelayNotice";
import { setWebChatBackground, useWebChatBackground } from "./web-chat-background";
import type { WebNotificationSettings } from "./web-notification-settings";
import { relayStateKey, type WebRelayConnection } from "./web-relay";

const TABS = ["team", "preferences", "keyboard"] as const;
type WebAccountSettingsTab = (typeof TABS)[number];

const TAB_ITEMS = {
  team: {
    titleKey: "settings.team.identity.title",
    descriptionKey: "webClient.team.identityDescription",
    icon: KeyRound,
  },
  preferences: {
    titleKey: "webClient.settings.preferences.title",
    descriptionKey: "webClient.settings.preferences.description",
    icon: SlidersHorizontal,
  },
  keyboard: {
    titleKey: "settings.tab.keyboard.title",
    descriptionKey: "settings.tab.keyboard.description",
    icon: Keyboard,
  },
} as const satisfies Record<
  WebAccountSettingsTab,
  { titleKey: AppTextKey; descriptionKey: AppTextKey; icon: typeof KeyRound }
>;

export interface WebAccountSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  page: SettingsPagePlacement | undefined;
  relay: WebRelayConnection;
  language: AppLanguage;
  onChangeLanguage: (language: AppLanguage) => void;
  appearance: AppAppearance;
  onChangeAppearance: (appearance: AppAppearance) => void;
  onRemoveIdentity: () => Promise<void>;
  notifications: WebNotificationSettings;
  notificationFocusRequest?: { serverId: string; nonce: number } | null | undefined;
  keyboardFocusRequest?: number | null | undefined;
}

export default function WebAccountSettings(props: WebAccountSettingsProps) {
  const { t, errorMessage } = useText();
  const [activeTab, setActiveTab] = createSignal<WebAccountSettingsTab>("team");
  const [taskSound, setTaskSoundChoice] = createSignal(readTaskSound());
  const sendShortcutMode = useSendShortcutMode();
  const layout = useLayout();
  const showAgentSteps = useShowAgentSteps();
  const compactMessageActions = useCompactMessageActions();
  const bubbleStyle = useChatBubbleStyle();
  const chatBackground = useWebChatBackground();
  const [soundChoice, setSoundChoice] = createSignal(readActionSoundChoice());
  const readSoundSettings = () => {
    setTaskSoundChoice(readTaskSound());
    setSoundChoice(readActionSoundChoice());
  };
  window.addEventListener("storage", readSoundSettings);
  onCleanup(() => window.removeEventListener("storage", readSoundSettings));
  let modalElement: HTMLElement | undefined;

  const relaySnapshot = relaySnapshotSignal(props.relay.source);
  const [receivedAt, setReceivedAt] = createSignal(Date.now());
  createEffect(relaySnapshot, () => {
    setReceivedAt(Date.now());
  });
  const [removing, setRemoving] = createSignal(false);
  const [removeError, setRemoveError] = createSignal<TeamActionError | null>(null);
  const relayState = (): RelayState => {
    const snapshot = relaySnapshot();
    const { identity } = props.relay;
    const selfKeyId = snapshot.self?.keyId ?? identity.keyId;
    const { state } = snapshot;
    return {
      identity: {
        team: identity.team,
        user: identity.user,
        device: identity.device,
        keyId: identity.keyId,
        relayUrl: identity.relayUrl,
        expiresAt: identity.expiresAt,
      },
      identityIssue: null,
      control:
        state.status === "offline"
          ? {
              status: "offline",
              code: state.code,
              message: state.code === "stopped" ? null : sourceText(relayStateKey(state.code)),
              retryInMs: state.retryInMs,
            }
          : state,
      members: snapshot.roster.map((member) => {
        const self = member.keyId === selfKeyId;
        return {
          keyId: member.keyId,
          user: member.user,
          device: member.device,
          label: member.label,
          hosting: member.hosting,
          self,
          serverId: member.hosting && !self ? relayTeamHostId(member) : null,
          hidden: false,
        };
      }),
      hosting: false,
      hostingState: { status: "off", message: null },
    };
  };
  async function removeIdentity(): Promise<void> {
    setRemoving(true);
    setRemoveError(null);
    try {
      await props.onRemoveIdentity();
    } catch (error) {
      setRemoveError({ action: "remove", message: errorMessage(error, t("settings.team.error.remove")) });
    } finally {
      setRemoving(false);
    }
  }
  const navItem = () => TAB_ITEMS[activeTab()];
  createEffect(
    () => (props.open ? props.notificationFocusRequest : null),
    (request) => {
      if (request) setActiveTab("preferences");
    },
  );
  createEffect(
    () => (props.open ? props.keyboardFocusRequest : null),
    (request) => {
      if (request) setActiveTab("keyboard");
    },
  );

  return (
    <Tabs.Root
      value={activeTab()}
      onChange={(value: string) => {
        const tab = TABS.find((candidate) => candidate === value);
        if (tab) setActiveTab(tab);
      }}
      orientation="vertical"
      activationMode="automatic"
      class="settings-modal-tabs-root"
    >
      <SettingsDialogShell
        class="app-settings-modal-shell"
        open={props.open}
        page={props.page}
        title={t(navItem().titleKey)}
        description={t(navItem().descriptionKey)}
        contentKey={activeTab()}
        onContentElement={(element) => (modalElement = element)}
        sidebar={
          <Tabs.List class="settings-modal-nav" aria-label={t("settings.sections.label")}>
            {TABS.map((tab) => {
              const item = TAB_ITEMS[tab];
              const NavIcon = item.icon;
              return (
                <Tabs.Trigger
                  class="settings-modal-nav-item"
                  value={tab}
                  aria-current={activeTab() === tab ? "page" : undefined}
                >
                  <NavIcon aria-hidden="true" />
                  <span>{t(item.titleKey)}</span>
                </Tabs.Trigger>
              );
            })}
          </Tabs.List>
        }
      >
        <Tabs.Content value="team" class="settings-modal-tab-panel" data-tab="team">
          <SettingsTeamTab
            browser
            state={relayState()}
            receivedAt={receivedAt()}
            loadError={null}
            busy={removing() ? "remove" : null}
            unhidingServerId={null}
            error={removeError()}
            onRemove={removeIdentity}
            onUnhide={() => undefined}
            onRetryLoad={() => undefined}
          />
        </Tabs.Content>

        <Tabs.Content value="keyboard" class="settings-modal-tab-panel" data-tab="keyboard">
          <SettingsKeyboardTab />
        </Tabs.Content>

        <Tabs.Content value="preferences" class="settings-modal-tab-panel" data-tab="preferences">
          <SettingsSection title={t("settings.appBehavior.title")}>
            <ItemGroup class="settings-modal-card">
              <Item class="settings-modal-row">
                <ItemContent>
                  <ItemTitle>{t("settings.sendShortcut.title")}</ItemTitle>
                  <ItemDescription>{t("settings.sendShortcut.description")}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <SendShortcutSelect
                    value={sendShortcutMode()}
                    onChange={(mode) => setSendShortcutMode(mode)}
                    devicePlatform={currentDevicePlatform()}
                    {...(modalElement ? { mount: modalElement } : {})}
                  />
                </ItemActions>
              </Item>
              <Item class="settings-modal-row">
                <ItemContent>
                  <ItemTitle>{t("sidebar.order.title")}</ItemTitle>
                  <ItemDescription>{t("settings.chatOrder.description")}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <SidebarChatOrderSelect
                    value={layout.sidebarChatOrder()}
                    onChange={layout.setSidebarChatOrder}
                    {...(modalElement ? { mount: modalElement } : {})}
                  />
                </ItemActions>
              </Item>
              <SwitchField
                checked={showAgentSteps()}
                onChange={(checked) => setShowAgentSteps(checked)}
                label={t("settings.showAgentSteps.title")}
                description={t("settings.showAgentSteps.description")}
              />
              <SwitchField
                checked={compactMessageActions()}
                onChange={(checked) => setCompactMessageActions(checked)}
                label={t("settings.compactMessageActions.title")}
                description={t("settings.compactMessageActions.description")}
              />
              <Item class="settings-modal-row">
                <ItemContent>
                  <ItemTitle>{t("settings.language.title")}</ItemTitle>
                  <ItemDescription>{t("settings.language.description")}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <LanguageSelect
                    value={props.language}
                    onChange={props.onChangeLanguage}
                    {...(modalElement ? { mount: modalElement } : {})}
                  />
                </ItemActions>
              </Item>
              <Item class="settings-modal-row">
                <ItemContent>
                  <ItemTitle>{t("settings.appearance.theme.title")}</ItemTitle>
                  <ItemDescription>{t("settings.appearance.theme.description")}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <AppearanceSelect
                    value={props.appearance}
                    onChange={(value) => {
                      if (isAppAppearance(value)) props.onChangeAppearance(value);
                    }}
                    {...(modalElement ? { mount: modalElement } : {})}
                  />
                </ItemActions>
              </Item>
              <Item class="settings-modal-row">
                <ItemContent>
                  <ItemTitle>{t("settings.bubbleStyle.title")}</ItemTitle>
                  <ItemDescription>{t("settings.bubbleStyle.description")}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <ChatBubbleStyleSelect
                    value={bubbleStyle()}
                    onChange={setChatBubbleStyle}
                    {...(modalElement ? { mount: modalElement } : {})}
                  />
                </ItemActions>
              </Item>
              <Item class="settings-modal-row">
                <ItemContent>
                  <ItemTitle>{t("settings.chatBackground.title")}</ItemTitle>
                  <ItemDescription>{t("settings.chatBackground.description")}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <ChatBackgroundSetting
                    scheme={documentColorScheme()}
                    light={chatBackground().chatBackgroundLight}
                    dark={chatBackground().chatBackgroundDark}
                    onChange={setWebChatBackground}
                  />
                </ItemActions>
              </Item>
              <Item class="settings-modal-row">
                <ItemContent>
                  <ItemTitle>{t("settings.chatBackdrop.title")}</ItemTitle>
                  <ItemDescription>{t("settings.chatBackdrop.description")}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <ChatBackdropSetting {...(modalElement ? { mount: modalElement } : {})} />
                </ItemActions>
              </Item>
              <MotionSwitches />
            </ItemGroup>
          </SettingsSection>
          <SettingsSection
            title={
              <NotificationScopeTitle
                title={t("settings.notifications.whatYouHear")}
                scope="settings.notifications.allDevices"
              />
            }
          >
            <NotificationMatrix
              servers={props.notifications.matrixServers()}
              device="browser"
              onSetServerLevel={props.notifications.setServerLevel}
              onSetAgentLevel={props.notifications.setAgentLevel}
              onMute={props.notifications.mute}
              onUnmute={props.notifications.unmute}
              onRetry={props.notifications.retry}
              focusRequest={props.open ? props.notificationFocusRequest : null}
              menuMount={modalElement}
            />
          </SettingsSection>
          <SettingsSection title={t("settings.notifications.thisBrowser")}>
            <ItemGroup class="settings-modal-card">
              <Item class="settings-modal-row">
                <ItemContent>
                  <ItemTitle>{t("settings.taskSound.title")}</ItemTitle>
                  <ItemDescription>{t("settings.taskSound.description")}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <SoundChoiceSelect
                    label={t("settings.taskSound.title")}
                    choices={TASK_SOUND_CHOICES}
                    value={taskSound()}
                    onChange={(value) => {
                      setTaskSoundChoice(value);
                      setTaskSound(value);
                      playSoundChoice(value);
                    }}
                    onPreview={playSoundChoice}
                    mount={modalElement}
                  />
                </ItemActions>
              </Item>
              <Item class="settings-modal-row">
                <ItemContent>
                  <ItemTitle>{t("settings.soundFeedback.title")}</ItemTitle>
                  <ItemDescription>{t("settings.soundFeedback.description")}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <SoundChoiceSelect
                    label={t("settings.soundFeedback.title")}
                    choices={ACTION_SOUND_CHOICES}
                    value={soundChoice()}
                    onChange={(value) => {
                      setSoundChoice(value);
                      setActionSoundChoice(value);
                    }}
                    onPreview={playSoundChoice}
                    mount={modalElement}
                  />
                </ItemActions>
              </Item>
            </ItemGroup>
          </SettingsSection>
        </Tabs.Content>
      </SettingsDialogShell>
    </Tabs.Root>
  );
}
