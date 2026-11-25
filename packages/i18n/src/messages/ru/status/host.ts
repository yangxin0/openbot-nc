import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/host";

export const messages = {
  "status.host.identityUpdated": "Идентификатор сервера обновлён.",
  "status.host.signalLost": "Другие устройства сейчас не могут подключиться к этому OpenBot-NC. Он подключается снова.",
  "status.host.stopping": "Перевод этого OpenBot-NC в приватный режим…",
  "status.host.private": "Этот OpenBot-NC приватный.",
  "status.host.removed": "Этот OpenBot-NC удалён из вашего аккаунта. Опубликуйте его снова, чтобы открыть доступ.",
} as const satisfies PartialTranslation<typeof source>;
