import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/app";

export const messages = {
  "error.app.externalLinkProtocol": "Seuls les liens HTTP(S) peuvent s’ouvrir dans le navigateur externe.",
  "error.app.notificationsUnsupported": "Ce système ne prend pas en charge les notifications de bureau.",
  "error.app.notificationSettingsMissing": "Ce système n’a pas de page de réglages des notifications.",
  "error.app.notReady": "OpenBot-NC n’est pas prêt.",
  "error.app.macSecureStorageUnavailable": "Le stockage sécurisé de macOS n’est pas disponible.",
  "error.app.secretStorageUnavailable": "Le stockage des secrets du système n’est pas disponible.",
  "error.app.windowBlockedBySecuritySoftware":
    "Un logiciel de sécurité de cet ordinateur a probablement arrêté la fenêtre d’OpenBot-NC. Dans votre logiciel de sécurité, par exemple Kaspersky, ajoutez OpenBot-NC.exe comme application de confiance. Puis redémarrez OpenBot-NC.",
} as const satisfies PartialTranslation<typeof source>;
