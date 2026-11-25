import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/host";

export const messages = {
  "status.host.identityUpdated": "Serveridentiteit bijgewerkt.",
  "status.host.ready": "Deze OpenBot is klaar voor WebRTC-verbindingen.",
  "status.host.signalLost": "Andere apparaten kunnen deze OpenBot nu niet bereiken. Hij maakt opnieuw verbinding.",
  "status.host.stopping": "Deze OpenBot privé maken…",
  "status.host.private": "Deze OpenBot is privé.",
  "status.host.removed": "Deze OpenBot is uit je account verwijderd. Publiceer hem opnieuw om hem te delen.",
} as const satisfies PartialTranslation<typeof source>;
