import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/host";

export const messages = {
  "status.host.identityUpdated": "Serveridentiteit bijgewerkt.",
  "status.host.signalLost": "Andere apparaten kunnen deze OpenBot-NC nu niet bereiken. Hij maakt opnieuw verbinding.",
  "status.host.stopping": "Deze OpenBot-NC privé maken…",
  "status.host.private": "Deze OpenBot-NC is privé.",
  "status.host.removed": "Deze OpenBot-NC is uit je account verwijderd. Publiceer hem opnieuw om hem te delen.",
} as const satisfies PartialTranslation<typeof source>;
