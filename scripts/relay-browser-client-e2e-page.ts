import type { TeamProtocolV2Json } from "@openbot/contracts/team-protocol";
import {
  createIndexedDbRelayIdentityKeyStore,
  createRelayIdentityFromFile,
  createRelayIdentityFromText,
  createRelayTeamPeer,
  loadRelayIdentity,
  type RelayBrowserControl,
  type RelayBrowserIdentity,
  type RelayControlState,
  relayHubTunnelTransport,
  relayRosterHosts,
  removeRelayIdentity,
  saveRelayIdentity,
  startRelayControl,
} from "@openbot/team-client/relay-client";
import type { RemoteTeamCommandResult } from "@openbot/team-client/remote-peer";

interface ImportedIdentity {
  keyId: string;
  team: string;
  user: string;
  device: string | null;
  extractable: boolean;
  exportRefused: boolean;
}

interface RelayBrowserTestApi {
  importText(text: string): Promise<ImportedIdentity>;
  importFile(): Promise<ImportedIdentity>;
  importFailure(text: string): Promise<string>;
  saveIdentity(): Promise<void>;
  loadIdentity(): Promise<ImportedIdentity | null>;
  removeIdentity(): Promise<boolean>;
  startControl(): void;
  waitForHost(keyId: string): Promise<string[]>;
  connect(hostKeyId: string): Promise<RemoteTeamCommandResult>;
  request(method: string, path: string, body: TeamProtocolV2Json): Promise<RemoteTeamCommandResult>;
  upload(path: string, name: string, mimeType: string, base64: string): Promise<RemoteTeamCommandResult>;
  waitForEvent(fragments: string[]): Promise<number>;
  stopAll(): Promise<void>;
  controlStates(text: string): Promise<RelayControlState[]>;
  dialFailure(text: string, target: string): Promise<string>;
  dialMain(target: string): Promise<string>;
  rosterHas(keyId: string): boolean;
}

declare global {
  interface Window {
    relayBrowserTest: RelayBrowserTestApi;
  }
}

const store = createIndexedDbRelayIdentityKeyStore({ databaseName: "openbot-relay-browser-client-e2e" });
const log = document.querySelector("#log");
const events: string[] = [];
const eventWaiters = new Set<() => void>();
let identity: RelayBrowserIdentity | null = null;
let control: RelayBrowserControl | null = null;
let peer: ReturnType<typeof createRelayTeamPeer> | null = null;
let commandCount = 0;

function note(line: string): void {
  if (log) log.textContent = `${log.textContent ?? ""}${line}\n`;
}

function current(): RelayBrowserIdentity {
  if (!identity) throw new Error("No identity is imported.");
  return identity;
}

async function describe(value: RelayBrowserIdentity): Promise<ImportedIdentity> {
  const key = value.privateKey;
  if (!(key instanceof CryptoKey)) throw new Error("The browser identity must hold a WebCrypto key.");
  let exportRefused = false;
  try {
    await crypto.subtle.exportKey("pkcs8", key);
  } catch {
    exportRefused = true;
  }
  return {
    keyId: value.keyId,
    team: value.team,
    user: value.user,
    device: value.device,
    extractable: key.extractable,
    exportRefused,
  };
}

function errorCode(error: unknown): string {
  if (error instanceof Error && "code" in error && typeof error.code === "string") return error.code;
  return error instanceof Error ? `unknown: ${error.message}` : "unknown";
}

function commandId(): string {
  commandCount += 1;
  return `command-${commandCount}`;
}

function activePeer(): ReturnType<typeof createRelayTeamPeer> {
  if (!peer) throw new Error("No peer is open.");
  return peer;
}

function untilControl(target: RelayBrowserControl, accepts: (state: RelayControlState) => boolean): Promise<void> {
  return new Promise((resolve) => {
    const stop = target.subscribe((snapshot) => {
      if (!accepts(snapshot.state)) return;
      queueMicrotask(() => stop());
      resolve();
    });
  });
}

