import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/update";

export const messages = {
  "error.update.unsupported": "עדכונים זמינים בגרסאות שולחן עבודה מותקנות.",
  "error.update.noSelfUpdate": "הגרסה הזו לא מתעדכנת בעצמה. כדי לעדכן את OpenBot-NC, התקינו גרסה חדשה יותר באופן ידני.",
  "error.update.notReady": "עדכון אינו מוכן להתקנה.",
  "error.update.restartFailed": "OpenBot-NC לא הצליח להפעיל את עצמו מחדש כדי להתקין את העדכון.",
  "error.update.downloadStalled": "הורדת העדכון הפסיקה להגיב. יש לנסות שוב.",
  "error.update.installFailed": "לא ניתן להתקין את העדכון. יש לצאת מ-OpenBot-NC, לפתוח אותו מחדש ולנסות שוב.",
  "error.update.notInstalled": "ההפעלה מחדש האחרונה לא התקינה את העדכון. יש להפעיל מחדש כדי לנסות שוב.",
  "error.update.downloadFailed": "לא ניתן להוריד את העדכון. יש לנסות שוב.",
  "error.update.signatureNotConfirmed":
    "OpenBot-NC לא הצליח לאמת את העדכון. יש לנסות שוב. אם השגיאה נמשכת, יש להתקין את OpenBot-NC מחדש מהמקום שממנו קיבלת אותו.",
  "error.update.checkFailed": "לא ניתן לבדוק אם יש עדכונים. יש לנסות שוב.",
  "error.update.checkStalled": "בדיקת העדכונים הפסיקה להגיב. יש לנסות שוב.",
  "error.update.checkOffline": "לא ניתן להתחבר לשירות העדכונים. יש לבדוק את חיבור האינטרנט ולנסות שוב.",
  "error.update.checkUnavailable": "שירות העדכונים לא הגיב. OpenBot-NC ינסה שוב מעצמו בעוד כמה דקות.",
  "error.update.checkNoRelease": "לא נמצא עדכון שפורסם עבור הפלטפורמה הזו. OpenBot-NC ינסה שוב מעצמו בעוד כמה דקות.",
  "error.update.managedByNix": "Nix מתקין עדכונים עבור העותק הזה של OpenBot-NC. יש לעדכן אותו באמצעות Nix.",
  "error.update.managedByHost": "עדכונים ב-Mac הזה מותקנים על ידי המארח. העדכון נשאר מוכן עד להרצת התחזוקה של המארח.",
  "error.update.siblingSession":
    "סשן אחר של OpenBot-NC עדיין פועל מהאפליקציה הזו. יש לעצור את OpenBot-NC בכל חשבון משתמש אחר ב-macOS ואז להתקין את העדכון שוב.",
  "error.update.siblingSessionSameAccount":
    "תהליך אחר של OpenBot-NC עדיין פועל בחשבון המשתמש הזה. יש לסגור אותו ואז להתקין את העדכון שוב.",
  "error.update.siblingCheckFailed": "לא ניתן לאמת סשנים אחרים של OpenBot-NC. יש לנסות שוב לפני ההתקנה.",
  "error.update.readOnlyLocation":
    "OpenBot-NC לא יכול להתקין עדכונים מהמיקום הזה. צא מ-OpenBot-NC. ב-Finder, גרור את OpenBot-NC לתיקייה 'יישומים' (אם הוא כבר שם, גרור אותו החוצה ובחזרה פנימה). לאחר מכן פתח את OpenBot-NC והתקן את העדכון שוב.",
  "error.update.appImageMissing":
    "OpenBot-NC לא יכול להתקין את העדכון כי קובץ ה-AppImage שלו הועבר, שונה שמו או הוחלף. יש לצאת מ-OpenBot-NC ואז לפתוח שוב את קובץ ה-AppImage.",
  "error.update.appImageReadOnly":
    "OpenBot-NC לא יכול להתקין עדכונים בתיקייה של קובץ ה-AppImage שלו. יש לצאת מ-OpenBot-NC, להעביר את קובץ ה-AppImage לתיקייה בתוך תיקיית הבית, ואז לפתוח אותו ולהתקין שוב את העדכון.",
  "error.update.remoteDisabled": "עדכונים ממנהלי שרת כבויים במחשב הזה.",
  "error.update.restartStarted": "OpenBot-NC כבר מופעל מחדש כדי להתקין את העדכון.",
  "error.update.alreadyRestarting": "OpenBot-NC כבר מופעל מחדש.",
} as const satisfies PartialTranslation<typeof source>;
