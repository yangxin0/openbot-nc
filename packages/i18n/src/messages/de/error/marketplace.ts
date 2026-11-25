import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/marketplace";

export const messages = {
  "error.marketplace.catalogLoadFailed": "Der Marketplace konnte nicht geladen werden. Versuche es erneut.",
  "error.marketplace.templateUnreadable":
    "Dieser geteilte Agent konnte nicht gelesen werden. Sein Eigentümer hat ihn möglicherweise entfernt.",
} as const satisfies PartialTranslation<typeof source>;
