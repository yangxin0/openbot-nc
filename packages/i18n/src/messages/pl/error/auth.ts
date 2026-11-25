import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/auth";

export const messages = {
  "error.auth.serviceUnavailable":
    "OpenBot nie może połączyć się z usługą kont. Sprawdź, czy API działa, i spróbuj ponownie.",
  "error.auth.sessionTimeout":
    "OpenBot nie odpowiedział na czas. Sprawdź połączenie z internetem, a potem spróbuj ponownie.",
  "error.auth.deliveryTimeout":
    "OpenBot nie zdołał na czas potwierdzić dostarczenia. Kod może jeszcze dotrzeć; sprawdź skrzynkę, zanim wyślesz go ponownie.",
} as const satisfies PartialTranslation<typeof source>;
