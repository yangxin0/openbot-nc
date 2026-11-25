import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/share";

export const messages = {
  "mobile.share.reading": "קורא את מה ששיתפת…",
  "mobile.share.readFailed": "OpenBot-NC לא הצליח לקרוא את מה ששיתפת. יש לשתף שוב.",
  "mobile.share.content": "לשיתוף",
  "mobile.share.footer": "הצ'אט נפתח כשהתוכן הזה בשדה ההודעה. דבר לא נשלח עד שתשלח.",
  "mobile.share.sendFooter": "OpenBot-NC שולח את זה לסוכן ואז פותח את הצ'אט.",
  "mobile.share.lastUsed": "בשימוש לאחרונה",
  "mobile.share.noAgents": "אין סוכנים",
  "mobile.share.chooseAgent": "בחירת סוכן",
  "mobile.share.action": "שיתוף עם {name}",
  "mobile.share.extension.send": "שליחה",
  "mobile.share.extension.message": "הוספת הודעה",
  "mobile.share.extension.sending": "שולח אל {name}…",
} as const satisfies PartialTranslation<typeof source>;
