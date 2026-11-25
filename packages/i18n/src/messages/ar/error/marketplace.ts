import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/marketplace";

export const messages = {
  "error.marketplace.catalogLoadFailed": "تعذّر تحميل المتجر. حاول مرة أخرى.",
  "error.marketplace.templateUnreadable": "تعذّرت قراءة هذا الوكيل المشترك. ربما أزاله مالكه.",
} as const satisfies PartialTranslation<typeof source>;
