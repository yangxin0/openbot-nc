import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/marketplace";

export const messages = {
  "mobile.marketplace.app.slackTagline": "الإشارات والرسائل المباشرة في Slack",
  "mobile.marketplace.app.discordTagline": "الإشارات والرسائل المباشرة في Discord",
  "mobile.marketplace.app.telegramTagline": "المجموعات والدردشات المباشرة في Telegram",
  "mobile.marketplace.app.whatsappTagline": "دردشتك الخاصة والأشخاص الذين تسمح لهم في WhatsApp",
  "mobile.marketplace.app.githubTagline": "المستودعات والمشكلات وطلبات السحب",
  "mobile.marketplace.app.onePasswordTagline": "سجّل الدخول إلى المواقع ببيانات الدخول التي تشاركها",
  "mobile.marketplace.app.bitwardenTagline": "سجّل الدخول إلى المواقع ببيانات دخول من مجلد مشترك",
  "mobile.marketplace.app.protonPassTagline": "سجّل الدخول إلى المواقع ببيانات دخول من خزنة مشتركة",
  "mobile.marketplace.error.signInUnsupported": "حدّث OpenBot-NC على الخادم لتسجيل الدخول إلى التطبيقات من الهاتف.",
  "mobile.marketplace.app.connect": "اتصال",
  "mobile.marketplace.app.signInIntro": "سجّل الدخول في صفحة التطبيق. يحتفظ الخادم بتسجيل الدخول، لا هذا الهاتف.",
  "mobile.marketplace.app.stepOpen": "افتح صفحة تسجيل الدخول إلى {name}.",
  "mobile.marketplace.app.stepAllow": "سجّل الدخول واسمح بالوصول.",
  "mobile.marketplace.app.stepBlank": "لا تُحمّل الصفحة الأخيرة. هذا صحيح.",
  "mobile.marketplace.app.stepCopy": "اضغط شريط العنوان وانسخ العنوان الكامل.",
  "mobile.marketplace.app.stepPaste": "عد إلى OpenBot-NC والصق العنوان أدناه.",
  "mobile.marketplace.app.connected": "متصل",
  "mobile.marketplace.app.connectFailed": "لم يتصل التطبيق.",
  "mobile.marketplace.app.waiting": "في انتظار صفحة تسجيل الدخول…",
  "mobile.marketplace.app.openAgain": "فتح صفحة تسجيل الدخول مجددًا",
  "mobile.marketplace.app.pasteLabel": "العنوان بعد تسجيل الدخول",
  "mobile.marketplace.app.pasteInvalid": "هذا العنوان ليس نهاية تسجيل الدخول هذا.",
  "mobile.marketplace.app.finishSignIn": "إنهاء تسجيل الدخول",
  "mobile.marketplace.app.openFailed": "لم تُفتح صفحة تسجيل الدخول.",
} as const satisfies PartialTranslation<typeof source>;
