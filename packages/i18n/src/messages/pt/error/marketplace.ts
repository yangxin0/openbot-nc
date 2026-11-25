import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/marketplace";

export const messages = {
  "error.marketplace.catalogLoadFailed": "Não foi possível carregar a loja. Tente novamente.",
  "error.marketplace.templateUnreadable":
    "Não foi possível ler este agente compartilhado. O proprietário pode tê-lo removido.",
} as const satisfies PartialTranslation<typeof source>;
