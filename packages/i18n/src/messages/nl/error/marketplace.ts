import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/marketplace";

export const messages = {
  "error.marketplace.catalogLoadFailed": "De marktplaats kon niet worden geladen. Probeer het opnieuw.",
  "error.marketplace.templateUnreadable":
    "Deze gedeelde agent kon niet worden gelezen. De eigenaar heeft hem misschien verwijderd.",
} as const satisfies PartialTranslation<typeof source>;
