import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/marketplace";

export const messages = {
  "error.marketplace.catalogLoadFailed": "Non è stato possibile caricare il Marketplace. Riprova.",
  "error.marketplace.templateUnreadable":
    "Non è stato possibile leggere questo agente condiviso. Il suo proprietario potrebbe averlo rimosso.",
} as const satisfies PartialTranslation<typeof source>;
