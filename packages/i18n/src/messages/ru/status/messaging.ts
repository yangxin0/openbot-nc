import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/messaging";

export const messages = {
  "status.messaging.working": "Уже работаю…",
  "status.messaging.queued": "Ожидание: предыдущий запрос ещё выполняется. Ответ придёт сюда.",
  "status.messaging.busy": "В очереди слишком много запросов. Повторите попытку позже.",
  "status.messaging.failed": "OpenBot-NC не смог завершить этот запрос. Подробности — на хосте OpenBot-NC.",
  "status.messaging.noAnswer": "OpenBot-NC завершил работу без письменного ответа.",
  "status.messaging.noAgent":
    "Пока нет агента, который мог бы здесь ответить. Добавьте Оркестратора Slack в OpenBot-NC.",
  "status.messaging.delegated": "Над этим работает один из агентов. Ответ придёт сюда.",
  "status.messaging.stopped": "Остановлено.",
  "status.messaging.stop": "Остановить",
  "status.messaging.approvalTitle": "OpenBot-NC просит подтверждения, чтобы продолжить.",
  "status.messaging.approvalTitleTeammate": "Агент {agent} просит подтверждения, чтобы продолжить.",
  "status.messaging.approvalCommand": "Выполнить команду",
  "status.messaging.approvalFileChange": "Изменить файлы",
  "status.messaging.approvalPermissions": "Получить дополнительные разрешения",
  "status.messaging.approve": "Одобрить",
  "status.messaging.deny": "Отклонить",
  "status.messaging.approvedBy": "Одобрено: {user}.",
  "status.messaging.deniedBy": "Отклонено: {user}.",
  "status.messaging.answeredOnHost": "Отвечено на хосте OpenBot-NC.",
  "status.messaging.requestInactive": "Этот запрос больше не активен.",
  "status.messaging.onlyRequester": "Это может сделать только {user}. Ответить также может хост OpenBot-NC.",
  "status.messaging.hostOnly": "На этот запрос может ответить только хост OpenBot-NC.",
  "status.messaging.filesSkipped": "Некоторые файлы не отправлены: {names}.",
  "status.messaging.integrationsSection": "Интеграции",
  "status.messaging.whatsappNoAgent":
    "Пока нет агента, который мог бы здесь ответить. Добавьте Оркестратора WhatsApp в OpenBot-NC.",
  "status.messaging.whatsappApprovalMenu": "Ответьте 1, чтобы одобрить, или 2, чтобы отклонить.",
  "status.messaging.whatsappStopMenu": "Ответьте «stop», чтобы остановить.",
  "status.messaging.whatsappPairingCode":
    "Этот номер отвечает только людям, которым разрешил владелец. Передайте владельцу этот код: {code}",
  "status.messaging.whatsappPairingApproved": "Теперь вы можете отправлять запросы на этот номер.",
  "status.messaging.whatsappOwnChat": "Сообщение себе",
  "status.messaging.whatsappWelcomeOwn":
    "👋 *OpenBot-NC подключён*\n\nПишите сюда, чтобы обратиться к своим агентам. WhatsApp Orchestrator отвечает сам или передаёт работу нужному агенту.\n\nОтправьте *stop*, чтобы остановить запрос.",
  "status.messaging.whatsappWelcomeDedicated":
    "👋 *OpenBot-NC подключён*\n\nЛюди, которым вы разрешите в OpenBot-NC, теперь могут писать на этот номер. Новый человек получит код: одобрите его в OpenBot-NC в разделе «Запросы».\n\nОтправьте *stop*, чтобы остановить запрос.",
  "status.messaging.whatsappOtherOpenBot":
    "К этому номеру WhatsApp привязан ещё один OpenBot-NC, поэтому вы можете получать два ответа. Чтобы это исправить, откройте «Связанные устройства» в WhatsApp на телефоне и выйдите из OpenBot-NC, которым вы не пользуетесь.",
  "status.messaging.whatsappPaused":
    "OpenBot-NC перестал отвечать здесь на 10 минут: за короткое время пришло слишком много сообщений. Если к этому номеру привязан ещё один OpenBot-NC, откройте «Связанные устройства» в WhatsApp на телефоне и выйдите из OpenBot-NC, которым вы не пользуетесь.",
  "status.messaging.whatsappNotDelivered": "WhatsApp не принял этот ответ, поэтому человек его не получил.",
  "status.messaging.whatsappPartlyDelivered":
    "WhatsApp принял этот ответ не полностью, поэтому человек получил только его часть.",
  "status.messaging.whatsappOrchestratorName": "Оркестратор WhatsApp",
  "status.messaging.whatsappOrchestratorTitle": "Отвечает в WhatsApp и обращается к команде",
} as const satisfies PartialTranslation<typeof source>;
