import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/auth";

export const messages = {
  "error.auth.serviceUnavailable":
    "OpenBot non è riuscito a raggiungere il servizio account. Controlla che l'API sia in esecuzione, poi riprova.",
  "error.auth.sessionTimeout": "OpenBot non ha risposto in tempo. Controlla la connessione a internet, poi riprova.",
  "error.auth.deliveryTimeout":
    "OpenBot non ha potuto confermare la consegna in tempo. Il codice potrebbe comunque arrivare: controlla la consegna prima di inviarlo di nuovo.",
} as const satisfies PartialTranslation<typeof source>;
