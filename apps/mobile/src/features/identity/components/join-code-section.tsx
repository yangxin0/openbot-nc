import { router } from "expo-router";
import { Button, Spinner, Typography } from "heroui-native";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { takePendingJoinCode, usePendingJoinCode } from "@/features/identity/model/pending-join-code";
import { type PhoneJoinErrorKey, phoneJoinErrorKey } from "@/features/identity/model/phone-identity";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

export function JoinCodeSection({
  disabled = false,
  onJoin,
  onBusyChange,
}: {
  disabled?: boolean;
  onJoin: (code: string) => Promise<boolean>;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { t } = useText();
  const pending = usePendingJoinCode((state) => state.code);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<PhoneJoinErrorKey | null>(null);

  useEffect(() => {
    if (pending === null) return;
    setCode(pending);
    setErrorKey(null);
    takePendingJoinCode();
  }, [pending]);

  async function join(): Promise<void> {
    const text = code.trim();
    if (text === "") return;
    setBusy(true);
    onBusyChange?.(true);
    setErrorKey(null);
    try {
      if (await onJoin(text)) {
        setCode("");
        void haptics.notification("success");
      }
    } catch (error) {
      setErrorKey(phoneJoinErrorKey(error));
      void haptics.notification("error");
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }

  return (
    <View className="gap-3">
      <Typography.Heading type="h4">{t("mobile.identity.joinTitle")}</Typography.Heading>
      <Typography.Paragraph type="body-sm" className="text-text-secondary">
        {t("mobile.identity.joinHelp")}
      </Typography.Paragraph>
      <SheetFormField
        label={t("mobile.identity.joinLabel")}
        placeholder={t("mobile.identity.joinPlaceholder")}
        value={code}
        onChangeText={(value) => {
          setCode(value);
          setErrorKey(null);
        }}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!busy && !disabled}
        error={errorKey ? t(errorKey) : undefined}
      />
      <Button
        size="lg"
        variant="primary"
        isDisabled={busy || disabled || code.trim().length === 0}
        onPress={() => void join()}
      >
        {busy ? <Spinner size="sm" /> : null}
        <Button.Label className="font-sans font-semibold">{t("mobile.identity.join")}</Button.Label>
      </Button>
      <Button
        size="lg"
        variant="secondary"
        isDisabled={busy || disabled}
        onPress={() => router.push("/scan-join-code")}
      >
        <Button.Label className="font-sans font-semibold">{t("mobile.identity.scan")}</Button.Label>
      </Button>
    </View>
  );
}
