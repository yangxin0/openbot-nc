import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/host";

export const messages = {
  "status.host.identityUpdated": "Identidad del servidor actualizada.",
  "status.host.signalLost": "Otros dispositivos no pueden llegar a este OpenBot-NC ahora. Se vuelve a conectar.",
  "status.host.stopping": "Haciendo privado este OpenBot-NC…",
  "status.host.private": "Este OpenBot-NC es privado.",
  "status.host.removed": "Este OpenBot-NC se quitó de tu cuenta. Publícalo de nuevo para compartirlo.",
} as const satisfies PartialTranslation<typeof source>;
