import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/host";

export const messages = {
  "status.host.identityUpdated": "Serveridentität aktualisiert.",
  "status.host.signalLost": "Andere Geräte erreichen diesen OpenBot-NC gerade nicht. Er verbindet sich erneut.",
  "status.host.stopping": "Dieser OpenBot-NC wird auf privat gesetzt…",
  "status.host.private": "Dieser OpenBot-NC ist privat.",
  "status.host.removed":
    "Dieser OpenBot-NC wurde aus deinem Konto entfernt. Veröffentliche ihn erneut, um ihn zu teilen.",
} as const satisfies PartialTranslation<typeof source>;
