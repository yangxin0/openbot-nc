import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/messaging";

export const messages = {
  "status.messaging.working": "Mee bezig…",
  "status.messaging.queued": "Even wachten tot een eerder verzoek klaar is. Het antwoord komt hier.",
  "status.messaging.busy": "Er wachten te veel verzoeken. Probeer het later opnieuw.",
  "status.messaging.failed": "OpenBot-NC kon dit verzoek niet afronden. De OpenBot-NC-host heeft de details.",
  "status.messaging.noAnswer": "OpenBot-NC is klaar zonder geschreven antwoord.",
  "status.messaging.noAgent": "Er kan hier nog geen agent antwoorden. Voeg de Slack-orchestrator toe in OpenBot-NC.",
  "status.messaging.delegated": "Een teamgenoot is ermee bezig. Het antwoord komt hier.",
  "status.messaging.stopped": "Gestopt.",
  "status.messaging.stop": "Stop",
  "status.messaging.approvalTitle": "OpenBot-NC vraagt om goedkeuring om door te gaan.",
  "status.messaging.approvalTitleTeammate": "Teamgenoot {agent} vraagt om goedkeuring om door te gaan.",
  "status.messaging.approvalCommand": "Een opdracht uitvoeren",
  "status.messaging.approvalFileChange": "Bestanden wijzigen",
  "status.messaging.approvalPermissions": "Meer machtigingen krijgen",
  "status.messaging.approve": "Goedkeuren",
  "status.messaging.deny": "Weigeren",
  "status.messaging.approvedBy": "Goedgekeurd door {user}.",
  "status.messaging.deniedBy": "Geweigerd door {user}.",
  "status.messaging.answeredOnHost": "Beantwoord op de OpenBot-NC-host.",
  "status.messaging.requestInactive": "Dit verzoek is niet meer actief.",
  "status.messaging.onlyRequester": "Alleen {user} kan dit doen. De OpenBot-NC-host kan ook antwoorden.",
  "status.messaging.hostOnly": "Alleen de OpenBot-NC-host kan dit verzoek beantwoorden.",
  "status.messaging.filesSkipped": "Sommige bestanden zijn niet verstuurd: {names}.",
  "status.messaging.integrationsSection": "Integraties",
  "status.messaging.whatsappNoAgent":
    "Er kan hier nog geen agent antwoorden. Voeg de WhatsApp-orchestrator toe in OpenBot-NC.",
  "status.messaging.whatsappApprovalMenu": "Antwoord 1 om goed te keuren of 2 om te weigeren.",
  "status.messaging.whatsappStopMenu": "Antwoord “stop” om te stoppen.",
  "status.messaging.whatsappPairingCode":
    "Dit nummer antwoordt alleen mensen die de eigenaar heeft toegestaan. Geef de eigenaar deze code: {code}",
  "status.messaging.whatsappPairingApproved": "Je kunt nu verzoeken naar dit nummer sturen.",
  "status.messaging.whatsappOwnChat": "Bericht aan jezelf",
  "status.messaging.whatsappWelcomeOwn":
    "👋 *OpenBot-NC is verbonden*\n\nSchrijf hier om je agents iets te vragen. De WhatsApp Orchestrator antwoordt, of geeft het werk aan de juiste agent.\n\nStuur *stop* om een verzoek te stoppen.",
  "status.messaging.whatsappWelcomeDedicated":
    "👋 *OpenBot-NC is verbonden*\n\nDe mensen die je in OpenBot-NC toestaat, kunnen nu naar dit nummer schrijven. Een nieuw persoon krijgt een code: keur die goed in OpenBot-NC onder Verzoeken.\n\nStuur *stop* om een verzoek te stoppen.",
  "status.messaging.whatsappOtherOpenBot":
    "Er is nog een OpenBot-NC aan dit WhatsApp-nummer gekoppeld, dus je kunt twee antwoorden krijgen. Open om dit op te lossen Gekoppelde apparaten in WhatsApp op je telefoon en log uit bij de OpenBot-NC die je niet gebruikt.",
  "status.messaging.whatsappPaused":
    "OpenBot-NC antwoordt hier 10 minuten niet: er kwamen te veel berichten in korte tijd. Als er nog een OpenBot-NC aan dit nummer is gekoppeld, open dan Gekoppelde apparaten in WhatsApp op je telefoon en log uit bij de OpenBot-NC die je niet gebruikt.",
  "status.messaging.whatsappNotDelivered":
    "WhatsApp heeft dit antwoord niet geaccepteerd, dus de persoon heeft het niet ontvangen.",
  "status.messaging.whatsappPartlyDelivered":
    "WhatsApp heeft dit antwoord niet volledig geaccepteerd, dus de persoon heeft maar een deel ontvangen.",
  "status.messaging.whatsappOrchestratorName": "WhatsApp-orchestrator",
  "status.messaging.whatsappOrchestratorTitle": "Antwoordt in WhatsApp en vraagt het team",
} as const satisfies PartialTranslation<typeof source>;
