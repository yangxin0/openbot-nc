import { runCauseEffect } from "../../backend/effect-boundary";
import type { LocalProfileStore } from "../local-profile-store";
import { parseChatColor, parseProfileName } from "./app-inputs";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";

export interface ProfileIpcDependencies {
  profile: Pick<LocalProfileStore, "get" | "update">;
}

export function profileIpcHandlers({ profile }: ProfileIpcDependencies): Pick<IpcGroupHandlers, "profile"> {
  return {
    profile: {
      get: handler(() => profile.get()),
      updateName: payloadHandler(parseProfileName, (name) => runCauseEffect(profile.update({ name }))),
      updateChatColor: payloadHandler(parseChatColor, (chatColor) => runCauseEffect(profile.update({ chatColor }))),
    },
  };
}
