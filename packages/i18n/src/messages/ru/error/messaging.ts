import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/messaging";

export const messages = {
  "error.messaging.notConnected": "Это рабочее пространство Slack не подключено.",
  "error.messaging.whatsappNotConnected": "Этот номер WhatsApp не подключён.",
  "error.messaging.whatsappUnsupported": "Этот компьютер не может подключиться к WhatsApp.",
  "error.messaging.whatsappTooManySenders": "Номер WhatsApp может разрешить не более 200 контактов и групп.",
  "error.messaging.whatsappNumberNotFound":
    "У этого номера нет аккаунта WhatsApp. Введите его с кодом страны, например +44 7700 900123.",
  "error.messaging.whatsappSenderNotFound": "Этого контакта или группы больше нет в списке.",
  "error.messaging.whatsappRequestEnded":
    "Срок этого запроса истёк. Попросите человека написать снова, чтобы получить новый код.",
  "error.messaging.memoryLimit":
    "В подключённом рабочем пространстве может быть не более {limit} записей памяти. Сначала удалите одну.",
} as const satisfies PartialTranslation<typeof source>;
