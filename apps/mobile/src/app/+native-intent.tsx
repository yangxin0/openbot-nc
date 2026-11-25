import { isMessagingInstallReturn } from "@/features/servers/model/connectors";
import { isIncomingShareLink } from "@/features/share/model/share-link";
import { holdShareSheet } from "@/features/share/model/share-sheet-opener";

export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }) {
  if (isMessagingInstallReturn(path)) return null;
  if (isIncomingShareLink(path)) {
    holdShareSheet();
    return "/incoming-share";
  }
  if (/^exps?:\/\//u.test(path)) return path;
  if (path.startsWith("/") && !path.startsWith("//")) return path;
  return initial ? "/" : null;
}
