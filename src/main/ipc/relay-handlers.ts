import type { RelayImportResult } from "@openbot/contracts/ipc";
import { RELAY_JOIN_CODE_TEXT_LIMIT } from "@openbot/contracts/relay-protocol/enrollment";
import { isBoolean } from "@openbot/contracts/runtime-values";
import type { AppTranslate } from "@openbot/i18n";
import { sourceText } from "@openbot/i18n/source";
import { type BrowserWindow, dialog, type OpenDialogOptions } from "electron";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { RelayService } from "../relay-service";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { stringPayload } from "./validation";

export interface RelayIpcDependencies {
  relay: Pick<RelayService, "state" | "importFile" | "joinWithCode" | "removeIdentity" | "setHosting" | "unhideHost">;
  getMainWindow: () => BrowserWindow | null;
  translate: AppTranslate;
  takePendingJoinCode: () => string | null;
}

const DESKTOP_ENROLL_LABEL = "Desktop app";
const joinCodePayload = stringPayload("The join code", 4 * RELAY_JOIN_CODE_TEXT_LIMIT);

export function relayIpcHandlers({
  relay,
  getMainWindow,
  translate,
  takePendingJoinCode,
}: RelayIpcDependencies): Pick<IpcGroupHandlers, "relay"> {
  const chooseIdentityFile = async (): Promise<string | null> => {
    const parent = getMainWindow();
    const options: OpenDialogOptions = {
      title: translate("dialog.chooseRelayIdentity"),
      properties: ["openFile"],
      filters: [{ name: translate("dialog.filter.jsonDocument"), extensions: ["json"] }],
    };
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  };
  const importChosenFile = async (replace: boolean): Promise<RelayImportResult> => {
    if (!replace && relay.state().identity !== null) throw new Error(sourceText("error.remote.relayIdentityExists"));
    const path = await chooseIdentityFile();
    if (path === null) return { status: "canceled" };
    return { status: "imported", state: await runCauseEffect(relay.importFile(path, replace)) };
  };
  return {
    relay: {
      getState: handler(() => relay.state()),
      importIdentity: handler(() => importChosenFile(false)),
      replaceIdentity: handler(() => importChosenFile(true)),
      joinWithCode: payloadHandler(joinCodePayload, (code) =>
        runCauseEffect(relay.joinWithCode(code, false, DESKTOP_ENROLL_LABEL)),
      ),
      replaceWithCode: payloadHandler(joinCodePayload, (code) =>
        runCauseEffect(relay.joinWithCode(code, true, DESKTOP_ENROLL_LABEL)),
      ),
      takePendingJoinCode: handler(takePendingJoinCode),
      removeIdentity: handler(() => runCauseEffect(relay.removeIdentity())),
      setHosting: payloadHandler(parseHostingChoice, (enabled) => runCauseEffect(relay.setHosting(enabled))),
      unhideHost: payloadHandler(stringPayload("serverId"), (serverId) => runCauseEffect(relay.unhideHost(serverId))),
    },
  };
}

function parseHostingChoice(value: unknown): boolean {
  if (!isBoolean(value)) throw new Error("The hosting choice must be a boolean.");
  return value;
}
