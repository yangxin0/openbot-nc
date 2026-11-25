import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/marketplace";

export const messages = {
  "mobile.marketplace.app.slackTagline": "Slack 멘션 및 다이렉트 메시지",
  "mobile.marketplace.app.discordTagline": "Discord 멘션 및 다이렉트 메시지",
  "mobile.marketplace.app.telegramTagline": "Telegram 그룹 및 다이렉트 채팅",
  "mobile.marketplace.app.whatsappTagline": "WhatsApp의 내 채팅 및 허용한 사람",
  "mobile.marketplace.app.githubTagline": "저장소, 이슈, 풀 리퀘스트",
  "mobile.marketplace.app.onePasswordTagline": "공유한 로그인 정보로 사이트에 로그인",
  "mobile.marketplace.app.bitwardenTagline": "공유 폴더의 로그인 정보로 사이트에 로그인",
  "mobile.marketplace.app.protonPassTagline": "공유 보관함의 로그인 정보로 사이트에 로그인",
  "mobile.marketplace.error.signInUnsupported": "휴대폰에서 앱에 로그인하려면 서버의 OpenBot을 업데이트해 주세요.",
  "mobile.marketplace.app.connect": "연결",
  "mobile.marketplace.app.signInIntro":
    "앱의 페이지에서 로그인하세요. 로그인 정보는 이 휴대폰이 아니라 서버가 보관해요.",
  "mobile.marketplace.app.stepOpen": "{name} 로그인 페이지를 여세요.",
  "mobile.marketplace.app.stepAllow": "로그인한 다음 접근을 허용하세요.",
  "mobile.marketplace.app.stepBlank": "마지막 페이지는 로드되지 않습니다. 정상입니다.",
  "mobile.marketplace.app.stepCopy": "주소 표시줄을 탭하고 전체 주소를 복사합니다.",
  "mobile.marketplace.app.stepPaste": "OpenBot으로 돌아와 아래에 주소를 붙여 넣습니다.",
  "mobile.marketplace.app.connected": "연결됨",
  "mobile.marketplace.app.connectFailed": "앱을 연결하지 못했어요.",
  "mobile.marketplace.app.waiting": "로그인 페이지를 기다리는 중…",
  "mobile.marketplace.app.openAgain": "로그인 페이지 다시 열기",
  "mobile.marketplace.app.pasteLabel": "로그인 후 주소",
  "mobile.marketplace.app.pasteInvalid": "이 주소는 이번 로그인의 마지막 단계 주소가 아니에요.",
  "mobile.marketplace.app.finishSignIn": "로그인 완료",
  "mobile.marketplace.app.openFailed": "로그인 페이지를 열지 못했어요.",
} as const satisfies PartialTranslation<typeof source>;
