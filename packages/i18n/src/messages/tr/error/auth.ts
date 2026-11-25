import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/auth";

export const messages = {
  "error.auth.serviceUnavailable":
    "OpenBot hesap hizmetine ulaşamadı. API'nin çalıştığını kontrol edin, ardından tekrar deneyin.",
  "error.auth.sessionTimeout":
    "OpenBot zamanında yanıt vermedi. İnternet bağlantınızı kontrol edin, ardından yeniden deneyin.",
  "error.auth.deliveryTimeout":
    "OpenBot teslimatı zamanında onaylayamadı. Kod yine de gelebilir; tekrar göndermeden önce teslimatı kontrol edin.",
} as const satisfies PartialTranslation<typeof source>;
