import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/messaging";

export const messages = {
  "error.messaging.notConnected": "この Slack ワークスペースは接続されていません。",
  "error.messaging.whatsappNotConnected": "この WhatsApp 番号は接続されていません。",
  "error.messaging.whatsappUnsupported": "このコンピューターは WhatsApp に接続できません。",
  "error.messaging.whatsappTooManySenders": "1 つの WhatsApp 番号で許可できる連絡先とグループは最大 200 件です。",
  "error.messaging.whatsappNumberNotFound":
    "この番号には WhatsApp アカウントがありません。+44 7700 900123 のように国番号を付けて入力してください。",
  "error.messaging.whatsappSenderNotFound": "この連絡先またはグループはリストにありません。",
  "error.messaging.whatsappRequestEnded":
    "このリクエストは終了しました。新しいコードを受け取るには、相手にもう一度書き込むよう依頼してください。",
  "error.messaging.memoryLimit":
    "接続したワークスペースに置けるメモリーは {limit} 個までです。先に 1 つ削除してください。",
} as const satisfies PartialTranslation<typeof source>;
