import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/auth";

export const messages = {
  "mobile.auth.logo.animate": "הנפשת הלוגו של OpenBot",
  "mobile.auth.logo.animateHint": "גורם ללוגו לקרוץ",
  "mobile.auth.scanner.connectFailed": "ההתחברות נכשלה",
  "mobile.auth.scanner.codeFailed": "לא ניתן להשתמש בקוד הזה",
  "mobile.auth.scanner.scanAgain": "סריקה חוזרת",
  "mobile.auth.scanner.connecting": "מחבר את הטלפון…",
  "mobile.auth.scanner.readingInvitation": "קורא את ההזמנה…",
  "mobile.auth.scanner.scanDesktop": "סריקת הקוד מהמחשב",
  "mobile.auth.scanner.scanInvitation": "סריקת קוד ההזמנה",
  "mobile.auth.scanner.verifying": "מאמת את הקוד החד-פעמי.",
  "mobile.auth.scanner.checkingServer": "בודק את זהות השרת.",
  "mobile.auth.scanner.keepCentered": "יש להחזיק את קוד ה-QR במרכז המסגרת.",
  "mobile.auth.scanner.connectFallback": "OpenBot לא הצליח לחבר את הטלפון הזה.",
  "mobile.auth.scanner.cameraFailed": "לא ניתן להפעיל את המצלמה. יש לנסות שוב.",
  "mobile.auth.camera.title": "נדרשת גישה למצלמה",
  "mobile.auth.camera.pairingReason": "OpenBot משתמש במצלמה רק כדי לסרוק את קוד ה-QR החד-פעמי שמוצג באפליקציית המחשב.",
  "mobile.auth.camera.invitationReason": "OpenBot משתמש במצלמה רק כדי לסרוק את קוד ה-QR של ההזמנה.",
  "mobile.auth.camera.blocked":
    "הגישה למצלמה חסומה. יש להפעיל אותה עבור OpenBot בהגדרות המכשיר ולחזור לכאן כדי לסרוק את הקוד.",
  "mobile.auth.camera.allow": "אישור גישה למצלמה",
  "mobile.auth.camera.openSettings": "פתיחת ההגדרות",
  "mobile.auth.error.signOutUnconfirmed": "לא ניתן היה לאשר את ההתנתקות. יש לבדוק את החיבור ולנסות שוב.",
} as const satisfies PartialTranslation<typeof source>;
