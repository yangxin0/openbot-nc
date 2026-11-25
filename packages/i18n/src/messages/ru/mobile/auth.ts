import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/auth";

export const messages = {
  "mobile.auth.logo.animate": "Анимировать логотип OpenBot",
  "mobile.auth.logo.animateHint": "Логотип подмигнёт",
  "mobile.auth.scanner.connectFailed": "Не удалось подключиться",
  "mobile.auth.scanner.codeFailed": "Не удалось использовать код",
  "mobile.auth.scanner.scanAgain": "Сканировать снова",
  "mobile.auth.scanner.connecting": "Подключаем телефон…",
  "mobile.auth.scanner.readingInvitation": "Читаем приглашение…",
  "mobile.auth.scanner.scanDesktop": "Отсканируйте код на компьютере",
  "mobile.auth.scanner.scanInvitation": "Отсканируйте код приглашения",
  "mobile.auth.scanner.verifying": "Проверяем одноразовый код.",
  "mobile.auth.scanner.checkingServer": "Проверяем подлинность сервера.",
  "mobile.auth.scanner.keepCentered": "Держите QR-код в центре рамки.",
  "mobile.auth.scanner.connectFallback": "OpenBot не удалось подключить этот телефон.",
  "mobile.auth.scanner.cameraFailed": "Не удалось включить камеру. Повторите попытку.",
  "mobile.auth.camera.title": "Нужен доступ к камере",
  "mobile.auth.camera.pairingReason":
    "OpenBot использует камеру только для сканирования одноразового QR-кода из настольного приложения.",
  "mobile.auth.camera.invitationReason": "OpenBot использует камеру только для сканирования QR-кода приглашения.",
  "mobile.auth.camera.blocked":
    "Доступ к камере заблокирован. Разрешите его для OpenBot в настройках устройства и вернитесь сюда, чтобы отсканировать код.",
  "mobile.auth.camera.allow": "Разрешить доступ к камере",
  "mobile.auth.camera.openSettings": "Открыть настройки",
  "mobile.auth.error.signOutUnconfirmed": "Не удалось подтвердить выход. Проверьте подключение и повторите попытку.",
} as const satisfies PartialTranslation<typeof source>;
