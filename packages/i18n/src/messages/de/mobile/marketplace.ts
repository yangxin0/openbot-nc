import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/marketplace";

export const messages = {
  "mobile.marketplace.app.slackTagline": "Erwähnungen und Direktnachrichten in Slack",
  "mobile.marketplace.app.discordTagline": "Erwähnungen und Direktnachrichten in Discord",
  "mobile.marketplace.app.telegramTagline": "Gruppen und Direktchats in Telegram",
  "mobile.marketplace.app.whatsappTagline": "Dein eigener Chat und zugelassene Personen in WhatsApp",
  "mobile.marketplace.app.githubTagline": "Repositorys, Issues und Pull Requests",
  "mobile.marketplace.app.onePasswordTagline": "Bei Websites mit von dir geteilten Zugangsdaten anmelden",
  "mobile.marketplace.app.bitwardenTagline": "Bei Websites mit Zugangsdaten aus einem geteilten Ordner anmelden",
  "mobile.marketplace.app.protonPassTagline": "Bei Websites mit Zugangsdaten aus einem geteilten Tresor anmelden",
  "mobile.marketplace.error.signInUnsupported":
    "Aktualisiere OpenBot auf dem Server, um dich vom Telefon aus bei Apps anzumelden.",
  "mobile.marketplace.app.connect": "Verbinden",
  "mobile.marketplace.app.signInIntro":
    "Melde dich auf der Seite der App an. Die Anmeldung bleibt auf dem Server, nicht auf diesem Telefon.",
  "mobile.marketplace.app.stepOpen": "Öffne die Anmeldeseite von {name}.",
  "mobile.marketplace.app.stepAllow": "Melde dich an und erlaube den Zugriff.",
  "mobile.marketplace.app.stepBlank": "Die letzte Seite lädt nicht. Das ist richtig.",
  "mobile.marketplace.app.stepCopy": "Tippe auf die Adressleiste und kopiere die ganze Adresse.",
  "mobile.marketplace.app.stepPaste": "Komm zurück zu OpenBot und füge die Adresse unten ein.",
  "mobile.marketplace.app.connected": "Verbunden",
  "mobile.marketplace.app.connectFailed": "Die App konnte nicht verbunden werden.",
  "mobile.marketplace.app.waiting": "Warten auf die Anmeldeseite…",
  "mobile.marketplace.app.openAgain": "Anmeldeseite erneut öffnen",
  "mobile.marketplace.app.pasteLabel": "Adresse nach der Anmeldung",
  "mobile.marketplace.app.pasteInvalid": "Diese Adresse ist nicht das Ende dieser Anmeldung.",
  "mobile.marketplace.app.finishSignIn": "Anmeldung abschließen",
  "mobile.marketplace.app.openFailed": "Die Anmeldeseite konnte nicht geöffnet werden.",
} as const satisfies PartialTranslation<typeof source>;
