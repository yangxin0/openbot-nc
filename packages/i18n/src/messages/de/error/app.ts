import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/app";

export const messages = {
  "error.app.externalLinkProtocol": "Im externen Browser können nur HTTP(S)-Links geöffnet werden.",
  "error.app.notificationsUnsupported": "Dieses System unterstützt keine Desktop-Benachrichtigungen.",
  "error.app.notificationSettingsMissing": "Dieses System hat keine Seite für Benachrichtigungseinstellungen.",
  "error.app.notReady": "OpenBot-NC ist nicht bereit.",
  "error.app.macSecureStorageUnavailable": "Der sichere Speicher von macOS ist nicht verfügbar.",
  "error.app.secretStorageUnavailable": "Der Systemspeicher für Geheimnisse ist nicht verfügbar.",
  "error.app.windowBlockedBySecuritySoftware":
    "Sicherheitssoftware auf diesem Computer hat wahrscheinlich das OpenBot-NC-Fenster gestoppt. Füge OpenBot-NC.exe in deiner Sicherheitssoftware, zum Beispiel Kaspersky, als vertrauenswürdige Anwendung hinzu. Starte OpenBot-NC dann erneut.",
} as const satisfies PartialTranslation<typeof source>;
