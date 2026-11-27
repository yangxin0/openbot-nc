import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/messaging";

export const messages = {
  "status.messaging.working": "En cours…",
  "status.messaging.queued": "En attente de la fin d’une demande précédente. La réponse arrivera ici.",
  "status.messaging.busy": "Trop de demandes sont en attente. Réessayez plus tard.",
  "status.messaging.failed": "OpenBot-NC n’a pas pu terminer cette demande. L’hôte OpenBot-NC dispose des détails.",
  "status.messaging.noAnswer": "OpenBot-NC a terminé sans réponse écrite.",
  "status.messaging.noAgent": "Aucun agent ne peut encore répondre ici. Ajoutez l’Orchestrateur Slack dans OpenBot-NC.",
  "status.messaging.delegated": "Un coéquipier s’en occupe. La réponse arrivera ici.",
  "status.messaging.stopped": "Arrêté.",
  "status.messaging.stop": "Arrêter",
  "status.messaging.approvalTitle": "OpenBot-NC demande une approbation pour continuer.",
  "status.messaging.approvalTitleTeammate": "Le coéquipier {agent} demande une approbation pour continuer.",
  "status.messaging.approvalCommand": "Exécuter une commande",
  "status.messaging.approvalFileChange": "Modifier des fichiers",
  "status.messaging.approvalPermissions": "Obtenir plus d’autorisations",
  "status.messaging.approve": "Approuver",
  "status.messaging.deny": "Refuser",
  "status.messaging.approvedBy": "Approuvé par {user}.",
  "status.messaging.deniedBy": "Refusé par {user}.",
  "status.messaging.answeredOnHost": "Réponse donnée sur l’hôte OpenBot-NC.",
  "status.messaging.requestInactive": "Cette demande n’est plus active.",
  "status.messaging.onlyRequester": "Seul {user} peut faire cela. L’hôte OpenBot-NC peut aussi répondre.",
  "status.messaging.hostOnly": "Seul l’hôte OpenBot-NC peut répondre à cette demande.",
  "status.messaging.filesSkipped": "Certains fichiers n’ont pas été envoyés : {names}.",
  "status.messaging.integrationsSection": "Intégrations",
  "status.messaging.whatsappNoAgent":
    "Aucun agent ne peut encore répondre ici. Ajoutez l’Orchestrateur WhatsApp dans OpenBot-NC.",
  "status.messaging.whatsappApprovalMenu": "Répondez 1 pour approuver ou 2 pour refuser.",
  "status.messaging.whatsappStopMenu": "Répondez « stop » pour arrêter.",
  "status.messaging.whatsappPairingCode":
    "Ce numéro répond uniquement aux personnes autorisées par son propriétaire. Donnez ce code au propriétaire : {code}",
  "status.messaging.whatsappPairingApproved": "Vous pouvez maintenant envoyer des demandes à ce numéro.",
  "status.messaging.whatsappOwnChat": "Message à vous-même",
  "status.messaging.whatsappWelcomeOwn":
    "👋 *OpenBot-NC est connecté*\n\nÉcrivez ici pour poser vos questions à vos agents. Le WhatsApp Orchestrator répond, ou confie le travail au bon agent.\n\nEnvoyez *stop* pour arrêter une demande.",
  "status.messaging.whatsappWelcomeDedicated":
    "👋 *OpenBot-NC est connecté*\n\nLes personnes que vous autorisez dans OpenBot-NC peuvent maintenant écrire à ce numéro. Une nouvelle personne reçoit un code : approuvez-le dans OpenBot-NC, sous Demandes.\n\nEnvoyez *stop* pour arrêter une demande.",
  "status.messaging.whatsappOtherOpenBot":
    "Un autre OpenBot-NC est associé à ce numéro WhatsApp, vous pouvez donc recevoir deux réponses. Pour corriger cela, ouvrez Appareils connectés dans WhatsApp sur votre téléphone et déconnectez l’OpenBot-NC que vous n’utilisez pas.",
  "status.messaging.whatsappPaused":
    "OpenBot-NC ne répond plus ici pendant 10 minutes : trop de messages sont arrivés en peu de temps. Si un autre OpenBot-NC est associé à ce numéro, ouvrez Appareils connectés dans WhatsApp sur votre téléphone et déconnectez l’OpenBot-NC que vous n’utilisez pas.",
  "status.messaging.whatsappNotDelivered": "WhatsApp n’a pas accepté cette réponse, la personne ne l’a donc pas reçue.",
  "status.messaging.whatsappPartlyDelivered":
    "WhatsApp n’a pas accepté toute cette réponse, la personne n’en a donc reçu qu’une partie.",
  "status.messaging.whatsappOrchestratorName": "Orchestrateur WhatsApp",
  "status.messaging.whatsappOrchestratorTitle": "Répond dans WhatsApp et consulte l’équipe",
} as const satisfies PartialTranslation<typeof source>;
