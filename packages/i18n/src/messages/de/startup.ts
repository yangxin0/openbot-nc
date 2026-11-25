import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/startup";

export const messages = {
  "startup.failedTitle": "OpenBot-NC konnte nicht starten",
  "startup.failedBody":
    "{message}\n\nDeine lokalen Daten wurden weder zurückgesetzt noch überschrieben. Schritte zur Wiederherstellung findest du in der Anleitung zur Fehlerbehebung.",
  "startup.archiveChangedTitle": "OpenBot-NC-Dateien wurden geändert",
  "startup.archiveChangedBody":
    "Ein anderes Programm hat die OpenBot-NC-Datei app.asar geändert. OpenBot-NC läuft jetzt, startet aber nicht mehr, wenn du es beendest.\n\nInstalliere OpenBot-NC erneut, um es zu reparieren. Deine lokalen Daten bleiben erhalten.",
  "startup.filesDamagedBody":
    "Einige OpenBot-NC-Dateien sind beschädigt oder fehlen.\n\nInstalliere OpenBot-NC erneut, um es zu reparieren. Deine lokalen Daten bleiben erhalten.",
  "startup.newerDataTitle": "Neueste OpenBot-NC-Version installieren",
  "startup.newerDataBody":
    "Eine neuere Version von OpenBot-NC hat deine Daten gespeichert, und diese Version ({version}) kann sie nicht öffnen. Installiere die neueste Version, um deine Daten zu öffnen.\n\nDeine lokalen Daten wurden nicht zurückgesetzt oder überschrieben.",
  "startup.newerDataQuit": "Beenden",
  "startup.newerDataLoopTitle": "Das neueste OpenBot-NC hat sich nicht geöffnet",
  "startup.newerDataLoopBody":
    "Eine neuere Version von OpenBot-NC hat deine Daten gespeichert, und diese Version ({version}) kann sie nicht öffnen. OpenBot-NC {loopVersion} wurde mehrmals hintereinander vor dem Öffnen beendet und wird daher nicht erneut installiert.\n\nInstalliere eine Version neuer als {loopVersion}, sobald eine verfügbar ist. Für Hilfe öffne die Anleitung.\n\nDeine lokalen Daten wurden nicht zurückgesetzt oder überschrieben.",
  "startup.recoveryWindowTitle": "OpenBot-NC-Wiederherstellung",
  "startup.recoveryTitle": "OpenBot-NC wurde nicht geöffnet",
  "startup.recoveryBody": {
    one: "OpenBot-NC {version} wurde {count} Mal in Folge vor dem Öffnen beendet. Deine lokalen Daten wurden nicht zurückgesetzt oder überschrieben.",
    other:
      "OpenBot-NC {version} wurde {count} Mal in Folge vor dem Öffnen beendet. Deine lokalen Daten wurden nicht zurückgesetzt oder überschrieben.",
  },
  "startup.recoveryHint":
    "Versuche es erneut oder installiere die letzte Version, die sich geöffnet hat. Für Hilfe exportiere die Diagnosedaten und sende die Datei mit deinem Bericht.",
  "startup.recoveryHintLatest":
    "OpenBot-NC hat keine frühere Version gefunden, die deine Daten öffnen kann. Versuche es erneut oder installiere die neueste Version. Für Hilfe exportiere die Diagnosedaten und sende die Datei mit deinem Bericht.",
  "startup.recoveryRetry": "Wiederholen",
  "startup.recoveryExportDiagnostics": "Diagnose exportieren",
  "startup.recoveryOpenDataFolder": "Datenordner öffnen",
  "startup.recoveryQuit": "Beenden",
  "startup.recoveryDiagnosticsSaved": "Die Diagnosedatei ist gespeichert.",
  "startup.recoveryActionFailed": "OpenBot-NC konnte diese Aktion nicht ausführen.",
} as const satisfies PartialTranslation<typeof source>;
