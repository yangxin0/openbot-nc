import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/auth";

export const messages = {
  "error.auth.serviceUnavailable":
    "OpenBot n’a pas pu joindre le service de compte. Vérifiez que l’API fonctionne, puis réessayez.",
} as const satisfies PartialTranslation<typeof source>;
