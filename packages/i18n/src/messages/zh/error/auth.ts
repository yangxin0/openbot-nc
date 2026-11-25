import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/auth";

export const messages = {
  "error.auth.serviceUnavailable": "OpenBot 无法连接账号服务。请确认 API 正在运行后重试。",
} as const satisfies PartialTranslation<typeof source>;
