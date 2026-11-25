import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/host";

export const messages = {
  "status.host.identityUpdated": "Sunucu kimliği güncellendi.",
  "status.host.signalLost": "Diğer cihazlar şu anda bu OpenBot-NC'ye ulaşamıyor. Yeniden bağlanıyor.",
  "status.host.stopping": "Bu OpenBot-NC özel yapılıyor…",
  "status.host.private": "Bu OpenBot-NC özel.",
  "status.host.removed": "Bu OpenBot-NC hesabınızdan kaldırıldı. Paylaşmak için yeniden yayımlayın.",
} as const satisfies PartialTranslation<typeof source>;
