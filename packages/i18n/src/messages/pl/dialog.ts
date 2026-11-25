import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/dialog";

export const messages = {
  "dialog.chooseAgentFolder": "Wybierz folder dla agenta {agent}",
  "dialog.chooseChannelFolder": "Wybierz folder dla kanału {channel}",
  "dialog.chooseAgentExclusion": "Wybierz folder, którego {agent} nie może zmieniać",
  "dialog.filter.images": "Obrazy",
  "dialog.filter.supportedFiles": "Obsługiwane pliki",
  "dialog.filter.attachment": "Załącznik",
  "dialog.filter.zipArchive": "Archiwum ZIP",
  "dialog.filter.jsonDocument": "Dokument JSON",
  "dialog.chooseAgentExport": "Wybierz eksport agenta",
  "dialog.filter.agentExports": "Eksporty agentów",
  "dialog.saveExportSkill": "Zapisz umiejętność eksportu",
  "dialog.saveTransfer": "Zapisz plik przeniesienia",
  "dialog.chooseTransfer": "Wybierz plik przeniesienia",
  "dialog.filter.transfer": "Pliki przeniesienia OpenBot-NC",
  "dialog.saveWorkflow": "Zapisz plik przepływu",
  "dialog.filter.workflow": "Pliki przepływów OpenBot-NC",
  "dialog.chooseExternalLinkApp": "Wybierz przeglądarkę",
  "dialog.filter.applications": "Aplikacje",
} as const satisfies PartialTranslation<typeof source>;
