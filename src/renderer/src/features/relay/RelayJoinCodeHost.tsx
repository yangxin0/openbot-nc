import { ConfirmDialog, RotateCcw } from "@openbot/ui";
import { RelayJoinCodeDialog } from "@openbot/ui/features/settings/RelayJoinCode";
import { useText } from "@openbot/ui/text";
import { flush, onSettled } from "solid-js";
import { useRelay } from "./relay-context";
import { relayPort } from "./relay-port";

export function RelayJoinCodeHost() {
  const { t } = useText();
  const relay = useRelay();
  onSettled(() => {
    const unsubscribe = relayPort().relay.onOpenJoinCode((code) => flush(() => relay.requestJoin(code)));
    void relayPort()
      .relay.takePendingJoinCode()
      .then((code) => {
        if (code !== null) relay.requestJoin(code);
      })
      .catch(() => undefined);
    return unsubscribe;
  });
  return (
    <>
      <ConfirmDialog
        open={relay.joinStage() === "confirm"}
        tone="default"
        icon={<RotateCcw />}
        title={t("settings.team.replaceCode.confirmTitle")}
        description={t("settings.team.replaceCode.confirmDescription")}
        confirmLabel={t("settings.team.replaceCode.confirm")}
        onCancel={() => relay.closeJoin()}
        onConfirm={() => relay.confirmJoinReplace()}
      />
      <RelayJoinCodeDialog
        open={relay.joinStage() === "code"}
        code={relay.view.joinRequest?.code ?? ""}
        busy={relay.view.busy === "join"}
        error={relay.view.error?.action === "join" ? relay.view.error.message : null}
        onCancel={() => relay.closeJoin()}
        onJoin={(code) => relay.joinRequested(code)}
      />
    </>
  );
}
