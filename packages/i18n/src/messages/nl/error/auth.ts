import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/auth";

export const messages = {
  "error.auth.serviceUnavailable":
    "OpenBot kan de accountservice niet bereiken. Controleer of de API draait en probeer het opnieuw.",
  "error.auth.sessionTimeout":
    "OpenBot reageerde niet op tijd. Controleer je internetverbinding en probeer het daarna opnieuw.",
  "error.auth.deliveryTimeout":
    "OpenBot kon de bezorging niet op tijd bevestigen. De code kan nog aankomen; controleer de bezorging voordat je opnieuw verstuurt.",
} as const satisfies PartialTranslation<typeof source>;
