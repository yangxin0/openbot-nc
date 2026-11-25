import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/dialog";

export const messages = {
  "dialog.chooseAgentFolder": "Kies een map voor {agent}",
  "dialog.chooseChannelFolder": "Kies een map voor {channel}",
  "dialog.chooseAgentExclusion": "Kies een map die {agent} niet mag wijzigen",
  "dialog.filter.images": "Afbeeldingen",
  "dialog.filter.supportedFiles": "Ondersteunde bestanden",
  "dialog.filter.attachment": "Bijlage",
  "dialog.filter.zipArchive": "ZIP-archief",
  "dialog.filter.jsonDocument": "JSON-document",
  "dialog.chooseAgentExport": "Kies een agentexport",
  "dialog.chooseHermesFolder": "Kies de Hermes-map",
  "dialog.filter.agentExports": "Agentexports",
  "dialog.chooseVaultCsv": "Kies een wachtwoordexport",
  "dialog.filter.csv": "CSV-bestanden",
  "dialog.saveExportSkill": "Exportvaardigheid opslaan",
  "dialog.saveTransfer": "Overdrachtsbestand opslaan",
  "dialog.chooseTransfer": "Kies een overdrachtsbestand",
  "dialog.filter.transfer": "OpenBot-NC-overdrachtsbestanden",
  "dialog.saveWorkflow": "Workflowbestand opslaan",
  "dialog.filter.workflow": "OpenBot-NC-workflowbestanden",
  "dialog.chooseExternalLinkApp": "Kies een browser",
  "dialog.filter.applications": "Apps",
} as const satisfies PartialTranslation<typeof source>;
