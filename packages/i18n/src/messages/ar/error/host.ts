import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/host";

export const messages = {
  "error.host.webRtcNotConfigured": "خدمة مضيف WebRTC غير مهيّأة.",
  "error.host.nameBeforePublish": "سمِّ OpenBot هذا قبل نشره.",
  "error.host.publishBeforeInvite": "اجعل OpenBot هذا عامًا قبل إنشاء دعوة.",
  "error.host.teamAccessUnavailable": "وصولك إلى الفريق غير متاح.",
  "error.host.ownerIdentityUnavailable": "هوية مالك المضيف غير متاحة.",
  "error.host.publishFailed": "تعذّر نشر OpenBot هذا.",
  "error.host.noServer": "لا يوجد على هذا الحاسوب خادم لتغييره.",
  "error.host.identityLocalOnly": "لا يمكن تغيير اسم الخادم وشعاره إلا على الحاسوب الذي يشغّله.",
  "error.host.timezoneInvalid": "هذه المنطقة الزمنية غير معروفة.",
  "error.host.signalHomeUnknown": "خادم Signal هذا غير متاح.",
  "error.host.turnLimitInvalid": "هذا الحد للخيوط غير صالح.",
  "error.host.maintenanceInterrupted": "توقفت صيانة المضيف. تحقق من التطبيق وأعد تعيين حالة المضيف قبل إعادة المحاولة.",
  "error.host.updateFailed":
    "فشل تحديث المضيف أثناء {phase}. تحقق من ملكية الحزمة والتوقيع وحالة المستأجر والمساحة الحرة على القرص قبل إعادة تعيين الحالة.",
  "error.host.tenantsNotIdle": "لم يبقَ المستأجرون خاملين لمدة خمس دقائق خلال ساعتين.",
  "error.host.tenantShutdownTimeout": "انتهت مهلة إيقاف المستأجر. لم يبدأ استبدال التطبيق.",
  "error.host.tenantHealthMissing":
    "تقارير سلامة المستأجرين مفقودة أو غير سليمة بعد إعادة التشغيل. افحص جلسات المستأجرين قبل تحديث آخر.",
  "error.host.personalityInvalid": "أسلوب الرد هذا غير معروف.",
} as const satisfies PartialTranslation<typeof source>;
