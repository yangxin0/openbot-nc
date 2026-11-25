import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/share";

export const messages = {
  "mobile.share.reading": "Чтение того, чем вы поделились…",
  "mobile.share.readFailed": "OpenBot-NC не удалось прочитать то, чем вы поделились. Поделитесь ещё раз.",
  "mobile.share.content": "Что отправить",
  "mobile.share.footer":
    "Чат откроется с этим содержимым в поле сообщения. Ничего не будет отправлено, пока вы не отправите это.",
  "mobile.share.sendFooter": "OpenBot-NC отправит это агенту, затем откроет чат.",
  "mobile.share.lastUsed": "Последний использованный",
  "mobile.share.noAgents": "Нет агентов",
  "mobile.share.chooseAgent": "Выберите агента",
  "mobile.share.action": "Поделиться: {name}",
  "mobile.share.extension.send": "Отправить",
  "mobile.share.extension.message": "Добавить сообщение",
  "mobile.share.extension.sending": "Отправка: {name}…",
} as const satisfies PartialTranslation<typeof source>;
