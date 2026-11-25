import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/auth";

export const messages = {
  "error.auth.serviceUnavailable":
    "OpenBot no pudo acceder al servicio de cuentas. Comprueba que la API esté en funcionamiento e inténtalo de nuevo.",
} as const satisfies PartialTranslation<typeof source>;
