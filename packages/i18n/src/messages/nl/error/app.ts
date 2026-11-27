import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/app";

export const messages = {
  "error.app.externalLinkProtocol": "Alleen HTTP(S)-links kunnen in de externe browser worden geopend.",
  "error.app.notificationsUnsupported": "Dit systeem ondersteunt geen bureaubladmeldingen.",
  "error.app.notificationSettingsMissing": "Dit systeem heeft geen pagina met meldingsinstellingen.",
  "error.app.notReady": "OpenBot-NC is niet klaar.",
  "error.app.macSecureStorageUnavailable": "De beveiligde opslag van macOS is niet beschikbaar.",
  "error.app.secretStorageUnavailable": "De opslag voor geheimen van het systeem is niet beschikbaar.",
  "error.app.windowBlockedBySecuritySoftware":
    "Beveiligingssoftware op deze computer heeft het OpenBot-NC-venster waarschijnlijk gestopt. Voeg OpenBot-NC.exe in je beveiligingssoftware, bijvoorbeeld Kaspersky, toe als vertrouwde toepassing. Start OpenBot-NC daarna opnieuw.",
} as const satisfies PartialTranslation<typeof source>;
