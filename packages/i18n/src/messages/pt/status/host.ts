import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/host";

export const messages = {
  "status.host.identityUpdated": "Identidade do servidor atualizada.",
  "status.host.signalLost":
    "Outros dispositivos não conseguem acessar este OpenBot-NC agora. Ele está se conectando novamente.",
  "status.host.stopping": "Tornando este OpenBot-NC privado…",
  "status.host.private": "Este OpenBot-NC é privado.",
  "status.host.removed": "Este OpenBot-NC foi removido da sua conta. Publique-o novamente para compartilhá-lo.",
} as const satisfies PartialTranslation<typeof source>;
