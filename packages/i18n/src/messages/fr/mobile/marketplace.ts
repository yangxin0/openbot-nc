import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/marketplace";

export const messages = {
  "mobile.marketplace.app.slackTagline": "Mentions et messages directs dans Slack",
  "mobile.marketplace.app.discordTagline": "Mentions et messages directs dans Discord",
  "mobile.marketplace.app.telegramTagline": "Groupes et discussions privées dans Telegram",
  "mobile.marketplace.app.whatsappTagline": "Votre propre discussion et les personnes que vous autorisez dans WhatsApp",
  "mobile.marketplace.app.githubTagline": "Dépôts, tickets et pull requests",
  "mobile.marketplace.app.onePasswordTagline": "Connectez-vous aux sites avec les identifiants que vous partagez",
  "mobile.marketplace.app.bitwardenTagline": "Connectez-vous aux sites avec les identifiants d’un dossier partagé",
  "mobile.marketplace.app.protonPassTagline": "Connectez-vous aux sites avec les identifiants d’un coffre partagé",
  "mobile.marketplace.error.signInUnsupported":
    "Mettez à jour OpenBot sur le serveur pour vous connecter aux apps depuis le téléphone.",
  "mobile.marketplace.app.connect": "Connecter",
  "mobile.marketplace.app.signInIntro":
    "Connectez-vous sur la page de l’app. Le serveur conserve la connexion, pas ce téléphone.",
  "mobile.marketplace.app.stepOpen": "Ouvrez la page de connexion de {name}.",
  "mobile.marketplace.app.stepAllow": "Connectez-vous et autorisez l’accès.",
  "mobile.marketplace.app.stepBlank": "La dernière page ne se charge pas. C'est normal.",
  "mobile.marketplace.app.stepCopy": "Touchez la barre d'adresse et copiez l'adresse complète.",
  "mobile.marketplace.app.stepPaste": "Revenez dans OpenBot et collez l'adresse ci-dessous.",
  "mobile.marketplace.app.connected": "Connectée",
  "mobile.marketplace.app.connectFailed": "Impossible de connecter l’app.",
  "mobile.marketplace.app.waiting": "En attente de la page de connexion…",
  "mobile.marketplace.app.openAgain": "Rouvrir la page de connexion",
  "mobile.marketplace.app.pasteLabel": "Adresse après la connexion",
  "mobile.marketplace.app.pasteInvalid": "Cette adresse n’est pas la fin de cette connexion.",
  "mobile.marketplace.app.finishSignIn": "Terminer",
  "mobile.marketplace.app.openFailed": "Impossible d’ouvrir la page de connexion.",
} as const satisfies PartialTranslation<typeof source>;
