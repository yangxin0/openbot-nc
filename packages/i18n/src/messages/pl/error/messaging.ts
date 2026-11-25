import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/messaging";

export const messages = {
  "error.messaging.notConnected": "Ten obszar roboczy Slack nie jest połączony.",
  "error.messaging.whatsappNotConnected": "Ten numer WhatsApp nie jest połączony.",
  "error.messaging.whatsappUnsupported": "Ten komputer nie może połączyć się z WhatsApp.",
  "error.messaging.whatsappTooManySenders": "Numer WhatsApp może dopuścić maksymalnie 200 kontaktów i grup.",
  "error.messaging.whatsappNumberNotFound":
    "Ten numer nie ma konta WhatsApp. Wpisz go z kodem kraju, np. +44 7700 900123.",
  "error.messaging.whatsappSenderNotFound": "Tego kontaktu lub grupy nie ma już na liście.",
  "error.messaging.whatsappRequestEnded": "Ta prośba wygasła. Poproś tę osobę, aby napisała ponownie po nowy kod.",
  "error.messaging.memoryLimit":
    "Połączony obszar roboczy może mieć maksymalnie {limit} wspomnień. Najpierw usuń jedno.",
} as const satisfies PartialTranslation<typeof source>;
