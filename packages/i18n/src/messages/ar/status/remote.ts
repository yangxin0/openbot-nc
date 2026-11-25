import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/remote";

export const messages = {
  "status.remote.stagePreferences": "جارٍ تحميل تفضيلات الدردشة المحلية: {reason}",
  "status.remote.stageConnection": "جارٍ الاتصال بسطح المكتب: {reason}",
  "status.remote.stageCompatibility": "جارٍ التحقق من توافق سطح المكتب: {reason}",
  "status.remote.stageAgents": "جارٍ تحميل الوكلاء: {reason}",
  "status.remote.stageReads": "جارٍ تحميل حالة القراءة: {reason}",
  "status.remote.suspendedDetail": "حدّث OpenBot Mobile أو تطبيق سطح المكتب قبل الاتصال.\n{detail}",
  "status.remote.cooldownDetail": "فشل الاتصال بعد {limit} محاولات. إعادة المحاولة خلال {minutes}:{seconds}.\n{detail}",
  "status.remote.cooldown": "فشل الاتصال بعد {limit} محاولات. إعادة المحاولة خلال {minutes}:{seconds}.",
  "status.remote.connectionLostDetail": {
    zero: "انقطع الاتصال. إعادة المحاولة الآن.\n{detail}",
    one: "انقطع الاتصال. إعادة المحاولة خلال ثانية واحدة.\n{detail}",
    two: "انقطع الاتصال. إعادة المحاولة خلال ثانيتين.\n{detail}",
    few: "انقطع الاتصال. إعادة المحاولة خلال {count} ثوانٍ.\n{detail}",
    many: "انقطع الاتصال. إعادة المحاولة خلال {count} ثانية.\n{detail}",
    other: "انقطع الاتصال. إعادة المحاولة خلال {count} ثانية.\n{detail}",
  },
  "status.remote.connectionLost": {
    zero: "انقطع الاتصال. إعادة المحاولة الآن.",
    one: "انقطع الاتصال. إعادة المحاولة خلال ثانية واحدة.",
    two: "انقطع الاتصال. إعادة المحاولة خلال ثانيتين.",
    few: "انقطع الاتصال. إعادة المحاولة خلال {count} ثوانٍ.",
    many: "انقطع الاتصال. إعادة المحاولة خلال {count} ثانية.",
    other: "انقطع الاتصال. إعادة المحاولة خلال {count} ثانية.",
  },
  "status.remote.attemptFailedDetail": {
    zero: "فشلت محاولة الاتصال. إعادة المحاولة الآن.\n{detail}",
    one: "فشلت محاولة الاتصال. إعادة المحاولة خلال ثانية واحدة.\n{detail}",
    two: "فشلت محاولة الاتصال. إعادة المحاولة خلال ثانيتين.\n{detail}",
    few: "فشلت محاولة الاتصال. إعادة المحاولة خلال {count} ثوانٍ.\n{detail}",
    many: "فشلت محاولة الاتصال. إعادة المحاولة خلال {count} ثانية.\n{detail}",
    other: "فشلت محاولة الاتصال. إعادة المحاولة خلال {count} ثانية.\n{detail}",
  },
  "status.remote.attemptFailed": {
    zero: "فشلت محاولة الاتصال. إعادة المحاولة الآن.",
    one: "فشلت محاولة الاتصال. إعادة المحاولة خلال ثانية واحدة.",
    two: "فشلت محاولة الاتصال. إعادة المحاولة خلال ثانيتين.",
    few: "فشلت محاولة الاتصال. إعادة المحاولة خلال {count} ثوانٍ.",
    many: "فشلت محاولة الاتصال. إعادة المحاولة خلال {count} ثانية.",
    other: "فشلت محاولة الاتصال. إعادة المحاولة خلال {count} ثانية.",
  },
  "status.remote.reconnectingDetail": {
    zero: "جارٍ إعادة الاتصال {attempt}/{count}\n{detail}",
    one: "جارٍ إعادة الاتصال {attempt}/{count}\n{detail}",
    two: "جارٍ إعادة الاتصال {attempt}/{count}\n{detail}",
    few: "جارٍ إعادة الاتصال {attempt}/{count}\n{detail}",
    many: "جارٍ إعادة الاتصال {attempt}/{count}\n{detail}",
    other: "جارٍ إعادة الاتصال {attempt}/{count}\n{detail}",
  },
  "status.remote.reconnecting": {
    zero: "جارٍ إعادة الاتصال {attempt}/{count}",
    one: "جارٍ إعادة الاتصال {attempt}/{count}",
    two: "جارٍ إعادة الاتصال {attempt}/{count}",
    few: "جارٍ إعادة الاتصال {attempt}/{count}",
    many: "جارٍ إعادة الاتصال {attempt}/{count}",
    other: "جارٍ إعادة الاتصال {attempt}/{count}",
  },
  "status.remote.messageCut":
    "[لا يظهر {size} ميغابايت من هذه الرسالة على هذا الجهاز. افتحها على الكمبيوتر الذي يشغّل الخادم لقراءتها كاملة.]",
} as const satisfies PartialTranslation<typeof source>;
