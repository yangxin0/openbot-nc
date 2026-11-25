import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

export interface AppPort {
  getAppInfo: OpenBotDesktopApi["getAppInfo"];
  getAppAppearancePreference: OpenBotDesktopApi["getAppAppearancePreference"];
  getAppInterfaceSizePreference: OpenBotDesktopApi["getAppInterfaceSizePreference"];
  getAppLanguagePreference: OpenBotDesktopApi["getAppLanguagePreference"];
  getAppLogoColorPreference: OpenBotDesktopApi["getAppLogoColorPreference"];
  listInstalledFonts: OpenBotDesktopApi["listInstalledFonts"];
  onAppAppearancePreference: OpenBotDesktopApi["onAppAppearancePreference"];
  onAppInterfaceSizePreference: OpenBotDesktopApi["onAppInterfaceSizePreference"];
  onAppLanguagePreference: OpenBotDesktopApi["onAppLanguagePreference"];
  onAppLogoColorPreference: OpenBotDesktopApi["onAppLogoColorPreference"];
  openExternal: OpenBotDesktopApi["openExternal"];
  getSentMessageStats: OpenBotDesktopApi["getSentMessageStats"];
  reportRendererTiming: OpenBotDesktopApi["reportRendererTiming"];
  openUrl: OpenBotDesktopApi["openUrl"];
  openChatWindow: OpenBotDesktopApi["openChatWindow"];
  getChatWindows: OpenBotDesktopApi["getChatWindows"];
  onChatWindows: OpenBotDesktopApi["onChatWindows"];
  onQuitShortcutHint: OpenBotDesktopApi["onQuitShortcutHint"];
  setAppAppearancePreference: OpenBotDesktopApi["setAppAppearancePreference"];
  setAppInterfaceSizePreference: OpenBotDesktopApi["setAppInterfaceSizePreference"];
  setAppLanguagePreference: OpenBotDesktopApi["setAppLanguagePreference"];
  setAppLogoColorPreference: OpenBotDesktopApi["setAppLogoColorPreference"];
  agent: Pick<
    OpenBotDesktopApi["agent"],
    "readConversationPage" | "searchConversationMessages" | "searchConversationFiles" | "listRoutines" | "listAgents"
  >;
  acpRegistry: OpenBotDesktopApi["acpRegistry"];
  auth: Pick<
    OpenBotDesktopApi["auth"],
    "listOwnerTransfers" | "acceptOwnerTransfer" | "declineOwnerTransfer" | "onOwnerTransfersChanged"
  >;
  routineFeed: OpenBotDesktopApi["routineFeed"];
  events: OpenBotDesktopApi["events"];
  plugins: Pick<OpenBotDesktopApi["plugins"], "onOpenListing" | "takePendingListing">;
  servers: Pick<
    OpenBotDesktopApi["servers"],
    "onInvite" | "takePendingInvite" | "getOwnerTransfer" | "startOwnerTransfer" | "cancelOwnerTransfer"
  >;
}

export function appPort(): AppPort {
  return window.openbot;
}
