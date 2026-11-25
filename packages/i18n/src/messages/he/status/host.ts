import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/host";

export const messages = {
  "status.host.identityUpdated": "זהות השרת עודכנה.",
  "status.host.signalLost": "מכשירים אחרים לא יכולים להגיע ל-OpenBot-NC הזה כרגע. הוא מתחבר שוב.",
  "status.host.stopping": "הופך את ה-OpenBot-NC הזה לפרטי…",
  "status.host.private": "ה-OpenBot-NC הזה פרטי.",
  "status.host.removed": "ה-OpenBot-NC הזה הוסר מהחשבון שלך. יש לפרסם אותו שוב כדי לשתף אותו.",
} as const satisfies PartialTranslation<typeof source>;
