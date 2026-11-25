import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/auth";

export const messages = {
  "error.auth.serviceUnavailable":
    "O OpenBot não conseguiu acessar o serviço de contas. Verifique se a API está em execução e tente novamente.",
} as const satisfies PartialTranslation<typeof source>;
