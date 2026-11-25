import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/auth";

export const messages = {
  "error.auth.serviceUnavailable":
    "OpenBot이 계정 서비스에 연결하지 못했어요. API가 실행 중인지 확인한 후 다시 시도해 주세요.",
} as const satisfies PartialTranslation<typeof source>;
