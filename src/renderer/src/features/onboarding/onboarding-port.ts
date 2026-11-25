import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

export interface OnboardingPort {
  getSetupState: OpenBotDesktopApi["getSetupState"];
  saveSetup: OpenBotDesktopApi["saveSetup"];
  onSetupState: OpenBotDesktopApi["onSetupState"];
  openUrl: OpenBotDesktopApi["openUrl"];
}

export function onboardingPort(): OnboardingPort {
  return window.openbot;
}
