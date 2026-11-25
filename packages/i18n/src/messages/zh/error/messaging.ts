import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/messaging";

export const messages = {
  "error.messaging.notConnected": "该 Slack 工作区未连接。",
  "error.messaging.whatsappNotConnected": "该 WhatsApp 号码未连接。",
  "error.messaging.whatsappUnsupported": "这台电脑无法连接 WhatsApp。",
  "error.messaging.whatsappTooManySenders": "一个 WhatsApp 号码最多可允许 200 个联系人和群组。",
  "error.messaging.whatsappNumberNotFound": "此号码没有 WhatsApp 账号。请连同国家代码一起输入，例如 +44 7700 900123。",
  "error.messaging.whatsappSenderNotFound": "此联系人或群组已不在列表中。",
  "error.messaging.whatsappRequestEnded": "该请求已结束。请让对方重新发消息以获取新代码。",
  "error.messaging.memoryLimit": "一个已连接的工作区最多可有 {limit} 条记忆，请先删除一条。",
} as const satisfies PartialTranslation<typeof source>;
