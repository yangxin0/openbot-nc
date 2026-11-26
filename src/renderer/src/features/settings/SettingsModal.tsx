import type {
  AppInfo,
  AvatarColor,
  CentralAuthUser,
  DynamicIslandGeometry,
  ServerNotificationLevel,
  ServerSummary,
  UpdateStatus,
} from "@openbot/contracts/ipc";
import {
  Alert,
  AlertActions,
  AlertContent,
  AlertDescription,
  AlertIcon,
  Button,
  Tabs,
  TriangleAlert,
} from "@openbot/ui";
import type { GeneralSettingsValue } from "@openbot/ui/features/settings/app-settings";
import {
  SettingsDialogShell,
  SettingsNavGroupLabel,
  type SettingsPagePlacement,
} from "@openbot/ui/features/settings/SettingsDialogShell";
import { SettingsProfileTab } from "@openbot/ui/features/settings/SettingsProfileTab";
import { SettingsTeamTab } from "@openbot/ui/features/settings/SettingsTeamTab";
import { SettingsUpdatesTab } from "@openbot/ui/features/settings/SettingsUpdatesTab";
import { createSettingsProfileStore } from "@openbot/ui/features/settings/stores/profile-store";
import { createSettingsUpdatesStore } from "@openbot/ui/features/settings/stores/updates-store";
import { createEffect, createSignal, Show, untrack } from "solid-js";
import { useI18n } from "../../i18n-context";
import { ComputerUseSetup } from "../computer-use/ComputerUseSetup";
import { useRelay } from "../relay/relay-context";
import { createNotificationLevelsStore } from "./notification-levels-store";
import { createProfileActivityStore } from "./profile-activity-store";
import { renderProfileShareImage } from "./profile-share-image";
import { type AgentDockSettingsModel, SettingsAgentDockTab } from "./SettingsAgentDockTab";
import { SettingsDynamicIslandTab } from "./SettingsDynamicIslandTab";
import { SettingsGeneralTab } from "./SettingsGeneralTab";
import { SettingsKeyboardTab } from "./SettingsKeyboardTab";
import { SettingsNotificationsTab } from "./SettingsNotificationsTab";
import { SettingsVoiceTab } from "./SettingsVoiceTab";
import { dynamicIslandSettingsShown, navItem, navItems, type SettingsTab, settingsTabShown } from "./settings-tabs";
import { createSettingsVoiceStore } from "./settings-voice-store";

export interface SettingsModalProps {
  open: boolean;
  value: GeneralSettingsValue;
  onValueChange: (value: GeneralSettingsValue) => void;
  preferencesLoadFailed?: boolean;
  onRetryPreferencesLoad?: () => void;
  appInfo: AppInfo | null;
  chatWindow?: boolean;
  builtInDisplayGeometry?: DynamicIslandGeometry | undefined;
  agentDock?: AgentDockSettingsModel | undefined;
  servers?: readonly ServerSummary[];
  onSetServerNotificationLevel?: ((serverId: string, level: ServerNotificationLevel) => Promise<void>) | undefined;
  onSetServerMuted?: ((serverId: string, muted: boolean, durationMs?: number) => Promise<void>) | undefined;
  notificationFocusRequest?: { serverId: string; nonce: number } | null | undefined;
  updateStatus: UpdateStatus;
  onUpdateAction: () => Promise<void>;
  onOpenWhatsNew?: (() => void) | undefined;
  onCancelScheduledRestart?: () => Promise<void>;
  onRestartWhenIdle?: () => Promise<void>;
  onCancelIdleRestart?: () => Promise<void>;
  onRestartNow?: () => Promise<void>;
  account: CentralAuthUser;
  onUpdateAccountName: (name: string) => Promise<void>;
  onSetChatColor: (color: AvatarColor | null) => Promise<void>;
  onContactUs?: (() => void) | undefined;
  onTestNotification?: () => void | Promise<void>;
  onOpenNotificationSettings?: () => void | Promise<void>;
  restoreFocusTarget?: HTMLElement | null;
  initialTab?: SettingsTab | undefined;
  openTab?: SettingsTab | undefined;
  page: SettingsPagePlacement | undefined;
}

