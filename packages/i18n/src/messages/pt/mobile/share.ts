import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/share";

export const messages = {
  "mobile.share.reading": "Lendo o que você compartilhou…",
  "mobile.share.readFailed": "O OpenBot-NC não conseguiu ler o que você compartilhou. Compartilhe novamente.",
  "mobile.share.content": "Para compartilhar",
  "mobile.share.footer": "O chat abre com isto no campo de mensagem. Nada é enviado até você enviar.",
  "mobile.share.sendFooter": "O OpenBot-NC envia isto ao agente e depois abre o chat.",
  "mobile.share.lastUsed": "Usado por último",
  "mobile.share.noAgents": "Nenhum agente",
  "mobile.share.chooseAgent": "Escolha um agente",
  "mobile.share.action": "Compartilhar com {name}",
  "mobile.share.extension.send": "Enviar",
  "mobile.share.extension.message": "Adicionar mensagem",
  "mobile.share.extension.sending": "Enviando para {name}…",
} as const satisfies PartialTranslation<typeof source>;
