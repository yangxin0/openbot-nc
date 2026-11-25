import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

export interface AccountPort {
  agent: Pick<OpenBotDesktopApi["agent"], "getUsage">;
  profile: Pick<OpenBotDesktopApi["profile"], "get" | "onChanged" | "updateChatColor" | "updateName">;
}

export function accountPort(): AccountPort {
  return window.openbot;
}
