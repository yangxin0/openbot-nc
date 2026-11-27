import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/app";

export const messages = {
  "error.app.externalLinkProtocol": "Solo se pueden abrir enlaces HTTP(S) en el navegador externo.",
  "error.app.notificationsUnsupported": "Este sistema no admite notificaciones de escritorio.",
  "error.app.notificationSettingsMissing": "Este sistema no tiene una página de ajustes de notificaciones.",
  "error.app.notReady": "OpenBot-NC no está listo.",
  "error.app.macSecureStorageUnavailable": "El almacenamiento seguro de macOS no está disponible.",
  "error.app.secretStorageUnavailable": "El almacenamiento de secretos del sistema no está disponible.",
  "error.app.windowBlockedBySecuritySoftware":
    "Es probable que el software de seguridad de este ordenador haya detenido la ventana de OpenBot-NC. En tu software de seguridad, por ejemplo Kaspersky, añade OpenBot-NC.exe como aplicación de confianza. Después, vuelve a iniciar OpenBot-NC.",
} as const satisfies PartialTranslation<typeof source>;
