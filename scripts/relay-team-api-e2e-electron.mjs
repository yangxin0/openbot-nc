import { registerHooks } from "node:module";
import { tmpdir } from "node:os";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "electron") return { url: import.meta.url, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

class Inert {}

export const app = {
  getPath: () => tmpdir(),
  getVersion: () => "0.0.0-e2e",
  getName: () => "OpenBot",
  isPackaged: false,
  on: () => undefined,
  once: () => undefined,
};
export const BrowserWindow = Object.assign(class extends Inert {}, { getAllWindows: () => [] });
export const MessageChannelMain = class extends Inert {};
export const Notification = Object.assign(class extends Inert {}, { isSupported: () => false });
export const clipboard = {};
export const desktopCapturer = {};
export const dialog = {};
export const ipcMain = { handle: () => undefined, removeHandler: () => undefined, on: () => undefined };
export const nativeImage = {};
export const nativeTheme = { on: () => undefined };
export const net = {};
export const powerMonitor = { on: () => undefined };
export const protocol = {};
export const safeStorage = { isEncryptionAvailable: () => false };
export const screen = { getAllDisplays: () => [] };
export const session = {};
export const shell = { openExternal: async () => undefined };
export const systemPreferences = {};
export const utilityProcess = {};
export const webContents = { getAllWebContents: () => [] };
export default {
  app,
  BrowserWindow,
  MessageChannelMain,
  Notification,
  clipboard,
  desktopCapturer,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  net,
  powerMonitor,
  protocol,
  safeStorage,
  screen,
  session,
  shell,
  systemPreferences,
  utilityProcess,
  webContents,
};
