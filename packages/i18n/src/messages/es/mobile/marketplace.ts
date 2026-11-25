import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/marketplace";

export const messages = {
  "mobile.marketplace.app.slackTagline": "Menciones y mensajes directos en Slack",
  "mobile.marketplace.app.discordTagline": "Menciones y mensajes directos en Discord",
  "mobile.marketplace.app.telegramTagline": "Grupos y chats directos en Telegram",
  "mobile.marketplace.app.whatsappTagline": "Tu propio chat y las personas que permitas en WhatsApp",
  "mobile.marketplace.app.githubTagline": "Repositorios, incidencias y pull requests",
  "mobile.marketplace.app.onePasswordTagline": "Inicia sesión en sitios con las credenciales que compartes",
  "mobile.marketplace.app.bitwardenTagline": "Inicia sesión en sitios con credenciales de una carpeta compartida",
  "mobile.marketplace.app.protonPassTagline": "Inicia sesión en sitios con credenciales de una bóveda compartida",
  "mobile.marketplace.error.signInUnsupported":
    "Actualiza OpenBot en el servidor para iniciar sesión en apps desde el teléfono.",
  "mobile.marketplace.app.connect": "Conectar",
  "mobile.marketplace.app.signInIntro":
    "Inicia sesión en la página de la app. El servidor guarda la sesión, no este teléfono.",
  "mobile.marketplace.app.stepOpen": "Abre la página de inicio de sesión de {name}.",
  "mobile.marketplace.app.stepAllow": "Inicia sesión y permite el acceso.",
  "mobile.marketplace.app.stepBlank": "La última página no carga. Es lo correcto.",
  "mobile.marketplace.app.stepCopy": "Toca la barra de direcciones y copia la dirección completa.",
  "mobile.marketplace.app.stepPaste": "Vuelve a OpenBot y pega la dirección abajo.",
  "mobile.marketplace.app.connected": "Conectada",
  "mobile.marketplace.app.connectFailed": "No se pudo conectar la app.",
  "mobile.marketplace.app.waiting": "Esperando la página de inicio de sesión…",
  "mobile.marketplace.app.openAgain": "Abrir de nuevo la página de inicio de sesión",
  "mobile.marketplace.app.pasteLabel": "Dirección tras iniciar sesión",
  "mobile.marketplace.app.pasteInvalid": "Esta dirección no es el final de este inicio de sesión.",
  "mobile.marketplace.app.finishSignIn": "Terminar",
  "mobile.marketplace.app.openFailed": "No se pudo abrir la página de inicio de sesión.",
} as const satisfies PartialTranslation<typeof source>;
