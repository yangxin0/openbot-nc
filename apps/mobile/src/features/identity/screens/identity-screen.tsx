import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { Button, Spinner, Typography } from "heroui-native";
import { useState } from "react";
import { View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { withUniwind } from "uniwind";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import {
  PhoneIdentityError,
  type PhoneIdentityErrorKey,
  phoneIdentityErrorKey,
} from "@/features/identity/model/phone-identity";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

const StyledKeyboardAwareScrollView = withUniwind(KeyboardAwareScrollView);
const IDENTITY_FILE_BYTES = 64 * 1024;
const IDENTITY_TYPES = ["application/json", "text/plain", "public.json", "*/*"];

async function readPickedIdentity(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: IDENTITY_TYPES,
    multiple: false,
    copyToCacheDirectory: true,
  });
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return null;
  const file = new File(asset.uri);
  try {
    if ((asset.size ?? file.size) > IDENTITY_FILE_BYTES)
      throw new PhoneIdentityError("mobile.identity.error.fileTooLarge");
    return await file.text();
  } catch (error) {
    if (error instanceof PhoneIdentityError) throw error;
    throw new PhoneIdentityError("mobile.identity.error.fileUnreadable");
  } finally {
    if (file.exists) file.delete();
  }
}

export function IdentityScreen() {
  const { t } = useText();
  const insets = useSafeAreaInsets();
  const { importIdentity, endedKey } = useMobileSession();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"paste" | "file" | null>(null);
  const [errorKey, setErrorKey] = useState<PhoneIdentityErrorKey | null>(null);
  const shownKey = errorKey ?? endedKey;

  async function use(source: "paste" | "file"): Promise<void> {
    setBusy(source);
    setErrorKey(null);
    try {
      const value = source === "paste" ? text : await readPickedIdentity();
      if (value === null) return;
      await importIdentity(value);
      setText("");
      void haptics.notification("success");
    } catch (error) {
      setErrorKey(phoneIdentityErrorKey(error));
      void haptics.notification("error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <StyledKeyboardAwareScrollView
      className="flex-1"
      contentContainerStyle={{ paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 }}
      contentContainerClassName="gap-6 px-5"
      keyboardShouldPersistTaps="handled"
      bottomOffset={24}
    >
      <View className="gap-3">
        <Typography.Heading type="h2">{t("mobile.identity.title")}</Typography.Heading>
        <Typography.Paragraph className="text-text-secondary">{t("mobile.identity.intro")}</Typography.Paragraph>
        <Typography.Paragraph type="body-sm" className="text-text-secondary">
          {t("mobile.identity.phoneHelp")}
        </Typography.Paragraph>
      </View>
      <SheetFormField
        label={t("mobile.identity.pasteLabel")}
        placeholder={t("mobile.identity.pastePlaceholder")}
        value={text}
        onChangeText={(value) => {
          setText(value);
          setErrorKey(null);
        }}
        multiline
        tall
        autoCapitalize="none"
        autoCorrect={false}
        editable={busy === null}
        error={shownKey ? t(shownKey) : undefined}
      />
      <View className="gap-3">
        <Button
          size="lg"
          variant="primary"
          isDisabled={busy !== null || text.trim().length === 0}
          onPress={() => void use("paste")}
        >
          {busy === "paste" ? <Spinner size="sm" /> : null}
          <Button.Label className="font-sans font-semibold">{t("mobile.identity.usePasted")}</Button.Label>
        </Button>
        <Button size="lg" variant="secondary" isDisabled={busy !== null} onPress={() => void use("file")}>
          {busy === "file" ? <Spinner size="sm" /> : null}
          <Button.Label className="font-sans font-semibold">{t("mobile.identity.chooseFile")}</Button.Label>
        </Button>
      </View>
    </StyledKeyboardAwareScrollView>
  );
}
