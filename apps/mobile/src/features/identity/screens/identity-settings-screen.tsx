import type { RelayControlState } from "@openbot/team-client/relay-client";
import { Typography } from "heroui-native";
import { useState } from "react";
import { Alert } from "react-native";
import { useMobileSession, useRelaySnapshot } from "@/features/auth/context/mobile-session-context";
import { type PhoneIdentityErrorKey, phoneIdentityErrorKey } from "@/features/identity/model/phone-identity";
import { type RelayStateKey, relayStateKey } from "@/features/identity/model/phone-relay";
import { SettingsContent, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { haptics } from "@/shared/lib/haptics";
import { currentText, useText } from "@/shared/lib/text";

const LONG_DATE = { dateStyle: "long" } as const satisfies Intl.DateTimeFormatOptions;

function connectionKey(
  state: RelayControlState,
):
  | RelayStateKey
  | "mobile.identity.settings.online"
  | "mobile.identity.settings.connecting"
  | "mobile.identity.settings.stopped" {
  if (state.status === "online") return "mobile.identity.settings.online";
  if (state.status === "connecting") return "mobile.identity.settings.connecting";
  if (state.code === "stopped") return "mobile.identity.settings.stopped";
  return relayStateKey(state.code);
}

function serverName(relayUrl: string): string {
  try {
    return new URL(relayUrl).host;
  } catch {
    return relayUrl;
  }
}

export function IdentitySettingsScreen() {
  const { t, format } = useText();
  const { session, removeIdentity } = useMobileSession();
  const snapshot = useRelaySnapshot();
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<PhoneIdentityErrorKey | null>(null);
  if (!session) return null;
  const { identity } = session;

  function confirmRemove(): void {
    const text = currentText();
    Alert.alert(text.t("mobile.identity.settings.removeTitle"), text.t("mobile.identity.settings.removeBody"), [
      { text: text.t("common.cancel"), style: "cancel" },
      {
        text: text.t("mobile.identity.settings.remove"),
        style: "destructive",
        onPress: () => {
          setBusy(true);
          setErrorKey(null);
          void removeIdentity()
            .then(() => haptics.notification("success"))
            .catch((error: unknown) => setErrorKey(phoneIdentityErrorKey(error)))
            .finally(() => setBusy(false));
        },
      },
    ]);
  }

  return (
    <SettingsContent>
      <SettingsSection title={t("mobile.identity.settings.identity")}>
        <SettingsRow value={snapshot.team?.name ?? identity.team}>
          <Typography.Paragraph>{t("mobile.identity.settings.team")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow value={identity.user}>
          <Typography.Paragraph>{t("mobile.identity.settings.user")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow value={identity.device ?? t("mobile.identity.settings.deviceNone")}>
          <Typography.Paragraph>{t("mobile.identity.settings.device")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow value={serverName(session.relayUrl)}>
          <Typography.Paragraph>{t("mobile.identity.settings.server")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow value={format.date(new Date(identity.expiresAt), LONG_DATE)}>
          <Typography.Paragraph>{t("mobile.identity.settings.expires")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow description={t(connectionKey(snapshot.state))}>
          <Typography.Paragraph>{t("mobile.identity.settings.connection")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection footer={t("mobile.identity.settings.removeHint")}>
        <SettingsRow disabled={busy} disclosure={false} onPress={confirmRemove}>
          <Typography.Paragraph className="text-danger-text">
            {t("mobile.identity.settings.remove")}
          </Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      {errorKey ? (
        <Typography.Paragraph accessibilityRole="alert" className="px-1 text-danger-text">
          {t(errorKey)}
        </Typography.Paragraph>
      ) : null}
    </SettingsContent>
  );
}
