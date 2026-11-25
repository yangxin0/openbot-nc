import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/startup";

export const messages = {
  "startup.failedTitle": "تعذّر بدء تشغيل OpenBot-NC",
  "startup.failedBody":
    "{message}\n\nلم تُعَد تعيين بياناتك المحلية ولم يُكتب فوقها. راجع دليل استكشاف الأخطاء وإصلاحها لمعرفة خطوات الاسترداد.",
  "startup.archiveChangedTitle": "تم تغيير ملفات OpenBot-NC",
  "startup.archiveChangedBody":
    "غيّر برنامج آخر ملف OpenBot-NC المسمى app.asar. يعمل OpenBot-NC الآن، لكنه لن يفتح بعد إنهائه.\n\nلإصلاح OpenBot-NC، ثبّته من جديد. تبقى بياناتك المحلية.",
  "startup.filesDamagedBody":
    "بعض ملفات OpenBot-NC تالفة أو مفقودة.\n\nلإصلاح OpenBot-NC، ثبّته من جديد. تبقى بياناتك المحلية.",
  "startup.newerDataTitle": "ثبّت أحدث إصدار من OpenBot-NC",
  "startup.newerDataBody":
    "حفظ إصدار أحدث من OpenBot-NC بياناتك، ولا يستطيع هذا الإصدار ({version}) فتحها. ثبّت أحدث إصدار لفتح بياناتك.\n\nلم تتم إعادة تعيين بياناتك المحلية أو الكتابة فوقها.",
  "startup.newerDataQuit": "إنهاء",
  "startup.newerDataLoopTitle": "لم يُفتح أحدث إصدار من OpenBot-NC",
  "startup.newerDataLoopBody":
    "حفظ إصدار أحدث من OpenBot-NC بياناتك، ولا يستطيع هذا الإصدار ({version}) فتحها. توقف OpenBot-NC {loopVersion} قبل أن يُفتح عدة مرات متتالية، لذلك لن يُثبَّت مرة أخرى.\n\nثبّت إصدارًا أحدث من {loopVersion} عندما يتوفر. للحصول على المساعدة، افتح الدليل.\n\nلم تتم إعادة تعيين بياناتك المحلية أو الكتابة فوقها.",
  "startup.recoveryWindowTitle": "استرداد OpenBot-NC",
  "startup.recoveryTitle": "لم يُفتح OpenBot-NC",
  "startup.recoveryBody": {
    zero: "توقف OpenBot-NC {version} قبل أن يُفتح {count} مرة متتالية. لم تتم إعادة تعيين بياناتك المحلية أو الكتابة فوقها.",
    one: "توقف OpenBot-NC {version} قبل أن يُفتح مرة واحدة ({count}). لم تتم إعادة تعيين بياناتك المحلية أو الكتابة فوقها.",
    two: "توقف OpenBot-NC {version} قبل أن يُفتح مرتين متتاليتين ({count}). لم تتم إعادة تعيين بياناتك المحلية أو الكتابة فوقها.",
    few: "توقف OpenBot-NC {version} قبل أن يُفتح {count} مرات متتالية. لم تتم إعادة تعيين بياناتك المحلية أو الكتابة فوقها.",
    many: "توقف OpenBot-NC {version} قبل أن يُفتح {count} مرة متتالية. لم تتم إعادة تعيين بياناتك المحلية أو الكتابة فوقها.",
    other:
      "توقف OpenBot-NC {version} قبل أن يُفتح {count} مرة متتالية. لم تتم إعادة تعيين بياناتك المحلية أو الكتابة فوقها.",
  },
  "startup.recoveryHint":
    "أعد المحاولة، أو ثبّت آخر إصدار فُتح. للحصول على المساعدة، صدّر بيانات التشخيص وأرسل الملف مع بلاغك.",
  "startup.recoveryHintLatest":
    "لم يجد OpenBot-NC إصدارًا سابقًا يستطيع فتح بياناتك. أعد المحاولة، أو ثبّت أحدث إصدار. للحصول على المساعدة، صدّر بيانات التشخيص وأرسل الملف مع بلاغك.",
  "startup.recoveryRetry": "إعادة المحاولة",
  "startup.recoveryExportDiagnostics": "تصدير التشخيص",
  "startup.recoveryOpenDataFolder": "فتح مجلد البيانات",
  "startup.recoveryQuit": "إنهاء",
  "startup.recoveryDiagnosticsSaved": "تم حفظ ملف التشخيص.",
  "startup.recoveryActionFailed": "تعذّر على OpenBot-NC تنفيذ هذا الإجراء.",
} as const satisfies PartialTranslation<typeof source>;
