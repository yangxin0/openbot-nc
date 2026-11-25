import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/auth";

export const messages = {
  "mobile.auth.logo.animate": "OpenBot 로고 애니메이션",
  "mobile.auth.logo.animateHint": "로고가 윙크해요",
  "mobile.auth.scanner.connectFailed": "연결할 수 없어요",
  "mobile.auth.scanner.codeFailed": "이 코드를 사용할 수 없어요",
  "mobile.auth.scanner.scanAgain": "다시 스캔",
  "mobile.auth.scanner.connecting": "휴대폰을 연결하는 중…",
  "mobile.auth.scanner.readingInvitation": "초대를 읽는 중…",
  "mobile.auth.scanner.scanDesktop": "데스크톱 코드를 스캔하세요",
  "mobile.auth.scanner.scanInvitation": "초대 코드를 스캔하세요",
  "mobile.auth.scanner.verifying": "일회용 코드를 확인하는 중이에요.",
  "mobile.auth.scanner.checkingServer": "서버 ID를 확인하는 중이에요.",
  "mobile.auth.scanner.keepCentered": "QR 코드를 프레임 중앙에 맞춰 주세요.",
  "mobile.auth.scanner.connectFallback": "OpenBot이 이 휴대폰을 연결할 수 없어요.",
  "mobile.auth.scanner.cameraFailed": "카메라를 시작할 수 없어요. 다시 시도해 주세요.",
  "mobile.auth.camera.title": "카메라 접근 권한이 필요해요",
  "mobile.auth.camera.pairingReason":
    "OpenBot은 데스크톱 앱에 표시된 일회용 QR 코드를 스캔하는 데만 카메라를 사용해요.",
  "mobile.auth.camera.invitationReason": "OpenBot은 초대 QR 코드를 스캔하는 데만 카메라를 사용해요.",
  "mobile.auth.camera.blocked":
    "카메라 접근이 차단되어 있어요. 기기 설정에서 OpenBot의 카메라 접근을 허용한 다음 여기로 돌아와 코드를 스캔해 주세요.",
  "mobile.auth.camera.allow": "카메라 접근 허용",
  "mobile.auth.camera.openSettings": "설정 열기",
  "mobile.auth.error.signOutUnconfirmed": "로그아웃을 확인할 수 없어요. 연결 상태를 확인하고 다시 시도해 주세요.",
} as const satisfies PartialTranslation<typeof source>;
