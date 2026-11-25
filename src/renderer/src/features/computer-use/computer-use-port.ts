import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

export interface ComputerUsePort {
  computerUse: OpenBotDesktopApi["computerUse"];
  update: Pick<OpenBotDesktopApi["update"], "getStatus" | "restartWhenIdle">;
}

export function computerUsePort(): ComputerUsePort {
  return window.openbot;
}
