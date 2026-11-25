import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/auth";

export const messages = {
  "error.auth.serviceUnavailable":
    "OpenBot がアカウントサービスに接続できませんでした。API が動作していることを確認してから、再試行してください。",
  "error.auth.sessionTimeout":
    "OpenBot が時間内に応答しませんでした。インターネット接続を確認してから、もう一度お試しください。",
  "error.auth.deliveryTimeout":
    "OpenBot が時間内に配信を確認できませんでした。コードが後で届く場合があります。再送信する前に配信を確認してください。",
} as const satisfies PartialTranslation<typeof source>;
