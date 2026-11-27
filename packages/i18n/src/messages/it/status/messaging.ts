import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/messaging";

export const messages = {
  "status.messaging.working": "Ci sto lavorando…",
  "status.messaging.queued": "In attesa che finisca una richiesta precedente. La risposta arriva qui.",
  "status.messaging.busy": "Ci sono troppe richieste in attesa. Riprova più tardi.",
  "status.messaging.failed":
    "OpenBot-NC non è riuscito a completare questa richiesta. I dettagli sono sull'host di OpenBot-NC.",
  "status.messaging.noAnswer": "OpenBot-NC ha finito senza una risposta scritta.",
  "status.messaging.noAgent": "Nessun agente può ancora rispondere qui. Aggiungi lo Slack Orchestrator in OpenBot-NC.",
  "status.messaging.delegated": "Un collega ci sta lavorando. La risposta arriva qui.",
  "status.messaging.stopped": "Interrotto.",
  "status.messaging.stop": "Interrompi",
  "status.messaging.approvalTitle": "OpenBot-NC chiede l'approvazione per continuare.",
  "status.messaging.approvalTitleTeammate": "Il collega {agent} chiede l'approvazione per continuare.",
  "status.messaging.approvalCommand": "Eseguire un comando",
  "status.messaging.approvalFileChange": "Modificare dei file",
  "status.messaging.approvalPermissions": "Ottenere altri permessi",
  "status.messaging.approve": "Approva",
  "status.messaging.deny": "Rifiuta",
  "status.messaging.approvedBy": "Approvato da {user}.",
  "status.messaging.deniedBy": "Rifiutato da {user}.",
  "status.messaging.answeredOnHost": "Risposta data sull'host di OpenBot-NC.",
  "status.messaging.requestInactive": "Questa richiesta non è più attiva.",
  "status.messaging.onlyRequester": "Solo {user} può farlo. Può rispondere anche l'host di OpenBot-NC.",
  "status.messaging.hostOnly": "Solo l'host di OpenBot-NC può rispondere a questa richiesta.",
  "status.messaging.filesSkipped": "Alcuni file non sono stati inviati: {names}.",
  "status.messaging.integrationsSection": "Integrazioni",
  "status.messaging.whatsappNoAgent":
    "Nessun agente può ancora rispondere qui. Aggiungi il WhatsApp Orchestrator in OpenBot-NC.",
  "status.messaging.whatsappApprovalMenu": "Rispondi 1 per approvare o 2 per rifiutare.",
  "status.messaging.whatsappStopMenu": "Rispondi «stop» per interrompere.",
  "status.messaging.whatsappPairingCode":
    "Questo numero risponde solo alle persone autorizzate dal proprietario. Dai questo codice al proprietario: {code}",
  "status.messaging.whatsappPairingApproved": "Ora puoi inviare richieste a questo numero.",
  "status.messaging.whatsappOwnChat": "Messaggio a te stesso",
  "status.messaging.whatsappWelcomeOwn":
    "👋 *OpenBot-NC è collegato*\n\nScrivi qui per chiedere ai tuoi agenti. Il WhatsApp Orchestrator risponde o passa il lavoro all'agente giusto.\n\nInvia *stop* per fermare una richiesta.",
  "status.messaging.whatsappWelcomeDedicated":
    "👋 *OpenBot-NC è collegato*\n\nLe persone che autorizzi in OpenBot-NC ora possono scrivere a questo numero. Una persona nuova riceve un codice: approvalo in OpenBot-NC, in Richieste.\n\nInvia *stop* per fermare una richiesta.",
  "status.messaging.whatsappOtherOpenBot":
    "Un altro OpenBot-NC è collegato a questo numero WhatsApp, quindi puoi ricevere due risposte. Per risolvere, apri Dispositivi collegati in WhatsApp sul telefono ed esci dall’OpenBot-NC che non usi.",
  "status.messaging.whatsappPaused":
    "OpenBot-NC non risponde qui per 10 minuti: sono arrivati troppi messaggi in poco tempo. Se un altro OpenBot-NC è collegato a questo numero, apri Dispositivi collegati in WhatsApp sul telefono ed esci dall’OpenBot-NC che non usi.",
  "status.messaging.whatsappNotDelivered":
    "WhatsApp non ha accettato questa risposta, quindi la persona non l’ha ricevuta.",
  "status.messaging.whatsappPartlyDelivered":
    "WhatsApp non ha accettato tutta questa risposta, quindi la persona ne ha ricevuto solo una parte.",
  "status.messaging.whatsappOrchestratorName": "WhatsApp Orchestrator",
  "status.messaging.whatsappOrchestratorTitle": "Risponde su WhatsApp e consulta il team",
} as const satisfies PartialTranslation<typeof source>;
