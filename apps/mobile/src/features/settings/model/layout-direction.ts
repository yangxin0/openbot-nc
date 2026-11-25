import { localeDirection } from "@openbot/i18n/mobile";
import { reloadAppAsync } from "expo";
import { Alert, DevSettings, I18nManager } from "react-native";
import { currentLocale, currentText } from "@/shared/lib/text";

function syncLayoutDirection(): boolean {
  const rightToLeft = localeDirection(currentLocale()) === "rtl";
  I18nManager.allowRTL(rightToLeft);
  I18nManager.forceRTL(rightToLeft);
  return rightToLeft !== I18nManager.isRTL;
}

async function restartApp(): Promise<void> {
  if (__DEV__) {
    DevSettings.reload();
    return;
  }
  await reloadAppAsync();
}

export function offerLayoutRestart(onRestartFailed: (message: string) => void): void {
  if (!syncLayoutDirection()) return;
  const text = currentText();
  Alert.alert(text.t("mobile.settings.language.restartTitle"), text.t("mobile.settings.language.restartBody"), [
    { text: text.t("common.cancel"), style: "cancel" },
    {
      text: text.t("mobile.settings.language.restartNow"),
      onPress: () => {
        void restartApp().catch(() => {
          onRestartFailed(text.t("mobile.settings.language.restartFailed"));
        });
      },
    },
  ]);
}
