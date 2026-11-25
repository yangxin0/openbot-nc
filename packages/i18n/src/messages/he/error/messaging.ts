import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/messaging";

export const messages = {
  "error.messaging.notConnected": "סביבת העבודה הזו של Slack אינה מחוברת.",
  "error.messaging.whatsappNotConnected": "מספר ה-WhatsApp הזה אינו מחובר.",
  "error.messaging.whatsappUnsupported": "המחשב הזה אינו יכול להתחבר ל-WhatsApp.",
  "error.messaging.whatsappTooManySenders": "מספר WhatsApp יכול לאשר עד 200 אנשי קשר וקבוצות.",
  "error.messaging.whatsappNumberNotFound":
    "למספר הזה אין חשבון WhatsApp. יש להקליד אותו עם קידומת המדינה, למשל +44 7700 900123.",
  "error.messaging.whatsappSenderNotFound": "איש הקשר או הקבוצה האלה כבר לא ברשימה.",
  "error.messaging.whatsappRequestEnded": "הבקשה הזו הסתיימה. יש לבקש מהאדם לכתוב שוב כדי לקבל קוד חדש.",
  "error.messaging.memoryLimit": "לסביבת עבודה מחוברת יכולים להיות עד {limit} זיכרונות. יש למחוק אחד קודם.",
} as const satisfies PartialTranslation<typeof source>;
