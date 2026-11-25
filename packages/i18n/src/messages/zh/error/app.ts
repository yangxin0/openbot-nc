import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/app";

export const messages = {
  "error.app.externalLinkProtocol": "只有 HTTP(S) 链接可以在外部浏览器中打开。",
  "error.app.notificationsUnsupported": "该系统不支持桌面通知。",
  "error.app.notificationSettingsMissing": "该系统没有通知设置页面。",
  "error.app.notReady": "OpenBot-NC 尚未就绪。",
  "error.app.macSecureStorageUnavailable": "macOS 安全存储不可用。",
  "error.app.secretStorageUnavailable": "系统密钥存储不可用。",
} as const satisfies PartialTranslation<typeof source>;
