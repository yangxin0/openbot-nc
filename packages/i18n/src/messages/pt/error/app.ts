import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/app";

export const messages = {
  "error.app.externalLinkProtocol": "Somente links HTTP(S) podem abrir no navegador externo.",
  "error.app.notificationsUnsupported": "Este sistema não oferece suporte a notificações na área de trabalho.",
  "error.app.notificationSettingsMissing": "Este sistema não tem uma página de configurações de notificações.",
  "error.app.notReady": "O OpenBot-NC não está pronto.",
  "error.app.macSecureStorageUnavailable": "O armazenamento seguro do macOS está indisponível.",
  "error.app.secretStorageUnavailable": "O armazenamento de segredos do sistema está indisponível.",
  "error.app.windowBlockedBySecuritySoftware":
    "Um software de segurança neste computador provavelmente parou a janela do OpenBot-NC. No seu software de segurança, por exemplo o Kaspersky, adicione o OpenBot-NC.exe como aplicativo confiável. Depois, abra o OpenBot-NC de novo.",
} as const satisfies PartialTranslation<typeof source>;
