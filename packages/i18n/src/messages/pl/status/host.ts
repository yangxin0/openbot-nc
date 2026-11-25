import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/host";

export const messages = {
  "status.host.identityUpdated": "Zaktualizowano tożsamość serwera.",
  "status.host.signalLost":
    "Inne urządzenia nie mogą teraz połączyć się z tą aplikacją OpenBot-NC. Łączy się ponownie.",
  "status.host.stopping": "Ustawianie tego serwera OpenBot-NC jako prywatnego…",
  "status.host.private": "Ten OpenBot-NC jest prywatny.",
  "status.host.removed": "Ten OpenBot-NC został usunięty z Twojego konta. Opublikuj go ponownie, aby go udostępnić.",
} as const satisfies PartialTranslation<typeof source>;
