import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/remote";

export const messages = {
  "status.remote.stagePreferences": "Caricamento delle preferenze locali della chat: {reason}",
  "status.remote.stageConnection": "Connessione al desktop: {reason}",
  "status.remote.stageCompatibility": "Controllo della compatibilità del desktop: {reason}",
  "status.remote.stageAgents": "Caricamento degli agenti: {reason}",
  "status.remote.stageReads": "Caricamento dello stato di lettura: {reason}",
  "status.remote.suspendedDetail": "Aggiorna OpenBot-NC Mobile o l'app desktop prima di connetterti.\n{detail}",
  "status.remote.cooldownDetail":
    "Connessione non riuscita dopo {limit} tentativi. Nuovo tentativo tra {minutes}:{seconds}.\n{detail}",
  "status.remote.cooldown": "Connessione non riuscita dopo {limit} tentativi. Nuovo tentativo tra {minutes}:{seconds}.",
  "status.remote.connectionLostDetail": {
    one: "Connessione persa. Nuovo tentativo tra {count} s.\n{detail}",
    other: "Connessione persa. Nuovo tentativo tra {count} s.\n{detail}",
  },
  "status.remote.connectionLost": {
    one: "Connessione persa. Nuovo tentativo tra {count} s.",
    other: "Connessione persa. Nuovo tentativo tra {count} s.",
  },
  "status.remote.attemptFailedDetail": {
    one: "Tentativo di connessione non riuscito. Nuovo tentativo tra {count} s.\n{detail}",
    other: "Tentativo di connessione non riuscito. Nuovo tentativo tra {count} s.\n{detail}",
  },
  "status.remote.attemptFailed": {
    one: "Tentativo di connessione non riuscito. Nuovo tentativo tra {count} s.",
    other: "Tentativo di connessione non riuscito. Nuovo tentativo tra {count} s.",
  },
  "status.remote.reconnectingDetail": {
    one: "Riconnessione {attempt}/{count}\n{detail}",
    other: "Riconnessione {attempt}/{count}\n{detail}",
  },
  "status.remote.reconnecting": { one: "Riconnessione {attempt}/{count}", other: "Riconnessione {attempt}/{count}" },
  "status.remote.messageCut":
    "[{size} MB di questo messaggio non sono mostrati su questo dispositivo. Aprilo sul computer che esegue il server per leggerlo tutto.]",
} as const satisfies PartialTranslation<typeof source>;
