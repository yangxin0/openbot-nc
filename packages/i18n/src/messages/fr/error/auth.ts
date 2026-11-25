import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/auth";

export const messages = {
  "error.auth.serviceUnavailable":
    "OpenBot n’a pas pu joindre le service de compte. Vérifiez que l’API fonctionne, puis réessayez.",
  "error.auth.sessionTimeout": "OpenBot n’a pas répondu à temps. Vérifiez votre connexion internet, puis réessayez.",
  "error.auth.deliveryTimeout":
    "OpenBot n’a pas pu confirmer l’envoi à temps. Le code peut encore arriver ; vérifiez sa réception avant de le renvoyer.",
} as const satisfies PartialTranslation<typeof source>;
