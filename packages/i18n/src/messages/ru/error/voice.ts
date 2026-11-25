import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/voice";

export const messages = {
  "error.voice.downloadFailed": "Не удалось загрузить голосовую модель. Повторите попытку.",
  "error.voice.downloadStopped": "Загрузка голосовой модели остановлена.",
  "error.voice.removeBusy": "Дождитесь окончания расшифровки голоса, затем удалите модель.",
  "error.voice.removeFailed": "Не удалось удалить голосовую модель. Повторите попытку.",
  "error.voice.runtimeUnavailable": "Локальная расшифровка голоса недоступна на этой платформе.",
  "error.voice.modelUnavailable": "Голосовая модель недоступна.",
  "error.voice.transcriptionTimedOut": "Время расшифровки голоса истекло.",
  "error.voice.prepareRequired":
    "Локальная расшифровка голоса недоступна. Выполните `bun run voice:prepare` и перезапустите OpenBot.",
  "error.voice.transcriptionFailed": "OpenBot не смог расшифровать эту запись.",
  "error.voice.videoModelMissing":
    "В разделе «Настройки» → «Голос» не настроена модель распознавания речи для записей.",
  "error.voice.videoModelMissingServer":
    "На этом сервере не настроена модель распознавания речи. Владелец или администратор может настроить модель в настройках сервера, в разделе «Распознавание речи».",
  "error.voice.cloud.keyRequired": "Добавьте API-ключ {provider} в разделе «Настройки» → «Голос».",
  "error.voice.cloud.keyRejected": "{provider} не принял API-ключ. Проверьте ключ в разделе «Настройки» → «Голос».",
  "error.voice.cloud.quotaExceeded": "Квота {provider} исчерпана.",
  "error.voice.cloud.rateLimited": "{provider} перегружен. Повторите попытку чуть позже.",
  "error.voice.cloud.termsRequired": "Примите условия ElevenLabs в своём аккаунте ElevenLabs и повторите попытку.",
  "error.voice.cloud.streamEnded": "Передача диктовки прервалась. Запишите ещё раз.",
  "error.voice.cloud.tooLong": "Запись слишком длинная.",
  "error.voice.cloud.keySaveFailed": "Не удалось сохранить API-ключ {provider}.",
  "error.voice.speech.runtimeUnavailable": "Локальный синтез речи недоступен на этой платформе.",
  "error.voice.speech.modelRequired": "Скачайте модель синтеза речи в разделе «Настройки» → «Голос».",
  "error.voice.speech.timedOut": "Время чтения ответа вслух истекло.",
  "error.voice.speech.failed": "OpenBot не смог прочитать ответ вслух.",
  "error.voice.speech.providerRefused": "{provider} отказался создать аудио: {reason}",
  "error.voice.recordingNotKept": "OpenBot не смог сохранить голосовую запись.",
  "error.voice.server.modelUnsupported":
    "{host} не может распознавать речь с моделью {model}. В Настройки → Голос выберите другую модель диктовки для голосового сервера.",
} as const satisfies PartialTranslation<typeof source>;
