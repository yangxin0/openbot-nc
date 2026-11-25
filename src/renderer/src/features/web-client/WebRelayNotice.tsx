import { AppLogo } from "@openbot/brand";
import type { AppVariant } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import type { RelayControlSnapshot, RelaySocketErrorCode } from "@openbot/team-client/relay-client";
import { Button, ConfirmDialog, Heading, RotateCcw, Spinner, Text } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { type Accessor, createSignal, onSettled, Show } from "solid-js";
import { relayStateKey, type WebRelaySource } from "./web-relay";

export function relaySnapshotSignal(source: WebRelaySource): Accessor<RelayControlSnapshot> {
  const [snapshot, setSnapshot] = createSignal(source.snapshot());
  onSettled(() => source.subscribe((next) => setSnapshot(() => next)));
  return snapshot;
}

function noticeText(snapshot: RelayControlSnapshot): { title: AppTextKey; detail: AppTextKey; busy: boolean } {
  const { state } = snapshot;
  if (state.status === "connecting") {
    return { title: "webClient.relay.connecting", detail: "webClient.relay.noServersDescription", busy: true };
  }
  if (state.status === "offline" && state.code !== "stopped") {
    return { title: "webClient.relay.offline", detail: relayStateKey(state.code), busy: false };
  }
  return { title: "webClient.relay.noServers", detail: "webClient.relay.noServersDescription", busy: false };
}

export function WebRelayNotice(props: { source: WebRelaySource; variant: AppVariant }) {
  const { t } = useText();
  const snapshot = relaySnapshotSignal(props.source);
  const text = () => noticeText(snapshot());
  return (
    <section class="conversation-panel web-connect" aria-labelledby="web-relay-notice-title" aria-live="polite">
      <div class="web-connect-card">
        <header class="web-connect-header">
          <AppLogo variant={props.variant} class="web-connect-logo" />
          <Heading as="h2" size="lg" id="web-relay-notice-title">
            {t(text().title)}
          </Heading>
          <Text tone="muted">{t(text().detail)}</Text>
          <Show when={text().busy}>
            <Spinner size="sm" label={t(text().title)} />
          </Show>
        </header>
      </div>
    </section>
  );
}

export function WebRelayStopped(props: {
  code: RelaySocketErrorCode;
  variant: AppVariant;
  onRetry: () => void;
  onRemoveIdentity: () => Promise<void>;
}) {
  const { t } = useText();
  const [confirming, setConfirming] = createSignal(false);
  return (
    <main class="web-identity" aria-labelledby="web-relay-stopped-title">
      <div class="web-connect-card">
        <header class="web-connect-header">
          <AppLogo variant={props.variant} class="web-connect-logo" />
          <Heading as="h1" size="lg" id="web-relay-stopped-title">
            {t("webClient.relay.stopped")}
          </Heading>
          <Text tone="muted" role="alert">
            {t(relayStateKey(props.code))}
          </Text>
        </header>
        <div class="web-connect-primary-actions">
          <Button type="button" variant="outline" onClick={() => props.onRetry()}>
            <RotateCcw aria-hidden="true" />
            {t("common.retry")}
          </Button>
          <Button type="button" variant="destructive" onClick={() => setConfirming(true)}>
            {t("settings.team.remove.confirm")}
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirming()}
        title={t("settings.team.remove.confirmTitle")}
        description={t("webClient.team.removeConfirmDescription")}
        confirmLabel={t("settings.team.remove.confirm")}
        onCancel={() => setConfirming(false)}
        onConfirm={async () => {
          await props.onRemoveIdentity();
          setConfirming(false);
        }}
      />
    </main>
  );
}
