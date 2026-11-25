import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/auth";

export const messages = {
  "error.auth.serviceUnavailable":
    "OpenBot не смог связаться со службой аккаунтов. Убедитесь, что API работает, и повторите попытку.",
} as const satisfies PartialTranslation<typeof source>;
