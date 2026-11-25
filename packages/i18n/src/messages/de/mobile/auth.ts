import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/auth";

export const messages = {
  "mobile.auth.logo.animate": "OpenBot-NC-Logo animieren",
  "mobile.auth.logo.animateHint": "Lässt das Logo zwinkern",
  "mobile.auth.scanner.connectFailed": "Verbindung fehlgeschlagen",
  "mobile.auth.scanner.codeFailed": "Dieser Code kann nicht verwendet werden",
  "mobile.auth.scanner.scanAgain": "Erneut scannen",
  "mobile.auth.scanner.connecting": "Dein Telefon wird verbunden…",
  "mobile.auth.scanner.readingInvitation": "Einladung wird gelesen…",
  "mobile.auth.scanner.scanDesktop": "Scanne den Code vom Desktop",
  "mobile.auth.scanner.scanInvitation": "Scanne den Einladungscode",
  "mobile.auth.scanner.verifying": "Der Einmalcode wird überprüft.",
  "mobile.auth.scanner.checkingServer": "Die Identität des Servers wird geprüft.",
  "mobile.auth.scanner.keepCentered": "Halte den QR-Code mittig im Rahmen.",
  "mobile.auth.scanner.connectFallback": "OpenBot-NC konnte dieses Telefon nicht verbinden.",
  "mobile.auth.scanner.cameraFailed": "Die Kamera konnte nicht gestartet werden. Versuche es erneut.",
  "mobile.auth.camera.title": "Kamerazugriff erforderlich",
  "mobile.auth.camera.pairingReason":
    "OpenBot-NC verwendet die Kamera nur, um den einmaligen QR-Code aus der Desktop-App zu scannen.",
  "mobile.auth.camera.invitationReason":
    "OpenBot-NC verwendet die Kamera nur, um den QR-Code der Einladung zu scannen.",
  "mobile.auth.camera.blocked":
    "Der Kamerazugriff ist blockiert. Aktiviere ihn für OpenBot-NC in den Geräteeinstellungen und kehre dann hierher zurück, um den Code zu scannen.",
  "mobile.auth.camera.allow": "Kamerazugriff erlauben",
  "mobile.auth.camera.openSettings": "Einstellungen öffnen",
  "mobile.auth.error.signOutUnconfirmed":
    "Die Abmeldung konnte nicht bestätigt werden. Prüfe deine Verbindung und versuche es erneut.",
} as const satisfies PartialTranslation<typeof source>;
