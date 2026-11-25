import type { MobileTextKey, MobileTranslate } from "@openbot/i18n/mobile";
import * as Clipboard from "expo-clipboard";
import { showFailureAlert } from "@/shared/lib/failure-alert";
import { haptics } from "@/shared/lib/haptics";

export async function copyToClipboard(text: string, failedTitle: MobileTextKey, t: MobileTranslate): Promise<boolean> {
  try {
    await Clipboard.setStringAsync(text);
    void haptics.notification("success");
    return true;
  } catch (error) {
    void haptics.notification("error");
    showFailureAlert(error, t(failedTitle), t("mobile.chat.copyFailedMessage"));
    return false;
  }
}