export function SettingsModal(props: SettingsModalProps) {
  const i18n = useI18n();
  const relay = useRelay();
  const [activeTab, setActiveTab] = createSignal<SettingsTab>(untrack(() => props.initialTab) ?? "general");
  let modalElement: HTMLElement | undefined;
  const profile = createSettingsProfileStore(props, () => activeTab() === "profile");
  const profileActivity = createProfileActivityStore(
    () => props.open && activeTab() === "profile",
    (stats) => renderProfileShareImage(props.account, stats),
  );
  const updates = createSettingsUpdatesStore(props);
  const voice = createSettingsVoiceStore(() => props.open && activeTab() === "voice");
  const notificationLevels = createNotificationLevelsStore({
    visible: () => props.open && activeTab() === "notifications",
    servers: () => props.servers ?? [],
  });
  const dynamicIslandShown = () => dynamicIslandSettingsShown(props.appInfo?.platform, props.chatWindow === true);
  createEffect(
    () => (props.open ? props.openTab : undefined),
    (tab) => {
      if (!tab) return;
      setActiveTab(tab);
    },
  );
  const agentDockShown = () =>
    settingsTabShown("agent-dock", { platform: props.appInfo?.platform, chatWindow: props.chatWindow === true }) &&
    props.agentDock !== undefined;
  const visibleNavItems = () =>
    navItems.filter(
      (item) =>
        settingsTabShown(item.value, { platform: props.appInfo?.platform, chatWindow: props.chatWindow === true }) &&
        (item.value !== "agent-dock" || props.agentDock !== undefined),
    );

  const title = () => i18n.t(navItem(activeTab()).titleKey);
  const description = () => i18n.t(navItem(activeTab()).descriptionKey);

  const tabsProps = {
    get value() {
      return activeTab();
    },
    onChange(value: string) {
      if (
        value === "general" ||
        value === "appearance" ||
        value === "app-behavior" ||
        value === "notifications" ||
        value === "voice" ||
        value === "keyboard" ||
        (value === "dynamic-island" && dynamicIslandShown()) ||
        (value === "agent-dock" && agentDockShown()) ||
        value === "computer-use" ||
        value === "team" ||
        value === "profile" ||
        value === "updates"
      ) {
        setActiveTab(value);
      }
    },
    orientation: "vertical" as const,
    activationMode: "automatic" as const,
  };

  const preferencesLoadError = () => (
    <Show when={props.preferencesLoadFailed}>
      <Alert tone="danger" role="alert" report={{ operation: "settings", source: "system", cause_code: "unknown" }}>
        <AlertIcon>
          <TriangleAlert aria-hidden="true" />
        </AlertIcon>
        <AlertContent>
          <AlertDescription>{i18n.t("settings.preferences.loadFailed")}</AlertDescription>
        </AlertContent>
        <Show when={props.onRetryPreferencesLoad}>
          {(retry) => (
            <AlertActions>
              <Button type="button" variant="outline" size="sm" onClick={() => retry()()}>
                {i18n.t("common.retry")}
              </Button>
            </AlertActions>
          )}
        </Show>
      </Alert>
    </Show>
  );

  function updateSetting<Key extends keyof GeneralSettingsValue>(key: Key, value: GeneralSettingsValue[Key]): void {
    props.onValueChange({ ...props.value, [key]: value });
  }

  function updateSettings(patch: Partial<GeneralSettingsValue>): void {
    props.onValueChange({ ...props.value, ...patch });
  }

  return (
    <Tabs.Root {...tabsProps} class="settings-modal-tabs-root">
      <SettingsDialogShell
        class="app-settings-modal-shell"
        page={props.page}
        open={props.open}
        title={title()}
        description={description()}
        contentKey={activeTab()}
        restoreFocusTarget={props.restoreFocusTarget}
        onContentElement={(element) => (modalElement = element)}
        sidebar={
          <Tabs.List class="settings-modal-nav" aria-label={i18n.t("settings.sections.label")}>
            {visibleNavItems().map((item, index, items) => {
              const NavIcon = item.icon;
              const group = item.group !== items[index - 1]?.group ? item.group : undefined;
              return (
                <>
                  {group ? <SettingsNavGroupLabel label={i18n.t(group)} /> : null}
                  <Tabs.Trigger
                    class="settings-modal-nav-item"
                    value={item.value}
                    aria-current={activeTab() === item.value ? "page" : undefined}
                  >
                    <NavIcon aria-hidden="true" />
                    <span>{i18n.t(item.titleKey)}</span>
                  </Tabs.Trigger>
                </>
              );
            })}
          </Tabs.List>
        }
      >
        <Tabs.Content value="general" class="settings-modal-tab-panel" data-tab="general">
          {preferencesLoadError()}
          <SettingsGeneralTab
            part="general"
            value={props.value}
            variant={props.appInfo?.variant ?? "production"}
            platform={props.appInfo?.platform}
            onUpdateSetting={updateSetting}
            onUpdateSettings={updateSettings}
            selectMount={modalElement}
            chatColor={props.account.chatColor ?? null}
            onSetChatColor={props.onSetChatColor}
          />
        </Tabs.Content>

        <Tabs.Content value="appearance" class="settings-modal-tab-panel" data-tab="appearance">
          {preferencesLoadError()}
          <SettingsGeneralTab
            part="appearance"
            value={props.value}
            variant={props.appInfo?.variant ?? "production"}
            platform={props.appInfo?.platform}
            onUpdateSetting={updateSetting}
            onUpdateSettings={updateSettings}
            selectMount={modalElement}
            chatColor={props.account.chatColor ?? null}
            onSetChatColor={props.onSetChatColor}
          />
        </Tabs.Content>

        <Tabs.Content value="app-behavior" class="settings-modal-tab-panel" data-tab="app-behavior">
          {preferencesLoadError()}
          <SettingsGeneralTab
            part="app-behavior"
            value={props.value}
            variant={props.appInfo?.variant ?? "production"}
            platform={props.appInfo?.platform}
            onUpdateSetting={updateSetting}
            onUpdateSettings={updateSettings}
            selectMount={modalElement}
            chatColor={props.account.chatColor ?? null}
            onSetChatColor={props.onSetChatColor}
          />
        </Tabs.Content>

        <Tabs.Content value="notifications" class="settings-modal-tab-panel" data-tab="notifications">
          {preferencesLoadError()}
          <SettingsNotificationsTab
            value={props.value}
            onUpdateSetting={updateSetting}
            onUpdateSettings={updateSettings}
            onTestNotification={props.onTestNotification}
            onOpenNotificationSettings={
              props.appInfo?.platform === "darwin" || props.appInfo?.platform === "win32"
                ? props.onOpenNotificationSettings
                : undefined
            }
            levels={notificationLevels}
            onSetServerLevel={(serverId, level) =>
              props.onSetServerNotificationLevel?.(serverId, level) ?? Promise.resolve()
            }
            onSetServerMuted={(serverId, muted, durationMs) =>
              props.onSetServerMuted?.(serverId, muted, durationMs) ?? Promise.resolve()
            }
            focusRequest={props.notificationFocusRequest}
            menuMount={modalElement}
          />
        </Tabs.Content>

        <Tabs.Content value="voice" class="settings-modal-tab-panel" data-tab="voice">
          <SettingsVoiceTab store={voice} selectMount={modalElement} platform={props.appInfo?.platform} />
        </Tabs.Content>

        <Tabs.Content value="keyboard" class="settings-modal-tab-panel" data-tab="keyboard">
          <SettingsKeyboardTab />
        </Tabs.Content>

        <Show when={dynamicIslandShown()}>
          <Tabs.Content value="dynamic-island" class="settings-modal-tab-panel" data-tab="dynamic-island">
            {preferencesLoadError()}
            <SettingsDynamicIslandTab
              value={props.value}
              variant={props.appInfo?.variant ?? "production"}
              platform={props.appInfo?.platform}
              builtInDisplayGeometry={props.builtInDisplayGeometry}
              servers={props.servers ?? []}
              onUpdateSetting={updateSetting}
              onUpdateSettings={updateSettings}
            />
          </Tabs.Content>
        </Show>

        <Show when={agentDockShown() && props.agentDock}>
          {(model) => (
            <Tabs.Content value="agent-dock" class="settings-modal-tab-panel" data-tab="agent-dock">
              <SettingsAgentDockTab model={model()} selectMount={modalElement} />
            </Tabs.Content>
          )}
        </Show>

        <Tabs.Content value="computer-use" class="settings-modal-tab-panel" data-tab="computer-use">
          <ComputerUseSetup variant="settings" />
        </Tabs.Content>

        <Tabs.Content value="team" class="settings-modal-tab-panel" data-tab="team">
          <SettingsTeamTab
            state={relay.view.state}
            receivedAt={relay.view.receivedAt}
            loadError={relay.view.loadError}
            busy={relay.view.busy}
            unhidingServerId={relay.view.unhidingServerId}
            error={relay.view.error}
            onImport={() => void relay.importIdentity()}
            onReplace={() => void relay.replaceIdentity()}
            onJoinCode={relay.joinWithCode}
            onRemove={relay.removeIdentity}
            onSetHosting={(enabled) => void relay.setHosting(enabled)}
            onUnhide={(serverId) => void relay.unhideHost(serverId)}
            onRetryLoad={() => void relay.reload()}
          />
        </Tabs.Content>

        <Tabs.Content value="profile" class="settings-modal-tab-panel profile-panel" data-tab="profile">
          <SettingsProfileTab
            store={profile}
            account={props.account}
            activity={profileActivity}
            canListSessions={false}
            canRevokeSession={false}
          />
        </Tabs.Content>

        <Tabs.Content value="updates" class="settings-modal-tab-panel" data-tab="updates">
          {preferencesLoadError()}
          <SettingsUpdatesTab
            store={updates}
            onOpenWhatsNew={props.onOpenWhatsNew}
            value={props.value}
            onUpdateSetting={updateSetting}
            selectMount={modalElement}
          />
        </Tabs.Content>
      </SettingsDialogShell>
    </Tabs.Root>
  );
}
