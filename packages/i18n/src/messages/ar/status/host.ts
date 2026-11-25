import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/host";

export const messages = {
  "status.host.identityUpdated": "تم تحديث هوية الخادم.",
  "status.host.signalLost": "لا يمكن للأجهزة الأخرى الوصول إلى OpenBot هذا الآن. سيتصل مرة أخرى.",
  "status.host.stopping": "جارٍ جعل OpenBot هذا خاصًا…",
  "status.host.private": "OpenBot هذا خاص.",
  "status.host.removed": "أُزيل OpenBot هذا من حسابك. انشره مرة أخرى لمشاركته.",
} as const satisfies PartialTranslation<typeof source>;
