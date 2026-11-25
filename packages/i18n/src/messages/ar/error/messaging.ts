import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/messaging";

export const messages = {
  "error.messaging.notConnected": "مساحة عمل Slack هذه غير متصلة.",
  "error.messaging.whatsappNotConnected": "رقم WhatsApp هذا غير متصل.",
  "error.messaging.whatsappUnsupported": "لا يمكن لهذا الحاسوب الاتصال بـ WhatsApp.",
  "error.messaging.whatsappTooManySenders": "يمكن لرقم WhatsApp أن يسمح بما يصل إلى 200 من جهات الاتصال والمجموعات.",
  "error.messaging.whatsappNumberNotFound": "لا يوجد حساب واتساب لهذا الرقم. اكتبه مع رمز الدولة، مثل +44 7700 900123.",
  "error.messaging.whatsappSenderNotFound": "جهة الاتصال أو المجموعة هذه لم تعد في القائمة.",
  "error.messaging.whatsappRequestEnded": "انتهى هذا الطلب. اطلب من الشخص أن يكتب مرة أخرى للحصول على رمز جديد.",
  "error.messaging.memoryLimit": "يمكن أن تحتوي مساحة العمل المتصلة على {limit} ذكريات كحد أقصى. احذف واحدة أولًا.",
} as const satisfies PartialTranslation<typeof source>;
