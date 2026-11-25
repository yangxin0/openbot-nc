import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/share";

export const messages = {
  "mobile.share.reading": "Lettura del contenuto condiviso…",
  "mobile.share.readFailed": "OpenBot non è riuscito a leggere ciò che hai condiviso. Condividilo di nuovo.",
  "mobile.share.content": "Da condividere",
  "mobile.share.footer":
    "La chat si apre con questo contenuto nel campo del messaggio. Non viene inviato nulla finché non lo invii.",
  "mobile.share.sendFooter": "OpenBot invia questo contenuto all’agente, poi apre la chat.",
  "mobile.share.lastUsed": "Usato per ultimo",
  "mobile.share.noAgents": "Nessun agente",
  "mobile.share.chooseAgent": "Scegli un agente",
  "mobile.share.action": "Condividi con {name}",
  "mobile.share.extension.send": "Invia",
  "mobile.share.extension.message": "Aggiungi un messaggio",
  "mobile.share.extension.sending": "Invio a {name}…",
} as const satisfies PartialTranslation<typeof source>;
