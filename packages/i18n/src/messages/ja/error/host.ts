import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/host";

export const messages = {
  "error.host.nameBeforePublish": "公開する前に、この OpenBot に名前を付けてください。",
  "error.host.publishBeforeInvite": "招待を作成する前に、この OpenBot を公開してください。",
  "error.host.teamAccessUnavailable": "チームへのアクセスを利用できません。",
  "error.host.ownerIdentityUnavailable": "ホストのオーナーの ID を利用できません。",
  "error.host.publishFailed": "この OpenBot を公開できませんでした。",
  "error.host.noServer": "このコンピューターには変更できるサーバーがありません。",
  "error.host.identityLocalOnly": "サーバーの名前とロゴは、サーバーを実行しているコンピューターでのみ変更できます。",
  "error.host.timezoneInvalid": "このタイムゾーンは不明です。",
  "error.host.turnLimitInvalid": "このスレッド数の上限は無効です。",
  "error.host.maintenanceInterrupted":
    "ホストのメンテナンスが中断されました。再試行する前に、アプリケーションを確認し、ホストの状態をリセットしてください。",
  "error.host.updateFailed":
    "{phase} の間にホストの更新に失敗しました。状態をリセットする前に、バンドルの所有者、署名、テナントの状態、ディスクの空き容量を確認してください。",
  "error.host.tenantsNotIdle": "2 時間以内に、テナントが 5 分間アイドル状態を維持しませんでした。",
  "error.host.tenantShutdownTimeout":
    "テナントの停止がタイムアウトしました。アプリケーションの置き換えは開始されていません。",
  "error.host.tenantHealthMissing":
    "再起動後のテナントの正常性レポートがないか、異常です。次の更新の前に、テナントのセッションを確認してください。",
  "error.host.personalityInvalid": "この応答スタイルは不明です。",
} as const satisfies PartialTranslation<typeof source>;
