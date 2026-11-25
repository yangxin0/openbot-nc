import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/app";

export const messages = {
  "error.app.externalLinkProtocol": "Seuls les liens HTTP(S) peuvent s’ouvrir dans le navigateur externe.",
  "error.app.notificationsUnsupported": "Ce système ne prend pas en charge les notifications de bureau.",
  "error.app.notificationSettingsMissing": "Ce système n’a pas de page de réglages des notifications.",
  "error.app.notReady": "OpenBot-NC n’est pas prêt.",
  "error.app.macSecureStorageUnavailable": "Le stockage sécurisé de macOS n’est pas disponible.",
  "error.app.secretStorageUnavailable": "Le stockage des secrets du système n’est pas disponible.",
} as const satisfies PartialTranslation<typeof source>;
