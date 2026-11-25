import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/marketplace";

export const messages = {
  "mobile.marketplace.app.slackTagline": "אזכורים והודעות ישירות ב-Slack",
  "mobile.marketplace.app.discordTagline": "אזכורים והודעות ישירות ב-Discord",
  "mobile.marketplace.app.telegramTagline": "קבוצות וצ'אטים ישירים ב-Telegram",
  "mobile.marketplace.app.whatsappTagline": "הצ'אט שלך והאנשים שאישרת ב-WhatsApp",
  "mobile.marketplace.app.githubTagline": "מאגרים, בעיות ו-pull requests",
  "mobile.marketplace.app.onePasswordTagline": "התחברות לאתרים עם פרטי כניסה משותפים",
  "mobile.marketplace.app.bitwardenTagline": "התחברות לאתרים עם פרטי כניסה מתיקייה משותפת",
  "mobile.marketplace.app.protonPassTagline": "התחברות לאתרים עם פרטי כניסה מכספת משותפת",
  "mobile.marketplace.error.signInUnsupported": "יש לעדכן את OpenBot בשרת כדי להתחבר לאפליקציות מהטלפון.",
  "mobile.marketplace.app.connect": "חיבור",
  "mobile.marketplace.app.signInIntro": "יש להתחבר בדף של האפליקציה. השרת שומר את ההתחברות, לא הטלפון הזה.",
  "mobile.marketplace.app.stepOpen": "יש לפתוח את דף ההתחברות של {name}.",
  "mobile.marketplace.app.stepAllow": "יש להתחבר ולאשר גישה.",
  "mobile.marketplace.app.stepBlank": "הדף האחרון לא נטען. זה תקין.",
  "mobile.marketplace.app.stepCopy": "יש ללחוץ על שורת הכתובת ולהעתיק את הכתובת המלאה.",
  "mobile.marketplace.app.stepPaste": "יש לחזור ל-OpenBot ולהדביק את הכתובת למטה.",
  "mobile.marketplace.app.connected": "מחובר",
  "mobile.marketplace.app.connectFailed": "האפליקציה לא התחברה.",
  "mobile.marketplace.app.waiting": "ממתין לדף ההתחברות…",
  "mobile.marketplace.app.openAgain": "פתיחת דף ההתחברות שוב",
  "mobile.marketplace.app.pasteLabel": "הכתובת אחרי ההתחברות",
  "mobile.marketplace.app.pasteInvalid": "הכתובת הזו אינה סוף ההתחברות הזו.",
  "mobile.marketplace.app.finishSignIn": "סיום ההתחברות",
  "mobile.marketplace.app.openFailed": "דף ההתחברות לא נפתח.",
} as const satisfies PartialTranslation<typeof source>;
