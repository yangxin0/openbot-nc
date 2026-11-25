import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

export interface RelayPort {
  relay: OpenBotDesktopApi["relay"];
}

export function relayPort(): RelayPort {
  return window.openbot;
}
