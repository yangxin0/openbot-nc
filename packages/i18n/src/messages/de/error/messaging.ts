import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/messaging";

export const messages = {
  "error.messaging.notConnected": "Dieser Slack-Arbeitsbereich ist nicht verbunden.",
  "error.messaging.whatsappNotConnected": "Diese WhatsApp-Nummer ist nicht verbunden.",
  "error.messaging.whatsappUnsupported": "Dieser Computer kann keine Verbindung zu WhatsApp herstellen.",
  "error.messaging.whatsappTooManySenders": "Eine WhatsApp-Nummer kann bis zu 200 Kontakte und Gruppen zulassen.",
  "error.messaging.whatsappNumberNotFound":
    "Diese Nummer hat kein WhatsApp-Konto. Gib sie mit der Ländervorwahl ein, zum Beispiel +44 7700 900123.",
  "error.messaging.whatsappSenderNotFound": "Dieser Kontakt oder diese Gruppe ist nicht mehr in der Liste.",
  "error.messaging.whatsappRequestEnded":
    "Diese Anfrage ist beendet. Bitte die Person, erneut zu schreiben, um einen neuen Code zu bekommen.",
  "error.messaging.memoryLimit":
    "Ein verbundener Arbeitsbereich kann bis zu {limit} Erinnerungen haben. Lösche zuerst eine.",
} as const satisfies PartialTranslation<typeof source>;
