import { isBoolean, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { PreferenceStore } from "./preference-file";

export const RELAY_HOSTING_PREFERENCE_FILE = "openbot-relay-hosting-v1.json";

interface RelayHostingPreference {
  enabled: boolean;
}

export type RelayHostingPreferenceStore = PreferenceStore<RelayHostingPreference>;

export function createRelayHostingPreferenceStore(path: string): RelayHostingPreferenceStore {
  return new PreferenceStore({
    path,
    defaultValue: { enabled: false },
    decode: (parsed) =>
      isDynamicRecord(parsed) && parsed.version === 1 && isBoolean(parsed.enabled) ? { enabled: parsed.enabled } : null,
  });
}
