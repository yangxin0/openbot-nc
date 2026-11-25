import { isNewerRelease } from "@openbot/contracts/release-version";
import type { AppTranslate } from "@openbot/i18n";
import { createOpenBotLogger } from "@openbot/logging";
import { app, dialog } from "electron";

const logger = createOpenBotLogger("update");

interface NewerDatabaseRecoveryOptions {
  translate: AppTranslate;
  loopVersion: string | null;
}

export async function recoverFromNewerDatabase(options: NewerDatabaseRecoveryOptions): Promise<void> {
  const loopVersion =
    options.loopVersion && isNewerRelease(options.loopVersion, app.getVersion()) ? options.loopVersion : null;
  if (loopVersion) {
    logger.warn(`An older OpenBot started over newer data, and OpenBot ${loopVersion} did not start.`);
    await dialog.showMessageBox({
      type: "warning",
      message: options.translate("startup.newerDataLoopTitle"),
      detail: options.translate("startup.newerDataLoopBody", { version: app.getVersion(), loopVersion }),
      buttons: [options.translate("startup.newerDataQuit")],
    });
  } else {
    logger.warn("An older OpenBot started over newer data.");
    await dialog.showMessageBox({
      type: "warning",
      message: options.translate("startup.newerDataTitle"),
      detail: options.translate("startup.newerDataBody", { version: app.getVersion() }),
      buttons: [options.translate("startup.newerDataQuit")],
    });
  }
  app.quit();
}
