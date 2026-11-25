import { APP_NAME } from "@openbot/contracts/app-identity";
import Constants from "expo-constants";
import { Typography } from "heroui-native";
import { View } from "react-native";
import { AppLogo } from "@/features/auth/components/app-logo";
import { SettingsContent } from "@/features/settings/components/settings-content";
import { nativeBuildVersion } from "@/shared/lib/native-application";
import { useText } from "@/shared/lib/text";

export function AboutSettingsScreen() {
  const { t } = useText();
  const version = Constants.expoConfig?.version ?? t("mobile.settings.about.development");
  const build = nativeBuildVersion();
  const versionLabel = build ? `${version} (${build})` : version;
  return (
    <SettingsContent>
      <View className="items-center gap-4 px-4 pb-6 pt-8">
        <AppLogo size={56} interactive />
        <View className="items-center gap-1">
          <Typography.Heading type="h4" align="center">
            {APP_NAME}
          </Typography.Heading>
          <Typography.Paragraph type="body-xs" align="center" className="text-grouped-secondary" selectable>
            {versionLabel}
          </Typography.Paragraph>
        </View>
      </View>
    </SettingsContent>
  );
}
