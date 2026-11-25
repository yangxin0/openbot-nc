import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/messaging";

export const messages = {
  "error.messaging.notConnected": "Questo workspace Slack non è collegato.",
  "error.messaging.whatsappNotConnected": "Questo numero WhatsApp non è collegato.",
  "error.messaging.whatsappUnsupported": "Questo computer non può collegarsi a WhatsApp.",
  "error.messaging.whatsappTooManySenders": "Un numero WhatsApp può autorizzare al massimo 200 contatti e gruppi.",
  "error.messaging.whatsappNumberNotFound":
    "Questo numero non ha un account WhatsApp. Scrivilo con il prefisso internazionale, ad esempio +44 7700 900123.",
  "error.messaging.whatsappSenderNotFound": "Questo contatto o gruppo non è più nell'elenco.",
  "error.messaging.whatsappRequestEnded":
    "Questa richiesta è terminata. Chiedi alla persona di scrivere di nuovo per ricevere un nuovo codice.",
  "error.messaging.memoryLimit": "Un workspace collegato può avere al massimo {limit} memorie. Eliminane prima una.",
} as const satisfies PartialTranslation<typeof source>;
