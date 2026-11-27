import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/messaging";

export const messages = {
  "status.messaging.working": "עובד על זה…",
  "status.messaging.queued": "בהמתנה לסיום בקשה קודמת. התשובה תגיע לכאן.",
  "status.messaging.busy": "יותר מדי בקשות ממתינות. אפשר לנסות שוב מאוחר יותר.",
  "status.messaging.failed": "OpenBot-NC לא הצליח לסיים את הבקשה הזו. הפרטים נמצאים במארח OpenBot-NC.",
  "status.messaging.noAnswer": "OpenBot-NC סיים בלי תשובה כתובה.",
  "status.messaging.noAgent": "עדיין אין סוכן שיכול לענות כאן. יש להוסיף את Slack Orchestrator ב-OpenBot-NC.",
  "status.messaging.delegated": "חבר צוות עובד על זה. התשובה תגיע לכאן.",
  "status.messaging.stopped": "נעצר.",
  "status.messaging.stop": "עצירה",
  "status.messaging.approvalTitle": "OpenBot-NC מבקש אישור כדי להמשיך.",
  "status.messaging.approvalTitleTeammate": "חבר הצוות {agent} מבקש אישור כדי להמשיך.",
  "status.messaging.approvalCommand": "הרצת פקודה",
  "status.messaging.approvalFileChange": "שינוי קבצים",
  "status.messaging.approvalPermissions": "קבלת הרשאות נוספות",
  "status.messaging.approve": "אישור",
  "status.messaging.deny": "דחייה",
  "status.messaging.approvedBy": "אושר על ידי {user}.",
  "status.messaging.deniedBy": "נדחה על ידי {user}.",
  "status.messaging.answeredOnHost": "נענה במארח OpenBot-NC.",
  "status.messaging.requestInactive": "הבקשה הזו כבר אינה פעילה.",
  "status.messaging.onlyRequester": "רק {user} יכול לבצע זאת. אפשר גם לענות במארח OpenBot-NC.",
  "status.messaging.hostOnly": "רק מארח OpenBot-NC יכול לענות על הבקשה הזו.",
  "status.messaging.filesSkipped": "חלק מהקבצים לא נשלחו: {names}.",
  "status.messaging.integrationsSection": "שילובים",
  "status.messaging.whatsappNoAgent":
    "עדיין אין סוכן שיכול לענות כאן. יש להוסיף את WhatsApp Orchestrator ב-OpenBot-NC.",
  "status.messaging.whatsappApprovalMenu": "יש להשיב 1 לאישור או 2 לדחייה.",
  "status.messaging.whatsappStopMenu": "יש להשיב stop כדי לעצור.",
  "status.messaging.whatsappPairingCode":
    "המספר הזה עונה רק לאנשים שהבעלים שלו אישר. יש לתת לבעלים את הקוד הזה: {code}",
  "status.messaging.whatsappPairingApproved": "אפשר לשלוח עכשיו בקשות למספר הזה.",
  "status.messaging.whatsappOwnChat": "הודעה לעצמך",
  "status.messaging.whatsappWelcomeOwn":
    "👋 *OpenBot-NC מחובר*\n\nאפשר לכתוב כאן כדי לשאול את הסוכנים. WhatsApp Orchestrator עונה, או מעביר את העבודה לסוכן המתאים.\n\nיש לשלוח *stop* כדי לעצור בקשה.",
  "status.messaging.whatsappWelcomeDedicated":
    "👋 *OpenBot-NC מחובר*\n\nהאנשים שאישרת ב-OpenBot-NC יכולים עכשיו לכתוב למספר הזה. אדם חדש מקבל קוד: יש לאשר אותו ב-OpenBot-NC תחת בקשות.\n\nיש לשלוח *stop* כדי לעצור בקשה.",
  "status.messaging.whatsappOtherOpenBot":
    "OpenBot-NC נוסף מקושר למספר הוואטסאפ הזה, ולכן ייתכן שיתקבלו שתי תשובות. כדי לתקן זאת, יש לפתוח את 'מכשירים מקושרים' בוואטסאפ בטלפון ולהתנתק מה-OpenBot-NC שאינו בשימוש.",
  "status.messaging.whatsappPaused":
    "OpenBot-NC הפסיק לענות כאן למשך 10 דקות: הגיעו יותר מדי הודעות בזמן קצר. אם OpenBot-NC נוסף מקושר למספר הזה, יש לפתוח את 'מכשירים מקושרים' בוואטסאפ בטלפון ולהתנתק מה-OpenBot-NC שאינו בשימוש.",
  "status.messaging.whatsappNotDelivered": "וואטסאפ לא קיבל את התשובה הזו, ולכן האדם לא קיבל אותה.",
  "status.messaging.whatsappPartlyDelivered": "וואטסאפ לא קיבל את כל התשובה הזו, ולכן האדם קיבל רק חלק ממנה.",
  "status.messaging.whatsappOrchestratorName": "WhatsApp Orchestrator",
  "status.messaging.whatsappOrchestratorTitle": "עונה ב-WhatsApp ושואל את הצוות",
} as const satisfies PartialTranslation<typeof source>;
