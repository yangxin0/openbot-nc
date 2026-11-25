import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/dialog";

export const messages = {
  "dialog.chooseAgentFolder": "Scegli una cartella per {agent}",
  "dialog.chooseChannelFolder": "Scegli una cartella per {channel}",
  "dialog.chooseAgentExclusion": "Scegli una cartella che {agent} non deve modificare",
  "dialog.filter.images": "Immagini",
  "dialog.filter.supportedFiles": "File supportati",
  "dialog.filter.attachment": "Allegato",
  "dialog.filter.zipArchive": "Archivio ZIP",
  "dialog.filter.jsonDocument": "Documento JSON",
  "dialog.chooseAgentExport": "Scegli un'esportazione di agente",
  "dialog.filter.agentExports": "Esportazioni di agenti",
  "dialog.saveExportSkill": "Salva la skill di esportazione",
  "dialog.saveTransfer": "Salva il file di trasferimento",
  "dialog.chooseTransfer": "Scegli un file di trasferimento",
  "dialog.filter.transfer": "File di trasferimento OpenBot-NC",
  "dialog.saveWorkflow": "Salva il file del flusso di lavoro",
  "dialog.filter.workflow": "File dei flussi di lavoro OpenBot-NC",
  "dialog.chooseExternalLinkApp": "Scegli un browser",
  "dialog.filter.applications": "Applicazioni",
} as const satisfies PartialTranslation<typeof source>;
