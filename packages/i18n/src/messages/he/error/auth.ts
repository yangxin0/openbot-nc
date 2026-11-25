import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/auth";

export const messages = {
  "error.auth.serviceUnavailable": "OpenBot לא הצליח להגיע לשירות החשבון. יש לוודא שה-API פועל ולנסות שוב.",
  "error.auth.companySignInFailed": "ההתחברות דרך החברה לא הסתיימה. יש לנסות שוב.",
  "error.auth.companySignInCancelled": "ההתחברות דרך החברה בוטלה.",
  "error.auth.companySignInTimeout": "ההתחברות דרך החברה לקחה זמן רב מדי. יש לפתוח שוב את דף ההתחברות.",
  "error.auth.companySignInRefused": "ההתחברות בחברה שלך בוטלה או נדחתה.",
  "error.auth.companySignInDomainMismatch": "לחשבון החברה יש אימייל בדומיין שאינו כלול בהגדרה.",
  "error.auth.companySignInAccountDisabled": "החברה שלך כיבתה את החשבון הזה. יש לפנות למנהל המערכת.",
  "error.auth.companySignInOff": "ההתחברות דרך החברה כבויה עבור האימייל הזה.",
  "error.auth.companySignInEmailMissing": "חשבון החברה שלך לא סיפק כתובת אימייל מאומתת.",
  "error.auth.companySignInUnavailable": "OpenBot הזה לא יכול לפתוח דפדפן להתחברות דרך החברה.",
  "error.auth.companySignInProviderRejected": "הספק לא קיבל את מזהה הלקוח או את הסוד.",
  "error.auth.companySignInTokenInvalid": "הספק החזיר התחברות ש-OpenBot לא יכול לבדוק.",
  "error.auth.companySignInProviderUnreachable": "ספק ההתחברות של החברה לא הגיב.",
  "error.auth.companySignInDomainTaken": "אחד מהדומיינים האלה כבר מתחבר דרך שרת אחר.",
} as const satisfies PartialTranslation<typeof source>;
