import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/auth";

export const messages = {
  "error.auth.serviceUnavailable":
    "OpenBot no pudo acceder al servicio de cuentas. Comprueba que la API esté en funcionamiento e inténtalo de nuevo.",
  "error.auth.sessionTimeout": "OpenBot no respondió a tiempo. Comprueba tu conexión a internet y vuelve a intentarlo.",
  "error.auth.deliveryTimeout":
    "OpenBot no pudo confirmar la entrega a tiempo. El código aún puede llegar; comprueba la entrega antes de enviarlo de nuevo.",
} as const satisfies PartialTranslation<typeof source>;
