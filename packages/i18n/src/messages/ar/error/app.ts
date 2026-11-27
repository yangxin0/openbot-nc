import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/app";

export const messages = {
  "error.app.externalLinkProtocol": "يمكن فتح روابط HTTP(S) فقط في المتصفح الخارجي.",
  "error.app.notificationsUnsupported": "لا يدعم هذا النظام إشعارات سطح المكتب.",
  "error.app.notificationSettingsMissing": "لا توجد في هذا النظام صفحة لإعدادات الإشعارات.",
  "error.app.notReady": "OpenBot-NC غير جاهز.",
  "error.app.macSecureStorageUnavailable": "التخزين الآمن في macOS غير متاح.",
  "error.app.secretStorageUnavailable": "تخزين الأسرار في النظام غير متاح.",
  "error.app.windowBlockedBySecuritySoftware":
    "من المحتمل أن برنامج الحماية على هذا الكمبيوتر أوقف نافذة OpenBot-NC. في برنامج الحماية، مثل Kaspersky، أضف OpenBot-NC.exe كتطبيق موثوق. ثم شغّل OpenBot-NC مرة أخرى.",
} as const satisfies PartialTranslation<typeof source>;
