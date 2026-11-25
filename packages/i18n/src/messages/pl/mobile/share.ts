import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/share";

export const messages = {
  "mobile.share.reading": "Odczytywanie udostępnionej treści…",
  "mobile.share.readFailed": "OpenBot nie może odczytać udostępnionej treści. Udostępnij ją ponownie.",
  "mobile.share.content": "Do udostępnienia",
  "mobile.share.footer":
    "Czat otworzy się z tą treścią w polu wiadomości. Nic nie zostanie wysłane, dopóki jej nie wyślesz.",
  "mobile.share.sendFooter": "OpenBot wyśle to do agenta, a potem otworzy czat.",
  "mobile.share.lastUsed": "Ostatnio używany",
  "mobile.share.noAgents": "Brak agentów",
  "mobile.share.chooseAgent": "Wybierz agenta",
  "mobile.share.action": "Udostępnij: {name}",
  "mobile.share.extension.send": "Wyślij",
  "mobile.share.extension.message": "Dodaj wiadomość",
  "mobile.share.extension.sending": "Wysyłanie do {name}…",
} as const satisfies PartialTranslation<typeof source>;
