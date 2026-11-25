import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/share";

export const messages = {
  "mobile.share.reading": "جارٍ قراءة ما شاركته…",
  "mobile.share.readFailed": "تعذّر على OpenBot-NC قراءة ما شاركته. شاركه مرة أخرى.",
  "mobile.share.content": "للمشاركة",
  "mobile.share.footer": "تُفتح الدردشة وهذا المحتوى في حقل الرسالة. لا يُرسل شيء حتى ترسله أنت.",
  "mobile.share.sendFooter": "يرسل OpenBot-NC هذا إلى الوكيل، ثم يفتح الدردشة.",
  "mobile.share.lastUsed": "آخر استخدام",
  "mobile.share.noAgents": "لا وكلاء",
  "mobile.share.chooseAgent": "اختر وكيلًا",
  "mobile.share.action": "مشاركة مع {name}",
  "mobile.share.extension.send": "إرسال",
  "mobile.share.extension.message": "أضف رسالة",
  "mobile.share.extension.sending": "جارٍ الإرسال إلى {name}…",
} as const satisfies PartialTranslation<typeof source>;
