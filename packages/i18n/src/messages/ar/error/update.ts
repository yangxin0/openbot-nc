import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/update";

export const messages = {
  "error.update.unsupported": "التحديثات متاحة في إصدارات سطح المكتب المثبّتة.",
  "error.update.noSelfUpdate": "هذا الإصدار لا يحدّث نفسه. لتحديث OpenBot-NC، ثبّت إصدارًا أحدث يدويًا.",
  "error.update.notReady": "لا يوجد تحديث جاهز للتثبيت.",
  "error.update.restartFailed": "تعذّر على OpenBot-NC إعادة التشغيل لتثبيت التحديث.",
  "error.update.downloadStalled": "توقف تنزيل التحديث عن الاستجابة. حاول مرة أخرى.",
  "error.update.installFailed": "تعذّر تثبيت التحديث. أغلق OpenBot-NC وأعد فتحه، ثم حاول مرة أخرى.",
  "error.update.notInstalled": "لم تُثبِّت إعادة التشغيل الأخيرة التحديث. أعد التشغيل للمحاولة مرة أخرى.",
  "error.update.downloadFailed": "تعذّر تنزيل التحديث. حاول مرة أخرى.",
  "error.update.signatureNotConfirmed":
    "تعذّر على OpenBot-NC التحقق من التحديث. حاول مرة أخرى. إذا استمر هذا الخطأ، فثبّت OpenBot-NC مرة أخرى من المكان الذي حصلت عليه منه.",
  "error.update.checkFailed": "تعذّر التحقق من وجود تحديثات. حاول مرة أخرى.",
  "error.update.checkStalled": "توقف التحقق من التحديثات عن الاستجابة. حاول مرة أخرى.",
  "error.update.checkOffline": "تعذّر الوصول إلى خدمة التحديث. تحقق من اتصالك بالإنترنت، ثم حاول مرة أخرى.",
  "error.update.checkUnavailable": "لم تستجب خدمة التحديث. سيحاول OpenBot-NC مرة أخرى تلقائيًا خلال بضع دقائق.",
  "error.update.checkNoRelease":
    "لم يُعثر على تحديث منشور لهذه المنصة. سيحاول OpenBot-NC مرة أخرى تلقائيًا خلال بضع دقائق.",
  "error.update.managedByNix": "يثبّت Nix التحديثات لهذه النسخة من OpenBot-NC. حدّثها باستخدام Nix.",
  "error.update.managedByHost": "يثبّت المضيف التحديثات على جهاز Mac هذا. يبقى التحديث جاهزًا حتى تُجرى صيانة المضيف.",
  "error.update.siblingSession":
    "لا تزال جلسة OpenBot-NC أخرى تعمل من هذا التطبيق. أوقف OpenBot-NC في كل حسابات مستخدمي macOS الأخرى أولًا، ثم ثبّت التحديث مرة أخرى.",
  "error.update.siblingSessionSameAccount":
    "لا تزال عملية OpenBot-NC أخرى تعمل في حساب المستخدم هذا. أغلقها، ثم ثبّت التحديث مرة أخرى.",
  "error.update.siblingCheckFailed": "تعذّر التحقق من جلسات OpenBot-NC الأخرى. حاول مرة أخرى قبل التثبيت.",
  "error.update.readOnlyLocation":
    "لا يمكن لـ OpenBot-NC تثبيت التحديثات من هذا الموقع. أغلق OpenBot-NC. في Finder، اسحب OpenBot-NC إلى مجلد التطبيقات (إذا كان موجودًا هناك بالفعل، فاسحبه خارجه ثم أعده إليه). ثم افتح OpenBot-NC وثبّت التحديث مرة أخرى.",
  "error.update.appImageMissing":
    "لا يستطيع OpenBot-NC تثبيت التحديث لأن ملف AppImage الخاص به نُقل أو أُعيدت تسميته أو استُبدل. أغلق OpenBot-NC، ثم افتح ملف AppImage مرة أخرى.",
  "error.update.appImageReadOnly":
    "لا يستطيع OpenBot-NC تثبيت التحديثات في مجلد ملف AppImage الخاص به. أغلق OpenBot-NC، وانقل ملف AppImage إلى مجلد داخل مجلدك الرئيسي، ثم افتحه وثبّت التحديث مرة أخرى.",
  "error.update.remoteDisabled": "التحديثات من مسؤولي الخوادم معطّلة على هذا الحاسوب.",
  "error.update.restartStarted": "يعيد OpenBot-NC التشغيل بالفعل لتثبيت التحديث.",
  "error.update.alreadyRestarting": "يعيد OpenBot-NC التشغيل بالفعل.",
} as const satisfies PartialTranslation<typeof source>;
