import { decodeRelayIdentityBundle, type RelayIdentityBundle } from "@openbot/contracts/relay-protocol/identity-bundle";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import {
  createRelayIdentityFromText,
  type RelayBrowserIdentity,
  type RelayCrypto,
  RelayIdentityError,
} from "@openbot/team-client/relay-client";
import {
  joinRelayWithCode,
  type RelayJoinTextKey,
  relayJoinError,
  relayJoinErrorKey,
} from "@openbot/team-client/relay-join";

export interface PhoneSecureStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export interface PhoneIdentityStore {
  load(): Promise<RelayBrowserIdentity | null>;
  importText(text: string): Promise<RelayBrowserIdentity>;
  joinWithCode(text: string): Promise<RelayBrowserIdentity>;
  remove(): Promise<void>;
}

export type PhoneIdentityErrorKey =
  | "mobile.identity.error.invalid"
  | "mobile.identity.error.keyUnsupported"
  | "mobile.identity.error.keyMismatch"
  | "mobile.identity.error.untrusted"
  | "mobile.identity.error.expired"
  | "mobile.identity.error.notYetValid"
  | "mobile.identity.error.storage"
  | "mobile.identity.error.relayUrlMissing"
  | "mobile.identity.error.fileTooLarge"
  | "mobile.identity.error.fileUnreadable";

export class PhoneIdentityError extends Error {
  constructor(readonly key: PhoneIdentityErrorKey) {
    super(key);
  }
}

export const PHONE_IDENTITY_KEY = "openbot.relay-identity.v1";
export const PHONE_IDENTITY_PART_LENGTH = 2000;
const PHONE_IDENTITY_MAX_PARTS = 40;
const STORED_VERSION = 1;
const PHONE_ENROLL_LABEL = "Phone app";

export function phoneIdentityPartKey(index: number): string {
  return `${PHONE_IDENTITY_KEY}.part.${index}`;
}

export function createPhoneIdentityStore(store: PhoneSecureStore, crypto: RelayCrypto): PhoneIdentityStore {
  const read = async (text: string) => {
    const identity = await createRelayIdentityFromText(text, { crypto });
    if (identity.relayUrl === null) throw new PhoneIdentityError("mobile.identity.error.relayUrlMissing");
    return identity;
  };
  const removeParts = async (from: number) => {
    for (let index = from; index < PHONE_IDENTITY_MAX_PARTS; index += 1) {
      const key = phoneIdentityPartKey(index);
      if ((await store.getItemAsync(key)) === null) return;
      await store.deleteItemAsync(key);
    }
  };
  const remove = async () => {
    await store.deleteItemAsync(PHONE_IDENTITY_KEY);
    await removeParts(0);
  };
  const importText = async (text: string) => {
    let identity: RelayBrowserIdentity;
    let parts: string[];
    try {
      identity = await read(text);
      parts = splitParts(storedBundleText(text));
    } catch (error) {
      throw new PhoneIdentityError(phoneIdentityErrorKey(error));
    }
    try {
      await store.deleteItemAsync(PHONE_IDENTITY_KEY);
      for (const [index, part] of parts.entries()) await store.setItemAsync(phoneIdentityPartKey(index), part);
      await removeParts(parts.length);
      await store.setItemAsync(PHONE_IDENTITY_KEY, JSON.stringify({ version: STORED_VERSION, parts: parts.length }));
    } catch {
      await remove().catch(() => undefined);
      throw new PhoneIdentityError("mobile.identity.error.storage");
    }
    return identity;
  };
  return {
    async load() {
      let saved: string | null;
      let text: string;
      try {
        saved = await store.getItemAsync(PHONE_IDENTITY_KEY);
        if (saved === null) return null;
        const parts = storedPartCount(saved);
        if (parts === null) throw new PhoneIdentityError("mobile.identity.error.storage");
        const chunks: string[] = [];
        for (let index = 0; index < parts; index += 1) {
          const chunk = await store.getItemAsync(phoneIdentityPartKey(index));
          if (chunk === null) throw new PhoneIdentityError("mobile.identity.error.storage");
          chunks.push(chunk);
        }
        text = chunks.join("");
      } catch (error) {
        throw new PhoneIdentityError(phoneIdentityErrorKey(error));
      }
      try {
        return await read(text);
      } catch (error) {
        throw new PhoneIdentityError(phoneIdentityErrorKey(error));
      }
    },
    importText,
    async joinWithCode(text) {
      const joined = await joinRelayWithCode(text, { crypto, label: PHONE_ENROLL_LABEL });
      if (joined.bundleText === null) throw relayJoinError("key_unavailable");
      return importText(joined.bundleText);
    },
    async remove() {
      try {
        await remove();
      } catch {
        throw new PhoneIdentityError("mobile.identity.error.storage");
      }
    },
  };
}

export type PhoneJoinErrorKey = PhoneIdentityErrorKey | RelayJoinTextKey;

export function phoneJoinErrorKey(error: unknown): PhoneJoinErrorKey {
  return relayJoinErrorKey(error) ?? phoneIdentityErrorKey(error);
}

export function phoneIdentityErrorKey(error: unknown): PhoneIdentityErrorKey {
  if (error instanceof PhoneIdentityError) return error.key;
  if (!(error instanceof RelayIdentityError)) return "mobile.identity.error.storage";
  switch (error.code) {
    case "invalid_bundle":
      return "mobile.identity.error.invalid";
    case "unsupported_key":
      return "mobile.identity.error.keyUnsupported";
    case "key_mismatch":
      return "mobile.identity.error.keyMismatch";
    case "untrusted_chain":
      return "mobile.identity.error.untrusted";
    case "expired":
      return "mobile.identity.error.expired";
    case "not_yet_valid":
      return "mobile.identity.error.notYetValid";
    case "storage":
      return "mobile.identity.error.storage";
  }
}

function storedPartCount(saved: string): number | null {
  let value: unknown;
  try {
    value = JSON.parse(saved);
  } catch {
    return null;
  }
  if (!isDynamicRecord(value) || value.version !== STORED_VERSION) return null;
  const { parts } = value;
  return typeof parts === "number" && Number.isSafeInteger(parts) && parts > 0 && parts <= PHONE_IDENTITY_MAX_PARTS
    ? parts
    : null;
}

function storedBundleText(text: string): string {
  const bundle: RelayIdentityBundle | null = decodeRelayIdentityBundle(JSON.parse(text));
  if (!bundle) throw new PhoneIdentityError("mobile.identity.error.invalid");
  return JSON.stringify(bundle).replace(
    /[\u007f-\uffff]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

function splitParts(text: string): string[] {
  const parts: string[] = [];
  for (let start = 0; start < text.length; start += PHONE_IDENTITY_PART_LENGTH)
    parts.push(text.slice(start, start + PHONE_IDENTITY_PART_LENGTH));
  if (parts.length === 0 || parts.length > PHONE_IDENTITY_MAX_PARTS)
    throw new PhoneIdentityError("mobile.identity.error.invalid");
  return parts;
}
