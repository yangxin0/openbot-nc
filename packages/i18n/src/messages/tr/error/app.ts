import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/app";

export const messages = {
  "error.app.externalLinkProtocol": "Harici tarayıcıda yalnızca HTTP(S) bağlantıları açılabilir.",
  "error.app.notificationsUnsupported": "Bu sistem masaüstü bildirimlerini desteklemiyor.",
  "error.app.notificationSettingsMissing": "Bu sistemin bildirim ayarları sayfası yok.",
  "error.app.notReady": "OpenBot-NC hazır değil.",
  "error.app.macSecureStorageUnavailable": "macOS güvenli depolaması kullanılamıyor.",
  "error.app.secretStorageUnavailable": "Sistem gizli anahtar depolaması kullanılamıyor.",
} as const satisfies PartialTranslation<typeof source>;
