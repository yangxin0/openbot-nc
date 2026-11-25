import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/dialog";

export const messages = {
  "dialog.chooseAgentFolder": "{agent} için bir klasör seçin",
  "dialog.chooseChannelFolder": "{channel} için bir klasör seçin",
  "dialog.chooseAgentExclusion": "{agent} adlı ajanın değiştirmemesi gereken klasörü seç",
  "dialog.filter.images": "Görseller",
  "dialog.filter.supportedFiles": "Desteklenen dosyalar",
  "dialog.filter.attachment": "Ek",
  "dialog.filter.zipArchive": "ZIP arşivi",
  "dialog.filter.jsonDocument": "JSON belgesi",
  "dialog.chooseAgentExport": "Bir ajan dışa aktarımı seçin",
  "dialog.filter.agentExports": "Ajan dışa aktarımları",
  "dialog.saveExportSkill": "Dışa aktarma becerisini kaydet",
  "dialog.saveTransfer": "Aktarım dosyasını kaydet",
  "dialog.chooseTransfer": "Bir aktarım dosyası seçin",
  "dialog.filter.transfer": "OpenBot-NC aktarım dosyaları",
  "dialog.saveWorkflow": "İş akışı dosyasını kaydet",
  "dialog.filter.workflow": "OpenBot-NC iş akışı dosyaları",
  "dialog.chooseExternalLinkApp": "Tarayıcı seçin",
  "dialog.filter.applications": "Uygulamalar",
} as const satisfies PartialTranslation<typeof source>;
