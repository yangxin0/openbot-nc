import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { formatLocale, loadLocale, resolveLocale } from "@openbot/i18n";
import {
  type RelayBrowserControl,
  type RelayControlSnapshot,
  startRelayControl,
} from "@openbot/team-client/relay-client";
import { currentText, TextProvider } from "@openbot/ui/text";
import { render } from "@solidjs/web";
import { type ClientBrowserLink, createClientBrowserLink } from "./client-browser-link";
import { BROWSER_HOLD_MESSAGE } from "./client-browser-messages";
import { loadIdentity, openIdentityStore } from "./extension-identity";
import { isStoredItems, STORAGE_MESSAGE } from "./extension-messages";
import { readSavedHost, useStorageArea } from "./extension-storage";
import { createHostConnection, type HostConnection } from "./host-connection";

useStorageArea({
  get: async (keys) => {
    const answer = await chrome.runtime.sendMessage({ kind: STORAGE_MESSAGE, op: "get", keys });
    const items = isDynamicRecord(answer) ? answer.items : null;
    if (!isStoredItems(items)) throw new Error(currentText().t("extension.connection.requestFailed"));
    return items;
  },
  set: async (items) => {
    await chrome.runtime.sendMessage({ kind: STORAGE_MESSAGE, op: "set", items });
  },
  remove: async (keys) => {
    await chrome.runtime.sendMessage({ kind: STORAGE_MESSAGE, op: "remove", keys });
  },
});

const locale = resolveLocale("system", navigator.language);
const started = loadLocale(locale)
  .catch(() => undefined)
  .then(() => {
    const root = document.getElementById("root");
    if (root)
      render(() => <TextProvider locale={locale} formatLocale={formatLocale("system", navigator.language)} />, root);
  });

const identities = openIdentityStore();

interface Target {
  identityKeyId: string;
  hostId: string;
  connection: HostConnection;
  control: RelayBrowserControl;
  link: ClientBrowserLink;
  stopWatch: () => void;
}

let target: Target | null = null;
let queue: Promise<unknown> = Promise.resolve();

function drop(): void {
  target?.stopWatch();
  target?.link.dispose();
  void target?.connection.dispose();
  target?.control.stop();
  target = null;
}

async function connectSavedHost(): Promise<void> {
  const identity = await loadIdentity(identities);
  const saved = await readSavedHost();
  if (!identity || !saved || saved.identityKeyId !== identity.keyId) {
    drop();
    return;
  }
  if (target && target.identityKeyId === identity.keyId && target.hostId === saved.hostId) return;
  drop();
  const links: { current: ClientBrowserLink | null } = { current: null };
  const control = startRelayControl(identity);
  let offline = false;
  const reconnectWhenListed = (snapshot: RelayControlSnapshot) => {
    if (!offline || target?.connection !== connection || snapshot.state.status !== "online") return;
    if (!snapshot.roster.some((member) => member.hosting && member.keyId === saved.devicePublicKey)) return;
    offline = false;
    void connection.connect(saved).catch(() => {
      offline = true;
    });
  };
  const connection = await createHostConnection(identity, control, {
    event: (event) => links.current?.handleEvent(event),
    state: (update) => {
      if (update.state === "online") links.current?.refresh();
      else if (update.state === "offline" && target?.connection === connection) {
        offline = true;
        reconnectWhenListed(control.snapshot());
      }
    },
  });
  try {
    const capabilities = await connection.connect(saved);
    const link = createClientBrowserLink({ request: connection.request, capabilities });
    links.current = link;
    const stopWatch = control.subscribe(reconnectWhenListed);
    target = { identityKeyId: identity.keyId, hostId: saved.hostId, connection, control, link, stopWatch };
  } catch (error) {
    await connection.dispose();
    control.stop();
    throw error;
  }
}

function holdShared(): void {
  const work = queue.then(() => started).then(connectSavedHost);
  queue = work.catch(() => undefined);
}
window.setInterval(holdShared, 30_000);

chrome.runtime.onMessage.addListener((message, sender) => {
  if (isDynamicRecord(message) && message.kind === BROWSER_HOLD_MESSAGE && !sender.tab) holdShared();
  return undefined;
});
