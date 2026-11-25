import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/auth";

export const messages = {
  "mobile.auth.logo.animate": "تحريك شعار OpenBot-NC",
  "mobile.auth.logo.animateHint": "يجعل الشعار يغمز",
  "mobile.auth.scanner.connectFailed": "تعذّر الاتصال",
  "mobile.auth.scanner.codeFailed": "تعذّر استخدام هذا الرمز",
  "mobile.auth.scanner.scanAgain": "المسح مرة أخرى",
  "mobile.auth.scanner.connecting": "جارٍ ربط هاتفك…",
  "mobile.auth.scanner.readingInvitation": "جارٍ قراءة الدعوة…",
  "mobile.auth.scanner.scanDesktop": "امسح رمز الحاسوب المكتبي",
  "mobile.auth.scanner.scanInvitation": "امسح رمز الدعوة",
  "mobile.auth.scanner.verifying": "جارٍ التحقق من الرمز لمرة واحدة.",
  "mobile.auth.scanner.checkingServer": "جارٍ التحقق من هوية الخادم.",
  "mobile.auth.scanner.keepCentered": "أبقِ رمز QR في وسط الإطار.",
  "mobile.auth.scanner.connectFallback": "تعذّر على OpenBot-NC ربط هذا الهاتف.",
  "mobile.auth.scanner.cameraFailed": "تعذّر تشغيل الكاميرا. أعد المحاولة.",
  "mobile.auth.camera.title": "يلزم الوصول إلى الكاميرا",
  "mobile.auth.camera.pairingReason":
    "يستخدم OpenBot-NC الكاميرا فقط لمسح رمز QR لمرة واحدة الظاهر في تطبيق الحاسوب المكتبي.",
  "mobile.auth.camera.invitationReason": "يستخدم OpenBot-NC الكاميرا فقط لمسح رمز QR للدعوة.",
  "mobile.auth.camera.blocked":
    "الوصول إلى الكاميرا محظور. فعّله لـ OpenBot-NC في إعدادات الجهاز، ثم ارجع إلى هنا لمسح الرمز.",
  "mobile.auth.camera.allow": "السماح بالوصول إلى الكاميرا",
  "mobile.auth.camera.openSettings": "فتح الإعدادات",
  "mobile.auth.error.signOutUnconfirmed": "تعذّر تأكيد تسجيل الخروج. تحقق من اتصالك وأعد المحاولة.",
} as const satisfies PartialTranslation<typeof source>;
