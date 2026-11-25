import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/marketplace";

export const messages = {
  "mobile.marketplace.app.slackTagline": "Slack のメンションとダイレクトメッセージ",
  "mobile.marketplace.app.discordTagline": "Discord のメンションとダイレクトメッセージ",
  "mobile.marketplace.app.telegramTagline": "Telegram のグループとダイレクトチャット",
  "mobile.marketplace.app.whatsappTagline": "WhatsApp の自分のチャットと、許可した人",
  "mobile.marketplace.app.githubTagline": "リポジトリ、Issue、プルリクエスト",
  "mobile.marketplace.app.onePasswordTagline": "共有したログイン情報でサイトにサインイン",
  "mobile.marketplace.app.bitwardenTagline": "共有フォルダーのログイン情報でサイトにサインイン",
  "mobile.marketplace.app.protonPassTagline": "共有保管庫のログイン情報でサイトにサインイン",
  "mobile.marketplace.error.signInUnsupported":
    "電話からアプリにサインインするには、サーバーの OpenBot をアップデートしてください。",
  "mobile.marketplace.app.connect": "接続",
  "mobile.marketplace.app.signInIntro":
    "アプリのページでサインインしてください。サインイン情報はこの電話ではなくサーバーに保存されます。",
  "mobile.marketplace.app.stepOpen": "{name} のサインインページを開きます。",
  "mobile.marketplace.app.stepAllow": "サインインしてアクセスを許可します。",
  "mobile.marketplace.app.stepBlank": "最後のページは読み込まれません。これは正常です。",
  "mobile.marketplace.app.stepCopy": "アドレスバーをタップし、アドレス全体をコピーします。",
  "mobile.marketplace.app.stepPaste": "OpenBot に戻り、下にアドレスを貼り付けます。",
  "mobile.marketplace.app.connected": "接続済み",
  "mobile.marketplace.app.connectFailed": "アプリを接続できませんでした。",
  "mobile.marketplace.app.waiting": "サインインページを待っています…",
  "mobile.marketplace.app.openAgain": "サインインページをもう一度開く",
  "mobile.marketplace.app.pasteLabel": "サインイン後のアドレス",
  "mobile.marketplace.app.pasteInvalid": "このアドレスはこのサインインの最後のアドレスではありません。",
  "mobile.marketplace.app.finishSignIn": "サインインを完了",
  "mobile.marketplace.app.openFailed": "サインインページを開けませんでした。",
} as const satisfies PartialTranslation<typeof source>;
