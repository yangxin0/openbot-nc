import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/marketplace";

export const messages = {
  "error.marketplace.catalogLoadFailed": "Impossible de charger la marketplace. Réessayez.",
  "error.marketplace.templateUnreadable":
    "Impossible de lire cet agent partagé. Son propriétaire l’a peut-être supprimé.",
} as const satisfies PartialTranslation<typeof source>;
