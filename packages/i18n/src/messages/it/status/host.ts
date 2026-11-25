import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/host";

export const messages = {
  "status.host.identityUpdated": "Identità del server aggiornata.",
  "status.host.signalLost": "Gli altri dispositivi non possono raggiungere questo OpenBot-NC ora. Si ricollega.",
  "status.host.stopping": "Questo OpenBot-NC sta diventando privato…",
  "status.host.private": "Questo OpenBot-NC è privato.",
  "status.host.removed": "Questo OpenBot-NC è stato rimosso dal tuo account. Pubblicalo di nuovo per condividerlo.",
} as const satisfies PartialTranslation<typeof source>;
