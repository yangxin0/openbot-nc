import { Redirect, router, Stack, useLocalSearchParams } from "expo-router";
import { openBrowserAsync } from "expo-web-browser";
import { Button, Typography } from "heroui-native";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { forgetIncomingLink, readIncomingLink } from "../model/incoming-links";

export function IncomingLinkScreen() {
  const { request } = useLocalSearchParams<{ request?: string }>();
  return <IncomingLinkContent key={request ?? "invalid"} request={request} />;
}

function IncomingLinkContent({ request }: { request?: string }) {
  const { t } = useText();
  const insets = useSafeAreaInsets();
  const { session } = useMobileSession();
  const [link] = useState(() => readIncomingLink(request));
  const [error, setError] = useState<string | null>(null);
  const opened = useRef(false);
  const signedIn = Boolean(session);
  useEffect(() => {
    if (link.kind !== "template" || !signedIn || opened.current) return;
    opened.current = true;
    router.dismissTo("/connected");
    router.push({ pathname: "/install-agent", params: { request } });
  }, [link.kind, signedIn, request]);

  function close() {
    forgetIncomingLink(request);
    router.replace(session ? "/connected" : "/");
  }

  if (link.kind === "template") return session ? null : <Redirect href="/" />;

  return (
    <View
      className="flex-1 justify-center gap-5 bg-background py-safe-offset-6"
      style={{ paddingLeft: insets.left + 24, paddingRight: insets.right + 24 }}
    >
      <Stack.Screen options={{ headerShown: false }} />
      <Typography.Heading type="h3">
        {link.kind === "plugin" ? t("mobile.link.plugin.title") : t("mobile.link.unavailable.title")}
      </Typography.Heading>
      <Typography.Paragraph>
        {link.kind === "plugin" ? t("mobile.link.plugin.description") : t("mobile.link.unavailable.description")}
      </Typography.Paragraph>
      {error ? <Typography.Paragraph className="text-danger-text">{error}</Typography.Paragraph> : null}
      {link.kind === "plugin" ? (
        <Button
          onPress={() => {
            void haptics.impact("soft");
            void openBrowserAsync(link.url).catch(() => {
              void haptics.notification("error");
              setError(t("mobile.link.plugin.openFailed"));
            });
          }}
        >
          <Button.Label>{t("mobile.link.plugin.view")}</Button.Label>
        </Button>
      ) : null}
      <Button
        variant="ghost"
        onPress={() => {
          void haptics.impact("soft");
          close();
        }}
      >
        <Button.Label>{t("common.close")}</Button.Label>
      </Button>
    </View>
  );
}
