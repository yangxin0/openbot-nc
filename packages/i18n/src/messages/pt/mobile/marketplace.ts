import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/marketplace";

export const messages = {
  "mobile.marketplace.app.slackTagline": "Menções e mensagens diretas no Slack",
  "mobile.marketplace.app.discordTagline": "Menções e mensagens diretas no Discord",
  "mobile.marketplace.app.telegramTagline": "Grupos e conversas diretas no Telegram",
  "mobile.marketplace.app.whatsappTagline": "Seu próprio chat e as pessoas que você permitir no WhatsApp",
  "mobile.marketplace.app.githubTagline": "Repositórios, issues e pull requests",
  "mobile.marketplace.app.onePasswordTagline": "Entre em sites com os logins que você compartilha",
  "mobile.marketplace.app.bitwardenTagline": "Entre em sites com logins de uma pasta compartilhada",
  "mobile.marketplace.app.protonPassTagline": "Entre em sites com logins de um cofre compartilhado",
  "mobile.marketplace.error.signInUnsupported": "Atualize o OpenBot no servidor para entrar em apps pelo celular.",
  "mobile.marketplace.app.connect": "Conectar",
  "mobile.marketplace.app.signInIntro": "Entre na página do app. O servidor guarda o login, não este celular.",
  "mobile.marketplace.app.stepOpen": "Abra a página de login do {name}.",
  "mobile.marketplace.app.stepAllow": "Entre e permita o acesso.",
  "mobile.marketplace.app.stepBlank": "A última página não carrega. Isso é o esperado.",
  "mobile.marketplace.app.stepCopy": "Toque na barra de endereço e copie o endereço completo.",
  "mobile.marketplace.app.stepPaste": "Volte ao OpenBot e cole o endereço abaixo.",
  "mobile.marketplace.app.connected": "Conectado",
  "mobile.marketplace.app.connectFailed": "Não foi possível conectar o app.",
  "mobile.marketplace.app.waiting": "Aguardando a página de login…",
  "mobile.marketplace.app.openAgain": "Abrir a página de login de novo",
  "mobile.marketplace.app.pasteLabel": "Endereço após o login",
  "mobile.marketplace.app.pasteInvalid": "Este endereço não é o final deste login.",
  "mobile.marketplace.app.finishSignIn": "Concluir login",
  "mobile.marketplace.app.openFailed": "Não foi possível abrir a página de login.",
} as const satisfies PartialTranslation<typeof source>;
