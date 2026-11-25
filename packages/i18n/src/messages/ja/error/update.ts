import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/update";

export const messages = {
  "error.update.unsupported": "アップデートはインストール済みのデスクトップ版でご利用いただけます。",
  "error.update.noSelfUpdate":
    "このビルドは自動で更新されません。OpenBot-NC を更新するには、新しいビルドを手動でインストールしてください。",
  "error.update.notReady": "インストールできるアップデートがありません。",
  "error.update.restartFailed": "アップデートをインストールするための再起動ができませんでした。",
  "error.update.downloadStalled": "アップデートのダウンロードが応答しなくなりました。もう一度お試しください。",
  "error.update.installFailed":
    "アップデートをインストールできませんでした。OpenBot-NC を終了してから開き直し、もう一度お試しください。",
  "error.update.notInstalled":
    "前回の再起動ではアップデートがインストールされませんでした。もう一度再起動してお試しください。",
  "error.update.downloadFailed": "アップデートをダウンロードできませんでした。もう一度お試しください。",
  "error.update.signatureNotConfirmed":
    "OpenBot-NC はアップデートを検証できませんでした。もう一度お試しください。エラーが続く場合は、入手元から OpenBot-NC をもう一度インストールしてください。",
  "error.update.checkFailed": "アップデートを確認できませんでした。もう一度お試しください。",
  "error.update.checkStalled": "アップデートの確認が応答しなくなりました。もう一度お試しください。",
  "error.update.checkOffline":
    "アップデートサービスに接続できませんでした。インターネット接続を確認してから、もう一度お試しください。",
  "error.update.checkUnavailable":
    "アップデートサービスから応答がありませんでした。数分後に OpenBot-NC が自動でもう一度試します。",
  "error.update.checkNoRelease":
    "このプラットフォーム向けに公開されたアップデートは見つかりませんでした。数分後に OpenBot-NC が自動でもう一度試します。",
  "error.update.managedByNix": "この OpenBot-NC のアップデートは Nix がインストールします。Nix で更新してください。",
  "error.update.managedByHost":
    "この Mac のアップデートはホストがインストールします。ホストのメンテナンスが実行されるまで、アップデートは準備済みのままです。",
  "error.update.siblingSession":
    "このアプリケーションから別の OpenBot-NC セッションがまだ実行中です。先に他のすべての macOS ユーザーアカウントで OpenBot-NC を終了してから、アップデートをもう一度インストールしてください。",
  "error.update.siblingSessionSameAccount":
    "このユーザーアカウントで別の OpenBot-NC プロセスがまだ実行中です。それを終了してから、もう一度アップデートをインストールしてください。",
  "error.update.siblingCheckFailed":
    "他の OpenBot-NC セッションを確認できませんでした。インストールする前にもう一度お試しください。",
  "error.update.readOnlyLocation":
    "この場所からは OpenBot-NC のアップデートをインストールできません。OpenBot-NC を終了してください。Finder で OpenBot-NC を「アプリケーション」フォルダにドラッグします（すでにそこにある場合は、一度外に出してから戻します）。その後 OpenBot-NC を開き、もう一度アップデートをインストールしてください。",
  "error.update.appImageMissing":
    "AppImage ファイルが移動、名前変更、または置き換えられたため、OpenBot-NC はアップデートをインストールできません。OpenBot-NC を終了してから、AppImage ファイルをもう一度開いてください。",
  "error.update.appImageReadOnly":
    "OpenBot-NC は AppImage ファイルのフォルダにアップデートをインストールできません。OpenBot-NC を終了し、AppImage ファイルをホームフォルダ内のフォルダに移動してから開き、もう一度アップデートをインストールしてください。",
  "error.update.remoteDisabled": "このコンピューターでは、サーバー管理者からのアップデートはオフになっています。",
  "error.update.restartStarted": "OpenBot-NC はアップデートをインストールするため、すでに再起動しています。",
  "error.update.alreadyRestarting": "OpenBot-NC はすでに再起動しています。",
} as const satisfies PartialTranslation<typeof source>;
