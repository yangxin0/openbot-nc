import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/host";

export const messages = {
  "status.host.identityUpdated": "サーバーの ID を更新しました。",
  "status.host.signalLost": "現在、ほかのデバイスからこの OpenBot-NC に接続できません。再接続しています。",
  "status.host.stopping": "この OpenBot-NC を非公開にしています…",
  "status.host.private": "この OpenBot-NC は非公開です。",
  "status.host.removed": "この OpenBot-NC はアカウントから削除されました。共有するには、もう一度公開してください。",
} as const satisfies PartialTranslation<typeof source>;
