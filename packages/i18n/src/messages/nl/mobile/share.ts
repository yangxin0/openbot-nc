import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/share";

export const messages = {
  "mobile.share.reading": "Gedeelde inhoud lezen…",
  "mobile.share.readFailed": "OpenBot-NC kan niet lezen wat je hebt gedeeld. Deel het opnieuw.",
  "mobile.share.content": "Te delen",
  "mobile.share.footer": "De chat opent met dit in het berichtveld. Er wordt niets verstuurd totdat jij het verstuurt.",
  "mobile.share.sendFooter": "OpenBot-NC stuurt dit naar de agent en opent daarna de chat.",
  "mobile.share.lastUsed": "Laatst gebruikt",
  "mobile.share.noAgents": "Geen agents",
  "mobile.share.chooseAgent": "Kies een agent",
  "mobile.share.action": "Deel met {name}",
} as const satisfies PartialTranslation<typeof source>;
