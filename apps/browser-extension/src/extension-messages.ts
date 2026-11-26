import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";

export const PANEL_PORT = "openbot-panel";
export const PANEL_READY = "openbot-panel-ready";
export const STORAGE_MESSAGE = "openbot-storage";

export type StorageRequest =
  | { kind: typeof STORAGE_MESSAGE; op: "get"; keys: string | string[] | null }
  | { kind: typeof STORAGE_MESSAGE; op: "set"; items: { [key: string]: chrome.storage.StoredValue } }
  | { kind: typeof STORAGE_MESSAGE; op: "remove"; keys: string | string[] };

const isKeys = (value: unknown): value is string | string[] =>
  isString(value) || (Array.isArray(value) && value.every(isString));

function isStoredValue(value: unknown): value is chrome.storage.StoredValue {
  if (value === null || isString(value) || typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.every(isStoredValue);
  return isDynamicRecord(value) && Object.values(value).every(isStoredValue);
}

export function isStoredItems(value: unknown): value is { [key: string]: chrome.storage.StoredValue } {
  return isDynamicRecord(value) && Object.values(value).every(isStoredValue);
}

export function decodeStorageRequest(value: unknown): StorageRequest | null {
  if (!isDynamicRecord(value) || value.kind !== STORAGE_MESSAGE) return null;
  if (value.op === "get" && (value.keys === null || isKeys(value.keys)))
    return { kind: STORAGE_MESSAGE, op: "get", keys: value.keys };
  if (value.op === "set" && isStoredItems(value.items)) return { kind: STORAGE_MESSAGE, op: "set", items: value.items };
  if (value.op === "remove" && isKeys(value.keys)) return { kind: STORAGE_MESSAGE, op: "remove", keys: value.keys };
  return null;
}
