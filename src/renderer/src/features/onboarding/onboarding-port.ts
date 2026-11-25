import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

export interface OnboardingPort {
  getSetupState: OpenBotDesktopApi["getSetupState"];
  saveSetup: OpenBotDesktopApi["saveSetup"];
  onSetupState: OpenBotDesktopApi["onSetupState"];
  servers: Pick<OpenBotDesktopApi["servers"], "previewInvite">;
  openUrl: OpenBotDesktopApi["openUrl"];
}

export function onboardingPort(): OnboardingPort {
  return window.openbot;
}
