import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/startup";

export const messages = {
  "startup.failedTitle": "OpenBot-NC を起動できませんでした",
  "startup.failedBody":
    "{message}\n\nお使いのデータは初期化も上書きもされていません。復旧の手順はトラブルシューティングガイドをご覧ください。",
  "startup.archiveChangedTitle": "OpenBot-NC のファイルが変更されました",
  "startup.archiveChangedBody":
    "別のプログラムが OpenBot-NC のファイル app.asar を変更しました。OpenBot-NC は今は動作していますが、終了すると次は起動しません。\n\n修復するには、OpenBot-NC をもう一度インストールしてください。ローカルのデータはそのまま残ります。",
  "startup.filesDamagedBody":
    "OpenBot-NC の一部のファイルが破損しているか、見つかりません。\n\n修復するには、OpenBot-NC をもう一度インストールしてください。ローカルのデータはそのまま残ります。",
  "startup.newerDataTitle": "最新の OpenBot-NC をインストールしてください",
  "startup.newerDataBody":
    "新しいバージョンの OpenBot-NC がデータを保存したため、このバージョン ({version}) では開けません。データを開くには最新バージョンをインストールしてください。\n\nローカルデータはリセットも上書きもされていません。",
  "startup.newerDataQuit": "終了",
  "startup.newerDataLoopTitle": "最新の OpenBot-NC が開きませんでした",
  "startup.newerDataLoopBody":
    "新しいバージョンの OpenBot-NC がデータを保存したため、このバージョン ({version}) では開けません。OpenBot-NC {loopVersion} は開く前に何度も続けて停止したため、再インストールしません。\n\n{loopVersion} より新しいバージョンが公開されたら、それをインストールしてください。サポートが必要な場合は、ガイドを開いてください。\n\nローカルデータはリセットも上書きもされていません。",
  "startup.recoveryWindowTitle": "OpenBot-NC の復旧",
  "startup.recoveryTitle": "OpenBot-NC を開けませんでした",
  "startup.recoveryBody": {
    other:
      "OpenBot-NC {version} は開く前に {count} 回続けて停止しました。ローカルデータはリセットも上書きもされていません。",
  },
  "startup.recoveryHint":
    "もう一度試すか、最後に開けたバージョンをインストールしてください。サポートが必要な場合は、診断情報を書き出し、そのファイルをレポートと一緒に送ってください。",
  "startup.recoveryHintLatest":
    "データを開ける以前のバージョンが見つかりませんでした。もう一度試すか、最新バージョンをインストールしてください。サポートが必要な場合は、診断情報を書き出し、そのファイルをレポートと一緒に送ってください。",
  "startup.recoveryRetry": "再試行",
  "startup.recoveryExportDiagnostics": "診断情報を書き出す",
  "startup.recoveryOpenDataFolder": "データフォルダを開く",
  "startup.recoveryQuit": "終了",
  "startup.recoveryDiagnosticsSaved": "診断ファイルを保存しました。",
  "startup.recoveryActionFailed": "OpenBot-NC はこの操作を実行できませんでした。",
} as const satisfies PartialTranslation<typeof source>;
