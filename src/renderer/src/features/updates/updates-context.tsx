import type { UpdateStatus } from "@openbot/contracts/ipc";
import { createSignal, flush, onSettled } from "solid-js";
import { FALLBACK_UPDATE_STATUS } from "../../app-defaults";
import { createSimpleContext } from "../../simple-context";
import { useSettings } from "../settings/settings-context";
import { createIdleRestartToast } from "./idle-restart-toast";
import { createScheduledUpdateToast } from "./scheduled-update-toast";
import { idleRestartTarget, updatesPort } from "./updates-port";

const Updates = createSimpleContext({
  name: "Updates",
  init: () => {
    const [status, setStatus] = createSignal<UpdateStatus>(FALLBACK_UPDATE_STATUS);

    onSettled(() => {
      const unsubscribe = updatesPort().update.onEvent((next) => {
        flush(() => setStatus(next));
      });
      void updatesPort()
        .update.getStatus()
        .then(setStatus)
        .catch(() => undefined);
      return unsubscribe;
    });

    async function runAction(): Promise<void> {
      const current = status();
      if (current.managedByHost === true) return;
      const phase = current.phase;
      if (phase === "ready") {
        const next = await updatesPort().update.install();
        setStatus(next);
        return;
      }
      const action =
        phase === "available" || (phase === "error" && current.errorCode === "download_failed")
          ? ("download" as const)
          : ("check" as const);
      const next = action === "download" ? await updatesPort().update.download() : await updatesPort().update.check();
      setStatus(next);
    }

    async function cancelScheduledRestart(): Promise<void> {
      setStatus(await updatesPort().update.cancelScheduledRestart());
    }

    createScheduledUpdateToast({ status, cancel: cancelScheduledRestart });

    async function restartWhenIdle(): Promise<void> {
      setStatus(await updatesPort().update.restartWhenIdle(idleRestartTarget(status())));
    }

    async function cancelIdleRestart(): Promise<void> {
      setStatus(await updatesPort().update.cancelIdleRestart());
    }

    async function restartNow(): Promise<void> {
      setStatus(await updatesPort().update.restartNow());
    }

    const { openAppSettings } = useSettings();
    createIdleRestartToast({
      status,
      cancel: cancelIdleRestart,
      openSettings: () => openAppSettings(null, "updates"),
    });

    return { status, runAction, cancelScheduledRestart, restartWhenIdle, cancelIdleRestart, restartNow };
  },
});

export const UpdatesProvider = Updates.provider;
export const useUpdates = Updates.use;
