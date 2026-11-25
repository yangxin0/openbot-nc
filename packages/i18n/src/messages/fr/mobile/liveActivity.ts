import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/liveActivity";

export const messages = {
  "mobile.liveActivity.appName": "OpenBot-NC",
  "mobile.liveActivity.badge.working": "En cours",
  "mobile.liveActivity.badge.message": "Message",
  "mobile.liveActivity.badge.question": "Questions",
  "mobile.liveActivity.badge.approval": "Approbation",
  "mobile.liveActivity.badge.takeover": "Prendre la main",
  "mobile.liveActivity.badge.failed": "Échec",
  "mobile.liveActivity.unread": { one: "{count} non lu", other: "{count} non lus" },
  "mobile.liveActivity.moreRequests": { one: "+{count} autre demande", other: "+{count} autres demandes" },
  "mobile.liveActivity.moreChats": { one: "+{count} autre", other: "+{count} autres" },
  "mobile.liveActivity.question.fallback": "{name} attend une réponse.",
  "mobile.liveActivity.approval.fallback": "Vérifiez l’action demandée avant son exécution.",
  "mobile.liveActivity.takeover.fallback": "Terminez l’étape dans le navigateur pour que l’agent continue.",
  "mobile.liveActivity.failed.fallback": "La tâche s’est arrêtée avant la fin.",
  "mobile.liveActivity.failed.title": "{name} : {title}",
  "mobile.liveActivity.button.decline": "Refuser",
  "mobile.liveActivity.button.approve": "Approuver",
  "mobile.liveActivity.button.openDetails": "Voir les détails",
  "mobile.liveActivity.stale.label": "Pas à jour",
  "mobile.liveActivity.stale.detail": "Ouvrez OpenBot-NC pour voir l’état actuel.",
  "mobile.liveActivity.island.taskWorking": "Traitement de votre demande",
  "mobile.liveActivity.island.questionHeader": "Question de votre agent",
  "mobile.liveActivity.island.questionText": "Ouvrez OpenBot-NC pour répondre à cette question.",
  "mobile.liveActivity.island.optionFallback": "Option {number}",
  "mobile.liveActivity.island.takeoverTitle": "Une étape du navigateur vous attend",
  "mobile.liveActivity.island.takeoverDetail":
    "Terminez la connexion, la vérification ou le consentement dans le navigateur.",
  "mobile.liveActivity.island.failureTitle": "Échec de la tâche",
  "mobile.liveActivity.island.failureDetail":
    "La tâche s’est arrêtée avant la fin. Ouvrez la conversation pour réessayer.",
  "mobile.liveActivity.island.approvalCommand": "Commande à vérifier",
  "mobile.liveActivity.island.approvalFileChange": "Modifications de fichiers à vérifier",
  "mobile.liveActivity.island.approvalPermissions": "Autorisations à vérifier",
} as const satisfies PartialTranslation<typeof source>;
