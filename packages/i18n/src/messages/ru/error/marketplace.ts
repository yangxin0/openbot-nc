import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/marketplace";

export const messages = {
  "error.marketplace.catalogLoadFailed": "Не удалось загрузить каталог. Повторите попытку.",
  "error.marketplace.templateUnreadable": "Не удалось прочитать этого общего агента. Возможно, владелец удалил его.",
} as const satisfies PartialTranslation<typeof source>;
