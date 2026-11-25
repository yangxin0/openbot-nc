import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/auth";

export const messages = {
  "mobile.auth.logo.animate": "OpenBot-NC のロゴを動かす",
  "mobile.auth.logo.animateHint": "ロゴがウインクします",
  "mobile.auth.scanner.connectFailed": "接続できませんでした",
  "mobile.auth.scanner.codeFailed": "このコードは使用できません",
  "mobile.auth.scanner.scanAgain": "もう一度スキャン",
  "mobile.auth.scanner.connecting": "スマートフォンを接続しています…",
  "mobile.auth.scanner.readingInvitation": "招待を読み込んでいます…",
  "mobile.auth.scanner.scanDesktop": "デスクトップのコードをスキャンしてください",
  "mobile.auth.scanner.scanInvitation": "招待コードをスキャンしてください",
  "mobile.auth.scanner.verifying": "ワンタイムコードを確認しています。",
  "mobile.auth.scanner.checkingServer": "サーバーの ID を確認しています。",
  "mobile.auth.scanner.keepCentered": "QR コードを枠の中央に合わせてください。",
  "mobile.auth.scanner.connectFallback": "OpenBot-NC はこのスマートフォンを接続できませんでした。",
  "mobile.auth.scanner.cameraFailed": "カメラを起動できませんでした。もう一度お試しください。",
  "mobile.auth.camera.title": "カメラへのアクセスが必要です",
  "mobile.auth.camera.pairingReason":
    "OpenBot-NC はデスクトップアプリに表示されるワンタイム QR コードをスキャンするためにのみカメラを使用します。",
  "mobile.auth.camera.invitationReason": "OpenBot-NC は招待の QR コードをスキャンするためにのみカメラを使用します。",
  "mobile.auth.camera.blocked":
    "カメラへのアクセスがブロックされています。端末の設定で OpenBot-NC のカメラを許可してから、ここに戻ってコードをスキャンしてください。",
  "mobile.auth.camera.allow": "カメラへのアクセスを許可",
  "mobile.auth.camera.openSettings": "設定を開く",
  "mobile.auth.error.signOutUnconfirmed":
    "サインアウトを確認できませんでした。接続を確認して、もう一度お試しください。",
} as const satisfies PartialTranslation<typeof source>;
