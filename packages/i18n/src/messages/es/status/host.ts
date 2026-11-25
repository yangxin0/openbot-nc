import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/host";

export const messages = {
  "status.host.identityUpdated": "Identidad del servidor actualizada.",
  "status.host.ready": "Este OpenBot está listo para conexiones WebRTC.",
  "status.host.signalLost": "Otros dispositivos no pueden llegar a este OpenBot ahora. Se vuelve a conectar.",
  "status.host.stopping": "Haciendo privado este OpenBot…",
  "status.host.private": "Este OpenBot es privado.",
  "status.host.removed": "Este OpenBot se quitó de tu cuenta. Publícalo de nuevo para compartirlo.",
} as const satisfies PartialTranslation<typeof source>;
