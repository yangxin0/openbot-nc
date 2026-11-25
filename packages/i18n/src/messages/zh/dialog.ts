import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/dialog";

export const messages = {
  "dialog.chooseAgentFolder": "为 {agent} 选择文件夹",
  "dialog.chooseChannelFolder": "为 {channel} 选择文件夹",
  "dialog.chooseAgentExclusion": "选择 {agent} 不得更改的文件夹",
  "dialog.filter.images": "图片",
  "dialog.filter.supportedFiles": "支持的文件",
  "dialog.filter.attachment": "附件",
  "dialog.filter.zipArchive": "ZIP 压缩包",
  "dialog.filter.jsonDocument": "JSON 文档",
  "dialog.chooseAgentExport": "选择助手导出文件",
  "dialog.chooseHermesFolder": "选择 Hermes 文件夹",
  "dialog.filter.agentExports": "助手导出文件",
  "dialog.chooseVaultCsv": "选择密码导出文件",
  "dialog.filter.csv": "CSV 文件",
  "dialog.saveExportSkill": "保存导出的技能",
  "dialog.saveTransfer": "保存传输文件",
  "dialog.chooseTransfer": "选择传输文件",
  "dialog.filter.transfer": "OpenBot-NC 传输文件",
  "dialog.saveWorkflow": "保存工作流文件",
  "dialog.filter.workflow": "OpenBot-NC 工作流文件",
  "dialog.chooseExternalLinkApp": "选择浏览器",
  "dialog.filter.applications": "应用程序",
} as const satisfies PartialTranslation<typeof source>;
