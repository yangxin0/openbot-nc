import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/app";

export const messages = {
  "error.app.externalLinkProtocol": "外部ブラウザーで開けるのは HTTP(S) リンクのみです。",
  "error.app.notificationsUnsupported": "このシステムはデスクトップ通知に対応していません。",
  "error.app.notificationSettingsMissing": "このシステムには通知設定のページがありません。",
  "error.app.notReady": "OpenBot-NC の準備ができていません。",
  "error.app.macSecureStorageUnavailable": "macOS のセキュアストレージを利用できません。",
  "error.app.secretStorageUnavailable": "システムのシークレットストレージを利用できません。",
  "error.app.windowBlockedBySecuritySoftware":
    "このコンピューターのセキュリティソフトが OpenBot-NC のウィンドウを停止した可能性があります。セキュリティソフト（Kaspersky など）で OpenBot-NC.exe を信頼するアプリケーションに追加してから、OpenBot-NC をもう一度起動してください。",
} as const satisfies PartialTranslation<typeof source>;
