import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/auth";

export const messages = {
  "error.auth.serviceUnavailable":
    "OpenBot konnte den Kontodienst nicht erreichen. Prüfe, ob die API läuft, und versuche es erneut.",
  "error.auth.sessionTimeout":
    "OpenBot hat nicht rechtzeitig geantwortet. Prüfe deine Internetverbindung und versuche es dann erneut.",
  "error.auth.deliveryTimeout":
    "OpenBot konnte die Zustellung nicht rechtzeitig bestätigen. Der Code kann noch eintreffen. Prüfe die Zustellung, bevor du ihn erneut sendest.",
} as const satisfies PartialTranslation<typeof source>;
