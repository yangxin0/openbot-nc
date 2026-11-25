import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

export interface SettingsPort {
  getAgentDefaults: OpenBotDesktopApi["getAgentDefaults"];
  getAgentMemoryLimitPreference: OpenBotDesktopApi["getAgentMemoryLimitPreference"];
  getAppBehaviorPreference: OpenBotDesktopApi["getAppBehaviorPreference"];
  getApprovalAutomation: OpenBotDesktopApi["getApprovalAutomation"];
  getBusyMessageModePreference: OpenBotDesktopApi["getBusyMessageModePreference"];
  getExternalLinkPreference: OpenBotDesktopApi["getExternalLinkPreference"];
  listExternalLinkBrowsers: OpenBotDesktopApi["listExternalLinkBrowsers"];
  chooseExternalLinkApp: OpenBotDesktopApi["chooseExternalLinkApp"];
  onExternalLinkFallback: OpenBotDesktopApi["onExternalLinkFallback"];
  getRemoteNetworkRoute: OpenBotDesktopApi["getRemoteNetworkRoute"];
  getRemoteSessionReusePreference: OpenBotDesktopApi["getRemoteSessionReusePreference"];
  onAgentMemoryLimitPreference: OpenBotDesktopApi["onAgentMemoryLimitPreference"];
  onApprovalAutomation: OpenBotDesktopApi["onApprovalAutomation"];
  onOpenSettings: OpenBotDesktopApi["onOpenSettings"];
  onOpenUpdateSettings: OpenBotDesktopApi["onOpenUpdateSettings"];
  setAppBehaviorPreference: OpenBotDesktopApi["setAppBehaviorPreference"];
  setExternalLinkPreference: OpenBotDesktopApi["setExternalLinkPreference"];
  setRemoteNetworkRoute: OpenBotDesktopApi["setRemoteNetworkRoute"];
  setRemoteSessionReusePreference: OpenBotDesktopApi["setRemoteSessionReusePreference"];
  agent: Pick<
    OpenBotDesktopApi["agent"],
    "listAgents" | "updateAgent" | "listAgentNotificationLevels" | "setAgentNotificationLevel" | "onScopedEvent"
  >;
  dynamicIsland: Pick<
    OpenBotDesktopApi["dynamicIsland"],
    "getBuiltInDisplayGeometry" | "getPreference" | "onPreference" | "setPreference" | "setXWayland"
  >;
  notifications: Pick<OpenBotDesktopApi["notifications"], "getPreference" | "openSettings" | "setPreference" | "test">;
  update: Pick<OpenBotDesktopApi["update"], "getPreference" | "onPreference" | "setPreference">;
}

export function settingsPort(): SettingsPort {
  return window.openbot;
}
