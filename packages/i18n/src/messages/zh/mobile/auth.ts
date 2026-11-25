import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/auth";

export const messages = {
  "mobile.auth.logo.animate": "播放 OpenBot 标志动画",
  "mobile.auth.logo.animateHint": "让标志眨一下眼",
  "mobile.auth.scanner.connectFailed": "无法连接",
  "mobile.auth.scanner.codeFailed": "无法使用该验证码",
  "mobile.auth.scanner.scanAgain": "重新扫描",
  "mobile.auth.scanner.connecting": "正在连接你的手机…",
  "mobile.auth.scanner.readingInvitation": "正在读取邀请…",
  "mobile.auth.scanner.scanDesktop": "扫描桌面端二维码",
  "mobile.auth.scanner.scanInvitation": "扫描邀请二维码",
  "mobile.auth.scanner.verifying": "正在验证一次性验证码。",
  "mobile.auth.scanner.checkingServer": "正在检查服务器身份。",
  "mobile.auth.scanner.keepCentered": "请让二维码保持在取景框中央。",
  "mobile.auth.scanner.connectFallback": "OpenBot 无法连接这台手机。",
  "mobile.auth.scanner.cameraFailed": "无法启动相机，请重试。",
  "mobile.auth.camera.title": "需要相机权限",
  "mobile.auth.camera.pairingReason": "OpenBot 只使用相机扫描桌面应用中显示的一次性二维码。",
  "mobile.auth.camera.invitationReason": "OpenBot 只使用相机扫描邀请二维码。",
  "mobile.auth.camera.blocked": "相机权限已被阻止。请在系统设置中为 OpenBot 开启，然后回到这里扫码。",
  "mobile.auth.camera.allow": "允许使用相机",
  "mobile.auth.camera.openSettings": "打开系统设置",
  "mobile.auth.error.signOutUnconfirmed": "无法确认已退出登录。请检查网络后重试。",
} as const satisfies PartialTranslation<typeof source>;
