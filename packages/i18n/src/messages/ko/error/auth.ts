import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/auth";

export const messages = {
  "error.auth.serviceUnavailable":
    "OpenBot이 계정 서비스에 연결하지 못했어요. API가 실행 중인지 확인한 후 다시 시도해 주세요.",
  "error.auth.sessionTimeout": "OpenBot이 제시간에 응답하지 않았습니다. 인터넷 연결을 확인한 다음 다시 시도하세요.",
  "error.auth.deliveryTimeout":
    "OpenBot이 전송 여부를 제때 확인하지 못했어요. 코드가 도착할 수도 있으니, 다시 보내기 전에 전송 여부를 확인해 주세요.",
} as const satisfies PartialTranslation<typeof source>;
