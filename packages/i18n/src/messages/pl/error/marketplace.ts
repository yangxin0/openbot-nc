import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/marketplace";

export const messages = {
  "error.marketplace.catalogLoadFailed": "Nie udało się wczytać Marketplace. Spróbuj ponownie.",
  "error.marketplace.templateUnreadable":
    "Nie udało się odczytać tego udostępnionego agenta. Właściciel mógł go usunąć.",
} as const satisfies PartialTranslation<typeof source>;
