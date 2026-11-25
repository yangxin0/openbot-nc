import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/host";

export const messages = {
  "error.host.nameBeforePublish": "发布前请先为该 OpenBot-NC 命名。",
  "error.host.publishBeforeInvite": "创建邀请前请先将该 OpenBot-NC 设为公开。",
  "error.host.teamAccessUnavailable": "你的团队访问权限不可用。",
  "error.host.ownerIdentityUnavailable": "主机所有者身份不可用。",
  "error.host.publishFailed": "无法发布该 OpenBot-NC。",
  "error.host.noServer": "这台电脑没有可更改的服务器。",
  "error.host.identityLocalOnly": "服务器名称和标志只能在运行它的电脑上更改。",
  "error.host.timezoneInvalid": "未知的时区。",
  "error.host.turnLimitInvalid": "此线程数上限无效。",
  "error.host.maintenanceInterrupted": "主机维护被中断。请校验应用并重置主机状态后再重试。",
  "error.host.updateFailed": "主机更新在“{phase}”阶段失败。重置状态前请校验包归属、签名、租户状态和可用磁盘空间。",
  "error.host.tenantsNotIdle": "两小时内租户未能保持空闲五分钟。",
  "error.host.tenantShutdownTimeout": "租户关闭超时，未开始替换应用。",
  "error.host.tenantHealthMissing": "重启后租户健康报告缺失或不健康。再次更新前请检查租户会话。",
  "error.host.personalityInvalid": "此回复风格未知。",
} as const satisfies PartialTranslation<typeof source>;
