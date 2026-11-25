import type { MarketplaceSkillSummary } from "@openbot/contracts/ipc";
import { ArrowRight, Button, Check, ErrorReference, IconButton, Plug, Puzzle, Sparkles, Text } from "@openbot/ui";
import { ReferenceChip } from "@openbot/ui/reference-chip";
import { SkillGradient } from "@openbot/ui/skill-gradient";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { createSignal, For, Match, Show, Switch } from "solid-js";
import { CONNECTOR_LISTINGS } from "../connectors/connector-catalog";
import { LogoTile } from "../settings/IntegrationLayout";
import type { MarketplaceApp } from "./marketplace-model";

export function DetailState(props: {
  status: "loading" | "loaded" | "failed";
  reference?: string | null | undefined;
  loadingLabel: string;
  onRetry: () => void;
  children: JSX.Element;
}) {
  const { t } = useText();
  return (
    <Switch>
      <Match when={props.status === "loading"}>
        <Text as="p" variant="body-sm" tone="muted" role="status">
          {props.loadingLabel}
        </Text>
      </Match>
      <Match when={props.status === "failed"}>
        <div class="marketplace-empty" role="alert">
          <Text as="p" variant="body-sm" tone="muted">
            {t("marketplace.loadFailed")}
          </Text>
          <ErrorReference reference={props.reference} />
          <Button type="button" variant="outline" size="sm" onClick={props.onRetry}>
            {t("common.retry")}
          </Button>
        </div>
      </Match>
      <Match when={props.status === "loaded"}>{props.children}</Match>
    </Switch>
  );
}

export function MissingNotice(props: { children: string }) {
  return (
    <div class="marketplace-empty" role="alert">
      <Text as="p" variant="body-sm" tone="muted">
        {props.children}
      </Text>
    </div>
  );
}

export function Done(props: { children: JSX.Element }) {
  return (
    <span class="marketplace-done">
      <Check aria-hidden="true" />
      {props.children}
    </span>
  );
}

export function SkillMark(props: { skill: Pick<MarketplaceSkillSummary, "iconUrl">; size: "sm" | "row" | "md" }) {
  const [failed, setFailed] = createSignal<string | null>(null);
  const url = () => (props.skill.iconUrl && props.skill.iconUrl !== failed() ? props.skill.iconUrl : null);
  return (
    <span class="marketplace-skill-mark" data-size={props.size} data-kind={url() ? "icon" : "none"} aria-hidden="true">
      <SkillIcon url={url()} onError={setFailed} />
    </span>
  );
}

export function SkillIcon(props: { url: string | null | undefined; onError?: (url: string) => void }) {
  const [failed, setFailed] = createSignal<string | null>(null);
  const url = () => (props.url && props.url !== failed() ? props.url : null);
  return (
    <Show when={url()} fallback={<Sparkles />} keyed>
      {(src) => (
        <img
          src={src}
          alt=""
          onError={() => {
            setFailed(src);
            props.onError?.(src);
          }}
        />
      )}
    </Show>
  );
}

export function AppMark(props: { app: MarketplaceApp }) {
  const [failed, setFailed] = createSignal<string | null>(null);
  const url = () => {
    const app = props.app;
    const icon = app.kind === "plugin" ? app.plugin.iconUrl : null;
    return icon && icon !== failed() ? icon : null;
  };
  return (
    <Switch fallback={<Puzzle aria-hidden="true" />}>
      <Match when={props.app.kind === "connector" ? CONNECTOR_LISTINGS[props.app.connector] : undefined} keyed>
        {(listing) => <listing.Mark />}
      </Match>
      <Match when={url()} keyed>
        {(src) => <img src={src} alt="" onError={() => setFailed(src)} />}
      </Match>
      <Match when={props.app.kind === "custom"}>
        <Plug aria-hidden="true" />
      </Match>
    </Switch>
  );
}

export function AppLogo(props: { app: MarketplaceApp; size?: "md" | "lg" }) {
  return (
    <LogoTile size={props.size ?? "md"}>
      <AppMark app={props.app} />
    </LogoTile>
  );
}

export function TryCard(props: {
  seed: string;
  chip: { kind: "agent" | "skill" | "plugin"; name: string; icon: JSX.Element };
  requests: readonly { id: string; text: string }[];
  tryLabel: (request: string) => string;
  onTry?: ((id: string) => void) | undefined;
  caption?: string | undefined;
}) {
  return (
    <div class="marketplace-try">
      <div class="skill-preview-card marketplace-try-card">
        <SkillGradient name={props.seed} />
        <For each={props.requests}>
          {(request) => (
            <div class="skill-preview-request">
              <p>
                <ReferenceChip
                  kind={props.chip.kind}
                  name={props.chip.name}
                  icon={props.chip.icon}
                  class="skill-preview-chip"
                />{" "}
                {request.text}
              </p>
              <IconButton
                label={props.tryLabel(request.text)}
                size="icon-lg"
                variant="ghost"
                disabled={!props.onTry}
                onClick={() => props.onTry?.(request.id)}
              >
                <ArrowRight />
              </IconButton>
            </div>
          )}
        </For>
      </div>
      <Show when={props.caption}>
        {(caption) => (
          <Text as="p" variant="body-sm" tone="muted">
            {caption()}
          </Text>
        )}
      </Show>
    </div>
  );
}
