import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/app";

export const messages = {
  "error.app.externalLinkProtocol": "Nel browser esterno si possono aprire solo link HTTP(S).",
  "error.app.notificationsUnsupported": "Questo sistema non supporta le notifiche del desktop.",
  "error.app.notificationSettingsMissing": "Questo sistema non ha una pagina delle impostazioni delle notifiche.",
  "error.app.notReady": "OpenBot-NC non è pronto.",
  "error.app.macSecureStorageUnavailable": "L'archivio sicuro di macOS non è disponibile.",
  "error.app.secretStorageUnavailable": "L'archivio dei segreti del sistema non è disponibile.",
  "error.app.windowBlockedBySecuritySoftware":
    "Probabilmente un software di sicurezza su questo computer ha fermato la finestra di OpenBot-NC. Nel tuo software di sicurezza, ad esempio Kaspersky, aggiungi OpenBot-NC.exe come applicazione attendibile. Poi avvia di nuovo OpenBot-NC.",
} as const satisfies PartialTranslation<typeof source>;
