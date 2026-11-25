import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { PRESENCE_KEY, type PresenceAck } from "./client-browser-messages";

const SERVER_KEY = "openbot.server.v2";
const HOST_PROTOCOL_PREFIX = "openbot.host-protocol.v2:";

let area: chrome.storage.StorageArea | null = null;

export function useStorageArea(next: chrome.storage.StorageArea): void {
  area = next;
}

const local = () => area ?? chrome.storage.local;

export interface SavedHost {
  identityKeyId: string;
  hostId: string;
  name: string;
  devicePublicKey: string;
}

export async function readSavedHost(): Promise<SavedHost | null> {
  const value = (await local().get(SERVER_KEY))[SERVER_KEY];
  if (
    !isDynamicRecord(value) ||
    !isString(value.identityKeyId) ||
    !isString(value.hostId) ||
    !isString(value.name) ||
    !isString(value.devicePublicKey)
  )
    return null;
  return {
    identityKeyId: value.identityKeyId,
    hostId: value.hostId,
    name: value.name,
    devicePublicKey: value.devicePublicKey,
  };
}

export function saveHost(host: SavedHost): Promise<void> {
  return local().set({ [SERVER_KEY]: { ...host } });
}

export async function readHostProtocols(identityKeyId: string): Promise<Map<string, number>> {
  const prefix = `${HOST_PROTOCOL_PREFIX}${identityKeyId}:`;
  const all = await local().get(null);
  const protocols = new Map<string, number>();
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(prefix) && typeof value === "number" && Number.isSafeInteger(value) && value > 0)
      protocols.set(key.slice(prefix.length), value);
  }
  return protocols;
}

export function saveHostProtocol(identityKeyId: string, hostId: string, protocol: number): Promise<void> {
  return local().set({ [`${HOST_PROTOCOL_PREFIX}${identityKeyId}:${hostId}`]: protocol });
}

export async function clearIdentityData(): Promise<void> {
  const all = await local().get(null);
  await local().remove([SERVER_KEY, ...Object.keys(all).filter((key) => key.startsWith(HOST_PROTOCOL_PREFIX))]);
}

export function savePresenceAck(ack: PresenceAck): Promise<void> {
  return local().set({ [PRESENCE_KEY]: { ...ack } });
}
