import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/marketplace";

export const messages = {
  "error.marketplace.catalogLoadFailed": "无法加载市场，请重试。",
  "error.marketplace.templateUnreadable": "无法读取该共享助手，其所有者可能已将其移除。",
} as const satisfies PartialTranslation<typeof source>;
