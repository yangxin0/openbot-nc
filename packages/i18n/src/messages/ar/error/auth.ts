import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/auth";

export const messages = {
  "error.auth.companySignInFailed": "لم يكتمل تسجيل الدخول بحساب الشركة. حاول مرة أخرى.",
  "error.auth.companySignInCancelled": "أُلغي تسجيل الدخول بحساب الشركة.",
  "error.auth.companySignInTimeout": "استغرق تسجيل الدخول بحساب الشركة وقتًا طويلًا. افتح صفحة تسجيل الدخول مرة أخرى.",
  "error.auth.companySignInRefused": "أُلغي تسجيل الدخول في شركتك أو رُفض.",
  "error.auth.companySignInDomainMismatch": "بريد حساب الشركة في نطاق غير موجود في الإعداد.",
  "error.auth.companySignInAccountDisabled": "أوقفت شركتك هذا الحساب. اسأل المسؤول.",
  "error.auth.companySignInOff": "تسجيل الدخول بحساب الشركة متوقف لهذا البريد الإلكتروني.",
  "error.auth.companySignInEmailMissing": "لم يعطِ حساب شركتك عنوان بريد إلكتروني موثّقًا.",
  "error.auth.companySignInUnavailable": "لا يستطيع OpenBot هذا فتح متصفح لتسجيل الدخول بحساب الشركة.",
  "error.auth.companySignInProviderRejected": "لم يقبل المزوّد معرّف العميل أو السر.",
  "error.auth.companySignInTokenInvalid": "أعطى المزوّد تسجيل دخول لا يستطيع OpenBot التحقق منه.",
  "error.auth.companySignInProviderUnreachable": "لم يردّ مزوّد تسجيل الدخول بحساب الشركة.",
  "error.auth.companySignInDomainTaken": "أحد هذه النطاقات يسجّل الدخول من خلال خادم آخر.",
} as const satisfies PartialTranslation<typeof source>;
