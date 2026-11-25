import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/auth";

export const messages = {
  "error.auth.serviceUnavailable":
    "OpenBot kan de accountservice niet bereiken. Controleer of de API draait en probeer het opnieuw.",
} as const satisfies PartialTranslation<typeof source>;
