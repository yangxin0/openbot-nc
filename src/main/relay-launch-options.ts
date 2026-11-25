import { resolve } from "node:path";

export const IMPORT_RELAY_IDENTITY_SWITCH = "import-relay-identity";
export const RELAY_HOSTING_SWITCH = "relay-hosting";

export interface RelayLaunchOptions {
  importIdentityPath: string | null;
  hosting: boolean | null;
}

interface RelayLaunchSwitches {
  options: RelayLaunchOptions;
  ignored: string[];
}

export const NO_RELAY_LAUNCH_OPTIONS: RelayLaunchOptions = { importIdentityPath: null, hosting: null };

export function readRelayLaunchSwitches(importIdentity: string, hosting: string): RelayLaunchSwitches {
  const path = importIdentity.trim();
  const choice = hosting.trim().toLowerCase();
  const ignored =
    choice === "" || choice === "on" || choice === "off"
      ? []
      : [`The switch --${RELAY_HOSTING_SWITCH} takes "on" or "off". OpenBot ignored it.`];
  return {
    options: {
      importIdentityPath: path === "" ? null : resolve(path),
      hosting: choice === "on" ? true : choice === "off" ? false : null,
    },
    ignored,
  };
}
