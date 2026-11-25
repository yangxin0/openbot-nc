import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/host";

export const messages = {
  "status.host.identityUpdated": "Identité du serveur mise à jour.",
  "status.host.ready": "Cet OpenBot est prêt pour les connexions WebRTC.",
  "status.host.signalLost": "Les autres appareils ne peuvent pas joindre cet OpenBot pour le moment. Il se reconnecte.",
  "status.host.stopping": "Passage de cet OpenBot en mode privé…",
  "status.host.private": "Cet OpenBot est privé.",
  "status.host.removed": "Cet OpenBot a été retiré de votre compte. Publiez-le à nouveau pour le partager.",
} as const satisfies PartialTranslation<typeof source>;
