import { currentText } from "@openbot/ui/text";

export function marketplaceErrorMessage(cause: unknown): string {
  const text = currentText();
  return text.errorMessage(cause, text.t("marketplace.error.actionFailed"));
}
