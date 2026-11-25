import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/voice";

export const messages = {
  "error.voice.downloadFailed": "Das Sprachmodell konnte nicht heruntergeladen werden. Versuche es erneut.",
  "error.voice.downloadStopped": "Der Download des Sprachmodells wurde gestoppt.",
  "error.voice.removeBusy": "Warte, bis die Sprachtranskription endet, und entferne das Modell dann.",
  "error.voice.removeFailed": "Das Sprachmodell konnte nicht entfernt werden. Versuche es erneut.",
  "error.voice.runtimeUnavailable": "Lokale Sprachtranskription ist auf dieser Plattform nicht verfügbar.",
  "error.voice.modelUnavailable": "Das Sprachmodell ist nicht verfügbar.",
  "error.voice.transcriptionTimedOut": "Die Zeit für die Sprachtranskription ist abgelaufen.",
  "error.voice.prepareRequired":
    "Lokale Sprachtranskription ist nicht verfügbar. Führe `bun run voice:prepare` aus und starte OpenBot-NC neu.",
  "error.voice.transcriptionFailed": "OpenBot-NC konnte diese Aufnahme nicht transkribieren.",
  "error.voice.videoModelMissing":
    "Unter Einstellungen → Diktat ist kein Spracherkennungsmodell für Aufnahmen eingerichtet.",
  "error.voice.videoModelMissingServer":
    "Auf diesem Server ist kein Spracherkennungsmodell eingerichtet. Ein Owner oder Admin kann in den Servereinstellungen unter Spracherkennung ein Modell einrichten.",
  "error.voice.cloud.keyRequired": "Füge deinen {provider}-API-Schlüssel unter Einstellungen → Diktat hinzu.",
  "error.voice.cloud.keyRejected":
    "{provider} hat den API-Schlüssel nicht akzeptiert. Prüfe den Schlüssel unter Einstellungen → Diktat.",
  "error.voice.cloud.quotaExceeded": "Dein {provider}-Kontingent ist aufgebraucht.",
  "error.voice.cloud.rateLimited": "{provider} ist ausgelastet. Versuche es gleich noch einmal.",
  "error.voice.cloud.termsRequired":
    "Akzeptiere die Bedingungen von ElevenLabs in deinem ElevenLabs-Konto und versuche es dann erneut.",
  "error.voice.cloud.streamEnded": "Die Diktat-Übertragung wurde beendet. Nimm erneut auf.",
  "error.voice.cloud.tooLong": "Die Aufnahme ist zu lang.",
  "error.voice.cloud.keySaveFailed": "Der {provider}-API-Schlüssel konnte nicht gespeichert werden.",
  "error.voice.speech.runtimeUnavailable": "Lokale Sprachausgabe ist auf dieser Plattform nicht verfügbar.",
  "error.voice.speech.modelRequired": "Lade das Sprachausgabemodell unter Einstellungen → Diktat herunter.",
  "error.voice.speech.timedOut": "Das Vorlesen der Antwort hat zu lange gedauert.",
  "error.voice.speech.failed": "OpenBot-NC konnte die Antwort nicht vorlesen.",
  "error.voice.speech.providerRefused": "{provider} hat die Audioausgabe abgelehnt: {reason}",
  "error.voice.recordingNotKept": "OpenBot-NC konnte die Sprachaufnahme nicht speichern.",
  "error.voice.server.modelUnsupported":
    "{host} kann mit {model} nicht transkribieren. Wähle in den Einstellungen ein anderes Diktatmodell für den Sprachserver.",
} as const satisfies PartialTranslation<typeof source>;
