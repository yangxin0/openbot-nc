import { startClientBrowser } from "./client-browser-worker";
import { decodeStorageRequest, PANEL_PORT, type StorageRequest } from "./extension-messages";

void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

const OFFSCREEN_PAGE = "offscreen.html";
const PANEL_PAGE = "sidepanel.html";

let creating: Promise<void> | null = null;

async function ensureOffscreen(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PAGE,
      reasons: ["WORKERS"],
      justification:
        "Keeps the connection to the user's own central server while agents use the shared tabs and the side panel is closed.",
    })
    .finally(() => {
      creating = null;
    });
  await creating;
}

async function storageAnswer(request: StorageRequest) {
  if (request.op === "get") return { items: await chrome.storage.local.get(request.keys) };
  if (request.op === "set") await chrome.storage.local.set(request.items);
  else await chrome.storage.local.remove(request.keys);
  return {};
}

const panels = new Set<chrome.runtime.Port>();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PANEL_PORT || !port.sender?.url?.startsWith(chrome.runtime.getURL(PANEL_PAGE))) return;
  panels.add(port);
  void chrome.offscreen.closeDocument().catch(() => undefined);
  port.onDisconnect.addListener(() => {
    panels.delete(port);
    clientBrowser.panelClosed();
  });
});

const clientBrowser = startClientBrowser({ panelOpen: () => panels.size > 0, ensureOffscreen });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const storage = decodeStorageRequest(message);
  if (!storage || sender.tab || sender.url !== chrome.runtime.getURL(OFFSCREEN_PAGE)) return undefined;
  void storageAnswer(storage).then(sendResponse, () => sendResponse({}));
  return true;
});
