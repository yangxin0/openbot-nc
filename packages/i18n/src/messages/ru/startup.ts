import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/startup";

export const messages = {
  "startup.failedTitle": "OpenBot-NC не удалось запустить",
  "startup.failedBody":
    "{message}\n\nЛокальные данные не сброшены и не перезаписаны. Шаги восстановления — в руководстве по устранению неполадок.",
  "startup.archiveChangedTitle": "Файлы OpenBot-NC изменены",
  "startup.archiveChangedBody":
    "Другая программа изменила файл OpenBot-NC app.asar. Сейчас OpenBot-NC работает, но после выхода он больше не запустится.\n\nЧтобы исправить это, установите OpenBot-NC заново. Ваши локальные данные сохранятся.",
  "startup.filesDamagedBody":
    "Некоторые файлы OpenBot-NC повреждены или отсутствуют.\n\nЧтобы исправить это, установите OpenBot-NC заново. Ваши локальные данные сохранятся.",
  "startup.newerDataTitle": "Установите последнюю версию OpenBot-NC",
  "startup.newerDataBody":
    "Более новая версия OpenBot-NC сохранила ваши данные, и эта версия ({version}) не может их открыть. Установите последнюю версию, чтобы открыть данные.\n\nВаши локальные данные не были сброшены или перезаписаны.",
  "startup.newerDataQuit": "Выйти",
  "startup.newerDataLoopTitle": "Последняя версия OpenBot-NC не открылась",
  "startup.newerDataLoopBody":
    "Более новая версия OpenBot-NC сохранила ваши данные, и эта версия ({version}) не может их открыть. OpenBot-NC {loopVersion} несколько раз подряд останавливался до открытия, поэтому он не будет установлен снова.\n\nУстановите версию новее {loopVersion}, когда она появится. Чтобы получить помощь, откройте руководство.\n\nВаши локальные данные не были сброшены или перезаписаны.",
  "startup.recoveryWindowTitle": "Восстановление OpenBot-NC",
  "startup.recoveryTitle": "OpenBot-NC не открылся",
  "startup.recoveryBody": {
    one: "OpenBot-NC {version} остановился до открытия {count} раз подряд. Ваши локальные данные не сброшены и не перезаписаны.",
    few: "OpenBot-NC {version} остановился до открытия {count} раза подряд. Ваши локальные данные не сброшены и не перезаписаны.",
    many: "OpenBot-NC {version} остановился до открытия {count} раз подряд. Ваши локальные данные не сброшены и не перезаписаны.",
    other:
      "OpenBot-NC {version} остановился до открытия {count} раза подряд. Ваши локальные данные не сброшены и не перезаписаны.",
  },
  "startup.recoveryHint":
    "Попробуйте снова или установите последнюю версию, которая открывалась. Чтобы получить помощь, экспортируйте диагностику и отправьте файл вместе с отчётом.",
  "startup.recoveryHintLatest":
    "OpenBot-NC не нашёл более раннюю версию, которая может открыть ваши данные. Попробуйте снова или установите последнюю версию. Чтобы получить помощь, экспортируйте диагностику и отправьте файл вместе с отчётом.",
  "startup.recoveryRetry": "Повторить",
  "startup.recoveryExportDiagnostics": "Экспорт диагностики",
  "startup.recoveryOpenDataFolder": "Открыть папку данных",
  "startup.recoveryQuit": "Выйти",
  "startup.recoveryDiagnosticsSaved": "Файл диагностики сохранён.",
  "startup.recoveryActionFailed": "OpenBot-NC не удалось выполнить это действие.",
} as const satisfies PartialTranslation<typeof source>;
