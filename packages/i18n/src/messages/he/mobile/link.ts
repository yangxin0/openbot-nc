import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/link";

export const messages = {
  "mobile.link.plugin.title": "פתיחת דף התוסף",
  "mobile.link.plugin.description": "הצגת התוסף הזה באתר של OpenBot.",
  "mobile.link.plugin.openFailed": "לא ניתן לפתוח את דף התוסף.",
  "mobile.link.plugin.view": "הצגת התוסף",
  "mobile.link.unavailable.title": "הקישור אינו זמין",
  "mobile.link.unavailable.description": "הקישור הזה אינו תקין, אינו זמין עוד או אינו נתמך בנייד.",
  "mobile.link.template.loading": "טוען סוכן…",
  "mobile.link.template.creator": "מאת {name}",
  "mobile.link.template.section.instructions": "הוראות",
  "mobile.link.template.section.skills": "מיומנויות",
  "mobile.link.template.section.noSkills": "אין מיומנויות.",
  "mobile.link.template.section.routines": "שגרות",
  "mobile.link.template.section.noRoutines": "אין שגרות.",
  "mobile.link.template.skill.local": "מיומנות מקומית (SKILL.md בלבד)",
  "mobile.link.template.skill.marketplace": "מיומנות מהחנות, גרסה {version}",
  "mobile.link.template.server.title": "הוספה לשרת",
  "mobile.link.template.server.footer": "מוצגים רק שרתים שבהם יש לך תפקיד של בעלים או מנהל.",
  "mobile.link.template.server.updateRequired": "יש לעדכן את OpenBot בשרת הזה כדי להוסיף סוכנים משותפים.",
  "mobile.link.template.server.none": "כדי להוסיף סוכן משותף צריך להיות בעלים או מנהל של שרת.",
  "mobile.link.template.install.action": "הוספת סוכן",
  "mobile.link.template.install.pending": "מוסיף…",
  "mobile.link.template.install.failed": "לא ניתן להוסיף את הסוכן.",
  "mobile.link.template.notFound.title": "הסוכן לא נמצא",
  "mobile.link.template.notFound.description": "הסוכן המשותף הזה אינו קיים, או שהיוצר שלו ביטל את הפרסום.",
  "mobile.link.template.error.title": "לא ניתן לטעון את הסוכן",
  "mobile.link.template.error.loadFailed": "לא ניתן לקרוא את הסוכן המשותף. יש לנסות שוב.",
  "mobile.link.template.error.unsupported":
    "השרת הזה לא יכול להוסיף סוכנים משותפים. יש לעדכן את OpenBot במחשב שמריץ את השרת.",
} as const satisfies PartialTranslation<typeof source>;
