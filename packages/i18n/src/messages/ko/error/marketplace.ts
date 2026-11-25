import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/marketplace";

export const messages = {
  "error.marketplace.catalogLoadFailed": "마켓플레이스를 불러오지 못했어요. 다시 시도해 주세요.",
  "error.marketplace.templateUnreadable": "공유된 에이전트를 읽지 못했어요. 소유자가 삭제했을 수 있어요.",
} as const satisfies PartialTranslation<typeof source>;
