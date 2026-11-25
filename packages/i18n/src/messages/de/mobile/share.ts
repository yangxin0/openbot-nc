import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/share";

export const messages = {
  "mobile.share.reading": "Geteilter Inhalt wird gelesen…",
  "mobile.share.readFailed": "OpenBot-NC konnte den geteilten Inhalt nicht lesen. Teile ihn noch einmal.",
  "mobile.share.content": "Zum Teilen",
  "mobile.share.footer":
    "Der Chat öffnet sich mit diesem Inhalt im Nachrichtenfeld. Nichts wird gesendet, bevor du es sendest.",
  "mobile.share.sendFooter": "OpenBot-NC sendet dies an den Agenten und öffnet dann den Chat.",
  "mobile.share.lastUsed": "Zuletzt verwendet",
  "mobile.share.noAgents": "Keine Agenten",
  "mobile.share.chooseAgent": "Agenten wählen",
  "mobile.share.action": "Mit {name} teilen",
  "mobile.share.extension.send": "Senden",
  "mobile.share.extension.message": "Nachricht hinzufügen",
  "mobile.share.extension.sending": "Wird an {name} gesendet…",
} as const satisfies PartialTranslation<typeof source>;