window.relayBrowserTest = {
  async importText(text) {
    identity = await createRelayIdentityFromText(text);
    note(`identity imported from text: ${identity.user} in ${identity.team}`);
    return describe(identity);
  },
  async importFile() {
    const input = document.querySelector<HTMLInputElement>("#identity-file");
    const file = input?.files?.[0];
    if (!file) throw new Error("No file is picked.");
    identity = await createRelayIdentityFromFile(file);
    note(`identity imported from a file: ${identity.user} in ${identity.team}`);
    return describe(identity);
  },
  async importFailure(text) {
    try {
      await createRelayIdentityFromText(text);
      return "accepted";
    } catch (error) {
      note(`identity refused: ${errorCode(error)}`);
      return errorCode(error);
    }
  },
  async saveIdentity() {
    await saveRelayIdentity(store, current());
    note("identity saved in IndexedDB");
  },
  async loadIdentity() {
    const loaded = await loadRelayIdentity(store);
    if (!loaded) return null;
    identity = loaded;
    note(`identity loaded from IndexedDB: ${loaded.user}`);
    return describe(loaded);
  },
  async removeIdentity() {
    await removeRelayIdentity(store);
    return (await loadRelayIdentity(store)) === null;
  },
  startControl() {
    control = startRelayControl(current(), { reconnect: { baseMs: 100, maxMs: 500 } });
    control.subscribe((snapshot) => note(`control: ${snapshot.state.status}, ${snapshot.roster.length} in the roster`));
  },
  waitForHost(keyId) {
    const target = control;
    if (!target) throw new Error("The control is not started.");
    return new Promise((resolve) => {
      const stop = target.subscribe(() => {
        const hosts = relayRosterHosts(target).map((member) => member.keyId);
        if (!hosts.includes(keyId)) return;
        queueMicrotask(() => stop());
        resolve(hosts);
      });
    });
  },
  connect(hostKeyId) {
    const sessions = control;
    if (!sessions) throw new Error("The control is not started.");
    peer = createRelayTeamPeer(sessions, {
      current: {
        onConnectionUpdate: async (update) =>
          note(`peer: ${update.state}${update.message ? ` (${update.message})` : ""}`),
        onTeamEvent: async (_hostId, event) => {
          events.push(JSON.stringify(event));
          for (const waiter of [...eventWaiters]) waiter();
        },
      },
    });
    return activePeer().execute({ id: commandId(), type: "connect", hostId: hostKeyId, hostPublicKey: hostKeyId });
  },
  async request(method, path, body) {
    const result = await activePeer().execute({ id: commandId(), type: "request", method, path, body });
    note(`${method} ${path}: ${result.status ?? result.error ?? "no status"}`);
    return result;
  },
  async upload(path, name, mimeType, base64) {
    const result = await activePeer().execute({
      id: commandId(),
      type: "request",
      method: "POST",
      path,
      body: null,
      upload: { name, mimeType, base64 },
    });
    note(`upload ${name}: ${result.status ?? result.error ?? "no status"}`);
    return result;
  },
  waitForEvent(fragments) {
    return new Promise((resolve) => {
      const look = () => {
        const index = events.findIndex((event) => fragments.every((fragment) => event.includes(fragment)));
        if (index < 0) return;
        eventWaiters.delete(look);
        note("the reply event arrived");
        resolve(index);
      };
      eventWaiters.add(look);
      look();
    });
  },
  async stopAll() {
    control?.stop();
    control = null;
    await peer?.dispose();
    peer = null;
  },
  async controlStates(text) {
    const fakeIdentity = await createRelayIdentityFromText(text);
    const fakeControl = startRelayControl(fakeIdentity, { reconnect: { baseMs: 100, maxMs: 500 } });
    const states: RelayControlState[] = [];
    fakeControl.subscribe((snapshot) => states.push(snapshot.state));
    await untilControl(fakeControl, (state) => state.status === "offline" && state.code !== "stopped");
    const final = states.at(-1);
    note(`control at the fake relay: ${final?.status === "offline" ? final.code : "online"}`);
    return states;
  },
  async dialMain(target) {
    if (!control) return "no control";
    try {
      const tunnels = await relayHubTunnelTransport(control).open("relay:check", target, new AbortController().signal);
      tunnels.close();
      return "accepted";
    } catch (error) {
      note(`dial refused: ${errorCode(error)}`);
      return `${errorCode(error)}: ${error instanceof Error ? error.message : ""}`;
    }
  },
  rosterHas(keyId) {
    return control?.member(keyId) !== null && control !== null;
  },
  async dialFailure(text, target) {
    const fakeIdentity = await createRelayIdentityFromText(text);
    try {
      const fakeControl = startRelayControl(fakeIdentity, { reconnect: { baseMs: 100, maxMs: 500 } });
      try {
        const tunnels = await relayHubTunnelTransport(fakeControl).open(
          "relay:check",
          target,
          new AbortController().signal,
        );
        tunnels.close();
        return "accepted";
      } finally {
        fakeControl.stop();
      }
    } catch (error) {
      note(`dial refused: ${errorCode(error)}`);
      return `${errorCode(error)}: ${error instanceof Error ? error.message : ""}`;
    }
  },
};

note("page ready");
