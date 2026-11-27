import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/messaging";

export const messages = {
  "status.messaging.working": "جارٍ العمل على ذلك…",
  "status.messaging.queued": "في الانتظار حتى ينتهي طلب سابق. ستصل الإجابة هنا.",
  "status.messaging.busy": "هناك طلبات كثيرة جدًا في الانتظار. أعد المحاولة لاحقًا.",
  "status.messaging.failed": "تعذّر على OpenBot-NC إنهاء هذا الطلب. التفاصيل لدى مضيف OpenBot-NC.",
  "status.messaging.noAnswer": "انتهى OpenBot-NC دون إجابة مكتوبة.",
  "status.messaging.noAgent": "لا يوجد وكيل يستطيع الإجابة هنا بعد. أضف Slack Orchestrator في OpenBot-NC.",
  "status.messaging.delegated": "يعمل زميل على ذلك. ستصل الإجابة هنا.",
  "status.messaging.stopped": "تم الإيقاف.",
  "status.messaging.stop": "إيقاف",
  "status.messaging.approvalTitle": "يطلب OpenBot-NC الموافقة للمتابعة.",
  "status.messaging.approvalTitleTeammate": "يطلب الزميل {agent} الموافقة للمتابعة.",
  "status.messaging.approvalCommand": "تشغيل أمر",
  "status.messaging.approvalFileChange": "تغيير الملفات",
  "status.messaging.approvalPermissions": "الحصول على أذونات إضافية",
  "status.messaging.approve": "موافقة",
  "status.messaging.deny": "رفض",
  "status.messaging.approvedBy": "وافق عليه {user}.",
  "status.messaging.deniedBy": "رفضه {user}.",
  "status.messaging.answeredOnHost": "تمت الإجابة على مضيف OpenBot-NC.",
  "status.messaging.requestInactive": "لم يعد هذا الطلب نشطًا.",
  "status.messaging.onlyRequester": "لا يستطيع فعل ذلك إلا {user}. يستطيع مضيف OpenBot-NC أيضًا الإجابة.",
  "status.messaging.hostOnly": "لا يستطيع الإجابة على هذا الطلب إلا مضيف OpenBot-NC.",
  "status.messaging.filesSkipped": "لم تُرسَل بعض الملفات: {names}.",
  "status.messaging.integrationsSection": "التكاملات",
  "status.messaging.whatsappNoAgent": "لا يوجد وكيل يستطيع الإجابة هنا بعد. أضف WhatsApp Orchestrator في OpenBot-NC.",
  "status.messaging.whatsappApprovalMenu": "أرسل 1 للموافقة أو 2 للرفض.",
  "status.messaging.whatsappStopMenu": "أرسل stop للإيقاف.",
  "status.messaging.whatsappPairingCode":
    "يجيب هذا الرقم عن الأشخاص الذين سمح لهم مالكه فقط. أعطِ المالك هذا الرمز: {code}",
  "status.messaging.whatsappPairingApproved": "يمكنك الآن إرسال الطلبات إلى هذا الرقم.",
  "status.messaging.whatsappOwnChat": "مراسلة نفسك",
  "status.messaging.whatsappWelcomeOwn":
    "👋 *OpenBot-NC متصل*\n\nاكتب هنا لتسأل وكلاءك. يجيب WhatsApp Orchestrator، أو يسند العمل إلى الوكيل المناسب.\n\nأرسل *stop* لإيقاف طلب.",
  "status.messaging.whatsappWelcomeDedicated":
    "👋 *OpenBot-NC متصل*\n\nيستطيع الأشخاص الذين تسمح لهم في OpenBot-NC الكتابة الآن إلى هذا الرقم. يحصل الشخص الجديد على رمز: وافق عليه في OpenBot-NC ضمن الطلبات.\n\nأرسل *stop* لإيقاف طلب.",
  "status.messaging.whatsappOtherOpenBot":
    "يوجد OpenBot-NC آخر مرتبط برقم واتساب هذا، لذلك قد تصلك إجابتان. لإصلاح ذلك، افتح الأجهزة المرتبطة في واتساب على هاتفك وسجّل الخروج من OpenBot-NC الذي لا تستخدمه.",
  "status.messaging.whatsappPaused":
    "توقّف OpenBot-NC عن الرد هنا لمدة 10 دقائق: وصلت رسائل كثيرة جدًا في وقت قصير. إذا كان OpenBot-NC آخر مرتبطًا بهذا الرقم، فافتح الأجهزة المرتبطة في واتساب على هاتفك وسجّل الخروج من OpenBot-NC الذي لا تستخدمه.",
  "status.messaging.whatsappNotDelivered": "لم يقبل واتساب هذه الإجابة، لذلك لم يستلمها الشخص.",
  "status.messaging.whatsappPartlyDelivered": "لم يقبل واتساب هذه الإجابة كاملة، لذلك استلم الشخص جزءًا منها فقط.",
  "status.messaging.whatsappOrchestratorName": "WhatsApp Orchestrator",
  "status.messaging.whatsappOrchestratorTitle": "يجيب في WhatsApp ويسأل الفريق",
} as const satisfies PartialTranslation<typeof source>;
