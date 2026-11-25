import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/messaging";

export const messages = {
  "status.messaging.working": "Trabajando en ello…",
  "status.messaging.queued": "En espera hasta que termine una solicitud anterior. La respuesta llegará aquí.",
  "status.messaging.busy": "Hay demasiadas solicitudes en espera. Inténtalo más tarde.",
  "status.messaging.failed": "OpenBot-NC no pudo completar esta solicitud. El host de OpenBot-NC tiene los detalles.",
  "status.messaging.noAnswer": "OpenBot-NC terminó sin una respuesta escrita.",
  "status.messaging.noAgent": "Aún no puede responder ningún agente aquí. Añade el Orquestador de Slack en OpenBot-NC.",
  "status.messaging.delegated": "Un compañero está trabajando en ello. La respuesta llegará aquí.",
  "status.messaging.stopped": "Detenido.",
  "status.messaging.stop": "Detener",
  "status.messaging.approvalTitle": "OpenBot-NC pide aprobación para continuar.",
  "status.messaging.approvalTitleTeammate": "El compañero {agent} pide aprobación para continuar.",
  "status.messaging.approvalCommand": "Ejecutar un comando",
  "status.messaging.approvalFileChange": "Cambiar archivos",
  "status.messaging.approvalPermissions": "Obtener más permisos",
  "status.messaging.approve": "Aprobar",
  "status.messaging.deny": "Rechazar",
  "status.messaging.approvedBy": "Aprobado por {user}.",
  "status.messaging.deniedBy": "Rechazado por {user}.",
  "status.messaging.answeredOnHost": "Respondido en el host de OpenBot-NC.",
  "status.messaging.requestInactive": "Esta solicitud ya no está activa.",
  "status.messaging.onlyRequester": "Solo {user} puede hacerlo. El host de OpenBot-NC también puede responder.",
  "status.messaging.hostOnly": "Solo el host de OpenBot-NC puede responder a esta solicitud.",
  "status.messaging.filesSkipped": "Algunos archivos no se enviaron: {names}.",
  "status.messaging.integrationsSection": "Integraciones",
  "status.messaging.whatsappNoAgent":
    "Aún no hay ningún agente que pueda responder aquí. Añade el Orquestador de WhatsApp en OpenBot-NC.",
  "status.messaging.whatsappApprovalMenu": "Responde 1 para aprobar o 2 para rechazar.",
  "status.messaging.whatsappStopMenu": "Responde «stop» para detener.",
  "status.messaging.whatsappPairingCode":
    "Este número solo responde a las personas que su propietario permitió. Dale este código al propietario: {code}",
  "status.messaging.whatsappPairingApproved": "Ya puedes enviar solicitudes a este número.",
  "status.messaging.whatsappOwnChat": "Envíate un mensaje",
  "status.messaging.whatsappWelcomeOwn":
    "👋 *OpenBot-NC está conectado*\n\nEscribe aquí para preguntar a tus agentes. El WhatsApp Orchestrator responde o pasa el trabajo al agente adecuado.\n\nEnvía *stop* para detener una solicitud.",
  "status.messaging.whatsappWelcomeDedicated":
    "👋 *OpenBot-NC está conectado*\n\nLas personas que permitas en OpenBot-NC ya pueden escribir a este número. Una persona nueva recibe un código: apruébalo en OpenBot-NC, en Solicitudes.\n\nEnvía *stop* para detener una solicitud.",
  "status.messaging.whatsappOtherOpenBot":
    "Otro OpenBot-NC está vinculado a este número de WhatsApp, así que puedes recibir dos respuestas. Para solucionarlo, abre Dispositivos vinculados en WhatsApp en tu teléfono y cierra la sesión del OpenBot-NC que no usas.",
  "status.messaging.whatsappPaused":
    "OpenBot-NC dejó de responder aquí durante 10 minutos: llegaron demasiados mensajes en poco tiempo. Si otro OpenBot-NC está vinculado a este número, abre Dispositivos vinculados en WhatsApp en tu teléfono y cierra la sesión del OpenBot-NC que no usas.",
  "status.messaging.whatsappOrchestratorName": "Orquestador de WhatsApp",
  "status.messaging.whatsappOrchestratorTitle": "Responde en WhatsApp y consulta al equipo",
} as const satisfies PartialTranslation<typeof source>;
