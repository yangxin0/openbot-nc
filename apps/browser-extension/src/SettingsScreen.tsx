import type { RelayBrowserIdentity, RelayControlState } from "@openbot/team-client/relay-client";
import { ArrowLeft, Button, ChevronDown, Globe2, Trash2 } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { createSignal, createUniqueId, For, Show } from "solid-js";
import { removeAllowedSite, siteName, useAllowedSites } from "./BrowserSharing";

type IdentityFacts = Pick<RelayBrowserIdentity, "team" | "user" | "device" | "relayUrl" | "expiresAt">;

interface SettingsScreenProps {
  canShare: boolean;
  identity: IdentityFacts;
  connection: RelayControlState;
  onBack: () => void;
  onRemoveIdentity: () => Promise<void>;
}

const CONNECTION_LABELS = {
  connecting: "settings.team.connection.connecting",
  online: "settings.team.connection.online",
  offline: "settings.team.connection.offline",
} as const;

export function SettingsScreen(props: SettingsScreenProps) {
  const { t } = useText();
  return (
    <div class="ext-form-screen">
      <header class="ch-topbar">
        <button type="button" class="ch-back" aria-label={t("common.back")} onClick={() => props.onBack()}>
          <ArrowLeft size={16} aria-hidden="true" />
        </button>
        <h1 class="ext-form-title">{t("extension.home.settings")}</h1>
      </header>
      <div class="ext-form-body">
        <IdentitySection identity={props.identity} connection={props.connection} onRemove={props.onRemoveIdentity} />
        <Show when={props.canShare}>
          <div class="ext-settings-rows">
            <SharedTabsRow />
          </div>
        </Show>
      </div>
    </div>
  );
}

function IdentitySection(props: {
  identity: IdentityFacts;
  connection: RelayControlState;
  onRemove: () => Promise<void>;
}) {
  const { t, format } = useText();
  const [removal, setRemoval] = createSignal<"closed" | "confirming" | "removing" | "failed">("closed");
  const titleId = `ext-settings-identity-${createUniqueId()}`;
  async function remove(): Promise<void> {
    setRemoval("removing");
    try {
      await props.onRemove();
    } catch {
      setRemoval("failed");
    }
  }
  return (
    <section class="ext-settings-identity" aria-labelledby={titleId}>
      <h2 id={titleId} class="ext-settings-heading">
        {t("settings.team.identity.title")}
      </h2>
      <p class="ext-settings-note">{t("extension.identity.settingsDescription")}</p>
      <dl class="ext-settings-facts">
        <Fact label={t("settings.team.fact.team")}>{props.identity.team}</Fact>
        <Fact label={t("settings.team.fact.user")}>{props.identity.user}</Fact>
        <Fact label={t("settings.team.fact.device")}>{props.identity.device ?? t("settings.team.fact.none")}</Fact>
        <Fact label={t("settings.team.fact.server")}>
          <span dir="ltr">{props.identity.relayUrl ?? t("settings.team.fact.none")}</span>
        </Fact>
        <Fact label={t("settings.team.fact.expires")}>
          {format.date(props.identity.expiresAt, { dateStyle: "medium" })}
        </Fact>
        <Fact label={t("settings.team.fact.connection")}>{t(CONNECTION_LABELS[props.connection.status])}</Fact>
      </dl>
      <Show
        when={removal() !== "closed"}
        fallback={
          <Button type="button" variant="outline" onClick={() => setRemoval("confirming")}>
            <Trash2 size={14} aria-hidden="true" />
            {t("settings.team.remove.title")}
          </Button>
        }
      >
        <section class="ext-settings-confirm" aria-labelledby={`${titleId}-confirm`}>
          <p id={`${titleId}-confirm`} class="ext-settings-confirm-title">
            {t("settings.team.remove.confirmTitle")}
          </p>
          <p class="ext-settings-note">{t("extension.identity.removeConfirmDescription")}</p>
          <Show when={removal() === "failed"}>
            <p class="ext-settings-error" role="alert">
              {t("settings.team.error.remove")}
            </p>
          </Show>
          <div class="ext-settings-confirm-actions">
            <Button
              type="button"
              variant="ghost"
              disabled={removal() === "removing"}
              onClick={() => setRemoval("closed")}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              loading={removal() === "removing"}
              loadingLabel={t("settings.team.remove.confirm")}
              onClick={() => void remove()}
            >
              {t("settings.team.remove.confirm")}
            </Button>
          </div>
        </section>
      </Show>
    </section>
  );
}

function Fact(props: { label: string; children: JSX.Element }) {
  return (
    <div class="ext-settings-fact">
      <dt>{props.label}</dt>
      <dd>{props.children}</dd>
    </div>
  );
}

function SharedTabsRow() {
  const { t } = useText();
  const sites = useAllowedSites();
  const [open, setOpen] = createSignal(false);
  const panelId = `ext-settings-shared-${createUniqueId()}`;
  return (
    <div class="ext-settings-disclosure" data-open={open() ? "" : undefined}>
      <button
        type="button"
        class="ext-settings-row ext-settings-toggle"
        aria-expanded={open() ? "true" : "false"}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <span class="ext-settings-label">{t("extension.browser.title")}</span>
        <span class="ext-settings-value">{t("extension.browser.sitesAllowed", { count: sites().length })}</span>
        <ChevronDown size={16} aria-hidden="true" class="ext-settings-chevron" />
      </button>
      <div id={panelId} class="ext-settings-panel" inert={!open()}>
        <div class="ext-settings-panel-inner">
          <p class="ext-settings-note">{t("extension.browser.alwaysAsk")}</p>
          <For each={sites()} fallback={<p class="ext-settings-note">{t("extension.browser.noSites")}</p>}>
            {(site) => (
              <div class="ext-settings-site">
                <Globe2 size={16} aria-hidden="true" />
                <span class="ext-settings-site-name" dir="ltr">
                  {siteName(site)}
                </span>
                <button
                  type="button"
                  class="ext-settings-remove"
                  aria-label={t("extension.browser.revokeSite", { site: siteName(site) })}
                  onClick={() => void removeAllowedSite(site)}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}
