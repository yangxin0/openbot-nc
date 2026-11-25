import {
  type ApprovalAutomationPreference,
  agentAutoApprovalEnabled,
  type DynamicIslandGeometry,
  type DynamicIslandPreference,
  type ExternalLinkTarget,
  LOCAL_SERVER_ID,
  type McpSignInState,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { DEFAULT_GENERAL_SETTINGS, type GeneralSettingsValue } from "@openbot/ui/features/settings/app-settings";
import { currentText } from "@openbot/ui/text";
import { createEffect, createSignal, flush, onSettled } from "solid-js";
import { isActionSoundEnabled, readActionSoundTheme, setActionSoundChoice } from "../../action-sounds";
import { actionToast } from "../../action-toast";
import { readShowAgentSteps, setShowAgentSteps, useShowAgentSteps } from "../../agent-steps-preference";
import {
  readCompactMessageActions,
  setCompactMessageActions,
  useCompactMessageActions,
} from "../../compact-message-actions-preference";
import { playSoundChoice, readTaskSound, setTaskSound } from "../../completion-sound";
import { usePlatform } from "../../platform";
import { readRestoreLastWorkspace, writeRestoreLastWorkspace } from "../../restore-workspace-preference";
import { readSendShortcutMode, setSendShortcutMode, useSendShortcutMode } from "../../send-shortcut-preference";
import { createSimpleContext } from "../../simple-context";
import { mcpSignInRecord } from "../servers/mcp-servers";
import { desktopMarketplaceCalls } from "./marketplace-calls";
import { settingsPort } from "./settings-port";
import { isOpenSettingsShortcut } from "./settings-shortcut";
import type { SettingsTab } from "./settings-tabs";

interface AppSettingRowRequest {
  tab: SettingsTab;
  anchor: AppTextKey;
  nonce: number;
}

function islandSettings(preference: DynamicIslandPreference) {
  return {
    macBookNotch: preference.enabled,
    macBookNotchHaptics: preference.hapticsEnabled,
    macBookNotchIdle: preference.idleVisible,
    macBookNotchAdditionalDisplays: preference.additionalDisplaysEnabled,
    macBookNotchWidthPercent: preference.widthPercent,
    macBookNotchHeightPercent: preference.heightPercent,
    macBookNotchServers: preference.serverVisibility,
    macBookNotchNewServers: preference.newServersVisible,
  } satisfies Partial<GeneralSettingsValue>;
}

function sameExternalLinkTarget(left: ExternalLinkTarget, right: ExternalLinkTarget): boolean {
  return left.kind === right.kind && (left.kind !== "app" || right.kind !== "app" || left.path === right.path);
}

function samePlainValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const leftEntries = Object.entries(left);
  const rightEntries = new Map(Object.entries(right));
  return (
    leftEntries.length === rightEntries.size &&
    leftEntries.every(([key, value]) => rightEntries.has(key) && samePlainValue(value, rightEntries.get(key)))
  );
}

function showSaveFailure(error: unknown): void {
  const { t, errorMessage } = currentText();
  actionToast.error(errorMessage(error, t("settings.preferences.saveFailed")), {
    id: "settings-preference-save-failed",
    report: { operation: "settings", source: "action", cause_code: "unknown" },
  });
}

