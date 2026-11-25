import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/host";

export const messages = {
  "status.host.identityUpdated": "서버 ID를 업데이트했어요.",
  "status.host.signalLost": "지금은 다른 기기에서 이 OpenBot-NC에 연결할 수 없어요. 다시 연결하는 중이에요.",
  "status.host.stopping": "이 OpenBot-NC를 비공개로 전환하는 중…",
  "status.host.private": "이 OpenBot-NC는 비공개예요.",
  "status.host.removed": "이 OpenBot-NC가 계정에서 삭제되었어요. 공유하려면 다시 게시하세요.",
} as const satisfies PartialTranslation<typeof source>;
