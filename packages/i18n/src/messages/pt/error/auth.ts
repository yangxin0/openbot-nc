import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/auth";

export const messages = {
  "error.auth.serviceUnavailable":
    "O OpenBot não conseguiu acessar o serviço de contas. Verifique se a API está em execução e tente novamente.",
  "error.auth.sessionTimeout":
    "O OpenBot não respondeu a tempo. Verifique sua conexão com a internet e tente novamente.",
  "error.auth.deliveryTimeout":
    "O OpenBot não conseguiu confirmar a entrega a tempo. O código ainda pode chegar; verifique a entrega antes de enviar novamente.",
} as const satisfies PartialTranslation<typeof source>;
