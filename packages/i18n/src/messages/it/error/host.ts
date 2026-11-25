import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/host";

export const messages = {
  "error.host.webRtcNotConfigured": "Il servizio host WebRTC non è configurato.",
  "error.host.nameBeforePublish": "Dai un nome a questo OpenBot prima di pubblicarlo.",
  "error.host.publishBeforeInvite": "Rendi pubblico questo OpenBot prima di creare un invito.",
  "error.host.teamAccessUnavailable": "L'accesso al tuo team non è disponibile.",
  "error.host.ownerIdentityUnavailable": "L'identità del proprietario dell'host non è disponibile.",
  "error.host.publishFailed": "Non è stato possibile pubblicare questo OpenBot.",
  "error.host.noServer": "Questo computer non ha nessun server da modificare.",
  "error.host.identityLocalOnly": "Il nome e il logo del server si possono cambiare solo sul computer che lo esegue.",
  "error.host.timezoneInvalid": "Questo fuso orario non è noto.",
  "error.host.signalHomeUnknown": "Questo server Signal non è disponibile.",
  "error.host.turnLimitInvalid": "Questo limite di thread non è valido.",
  "error.host.maintenanceInterrupted":
    "Manutenzione dell'host interrotta. Verifica l'applicazione e reimposta lo stato dell'host prima di riprovare.",
  "error.host.updateFailed":
    "L'aggiornamento dell'host è fallito durante {phase}. Verifica proprietà del bundle, firma, stato dei tenant e spazio libero su disco prima di reimpostare lo stato.",
  "error.host.tenantsNotIdle": "I tenant non sono rimasti inattivi per cinque minuti nell'arco di due ore.",
  "error.host.tenantShutdownTimeout":
    "L'arresto dei tenant è scaduto. Non è stata avviata nessuna sostituzione dell'applicazione.",
  "error.host.tenantHealthMissing":
    "I report di salute dei tenant mancano o non sono in buono stato dopo il riavvio. Controlla le sessioni dei tenant prima di un altro aggiornamento.",
  "error.host.personalityInvalid": "Questo stile di risposta non è noto.",
} as const satisfies PartialTranslation<typeof source>;
