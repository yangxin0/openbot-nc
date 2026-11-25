import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/startup";

export const messages = {
  "startup.failedTitle": "OpenBot-NC לא הצליח להיפתח",
  "startup.failedBody":
    "{message}\n\nהנתונים המקומיים שלך לא אופסו ולא נדרסו. בצעדי השחזור שבמדריך לפתרון בעיות אפשר לקרוא איך להמשיך.",
  "startup.archiveChangedTitle": "קובצי OpenBot-NC שונו",
  "startup.archiveChangedBody":
    "תוכנה אחרת שינתה את קובץ OpenBot-NC app.asar. OpenBot-NC פועל כעת, אך לא ייפתח לאחר היציאה ממנו.\n\nכדי לתקן את OpenBot-NC, יש להתקין אותו מחדש. הנתונים המקומיים נשמרים.",
  "startup.filesDamagedBody":
    "חלק מקובצי OpenBot-NC פגומים או חסרים.\n\nכדי לתקן את OpenBot-NC, יש להתקין אותו מחדש. הנתונים המקומיים נשמרים.",
  "startup.newerDataTitle": "התקנת OpenBot-NC העדכני ביותר",
  "startup.newerDataBody":
    "גרסה חדשה יותר של OpenBot-NC שמרה את הנתונים שלך, והגרסה הזו ({version}) אינה יכולה לפתוח אותם. יש להתקין את הגרסה האחרונה כדי לפתוח את הנתונים.\n\nהנתונים המקומיים שלך לא אופסו ולא נדרסו.",
  "startup.newerDataQuit": "יציאה",
  "startup.newerDataLoopTitle": "הגרסה האחרונה של OpenBot-NC לא נפתחה",
  "startup.newerDataLoopBody":
    "גרסה חדשה יותר של OpenBot-NC שמרה את הנתונים שלך, והגרסה הזו ({version}) אינה יכולה לפתוח אותם. OpenBot-NC {loopVersion} נעצר לפני שנפתח כמה פעמים ברצף, ולכן הוא לא יותקן שוב.\n\nיש להתקין גרסה חדשה יותר מ-{loopVersion} כשתהיה זמינה. לקבלת עזרה, יש לפתוח את המדריך.\n\nהנתונים המקומיים שלך לא אופסו ולא נדרסו.",
  "startup.recoveryWindowTitle": "שחזור OpenBot-NC",
  "startup.recoveryTitle": "OpenBot-NC לא נפתח",
  "startup.recoveryBody": {
    one: "OpenBot-NC {version} נעצר לפני שנפתח, פעם אחת ({count}). הנתונים המקומיים שלך לא אופסו ולא נדרסו.",
    two: "OpenBot-NC {version} נעצר לפני שנפתח, פעמיים ברצף ({count}). הנתונים המקומיים שלך לא אופסו ולא נדרסו.",
    other: "OpenBot-NC {version} נעצר לפני שנפתח, {count} פעמים ברצף. הנתונים המקומיים שלך לא אופסו ולא נדרסו.",
  },
  "startup.recoveryHint":
    "נסה שוב, או התקן את הגרסה האחרונה שנפתחה. לקבלת עזרה, ייצא את נתוני האבחון ושלח את הקובץ עם הדיווח שלך.",
  "startup.recoveryHintLatest":
    "OpenBot-NC לא מצא גרסה קודמת שיכולה לפתוח את הנתונים שלך. נסה שוב, או התקן את הגרסה האחרונה. לקבלת עזרה, ייצא את נתוני האבחון ושלח את הקובץ עם הדיווח שלך.",
  "startup.recoveryRetry": "נסה שוב",
  "startup.recoveryExportDiagnostics": "ייצוא אבחון",
  "startup.recoveryOpenDataFolder": "פתיחת תיקיית הנתונים",
  "startup.recoveryQuit": "יציאה",
  "startup.recoveryDiagnosticsSaved": "קובץ האבחון נשמר.",
  "startup.recoveryActionFailed": "OpenBot-NC לא הצליח לבצע את הפעולה הזו.",
} as const satisfies PartialTranslation<typeof source>;
