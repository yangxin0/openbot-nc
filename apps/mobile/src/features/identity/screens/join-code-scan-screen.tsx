import { router } from "expo-router";
import { QrScanner } from "@/features/auth/components/qr-scanner";
import { holdPendingJoinCode } from "@/features/identity/model/pending-join-code";
import { useText } from "@/shared/lib/text";

export function JoinCodeScanScreen() {
  const { t } = useText();
  return (
    <QrScanner
      pairing={false}
      onScan={async (data) => {
        if (!holdPendingJoinCode(data)) throw new Error(t("mobile.identity.scanNoCode"));
        router.back();
      }}
    />
  );
}
