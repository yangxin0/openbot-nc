import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/voice";

export const messages = {
  "error.voice.downloadFailed": "تعذّر تنزيل نموذج الصوت. أعد المحاولة.",
  "error.voice.downloadStopped": "تم إيقاف تنزيل نموذج الصوت.",
  "error.voice.removeBusy": "انتظر حتى ينتهي التفريغ الصوتي، ثم أزل النموذج.",
  "error.voice.removeFailed": "تعذّرت إزالة نموذج الصوت. أعد المحاولة.",
  "error.voice.runtimeUnavailable": "التفريغ الصوتي المحلي غير متاح على هذا النظام.",
  "error.voice.modelUnavailable": "نموذج الصوت غير متاح.",
  "error.voice.transcriptionTimedOut": "انتهت مهلة التفريغ الصوتي.",
  "error.voice.prepareRequired": "التفريغ الصوتي المحلي غير متاح. شغّل `bun run voice:prepare` وأعد تشغيل OpenBot.",
  "error.voice.transcriptionFailed": "تعذّر على OpenBot تفريغ هذا التسجيل.",
  "error.voice.videoModelMissing": "لم يتم إعداد نموذج للتعرّف على الكلام في التسجيلات في الإعدادات → الصوت.",
  "error.voice.videoModelMissingServer":
    "لم يتم إعداد نموذج للتعرّف على الكلام على هذا الخادم. يمكن للمالك أو المسؤول إعداد نموذج في إعدادات الخادم، في قسم التعرّف على الكلام.",
  "error.voice.cloud.keyRequired": "أضف مفتاح {provider} API في الإعدادات → الصوت.",
  "error.voice.cloud.keyRejected": "لم يقبل {provider} مفتاح API. تحقّق من المفتاح في الإعدادات → الصوت.",
  "error.voice.cloud.quotaExceeded": "استُنفدت حصتك في {provider}.",
  "error.voice.cloud.rateLimited": "{provider} مشغول. أعد المحاولة بعد قليل.",
  "error.voice.cloud.termsRequired": "اقبل شروط ElevenLabs في حسابك على ElevenLabs، ثم أعد المحاولة.",
  "error.voice.cloud.streamEnded": "انتهى بث الإملاء. سجّل مرة أخرى.",
  "error.voice.cloud.tooLong": "التسجيل طويل جدًا.",
  "error.voice.cloud.keySaveFailed": "تعذّر حفظ مفتاح {provider} API.",
  "error.voice.speech.runtimeUnavailable": "النطق المحلي غير متاح على هذا النظام.",
  "error.voice.speech.modelRequired": "نزّل نموذج النطق في الإعدادات → الصوت.",
  "error.voice.speech.timedOut": "انتهت مهلة قراءة الرد بصوت عالٍ.",
  "error.voice.speech.failed": "تعذّر على OpenBot قراءة الرد بصوت عالٍ.",
  "error.voice.speech.providerRefused": "رفضت {provider} إنشاء الصوت: {reason}",
  "error.voice.recordingNotKept": "تعذّر على OpenBot الاحتفاظ بالتسجيل الصوتي.",
  "error.voice.server.routeOff": "خادم الصوت غير مُعدّ لهذا. تحقّق من الإعدادات → الصوت.",
  "error.voice.server.keyRefused": "رفض {host} مفتاح API.",
  "error.voice.server.invalidAnswer": "لم يرسل {host} ردًا متوافقًا مع OpenAI.",
  "error.voice.server.invalidAudio": "أرسل {host} صوتًا لا يمكن لـ OpenBot تشغيله. استخدم خادمًا يرسل WAV.",
  "error.voice.server.tooLarge": "الرد من {host} كبير جدًا.",
  "error.voice.server.modelUnsupported":
    "لا يستطيع {host} التفريغ النصي باستخدام {model}. في الإعدادات ← الصوت، اختر نموذج إملاء آخر لخادم الصوت.",
} as const satisfies PartialTranslation<typeof source>;
