import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/host";

export const messages = {
  "status.host.identityUpdated": "Serveridentität aktualisiert.",
  "status.host.signalLost": "Andere Geräte erreichen diesen OpenBot gerade nicht. Er verbindet sich erneut.",
  "status.host.stopping": "Dieser OpenBot wird auf privat gesetzt…",
  "status.host.private": "Dieser OpenBot ist privat.",
  "status.host.removed": "Dieser OpenBot wurde aus deinem Konto entfernt. Veröffentliche ihn erneut, um ihn zu teilen.",
} as const satisfies PartialTranslation<typeof source>;
