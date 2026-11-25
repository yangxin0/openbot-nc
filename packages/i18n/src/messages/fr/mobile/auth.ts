import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/auth";

export const messages = {
  "mobile.auth.logo.animate": "Animer le logo OpenBot",
  "mobile.auth.logo.animateHint": "Le logo fait un clin d’œil",
  "mobile.auth.scanner.connectFailed": "Connexion impossible",
  "mobile.auth.scanner.codeFailed": "Impossible d’utiliser ce code",
  "mobile.auth.scanner.scanAgain": "Scanner à nouveau",
  "mobile.auth.scanner.connecting": "Connexion de votre téléphone…",
  "mobile.auth.scanner.readingInvitation": "Lecture de l’invitation…",
  "mobile.auth.scanner.scanDesktop": "Scannez le code de l’ordinateur",
  "mobile.auth.scanner.scanInvitation": "Scannez le code d’invitation",
  "mobile.auth.scanner.verifying": "Vérification du code à usage unique.",
  "mobile.auth.scanner.checkingServer": "Vérification de l’identité du serveur.",
  "mobile.auth.scanner.keepCentered": "Gardez le code QR au centre du cadre.",
  "mobile.auth.scanner.connectFallback": "OpenBot n’a pas pu connecter ce téléphone.",
  "mobile.auth.scanner.cameraFailed": "Impossible de démarrer l’appareil photo. Réessayez.",
  "mobile.auth.camera.title": "Accès à l’appareil photo requis",
  "mobile.auth.camera.pairingReason":
    "OpenBot utilise l’appareil photo uniquement pour scanner le code QR à usage unique affiché dans l’app de bureau.",
  "mobile.auth.camera.invitationReason":
    "OpenBot utilise l’appareil photo uniquement pour scanner le code QR de l’invitation.",
  "mobile.auth.camera.blocked":
    "L’accès à l’appareil photo est bloqué. Activez-le pour OpenBot dans les réglages de l’appareil, puis revenez ici pour scanner le code.",
  "mobile.auth.camera.allow": "Autoriser l’appareil photo",
  "mobile.auth.camera.openSettings": "Ouvrir les réglages",
  "mobile.auth.error.signOutUnconfirmed":
    "Impossible de confirmer la déconnexion. Vérifiez votre connexion et réessayez.",
} as const satisfies PartialTranslation<typeof source>;
