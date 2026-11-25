import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/marketplace";

export const messages = {
  "error.marketplace.catalogLoadFailed": "No se pudo cargar Marketplace. Inténtalo de nuevo.",
  "error.marketplace.templateUnreadable":
    "No se pudo leer este agente compartido. Es posible que su propietario lo haya eliminado.",
} as const satisfies PartialTranslation<typeof source>;
