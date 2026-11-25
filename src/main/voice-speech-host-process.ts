import { join } from "node:path";
import { APP_NAME } from "@openbot/contracts/app-identity";
import { utilityProcess } from "electron";
import type { VoiceSpeechHostProcess, VoiceSpeechResponse } from "./voice-speech-protocol";

export function spawnVoiceSpeechHost(): VoiceSpeechHostProcess {
  const child = utilityProcess.fork(join(__dirname, "voice-speech-host.js"), [], {
    serviceName: `${APP_NAME} speech`,
    stdio: "ignore",
  });
  return {
    send: (request) => child.postMessage(request),
    onResponse: (listener) => {
      child.on("message", (message: VoiceSpeechResponse) => listener(message));
    },
    onExit: (listener) => {
      child.once("exit", () => listener());
    },
    kill: () => {
      child.kill();
    },
  };
}
