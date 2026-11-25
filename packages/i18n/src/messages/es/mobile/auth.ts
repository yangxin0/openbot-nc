import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/auth";

export const messages = {
  "mobile.auth.logo.animate": "Animar el logotipo de OpenBot",
  "mobile.auth.logo.animateHint": "Hace que el logotipo guiñe un ojo",
  "mobile.auth.scanner.connectFailed": "No se pudo conectar",
  "mobile.auth.scanner.codeFailed": "No se pudo usar este código",
  "mobile.auth.scanner.scanAgain": "Escanear de nuevo",
  "mobile.auth.scanner.connecting": "Conectando tu teléfono…",
  "mobile.auth.scanner.readingInvitation": "Leyendo la invitación…",
  "mobile.auth.scanner.scanDesktop": "Escanea el código del escritorio",
  "mobile.auth.scanner.scanInvitation": "Escanea el código de invitación",
  "mobile.auth.scanner.verifying": "Verificando el código de un solo uso.",
  "mobile.auth.scanner.checkingServer": "Comprobando la identidad del servidor.",
  "mobile.auth.scanner.keepCentered": "Mantén el código QR centrado dentro del marco.",
  "mobile.auth.scanner.connectFallback": "OpenBot no pudo conectar este teléfono.",
  "mobile.auth.scanner.cameraFailed": "No se pudo iniciar la cámara. Inténtalo de nuevo.",
  "mobile.auth.camera.title": "Se necesita acceso a la cámara",
  "mobile.auth.camera.pairingReason":
    "OpenBot usa la cámara solo para escanear el código QR de un solo uso que muestra la aplicación de escritorio.",
  "mobile.auth.camera.invitationReason": "OpenBot usa la cámara solo para escanear el código QR de la invitación.",
  "mobile.auth.camera.blocked":
    "El acceso a la cámara está bloqueado. Actívalo para OpenBot en los ajustes del dispositivo y vuelve aquí para escanear el código.",
  "mobile.auth.camera.allow": "Permitir acceso a la cámara",
  "mobile.auth.camera.openSettings": "Abrir ajustes",
  "mobile.auth.error.signOutUnconfirmed":
    "No se pudo confirmar el cierre de sesión. Comprueba tu conexión e inténtalo de nuevo.",
} as const satisfies PartialTranslation<typeof source>;
