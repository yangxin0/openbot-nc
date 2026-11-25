import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/host";

export const messages = {
  "error.host.nameBeforePublish": "Gib diesem OpenBot einen Namen, bevor du ihn veröffentlichst.",
  "error.host.publishBeforeInvite": "Mache diesen OpenBot öffentlich, bevor du eine Einladung erstellst.",
  "error.host.teamAccessUnavailable": "Dein Teamzugriff ist nicht verfügbar.",
  "error.host.ownerIdentityUnavailable": "Die Identität des Host-Eigentümers ist nicht verfügbar.",
  "error.host.publishFailed": "Dieser OpenBot konnte nicht veröffentlicht werden.",
  "error.host.noServer": "Dieser Computer hat keinen Server, der geändert werden kann.",
  "error.host.identityLocalOnly":
    "Name und Logo des Servers können nur auf dem Computer geändert werden, auf dem er läuft.",
  "error.host.timezoneInvalid": "Diese Zeitzone ist unbekannt.",
  "error.host.turnLimitInvalid": "Dieses Thread-Limit ist ungültig.",
  "error.host.maintenanceInterrupted":
    "Die Host-Wartung wurde unterbrochen. Prüfe die Anwendung und setze den Host-Zustand zurück, bevor du es erneut versuchst.",
  "error.host.updateFailed":
    "Die Host-Aktualisierung ist während {phase} fehlgeschlagen. Prüfe Paketeigentümer, Signatur, Mandantenstatus und freien Speicherplatz, bevor du den Zustand zurücksetzt.",
  "error.host.tenantsNotIdle":
    "Die Mandanten waren innerhalb von zwei Stunden nicht fünf Minuten lang durchgehend inaktiv.",
  "error.host.tenantShutdownTimeout":
    "Die Zeit für das Herunterfahren der Mandanten ist abgelaufen. Der Austausch der Anwendung wurde nicht gestartet.",
  "error.host.tenantHealthMissing":
    "Nach dem Neustart fehlen Zustandsberichte der Mandanten oder sie melden Probleme. Prüfe die Mandantensitzungen vor einer weiteren Aktualisierung.",
  "error.host.personalityInvalid": "Dieser Antwortstil ist unbekannt.",
} as const satisfies PartialTranslation<typeof source>;
