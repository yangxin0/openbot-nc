import { join } from "node:path";
import { APP_NAME } from "@openbot/contracts/app-identity";
import { utilityProcess } from "electron";
import type { VoiceTranscriptionHostProcess, VoiceTranscriptionResponse } from "./voice-transcription-protocol";

export function spawnVoiceTranscriptionHost(): VoiceTranscriptionHostProcess {
  const child = utilityProcess.fork(join(__dirname, "voice-transcription-host.js"), [], {
    serviceName: `${APP_NAME} voice transcription`,
    stdio: "ignore",
  });
  return {
    send: (request) => child.postMessage(request),
    onResponse: (listener) => {
      child.on("message", (message: VoiceTranscriptionResponse) => listener(message));
    },
    onExit: (listener) => {
      child.once("exit", () => listener());
    },
    kill: () => {
      child.kill();
    },
  };
}
