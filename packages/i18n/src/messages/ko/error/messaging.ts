import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/messaging";

export const messages = {
  "error.messaging.notConnected": "이 Slack 워크스페이스가 연결되어 있지 않아요.",
  "error.messaging.whatsappNotConnected": "이 WhatsApp 번호가 연결되어 있지 않아요.",
  "error.messaging.whatsappUnsupported": "이 컴퓨터는 WhatsApp에 연결할 수 없어요.",
  "error.messaging.whatsappTooManySenders": "WhatsApp 번호 하나에 연락처와 그룹을 최대 200개까지 허용할 수 있어요.",
  "error.messaging.whatsappNumberNotFound":
    "이 번호에는 WhatsApp 계정이 없습니다. +44 7700 900123처럼 국가 코드를 포함해 입력하세요.",
  "error.messaging.whatsappSenderNotFound": "이 연락처나 그룹은 더 이상 목록에 없습니다.",
  "error.messaging.whatsappRequestEnded":
    "이 요청은 끝났어요. 새 코드를 받으려면 상대에게 다시 메시지를 보내 달라고 하세요.",
  "error.messaging.memoryLimit":
    "연결된 워크스페이스는 메모리를 최대 {limit}개까지 가질 수 있어요. 먼저 하나를 삭제해 주세요.",
} as const satisfies PartialTranslation<typeof source>;
