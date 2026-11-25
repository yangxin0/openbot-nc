import { defineMessages } from "../../message";

export const messages = defineMessages("startup", {
  "startup.failedTitle": "OpenBot-NC couldn’t start",
  "startup.failedBody":
    "{message}\n\nYour local data was not reset or overwritten. See the troubleshooting guide for recovery steps.",
  "startup.archiveChangedTitle": "OpenBot-NC files were changed",
  "startup.archiveChangedBody":
    "Another program changed the OpenBot-NC file app.asar. OpenBot-NC runs now, but it will not open after you quit it.\n\nTo repair OpenBot-NC, install it again. Your local data stays.",
  "startup.filesDamagedBody":
    "Some OpenBot-NC files are damaged or missing.\n\nTo repair OpenBot-NC, install it again. Your local data stays.",
  "startup.newerDataTitle": "Install the latest OpenBot-NC",
  "startup.newerDataBody":
    "A newer version of OpenBot-NC saved your data, and this version ({version}) cannot open it. Install the latest version to open your data.\n\nYour local data was not reset or overwritten.",
  "startup.newerDataQuit": "Quit",
  "startup.newerDataLoopTitle": "The latest OpenBot-NC did not open",
  "startup.newerDataLoopBody":
    "A newer version of OpenBot-NC saved your data, and this version ({version}) cannot open it. OpenBot-NC {loopVersion} stopped before it opened several times in a row, so it is not installed again.\n\nInstall a version newer than {loopVersion} when one is available. To get help, open the guide.\n\nYour local data was not reset or overwritten.",
  "startup.recoveryWindowTitle": "OpenBot-NC recovery",
  "startup.recoveryTitle": "OpenBot-NC did not open",
  "startup.recoveryBody": {
    one: "OpenBot-NC {version} stopped before it opened, {count} time in a row. Your local data was not reset or overwritten.",
    other:
      "OpenBot-NC {version} stopped before it opened, {count} times in a row. Your local data was not reset or overwritten.",
  },
  "startup.recoveryHint":
    "Try again, or install the last version that opened. To get help, export the diagnostics and send the file with your report.",
  "startup.recoveryHintLatest":
    "OpenBot-NC found no earlier version that can open your data. Try again, or install the latest version. To get help, export the diagnostics and send the file with your report.",
  "startup.recoveryRetry": "Try again",
  "startup.recoveryExportDiagnostics": "Export diagnostics",
  "startup.recoveryOpenDataFolder": "Open data folder",
  "startup.recoveryQuit": "Quit",
  "startup.recoveryDiagnosticsSaved": "The diagnostics file is saved.",
  "startup.recoveryActionFailed": "OpenBot-NC could not do this action.",
});
