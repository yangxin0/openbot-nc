import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/messaging";

export const messages = {
  "error.messaging.notConnected": "Deze Slack-werkruimte is niet verbonden.",
  "error.messaging.whatsappNotConnected": "Dit WhatsApp-nummer is niet verbonden.",
  "error.messaging.whatsappUnsupported": "Deze computer kan geen verbinding maken met WhatsApp.",
  "error.messaging.whatsappTooManySenders": "Een WhatsApp-nummer kan maximaal 200 contacten en groepen toestaan.",
  "error.messaging.whatsappNumberNotFound":
    "Dit nummer heeft geen WhatsApp-account. Typ het met de landcode, zoals +44 7700 900123.",
  "error.messaging.whatsappSenderNotFound": "Dit contact of deze groep staat niet meer in de lijst.",
  "error.messaging.whatsappRequestEnded":
    "Dit verzoek is beëindigd. Vraag de persoon opnieuw te schrijven voor een nieuwe code.",
  "error.messaging.memoryLimit":
    "Een verbonden werkruimte kan maximaal {limit} herinneringen hebben. Verwijder er eerst een.",
} as const satisfies PartialTranslation<typeof source>;
