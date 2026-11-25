import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/auth";

export const messages = {
  "mobile.auth.logo.animate": "Animeer OpenBot-logo",
  "mobile.auth.logo.animateHint": "Laat het logo knipogen",
  "mobile.auth.scanner.connectFailed": "Kan geen verbinding maken",
  "mobile.auth.scanner.codeFailed": "Kan deze code niet gebruiken",
  "mobile.auth.scanner.scanAgain": "Scan opnieuw",
  "mobile.auth.scanner.connecting": "Je telefoon verbinden…",
  "mobile.auth.scanner.readingInvitation": "Uitnodiging lezen…",
  "mobile.auth.scanner.scanDesktop": "Scan de code op je computer",
  "mobile.auth.scanner.scanInvitation": "Scan de uitnodigingscode",
  "mobile.auth.scanner.verifying": "Eenmalige code controleren.",
  "mobile.auth.scanner.checkingServer": "Identiteit van de server controleren.",
  "mobile.auth.scanner.keepCentered": "Houd de QR-code in het midden van het kader.",
  "mobile.auth.scanner.connectFallback": "OpenBot kan deze telefoon niet verbinden.",
  "mobile.auth.scanner.cameraFailed": "Kan de camera niet starten. Probeer opnieuw.",
  "mobile.auth.camera.title": "Cameratoegang nodig",
  "mobile.auth.camera.pairingReason":
    "OpenBot gebruikt de camera alleen om de eenmalige QR-code uit de desktop-app te scannen.",
  "mobile.auth.camera.invitationReason":
    "OpenBot gebruikt de camera alleen om de QR-code van de uitnodiging te scannen.",
  "mobile.auth.camera.blocked":
    "Cameratoegang is geblokkeerd. Zet deze aan voor OpenBot in de instellingen van je apparaat en kom dan terug om de code te scannen.",
  "mobile.auth.camera.allow": "Sta cameratoegang toe",
  "mobile.auth.camera.openSettings": "Open instellingen",
  "mobile.auth.error.signOutUnconfirmed":
    "Kan het uitloggen niet bevestigen. Controleer je verbinding en probeer opnieuw.",
} as const satisfies PartialTranslation<typeof source>;