const Settings = createSimpleContext({
  name: "Settings",
  init: () => {
    const platform = usePlatform();

    const [preferencesLoad, setPreferencesLoad] = createSignal<"loading" | "loaded" | "failed">("loading");
    const [skillsMarketplaceOpen, setSkillsMarketplaceOpen] = createSignal(false);
    const [builtInDisplayGeometry, setBuiltInDisplayGeometry] = createSignal<DynamicIslandGeometry | undefined>();
    const [pendingPluginSlug, setPendingPluginSlug] = createSignal<string | null>(null);
    const [pendingPluginConnect, setPendingPluginConnect] = createSignal(false);
    const [pendingMcpSignIn, setPendingMcpSignIn] = createSignal<string | null>(null);
    const [mcpSignIns, setMcpSignIns] = createSignal<{
      serverId: string;
      states: Readonly<Record<string, McpSignInState>>;
    } | null>(null);
    function refreshMcpSignIns(serverId: string | undefined): void {
      if (!serverId || mcpSignIns()?.serverId !== serverId) return;
      void desktopMarketplaceCalls()
        .mcp.listMcpSignIns(serverId)
        .then(mcpSignInRecord, () => null)
        .then((states) => {
          if (states && mcpSignIns()?.serverId === serverId) setMcpSignIns({ serverId, states });
        });
    }
    const [appSettingsOpen, setAppSettingsOpen] = createSignal(false);
    const [appSettingsOpenRequest, setAppSettingsOpenRequest] = createSignal(0);
    const [appSettingsTab, setAppSettingsTab] = createSignal<SettingsTab | undefined>();
    const [notificationFocusRequest, setNotificationFocusRequest] = createSignal<{
      serverId: string;
      nonce: number;
    } | null>(null);
    let notificationFocusNonce = 0;
    const [appSettingRowRequest, setAppSettingRowRequest] = createSignal<AppSettingRowRequest | null>(null);
    let appSettingRowNonce = 0;
    createEffect(appSettingsOpen, (open) => {
      if (open) return;
      setNotificationFocusRequest(null);
      setAppSettingRowRequest(null);
    });
    const [generalSettings, setGeneralSettings] = createSignal<GeneralSettingsValue>(
      {
        ...DEFAULT_GENERAL_SETTINGS,
        taskSound: readTaskSound(),
        sendShortcut: readSendShortcutMode(),
        restoreLastWorkspace: readRestoreLastWorkspace(),
        showAgentSteps: readShowAgentSteps(),
        compactMessageActions: readCompactMessageActions(),
        soundFeedback: isActionSoundEnabled(),
        soundTheme: readActionSoundTheme(),
      },
      { equals: samePlainValue },
    );
    const sendShortcutMode = useSendShortcutMode();
    createEffect(
      () => sendShortcutMode(),
      (mode) => {
        setGeneralSettings((current) => (current.sendShortcut === mode ? current : { ...current, sendShortcut: mode }));
      },
    );
    const showAgentSteps = useShowAgentSteps();
    createEffect(
      () => showAgentSteps(),
      (show) => {
        setGeneralSettings((current) =>
          current.showAgentSteps === show ? current : { ...current, showAgentSteps: show },
        );
      },
    );
    const compactMessageActions = useCompactMessageActions();
    createEffect(
      () => compactMessageActions(),
      (compact) => {
        setGeneralSettings((current) =>
          current.compactMessageActions === compact ? current : { ...current, compactMessageActions: compact },
        );
      },
    );
    const [approvalAutomation, setApprovalAutomation] = createSignal<ApprovalAutomationPreference>({
      defaultAutoApprove: false,
      autoApproveOverrides: {},
    });
    let appSettingsRestoreTarget: HTMLElement | null = null;
    let autoDownloadUpdatesChanged = false;
    let allowRemoteUpdatesChanged = false;
    let autoInstallUpdatesChanged = false;
    let notificationPreferenceChanged = false;
    let busyMessageModeChanged = false;
    let agentDefaultsChanged = false;
    let agentMemoryLimitChanged = false;
    let externalLinkTargetChanged = false;
    let launchAtLoginChanged = false;
    let keepRunningInBackgroundChanged = false;
    let keepAwakeChanged = false;
    let keepAwakeOnBatteryChanged = false;
    let quitGuardChanged = false;

    let dynamicIslandSaveCount = 0;

    function updateGeneralSettings(value: GeneralSettingsValue): void {
      const previous = generalSettings();
      function persistField<Key extends keyof GeneralSettingsValue, Response>(
        key: Key,
        request: Promise<Response>,
        read: (response: Response) => GeneralSettingsValue[Key],
      ): void {
        void request
          .then((response) => setGeneralSettings((current) => ({ ...current, [key]: read(response) })))
          .catch((error: unknown) => {
            setGeneralSettings((current) => ({ ...current, [key]: previous[key] }));
            showSaveFailure(error);
          });
      }

      setGeneralSettings(value);
      if (previous.taskSound !== value.taskSound) {
        setTaskSound(value.taskSound);
        playSoundChoice(value.taskSound);
      }
      if (previous.sendShortcut !== value.sendShortcut) {
        setSendShortcutMode(value.sendShortcut);
      }
      if (previous.showAgentSteps !== value.showAgentSteps) {
        setShowAgentSteps(value.showAgentSteps);
      }
      if (previous.restoreLastWorkspace !== value.restoreLastWorkspace) {
        writeRestoreLastWorkspace(value.restoreLastWorkspace);
      }
      if (previous.compactMessageActions !== value.compactMessageActions) {
        setCompactMessageActions(value.compactMessageActions);
      }
      if (previous.soundFeedback !== value.soundFeedback || previous.soundTheme !== value.soundTheme) {
        setActionSoundChoice(value.soundFeedback ? value.soundTheme : "off");
      }
      if (previous.autoDownloadUpdates !== value.autoDownloadUpdates) {
        autoDownloadUpdatesChanged = true;
        persistField(
          "autoDownloadUpdates",
          settingsPort().update.setPreference({ autoDownload: value.autoDownloadUpdates }),
          (preference) => preference.autoDownload,
        );
      }
      if (previous.allowRemoteUpdates !== value.allowRemoteUpdates) {
        allowRemoteUpdatesChanged = true;
        persistField(
          "allowRemoteUpdates",
          settingsPort().update.setPreference({ allowRemoteUpdates: value.allowRemoteUpdates }),
          (preference) => preference.allowRemoteUpdates,
        );
      }
      if (previous.autoInstallUpdates !== value.autoInstallUpdates) {
        autoInstallUpdatesChanged = true;
        persistField(
          "autoInstallUpdates",
          settingsPort().update.setPreference({ autoInstall: value.autoInstallUpdates }),
          (preference) => preference.autoInstall,
        );
      }
      if (
        previous.desktopNotifications !== value.desktopNotifications ||
        previous.notificationPreview !== value.notificationPreview
      ) {
        notificationPreferenceChanged = true;
        const saved = settingsPort().notifications.setPreference({
          desktopNotifications: value.desktopNotifications,
          messagePreview: value.notificationPreview,
        });
        if (previous.desktopNotifications !== value.desktopNotifications)
          persistField("desktopNotifications", saved, (preference) => preference.desktopNotifications);
        if (previous.notificationPreview !== value.notificationPreview)
          persistField("notificationPreview", saved, (preference) => preference.messagePreview);
      }
      if (value.launchAtLogin !== null && previous.launchAtLogin !== value.launchAtLogin) {
        launchAtLoginChanged = true;
        persistField(
          "launchAtLogin",
          settingsPort().setAppBehaviorPreference({ launchAtLogin: value.launchAtLogin }),
          (preference) => preference.launchAtLogin,
        );
      }
      if (
        value.keepRunningInBackground !== null &&
        previous.keepRunningInBackground !== value.keepRunningInBackground
      ) {
        keepRunningInBackgroundChanged = true;
        persistField(
          "keepRunningInBackground",
          settingsPort().setAppBehaviorPreference({ keepRunningInBackground: value.keepRunningInBackground }),
          (preference) => preference.keepRunningInBackground,
        );
      }
      if (value.keepAwake !== null && previous.keepAwake !== value.keepAwake) {
        keepAwakeChanged = true;
        persistField(
          "keepAwake",
          settingsPort().setAppBehaviorPreference({ keepAwake: value.keepAwake }),
          (preference) => preference.keepAwake,
        );
      }
      if (value.keepAwakeOnBattery !== null && previous.keepAwakeOnBattery !== value.keepAwakeOnBattery) {
        keepAwakeOnBatteryChanged = true;
        persistField(
          "keepAwakeOnBattery",
          settingsPort().setAppBehaviorPreference({ keepAwakeOnBattery: value.keepAwakeOnBattery }),
          (preference) => preference.keepAwakeOnBattery,
        );
      }
      if (value.quitGuard !== null && previous.quitGuard !== value.quitGuard) {
        quitGuardChanged = true;
        persistField(
          "quitGuard",
          settingsPort().setAppBehaviorPreference({ quitGuard: value.quitGuard }),
          (preference) => preference.quitGuard,
        );
      }
      if (!sameExternalLinkTarget(previous.externalLinkTarget, value.externalLinkTarget)) {
        externalLinkTargetChanged = true;
        persistField(
          "externalLinkTarget",
          settingsPort().setExternalLinkPreference({ target: value.externalLinkTarget }),
          (preference) => preference.target,
        );
      }
      if (
        previous.macBookNotch !== value.macBookNotch ||
        previous.macBookNotchHaptics !== value.macBookNotchHaptics ||
        previous.macBookNotchIdle !== value.macBookNotchIdle ||
        previous.macBookNotchAdditionalDisplays !== value.macBookNotchAdditionalDisplays ||
        previous.macBookNotchWidthPercent !== value.macBookNotchWidthPercent ||
        previous.macBookNotchHeightPercent !== value.macBookNotchHeightPercent ||
        previous.macBookNotchServers !== value.macBookNotchServers ||
        previous.macBookNotchNewServers !== value.macBookNotchNewServers
      ) {
        const save = ++dynamicIslandSaveCount;
        void settingsPort()
          .dynamicIsland.setPreference({
            enabled: value.macBookNotch,
            hapticsEnabled: value.macBookNotchHaptics,
            idleVisible: value.macBookNotchIdle,
            additionalDisplaysEnabled: value.macBookNotchAdditionalDisplays,
            widthPercent: value.macBookNotchWidthPercent,
            heightPercent: value.macBookNotchHeightPercent,
            serverVisibility: value.macBookNotchServers,
            newServersVisible: value.macBookNotchNewServers,
          })
          .then((preference) => {
            if (save !== dynamicIslandSaveCount) return;
            setGeneralSettings((current) => ({
              ...current,
              ...islandSettings(preference),
            }));
          })
          .catch((error: unknown) => {
            if (save !== dynamicIslandSaveCount) return;
            showSaveFailure(error);
            setGeneralSettings((current) => ({
              ...current,
              macBookNotch: previous.macBookNotch,
              macBookNotchHaptics: previous.macBookNotchHaptics,
              macBookNotchIdle: previous.macBookNotchIdle,
              macBookNotchAdditionalDisplays: previous.macBookNotchAdditionalDisplays,
              macBookNotchWidthPercent: previous.macBookNotchWidthPercent,
              macBookNotchHeightPercent: previous.macBookNotchHeightPercent,
              macBookNotchServers: previous.macBookNotchServers,
              macBookNotchNewServers: previous.macBookNotchNewServers,
            }));
          });
      }
    }

    function agentAutoApproves(agentId: string): boolean {
      return agentAutoApprovalEnabled(approvalAutomation(), agentId);
    }

    function openAppSettings(trigger?: HTMLElement | null, tab?: SettingsTab): void {
      const target = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      appSettingsRestoreTarget = target;
      setAppSettingsTab(tab);
      setAppSettingsOpen(true);
      setAppSettingsOpenRequest((count) => count + 1);
    }

    function openNotificationLevels(serverId?: string, trigger?: HTMLElement | null): void {
      if (serverId) setNotificationFocusRequest({ serverId, nonce: ++notificationFocusNonce });
      setAppSettingsTab(undefined);
      flush();
      openAppSettings(trigger, "notifications");
    }

    function openAppSettingRow(tab: SettingsTab, anchor: AppTextKey, trigger?: HTMLElement | null): void {
      setAppSettingRowRequest({ tab, anchor, nonce: ++appSettingRowNonce });
      setAppSettingsTab(undefined);
      flush();
      openAppSettings(trigger, tab);
    }

    onSettled(() => {
      const handleSettingsShortcut = (event: KeyboardEvent) => {
        if (!isOpenSettingsShortcut(event)) return;
        event.preventDefault();
        openAppSettings(event.target instanceof HTMLElement ? event.target : null);
      };
      window.addEventListener("keydown", handleSettingsShortcut);
      const unsubscribe = settingsPort().onOpenSettings(() => openAppSettings());
      const unsubscribeUpdateSettings = settingsPort().onOpenUpdateSettings(() =>
        openAppSettings(undefined, "updates"),
      );
      const unsubscribeApprovals = settingsPort().onApprovalAutomation(setApprovalAutomation);
      const unsubscribeMemoryLimit = settingsPort().onAgentMemoryLimitPreference(({ limit }) => {
        agentMemoryLimitChanged = true;
        setGeneralSettings((current) => ({ ...current, agentMemoryLimit: limit }));
      });
      const unsubscribeUpdates = settingsPort().update.onPreference((preference) => {
        autoDownloadUpdatesChanged = true;
        autoInstallUpdatesChanged = true;
        setGeneralSettings((current) => ({
          ...current,
          autoDownloadUpdates: preference.autoDownload,
          autoInstallUpdates: preference.autoInstall,
        }));
      });
      const unsubscribeIsland = settingsPort().dynamicIsland.onPreference((preference) => {
        ++dynamicIslandSaveCount;
        setGeneralSettings((current) => ({
          ...current,
          ...islandSettings(preference),
        }));
      });
      let agentDefaultsRead: Promise<void> | null = null;
      let agentDefaultsReadAgain = false;
      const readAgentDefaults = (): void => {
        if (agentDefaultsRead) {
          agentDefaultsReadAgain = true;
          return;
        }
        agentDefaultsRead = Promise.all([
          settingsPort()
            .getAgentDefaults()
            .then((defaults) => {
              agentDefaultsChanged = true;
              setGeneralSettings((current) => ({ ...current, agentDefaults: defaults }));
            }),
          settingsPort()
            .getBusyMessageModePreference()
            .then((preference) => {
              busyMessageModeChanged = true;
              setGeneralSettings((current) => ({ ...current, busyMessageMode: preference.mode }));
            }),
        ])
          .then(
            () => undefined,
            () => undefined,
          )
          .finally(() => {
            agentDefaultsRead = null;
            if (!agentDefaultsReadAgain) return;
            agentDefaultsReadAgain = false;
            readAgentDefaults();
          });
      };
      const unsubscribeAgentDefaults = settingsPort().agent.onScopedEvent(({ serverId, event }) => {
        if (serverId === LOCAL_SERVER_ID && event.type === "agents-changed") readAgentDefaults();
      });
      const unsubscribeLinkFallback = settingsPort().onExternalLinkFallback(({ name }) => {
        const { t } = currentText();
        actionToast.warning(t("settings.externalLinks.fallback.title", { name }), {
          id: "external-link-fallback",
          description: t("settings.externalLinks.fallback.description"),
        });
      });
      return () => {
        window.removeEventListener("keydown", handleSettingsShortcut);
        unsubscribeLinkFallback();
        unsubscribe();
        unsubscribeUpdateSettings();
        unsubscribeApprovals();
        unsubscribeMemoryLimit();
        unsubscribeUpdates();
        unsubscribeIsland();
        unsubscribeAgentDefaults();
      };
    });

    function loadPreferences(): void {
      setPreferencesLoad("loading");
      void Promise.allSettled([
        settingsPort()
          .update.getPreference()
          .then((preference) => {
            setGeneralSettings((current) => ({
              ...current,
              autoDownloadUpdates: autoDownloadUpdatesChanged ? current.autoDownloadUpdates : preference.autoDownload,
              allowRemoteUpdates: allowRemoteUpdatesChanged
                ? current.allowRemoteUpdates
                : preference.allowRemoteUpdates,
              autoInstallUpdates: autoInstallUpdatesChanged ? current.autoInstallUpdates : preference.autoInstall,
            }));
          }),
        settingsPort()
          .getBusyMessageModePreference()
          .then((preference) => {
            if (busyMessageModeChanged) return;
            setGeneralSettings((current) => ({ ...current, busyMessageMode: preference.mode }));
          }),
        settingsPort()
          .getAgentDefaults()
          .then((defaults) => {
            if (agentDefaultsChanged) return;
            setGeneralSettings((current) => ({ ...current, agentDefaults: defaults }));
          }),
        settingsPort()
          .getAgentMemoryLimitPreference()
          .then((preference) => {
            if (agentMemoryLimitChanged) return;
            setGeneralSettings((current) => ({ ...current, agentMemoryLimit: preference.limit }));
          }),
        settingsPort()
          .getAppBehaviorPreference()
          .then((preference) => {
            setGeneralSettings((current) => ({
              ...current,
              launchAtLogin: launchAtLoginChanged ? current.launchAtLogin : preference.launchAtLogin,
              keepRunningInBackground: keepRunningInBackgroundChanged
                ? current.keepRunningInBackground
                : preference.keepRunningInBackground,
              keepAwake: keepAwakeChanged ? current.keepAwake : preference.keepAwake,
              keepAwakeOnBattery: keepAwakeOnBatteryChanged
                ? current.keepAwakeOnBattery
                : preference.keepAwakeOnBattery,
              quitGuard: quitGuardChanged ? current.quitGuard : preference.quitGuard,
            }));
          }),
        settingsPort()
          .getExternalLinkPreference()
          .then((preference) => {
            if (externalLinkTargetChanged) return;
            setGeneralSettings((current) => ({ ...current, externalLinkTarget: preference.target }));
          }),
        settingsPort()
          .notifications.getPreference()
          .then((preference) => {
            if (notificationPreferenceChanged) return;
            setGeneralSettings((current) => ({
              ...current,
              desktopNotifications: preference.desktopNotifications,
              notificationPreview: preference.messagePreview,
            }));
          }),
        platform.chatWindow
          ? Promise.resolve()
          : settingsPort()
              .dynamicIsland.getPreference()
              .then((preference) =>
                setGeneralSettings((current) => ({
                  ...current,
                  ...islandSettings(preference),
                })),
              ),
      ]).then((results) => {
        setPreferencesLoad(results.some((result) => result.status === "rejected") ? "failed" : "loaded");
      });
    }

    onSettled(() => {
      loadPreferences();
      void settingsPort()
        .getApprovalAutomation()
        .then(setApprovalAutomation)
        .catch(() => undefined);
      if (platform.chatWindow) return;
      void settingsPort()
        .dynamicIsland.getBuiltInDisplayGeometry()
        .then((geometry) => setBuiltInDisplayGeometry(geometry))
        .catch(() => undefined);
    });

    const sendTestNotification = () => settingsPort().notifications.test();
    const openNotificationSettings = () => settingsPort().notifications.openSettings();

    return {
      preferencesLoadFailed: () => preferencesLoad() === "failed",
      reloadPreferences: loadPreferences,
      generalSettings,
      builtInDisplayGeometry,
      updateGeneralSettings,
      sendTestNotification,
      openNotificationSettings,
      agentAutoApproves,
      appSettingsOpen,
      setAppSettingsOpen,
      appSettingsOpenRequest,
      appSettingsRestoreTarget: () => appSettingsRestoreTarget,
      appSettingsTab,
      openAppSettings,
      notificationFocusRequest,
      openNotificationLevels,
      appSettingRowRequest,
      openAppSettingRow,
      skillsMarketplaceOpen,
      setSkillsMarketplaceOpen,
      pendingPluginSlug,
      setPendingPluginSlug,
      pendingPluginConnect,
      setPendingPluginConnect,
      pendingMcpSignIn,
      setPendingMcpSignIn,
      mcpSignIns,
      setMcpSignIns,
      refreshMcpSignIns,
    };
  },
});

export const SettingsProvider = Settings.provider;
export const useSettings = Settings.use;
