import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/auth";

export const messages = {
  "error.auth.serviceUnavailable":
    "OpenBot hesap hizmetine ulaşamadı. API'nin çalıştığını kontrol edin, ardından tekrar deneyin.",
} as const satisfies PartialTranslation<typeof source>;
