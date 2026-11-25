import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/host";

export const messages = {
  "status.host.identityUpdated": "Identità del server aggiornata.",
  "status.host.signalLost": "Gli altri dispositivi non possono raggiungere questo OpenBot ora. Si ricollega.",
  "status.host.stopping": "Questo OpenBot sta diventando privato…",
  "status.host.private": "Questo OpenBot è privato.",
  "status.host.removed": "Questo OpenBot è stato rimosso dal tuo account. Pubblicalo di nuovo per condividerlo.",
} as const satisfies PartialTranslation<typeof source>;
