import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/auth";

export const messages = {
  "error.auth.serviceUnavailable":
    "OpenBot не смог связаться со службой аккаунтов. Убедитесь, что API работает, и повторите попытку.",
  "error.auth.sessionTimeout":
    "OpenBot не ответил вовремя. Проверьте подключение к интернету, затем повторите попытку.",
  "error.auth.deliveryTimeout":
    "OpenBot не успел подтвердить доставку. Код всё же может прийти; проверьте доставку, прежде чем отправлять снова.",
} as const satisfies PartialTranslation<typeof source>;
