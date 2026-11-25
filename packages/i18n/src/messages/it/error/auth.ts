import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/auth";

export const messages = {
  "error.auth.serviceUnavailable":
    "OpenBot non è riuscito a raggiungere il servizio account. Controlla che l'API sia in esecuzione, poi riprova.",
} as const satisfies PartialTranslation<typeof source>;
