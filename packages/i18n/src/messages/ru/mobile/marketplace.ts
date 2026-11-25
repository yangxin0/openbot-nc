import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/marketplace";

export const messages = {
  "mobile.marketplace.app.slackTagline": "Упоминания и личные сообщения в Slack",
  "mobile.marketplace.app.discordTagline": "Упоминания и личные сообщения в Discord",
  "mobile.marketplace.app.telegramTagline": "Группы и личные чаты в Telegram",
  "mobile.marketplace.app.whatsappTagline": "Свой чат и разрешённые люди в WhatsApp",
  "mobile.marketplace.app.githubTagline": "Репозитории, задачи и пул-реквесты",
  "mobile.marketplace.app.onePasswordTagline": "Вход на сайты с общими учётными данными",
  "mobile.marketplace.app.bitwardenTagline": "Вход на сайты с учётными данными из общей папки",
  "mobile.marketplace.app.protonPassTagline": "Вход на сайты с учётными данными из общего хранилища",
  "mobile.marketplace.error.signInUnsupported": "Обновите OpenBot на сервере, чтобы входить в приложения с телефона.",
  "mobile.marketplace.app.connect": "Подключить",
  "mobile.marketplace.app.signInIntro":
    "Войдите на странице приложения. Вход хранится на сервере, а не на этом телефоне.",
  "mobile.marketplace.app.stepOpen": "Откройте страницу входа {name}.",
  "mobile.marketplace.app.stepAllow": "Войдите и разрешите доступ.",
  "mobile.marketplace.app.stepBlank": "Последняя страница не загрузится. Так и должно быть.",
  "mobile.marketplace.app.stepCopy": "Нажмите на адресную строку и скопируйте весь адрес.",
  "mobile.marketplace.app.stepPaste": "Вернитесь в OpenBot и вставьте адрес ниже.",
  "mobile.marketplace.app.connected": "Подключено",
  "mobile.marketplace.app.connectFailed": "Не удалось подключить приложение.",
  "mobile.marketplace.app.waiting": "Ожидание страницы входа…",
  "mobile.marketplace.app.openAgain": "Снова открыть страницу входа",
  "mobile.marketplace.app.pasteLabel": "Адрес после входа",
  "mobile.marketplace.app.pasteInvalid": "Этот адрес не является концом этого входа.",
  "mobile.marketplace.app.finishSignIn": "Завершить вход",
  "mobile.marketplace.app.openFailed": "Не удалось открыть страницу входа.",
} as const satisfies PartialTranslation<typeof source>;
