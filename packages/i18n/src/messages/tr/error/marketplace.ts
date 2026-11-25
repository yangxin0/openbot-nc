import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/marketplace";

export const messages = {
  "error.marketplace.catalogLoadFailed": "Pazaryeri yüklenemedi. Tekrar deneyin.",
  "error.marketplace.templateUnreadable": "Bu paylaşılan ajan okunamadı. Sahibi kaldırmış olabilir.",
} as const satisfies PartialTranslation<typeof source>;
