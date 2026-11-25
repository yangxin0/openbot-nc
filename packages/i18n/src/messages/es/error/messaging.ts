import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/messaging";

export const messages = {
  "error.messaging.notConnected": "Este espacio de trabajo de Slack no está conectado.",
  "error.messaging.whatsappNotConnected": "Este número de WhatsApp no está conectado.",
  "error.messaging.whatsappUnsupported": "Este equipo no puede conectarse a WhatsApp.",
  "error.messaging.whatsappTooManySenders": "Un número de WhatsApp puede permitir hasta 200 contactos y grupos.",
  "error.messaging.whatsappNumberNotFound":
    "Este número no tiene cuenta de WhatsApp. Escríbelo con el código de país, como +44 7700 900123.",
  "error.messaging.whatsappSenderNotFound": "Este contacto o grupo ya no está en la lista.",
  "error.messaging.whatsappRequestEnded":
    "Esta solicitud terminó. Pide a la persona que vuelva a escribir para obtener un código nuevo.",
  "error.messaging.memoryLimit":
    "Un espacio de trabajo conectado puede tener hasta {limit} recuerdos. Borra uno primero.",
} as const satisfies PartialTranslation<typeof source>;
