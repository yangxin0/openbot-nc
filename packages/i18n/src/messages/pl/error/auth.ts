import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/auth";

export const messages = {
  "error.auth.serviceUnavailable":
    "OpenBot nie może połączyć się z usługą kont. Sprawdź, czy API działa, i spróbuj ponownie.",
} as const satisfies PartialTranslation<typeof source>;
