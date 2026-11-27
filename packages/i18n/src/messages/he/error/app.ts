import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/app";

export const messages = {
  "error.app.externalLinkProtocol": "אפשר לפתוח בדפדפן החיצוני רק קישורי HTTP(S).",
  "error.app.notificationsUnsupported": "המערכת הזו אינה תומכת בהתראות שולחן עבודה.",
  "error.app.notificationSettingsMissing": "במערכת הזו אין דף הגדרות התראות.",
  "error.app.notReady": "OpenBot-NC אינו מוכן.",
  "error.app.macSecureStorageUnavailable": "האחסון המאובטח של macOS אינו זמין.",
  "error.app.secretStorageUnavailable": "אחסון הסודות של המערכת אינו זמין.",
  "error.app.windowBlockedBySecuritySoftware":
    "כנראה שתוכנת אבטחה במחשב הזה עצרה את החלון של OpenBot-NC. בתוכנת האבטחה, למשל Kaspersky, יש להוסיף את OpenBot-NC.exe כאפליקציה מהימנה. לאחר מכן יש להפעיל את OpenBot-NC שוב.",
} as const satisfies PartialTranslation<typeof source>;
