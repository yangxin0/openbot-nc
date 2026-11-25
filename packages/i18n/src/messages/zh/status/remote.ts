import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/remote";

export const messages = {
  "status.remote.stagePreferences": "正在加载本地聊天偏好：{reason}",
  "status.remote.stageConnection": "正在连接桌面：{reason}",
  "status.remote.stageCompatibility": "正在检查桌面兼容性：{reason}",
  "status.remote.stageAgents": "正在加载助手：{reason}",
  "status.remote.stageReads": "正在加载已读状态：{reason}",
  "status.remote.suspendedDetail": "连接前请先更新 OpenBot 手机版或桌面应用。\n{detail}",
  "status.remote.cooldownDetail": "连续 {limit} 次连接失败，将在 {minutes}:{seconds} 后重试。\n{detail}",
  "status.remote.cooldown": "连续 {limit} 次连接失败，将在 {minutes}:{seconds} 后重试。",
  "status.remote.connectionLostDetail": {
    one: "连接已断开，将在 {count} 秒后重试。\n{detail}",
    other: "连接已断开，将在 {count} 秒后重试。\n{detail}",
  },
  "status.remote.connectionLost": {
    one: "连接已断开，将在 {count} 秒后重试。",
    other: "连接已断开，将在 {count} 秒后重试。",
  },
  "status.remote.attemptFailedDetail": {
    one: "连接尝试失败，将在 {count} 秒后重试。\n{detail}",
    other: "连接尝试失败，将在 {count} 秒后重试。\n{detail}",
  },
  "status.remote.attemptFailed": {
    one: "连接尝试失败，将在 {count} 秒后重试。",
    other: "连接尝试失败，将在 {count} 秒后重试。",
  },
  "status.remote.reconnectingDetail": {
    one: "正在重连 {attempt}/{count}\n{detail}",
    other: "正在重连 {attempt}/{count}\n{detail}",
  },
  "status.remote.reconnecting": { one: "正在重连 {attempt}/{count}", other: "正在重连 {attempt}/{count}" },
  "status.remote.messageCut": "[此消息有 {size} MB 未在此设备上显示。请在运行服务器的电脑上打开以阅读全文。]",
} as const satisfies PartialTranslation<typeof source>;
