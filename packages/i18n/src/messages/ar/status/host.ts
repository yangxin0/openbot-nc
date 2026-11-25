import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/host";

export const messages = {
  "status.host.identityUpdated": "تم تحديث هوية الخادم.",
  "status.host.signalLost": "لا يمكن للأجهزة الأخرى الوصول إلى OpenBot-NC هذا الآن. سيتصل مرة أخرى.",
  "status.host.stopping": "جارٍ جعل OpenBot-NC هذا خاصًا…",
  "status.host.private": "OpenBot-NC هذا خاص.",
  "status.host.removed": "أُزيل OpenBot-NC هذا من حسابك. انشره مرة أخرى لمشاركته.",
} as const satisfies PartialTranslation<typeof source>;
