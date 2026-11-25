import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/host";

export const messages = {
  "status.host.identityUpdated": "Identidade do servidor atualizada.",
  "status.host.ready": "Este OpenBot está pronto para conexões WebRTC.",
  "status.host.signalLost":
    "Outros dispositivos não conseguem acessar este OpenBot agora. Ele está se conectando novamente.",
  "status.host.stopping": "Tornando este OpenBot privado…",
  "status.host.private": "Este OpenBot é privado.",
  "status.host.removed": "Este OpenBot foi removido da sua conta. Publique-o novamente para compartilhá-lo.",
} as const satisfies PartialTranslation<typeof source>;
