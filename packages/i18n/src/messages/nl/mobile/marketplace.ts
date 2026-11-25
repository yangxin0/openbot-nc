import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/marketplace";

export const messages = {
  "mobile.marketplace.app.slackTagline": "Vermeldingen en privéberichten in Slack",
  "mobile.marketplace.app.discordTagline": "Vermeldingen en privéberichten in Discord",
  "mobile.marketplace.app.telegramTagline": "Groepen en privéchats in Telegram",
  "mobile.marketplace.app.whatsappTagline": "Je eigen chat en de mensen die je toestaat in WhatsApp",
  "mobile.marketplace.app.githubTagline": "Repository’s, issues en pull requests",
  "mobile.marketplace.app.onePasswordTagline": "Log in op sites met logins die je deelt",
  "mobile.marketplace.app.bitwardenTagline": "Log in op sites met logins uit een gedeelde map",
  "mobile.marketplace.app.protonPassTagline": "Log in op sites met logins uit een gedeelde kluis",
  "mobile.marketplace.error.signInUnsupported":
    "Werk OpenBot bij op de server om vanaf je telefoon in te loggen bij apps.",
  "mobile.marketplace.app.connect": "Verbinden",
  "mobile.marketplace.app.signInIntro":
    "Log in op de pagina van de app. De server bewaart de inlog, niet deze telefoon.",
  "mobile.marketplace.app.stepOpen": "Open de inlogpagina van {name}.",
  "mobile.marketplace.app.stepAllow": "Log in en sta toegang toe.",
  "mobile.marketplace.app.stepBlank": "De laatste pagina laadt niet. Dat is juist.",
  "mobile.marketplace.app.stepCopy": "Tik op de adresbalk en kopieer het volledige adres.",
  "mobile.marketplace.app.stepPaste": "Ga terug naar OpenBot en plak het adres hieronder.",
  "mobile.marketplace.app.connected": "Verbonden",
  "mobile.marketplace.app.connectFailed": "De app is niet verbonden.",
  "mobile.marketplace.app.waiting": "Wachten op de inlogpagina…",
  "mobile.marketplace.app.openAgain": "Open de inlogpagina opnieuw",
  "mobile.marketplace.app.pasteLabel": "Adres na het inloggen",
  "mobile.marketplace.app.pasteInvalid": "Dit adres is niet het einde van deze inlog.",
  "mobile.marketplace.app.finishSignIn": "Rond inloggen af",
  "mobile.marketplace.app.openFailed": "De inlogpagina is niet geopend.",
} as const satisfies PartialTranslation<typeof source>;
