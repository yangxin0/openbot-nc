import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/messaging";

export const messages = {
  "error.messaging.notConnected": "Este espaço de trabalho do Slack não está conectado.",
  "error.messaging.whatsappNotConnected": "Este número do WhatsApp não está conectado.",
  "error.messaging.whatsappUnsupported": "Este computador não consegue se conectar ao WhatsApp.",
  "error.messaging.whatsappTooManySenders": "Um número do WhatsApp pode permitir até 200 contatos e grupos.",
  "error.messaging.whatsappNumberNotFound":
    "Este número não tem conta no WhatsApp. Digite-o com o código do país, como +44 7700 900123.",
  "error.messaging.whatsappSenderNotFound": "Este contato ou grupo não está mais na lista.",
  "error.messaging.whatsappRequestEnded":
    "Esta solicitação terminou. Peça para a pessoa escrever de novo para receber um novo código.",
  "error.messaging.memoryLimit": "Um espaço de trabalho conectado pode ter até {limit} memórias. Exclua uma primeiro.",
} as const satisfies PartialTranslation<typeof source>;
