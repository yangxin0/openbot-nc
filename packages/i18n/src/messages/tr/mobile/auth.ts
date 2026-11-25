import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/auth";

export const messages = {
  "mobile.auth.logo.animate": "OpenBot-NC logosunu hareketlendir",
  "mobile.auth.logo.animateHint": "Logonun göz kırpmasını sağlar",
  "mobile.auth.scanner.connectFailed": "Bağlanılamadı",
  "mobile.auth.scanner.codeFailed": "Bu kod kullanılamadı",
  "mobile.auth.scanner.scanAgain": "Tekrar tara",
  "mobile.auth.scanner.connecting": "Telefonunuz bağlanıyor…",
  "mobile.auth.scanner.readingInvitation": "Davet okunuyor…",
  "mobile.auth.scanner.scanDesktop": "Masaüstü kodunu tarayın",
  "mobile.auth.scanner.scanInvitation": "Davet kodunu tarayın",
  "mobile.auth.scanner.verifying": "Tek kullanımlık kod doğrulanıyor.",
  "mobile.auth.scanner.checkingServer": "Sunucu kimliği kontrol ediliyor.",
  "mobile.auth.scanner.keepCentered": "QR kodunu çerçevenin içinde ortalanmış tutun.",
  "mobile.auth.scanner.connectFallback": "OpenBot-NC bu telefonu bağlayamadı.",
  "mobile.auth.scanner.cameraFailed": "Kamera başlatılamadı. Tekrar deneyin.",
  "mobile.auth.camera.title": "Kamera erişimi gerekli",
  "mobile.auth.camera.pairingReason":
    "OpenBot-NC kamerayı yalnızca masaüstü uygulamasında gösterilen tek kullanımlık QR kodunu taramak için kullanır.",
  "mobile.auth.camera.invitationReason": "OpenBot-NC kamerayı yalnızca davet QR kodunu taramak için kullanır.",
  "mobile.auth.camera.blocked":
    "Kamera erişimi engellendi. Cihaz ayarlarından OpenBot-NC için kamerayı etkinleştirin, ardından kodu taramak için buraya dönün.",
  "mobile.auth.camera.allow": "Kamera erişimine izin ver",
  "mobile.auth.camera.openSettings": "Ayarları aç",
  "mobile.auth.error.signOutUnconfirmed":
    "Oturumun kapatıldığı doğrulanamadı. Bağlantınızı kontrol edip tekrar deneyin.",
} as const satisfies PartialTranslation<typeof source>;
