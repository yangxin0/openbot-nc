import { APP_LINK_PROTOCOL } from "@openbot/contracts/app-identity";

export function isIncomingShareLink(path: string): boolean {
  try {
    const url = new URL(path);
    return url.protocol === APP_LINK_PROTOCOL && url.host === "expo-sharing";
  } catch {
    return false;
  }
}
