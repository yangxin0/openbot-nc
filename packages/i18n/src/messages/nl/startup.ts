import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/startup";

export const messages = {
  "startup.failedTitle": "OpenBot-NC kan niet starten",
  "startup.failedBody":
    "{message}\n\nJe lokale gegevens zijn niet gereset of overschreven. Bekijk de handleiding voor probleemoplossing voor herstelstappen.",
  "startup.archiveChangedTitle": "OpenBot-NC-bestanden zijn gewijzigd",
  "startup.archiveChangedBody":
    "Een ander programma heeft het OpenBot-NC-bestand app.asar gewijzigd. OpenBot-NC werkt nu, maar opent niet meer nadat je het afsluit.\n\nInstalleer OpenBot-NC opnieuw om het te herstellen. Je lokale gegevens blijven bewaard.",
  "startup.filesDamagedBody":
    "Sommige OpenBot-NC-bestanden zijn beschadigd of ontbreken.\n\nInstalleer OpenBot-NC opnieuw om het te herstellen. Je lokale gegevens blijven bewaard.",
  "startup.newerDataTitle": "Installeer de nieuwste OpenBot-NC",
  "startup.newerDataBody":
    "Een nieuwere versie van OpenBot-NC heeft je gegevens opgeslagen, en deze versie ({version}) kan ze niet openen. Installeer de nieuwste versie om je gegevens te openen.\n\nJe lokale gegevens zijn niet gereset of overschreven.",
  "startup.newerDataQuit": "Stoppen",
  "startup.newerDataLoopTitle": "De nieuwste OpenBot-NC opende niet",
  "startup.newerDataLoopBody":
    "Een nieuwere versie van OpenBot-NC heeft je gegevens opgeslagen, en deze versie ({version}) kan ze niet openen. OpenBot-NC {loopVersion} stopte meerdere keren achter elkaar voordat het opende, dus het wordt niet opnieuw geïnstalleerd.\n\nInstalleer een versie nieuwer dan {loopVersion} zodra er een beschikbaar is. Open de gids voor hulp.\n\nJe lokale gegevens zijn niet gereset of overschreven.",
  "startup.recoveryWindowTitle": "OpenBot-NC-herstel",
  "startup.recoveryTitle": "OpenBot-NC is niet geopend",
  "startup.recoveryBody": {
    one: "OpenBot-NC {version} stopte voordat het openging, {count} keer achter elkaar. Je lokale gegevens zijn niet gewist of overschreven.",
    other:
      "OpenBot-NC {version} stopte voordat het openging, {count} keer achter elkaar. Je lokale gegevens zijn niet gewist of overschreven.",
  },
  "startup.recoveryHint":
    "Probeer het opnieuw, of installeer de laatste versie die wel opende. Exporteer voor hulp de diagnose en stuur het bestand mee met je melding.",
  "startup.recoveryHintLatest":
    "OpenBot-NC vond geen eerdere versie die je gegevens kan openen. Probeer het opnieuw, of installeer de nieuwste versie. Exporteer voor hulp de diagnose en stuur het bestand mee met je melding.",
  "startup.recoveryRetry": "Opnieuw",
  "startup.recoveryExportDiagnostics": "Diagnose exporteren",
  "startup.recoveryOpenDataFolder": "Gegevensmap openen",
  "startup.recoveryQuit": "Stoppen",
  "startup.recoveryDiagnosticsSaved": "Het diagnosebestand is opgeslagen.",
  "startup.recoveryActionFailed": "OpenBot-NC kon deze actie niet uitvoeren.",
} as const satisfies PartialTranslation<typeof source>;
