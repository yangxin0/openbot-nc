import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/marketplace";

export const messages = {
  "error.marketplace.catalogLoadFailed": "לא ניתן לטעון את החנות. יש לנסות שוב.",
  "error.marketplace.templateUnreadable": "לא ניתן לקרוא את הסוכן המשותף. ייתכן שהבעלים הסיר אותו.",
} as const satisfies PartialTranslation<typeof source>;
