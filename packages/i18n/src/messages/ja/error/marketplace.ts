import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/marketplace";

export const messages = {
  "error.marketplace.catalogLoadFailed": "マーケットプレイスを読み込めませんでした。もう一度お試しください。",
  "error.marketplace.templateUnreadable":
    "この共有エージェントを読み取れませんでした。所有者が削除した可能性があります。",
} as const satisfies PartialTranslation<typeof source>;
