import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/auth";

export const messages = {
  "error.auth.serviceUnavailable":
    "OpenBot konnte den Kontodienst nicht erreichen. Prüfe, ob die API läuft, und versuche es erneut.",
} as const satisfies PartialTranslation<typeof source>;
