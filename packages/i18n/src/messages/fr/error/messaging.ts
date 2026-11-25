import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/messaging";

export const messages = {
  "error.messaging.notConnected": "Cet espace de travail Slack n’est pas connecté.",
  "error.messaging.whatsappNotConnected": "Ce numéro WhatsApp n’est pas connecté.",
  "error.messaging.whatsappUnsupported": "Cet ordinateur ne peut pas se connecter à WhatsApp.",
  "error.messaging.whatsappTooManySenders": "Un numéro WhatsApp peut autoriser jusqu’à 200 contacts et groupes.",
  "error.messaging.whatsappNumberNotFound":
    "Ce numéro n’a pas de compte WhatsApp. Saisissez-le avec l’indicatif du pays, par exemple +44 7700 900123.",
  "error.messaging.whatsappSenderNotFound": "Ce contact ou ce groupe n'est plus dans la liste.",
  "error.messaging.whatsappRequestEnded":
    "Cette demande est terminée. Demandez à la personne d’écrire à nouveau pour obtenir un nouveau code.",
  "error.messaging.memoryLimit":
    "Un espace de travail connecté peut avoir jusqu’à {limit} souvenirs. Supprimez-en un d’abord.",
} as const satisfies PartialTranslation<typeof source>;
