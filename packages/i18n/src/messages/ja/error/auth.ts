import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/auth";

export const messages = {
  "error.auth.serviceUnavailable":
    "OpenBot がアカウントサービスに接続できませんでした。API が動作していることを確認してから、再試行してください。",
} as const satisfies PartialTranslation<typeof source>;
