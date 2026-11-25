import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/marketplace";

export const messages = {
  "mobile.marketplace.app.slackTagline": "Menzioni e messaggi diretti in Slack",
  "mobile.marketplace.app.discordTagline": "Menzioni e messaggi diretti in Discord",
  "mobile.marketplace.app.telegramTagline": "Gruppi e chat dirette in Telegram",
  "mobile.marketplace.app.whatsappTagline": "La tua chat personale e le persone che autorizzi in WhatsApp",
  "mobile.marketplace.app.githubTagline": "Repository, issue e pull request",
  "mobile.marketplace.app.onePasswordTagline": "Accedi ai siti con le credenziali che condividi",
  "mobile.marketplace.app.bitwardenTagline": "Accedi ai siti con le credenziali di una cartella condivisa",
  "mobile.marketplace.app.protonPassTagline": "Accedi ai siti con le credenziali di una cassaforte condivisa",
  "mobile.marketplace.error.signInUnsupported": "Aggiorna OpenBot-NC sul server per accedere alle app dal telefono.",
  "mobile.marketplace.app.connect": "Connetti",
  "mobile.marketplace.app.signInIntro":
    "Accedi nella pagina dell’app. Il server conserva l’accesso, non questo telefono.",
  "mobile.marketplace.app.stepOpen": "Apri la pagina di accesso di {name}.",
  "mobile.marketplace.app.stepAllow": "Accedi e consenti l’accesso.",
  "mobile.marketplace.app.stepBlank": "L'ultima pagina non si carica. È corretto.",
  "mobile.marketplace.app.stepCopy": "Tocca la barra degli indirizzi e copia l'indirizzo completo.",
  "mobile.marketplace.app.stepPaste": "Torna su OpenBot-NC e incolla l'indirizzo qui sotto.",
  "mobile.marketplace.app.connected": "Connessa",
  "mobile.marketplace.app.connectFailed": "Impossibile connettere l’app.",
  "mobile.marketplace.app.waiting": "In attesa della pagina di accesso…",
  "mobile.marketplace.app.openAgain": "Riapri la pagina di accesso",
  "mobile.marketplace.app.pasteLabel": "Indirizzo dopo l’accesso",
  "mobile.marketplace.app.pasteInvalid": "Questo indirizzo non è la fine di questo accesso.",
  "mobile.marketplace.app.finishSignIn": "Completa accesso",
  "mobile.marketplace.app.openFailed": "Impossibile aprire la pagina di accesso.",
} as const satisfies PartialTranslation<typeof source>;
