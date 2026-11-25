import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/remote";

export const messages = {
  "status.remote.stagePreferences": "Carregando preferências locais do chat: {reason}",
  "status.remote.stageConnection": "Conectando ao computador: {reason}",
  "status.remote.stageCompatibility": "Verificando a compatibilidade do computador: {reason}",
  "status.remote.stageAgents": "Carregando agentes: {reason}",
  "status.remote.stageReads": "Carregando o status de leitura: {reason}",
  "status.remote.suspendedDetail":
    "Atualize o OpenBot Mobile ou o aplicativo para computador antes de conectar.\n{detail}",
  "status.remote.cooldownDetail":
    "A conexão falhou após {limit} tentativas. Nova tentativa em {minutes}:{seconds}.\n{detail}",
  "status.remote.cooldown": "A conexão falhou após {limit} tentativas. Nova tentativa em {minutes}:{seconds}.",
  "status.remote.connectionLostDetail": {
    one: "Conexão perdida. Nova tentativa em {count}s.\n{detail}",
    other: "Conexão perdida. Nova tentativa em {count}s.\n{detail}",
  },
  "status.remote.connectionLost": {
    one: "Conexão perdida. Nova tentativa em {count}s.",
    other: "Conexão perdida. Nova tentativa em {count}s.",
  },
  "status.remote.attemptFailedDetail": {
    one: "A tentativa de conexão falhou. Nova tentativa em {count}s.\n{detail}",
    other: "A tentativa de conexão falhou. Nova tentativa em {count}s.\n{detail}",
  },
  "status.remote.attemptFailed": {
    one: "A tentativa de conexão falhou. Nova tentativa em {count}s.",
    other: "A tentativa de conexão falhou. Nova tentativa em {count}s.",
  },
  "status.remote.reconnectingDetail": {
    one: "Reconectando {attempt}/{count}\n{detail}",
    other: "Reconectando {attempt}/{count}\n{detail}",
  },
  "status.remote.reconnecting": { one: "Reconectando {attempt}/{count}", other: "Reconectando {attempt}/{count}" },
  "status.remote.messageCut":
    "[{size} MB desta mensagem não aparecem neste dispositivo. Abra-a no computador que executa o servidor para ler tudo.]",
} as const satisfies PartialTranslation<typeof source>;
