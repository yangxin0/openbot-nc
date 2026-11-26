import { router } from "expo-router";
import { Alert } from "react-native";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { JoinCodeSection } from "@/features/identity/components/join-code-section";
import { SettingsContent } from "@/features/settings/components/settings-content";
import { currentText } from "@/shared/lib/text";

function confirmReplace(): Promise<boolean> {
  const text = currentText();
  return new Promise((resolve) => {
    Alert.alert(
      text.t("mobile.identity.settings.replaceCodeTitle"),
      text.t("mobile.identity.settings.replaceCodeBody"),
      [
        { text: text.t("common.cancel"), style: "cancel", onPress: () => resolve(false) },
        {
          text: text.t("mobile.identity.settings.replaceCodeConfirm"),
          style: "destructive",
          onPress: () => resolve(true),
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

export function IdentityJoinScreen() {
  const { session, joinWithCode } = useMobileSession();
  return (
    <SettingsContent>
      <JoinCodeSection
        onJoin={async (code) => {
          if (session && !(await confirmReplace())) return false;
          await joinWithCode(code);
          if (router.canGoBack()) router.back();
          return true;
        }}
      />
    </SettingsContent>
  );
}
