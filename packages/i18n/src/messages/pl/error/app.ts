import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/app";

export const messages = {
  "error.app.externalLinkProtocol": "W zewnętrznej przeglądarce można otwierać tylko linki HTTP(S).",
  "error.app.notificationsUnsupported": "Ten system nie obsługuje powiadomień na pulpicie.",
  "error.app.notificationSettingsMissing": "Ten system nie ma strony ustawień powiadomień.",
  "error.app.notReady": "OpenBot-NC nie jest gotowy.",
  "error.app.macSecureStorageUnavailable": "Bezpieczny magazyn macOS jest niedostępny.",
  "error.app.secretStorageUnavailable": "Systemowy magazyn sekretów jest niedostępny.",
  "error.app.windowBlockedBySecuritySoftware":
    "Oprogramowanie zabezpieczające na tym komputerze prawdopodobnie zatrzymało okno OpenBot-NC. W oprogramowaniu zabezpieczającym, na przykład Kaspersky, dodaj OpenBot-NC.exe jako zaufaną aplikację. Następnie uruchom OpenBot-NC ponownie.",
} as const satisfies PartialTranslation<typeof source>;
