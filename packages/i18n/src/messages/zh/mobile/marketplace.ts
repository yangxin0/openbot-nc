import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/marketplace";

export const messages = {
  "mobile.marketplace.app.slackTagline": "Slack 中的提及和私信",
  "mobile.marketplace.app.discordTagline": "Discord 中的提及和私信",
  "mobile.marketplace.app.telegramTagline": "Telegram 中的群组和私聊",
  "mobile.marketplace.app.whatsappTagline": "WhatsApp 中你自己的聊天和你允许的人",
  "mobile.marketplace.app.githubTagline": "仓库、Issue 与拉取请求",
  "mobile.marketplace.app.onePasswordTagline": "用你共享的登录信息登录网站",
  "mobile.marketplace.app.bitwardenTagline": "用共享文件夹中的登录信息登录网站",
  "mobile.marketplace.app.protonPassTagline": "用共享保管库中的登录信息登录网站",
  "mobile.marketplace.error.signInUnsupported": "请更新服务器上的 OpenBot-NC，才能在手机上登录应用。",
  "mobile.marketplace.app.connect": "连接",
  "mobile.marketplace.app.signInIntro": "在应用的页面上登录。登录信息保存在服务器上，而不是这部手机上。",
  "mobile.marketplace.app.stepOpen": "打开 {name} 的登录页面。",
  "mobile.marketplace.app.stepAllow": "登录并允许访问。",
  "mobile.marketplace.app.stepBlank": "最后一个页面不会加载。这是正常的。",
  "mobile.marketplace.app.stepCopy": "点按地址栏并复制完整地址。",
  "mobile.marketplace.app.stepPaste": "回到 OpenBot-NC，把地址粘贴到下方。",
  "mobile.marketplace.app.connected": "已连接",
  "mobile.marketplace.app.connectFailed": "无法连接该应用。",
  "mobile.marketplace.app.waiting": "正在等待登录页面…",
  "mobile.marketplace.app.openAgain": "重新打开登录页面",
  "mobile.marketplace.app.pasteLabel": "登录后的地址",
  "mobile.marketplace.app.pasteInvalid": "该地址不是本次登录的结束地址。",
  "mobile.marketplace.app.finishSignIn": "完成登录",
  "mobile.marketplace.app.openFailed": "无法打开登录页面。",
} as const satisfies PartialTranslation<typeof source>;
