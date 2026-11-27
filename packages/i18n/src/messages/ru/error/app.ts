import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/app";

export const messages = {
  "error.app.externalLinkProtocol": "Во внешнем браузере можно открывать только ссылки HTTP(S).",
  "error.app.notificationsUnsupported": "Эта система не поддерживает уведомления на рабочем столе.",
  "error.app.notificationSettingsMissing": "В этой системе нет страницы настроек уведомлений.",
  "error.app.notReady": "OpenBot-NC не готов.",
  "error.app.macSecureStorageUnavailable": "Защищённое хранилище macOS недоступно.",
  "error.app.secretStorageUnavailable": "Системное хранилище секретов недоступно.",
  "error.app.windowBlockedBySecuritySoftware":
    "Вероятно, защитная программа на этом компьютере остановила окно OpenBot-NC. Добавьте OpenBot-NC.exe в доверенные программы в защитной программе, например в Kaspersky. Затем снова запустите OpenBot-NC.",
} as const satisfies PartialTranslation<typeof source>;
