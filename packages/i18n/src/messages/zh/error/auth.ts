import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/auth";

export const messages = {
  "error.auth.serviceUnavailable": "OpenBot 无法连接账号服务。请确认 API 正在运行后重试。",
  "error.auth.sessionTimeout": "OpenBot 未及时响应。请检查网络连接，然后重试。",
  "error.auth.deliveryTimeout": "OpenBot 未能及时确认送达。验证码可能仍会到达，重发前请先检查送达情况。",
} as const satisfies PartialTranslation<typeof source>;
