import { defineMessages } from "../../../message";

export const messages = defineMessages("mobile.auth", {
  "mobile.auth.logo.animate": "Animate OpenBot-NC logo",
  "mobile.auth.logo.animateHint": "Makes the logo wink",
  "mobile.auth.scanner.connectFailed": "Couldn’t connect",
  "mobile.auth.scanner.codeFailed": "Couldn’t use this code",
  "mobile.auth.scanner.scanAgain": "Scan again",
  "mobile.auth.scanner.connecting": "Connecting your phone…",
  "mobile.auth.scanner.readingInvitation": "Reading the invitation…",
  "mobile.auth.scanner.scanDesktop": "Scan the desktop code",
  "mobile.auth.scanner.scanInvitation": "Scan the invitation code",
  "mobile.auth.scanner.verifying": "Verifying the one-time code.",
  "mobile.auth.scanner.checkingServer": "Checking the server identity.",
  "mobile.auth.scanner.keepCentered": "Keep the QR code centered inside the frame.",
  "mobile.auth.scanner.connectFallback": "OpenBot-NC could not connect this phone.",
  "mobile.auth.scanner.cameraFailed": "Could not start the camera. Try again.",
  "mobile.auth.camera.title": "Camera access required",
  "mobile.auth.camera.pairingReason":
    "OpenBot-NC uses the camera only to scan the one-time QR code shown in the desktop app.",
  "mobile.auth.camera.invitationReason": "OpenBot-NC uses the camera only to scan the invitation QR code.",
  "mobile.auth.camera.blocked":
    "Camera access is blocked. Enable it for OpenBot-NC in device settings, then return here to scan the code.",
  "mobile.auth.camera.allow": "Allow camera access",
  "mobile.auth.camera.openSettings": "Open settings",
  "mobile.auth.error.signOutUnconfirmed": "Could not confirm sign-out. Check your connection and try again.",
});
