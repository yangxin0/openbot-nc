import type {
  RelayConnectionState,
  RelayHostingState,
  RelayIdentitySummary,
  RelayMemberSummary,
  RelayState,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  Alert,
  AlertActions,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Badge,
  Button,
  CircleAlert,
  ConfirmDialog,
  Eye,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  KeyRound,
  RotateCcw,
  SettingsSection,
  Spinner,
  SwitchField,
  Text,
  TriangleAlert,
  Upload,
} from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createEffect, createSignal, For, Show } from "solid-js";
import { useText } from "../../text";
import { type IntegrationStatus, StatusPill } from "./IntegrationLayout";

export type TeamAction = "import" | "replace" | "remove" | "hosting" | "unhide";

export interface TeamActionError {
  action: TeamAction;
  message: string;
}

export interface SettingsTeamTabProps {
  state: RelayState | null;
  receivedAt: number;
  loadError: string | null;
  busy: TeamAction | null;
  unhidingServerId: string | null;
  error: TeamActionError | null;
  browser?: boolean;
  onImport?: () => void;
  onReplace?: () => void;
  onRemove: () => Promise<unknown>;
  onSetHosting?: (enabled: boolean) => void;
  onUnhide: (serverId: string) => void;
  onRetryLoad: () => void;
}

const COMPUTER_COPY = {
  identityDescription: "settings.team.identity.description",
  membersEmpty: "settings.team.members.empty",
  memberSelf: "settings.team.member.self",
  removeDescription: "settings.team.remove.description",
  removeConfirmDescription: "settings.team.remove.confirmDescription",
} as const satisfies Record<string, AppTextKey>;

const BROWSER_COPY = {
  identityDescription: "webClient.team.identityDescription",
  membersEmpty: "webClient.team.membersEmpty",
  memberSelf: "webClient.team.memberSelf",
  removeDescription: "webClient.team.removeDescription",
  removeConfirmDescription: "webClient.team.removeConfirmDescription",
} as const satisfies Record<keyof typeof COMPUTER_COPY, AppTextKey>;

const DAY_MS = 86_400_000;
const EXPIRY_WARNING_DAYS = 30;

const CONNECTION_STATUS = {
  connecting: { status: "connecting", label: "settings.team.connection.connecting" },
  online: { status: "connected", label: "settings.team.connection.online" },
  offline: { status: "attention", label: "settings.team.connection.offline" },
} as const satisfies Record<RelayConnectionState["status"], { status: IntegrationStatus; label: AppTextKey }>;

const HOSTING_STATUS = {
  no_identity: { status: "unavailable", label: "settings.team.hosting.status.noIdentity" },
  starting: { status: "connecting", label: "settings.team.hosting.status.starting" },
  online: { status: "connected", label: "settings.team.hosting.status.online" },
  offline: { status: "attention", label: "settings.team.hosting.status.offline" },
  error: { status: "attention", label: "settings.team.hosting.status.error" },
} as const satisfies Record<
  Exclude<RelayHostingState["status"], "off">,
  { status: IntegrationStatus; label: AppTextKey }
>;

const HOSTING_DETAIL = {
  no_identity: "settings.team.hosting.noIdentity",
  starting: "settings.team.hosting.starting",
  online: "settings.team.hosting.online",
  offline: "settings.team.hosting.offline",
  error: "settings.team.hosting.error",
} as const satisfies Record<Exclude<RelayHostingState["status"], "off">, AppTextKey>;

function memberOrder(left: RelayMemberSummary, right: RelayMemberSummary): number {
  if (left.self !== right.self) return left.self ? -1 : 1;
  if (left.hosting !== right.hosting) return left.hosting ? -1 : 1;
  return left.user.localeCompare(right.user);
}

export function SettingsTeamTab(props: SettingsTeamTabProps) {
  const { t } = useText();
  const [confirm, setConfirm] = createSignal<"replace" | "remove" | null>(null);
  const identity = () => props.state?.identity ?? null;
  const copy = () => (props.browser ? BROWSER_COPY : COMPUTER_COPY);
  const errorFor = (...actions: TeamAction[]) => {
    const error = props.error;
    return error && actions.includes(error.action) ? error.message : null;
  };
  return (
    <>
      <Show when={props.loadError}>
        {(message) => (
          <Alert tone="danger" role="alert" report={{ operation: "team", source: "system", cause_code: "unknown" }}>
            <AlertIcon>
              <TriangleAlert />
            </AlertIcon>
            <AlertContent>
              <AlertDescription>{message()}</AlertDescription>
            </AlertContent>
            <AlertActions>
              <Button type="button" variant="outline" size="sm" onClick={() => props.onRetryLoad()}>
                {t("common.retry")}
              </Button>
            </AlertActions>
          </Alert>
        )}
      </Show>
      <Show when={props.state} fallback={<TeamLoading shown={props.loadError === null} />}>
        {(state) => (
          <>
            <SettingsSection
              title={t("settings.team.identity.title")}
              description={t(copy().identityDescription)}
              data-settings-row="settings.team.identity.title"
            >
              <Show when={state().identityIssue}>{(issue) => <IdentityIssue message={issue()} />}</Show>
              <Show
                when={identity()}
                fallback={<NoIdentity busy={props.busy === "import"} onImport={props.onImport} />}
              >
                {(current) => (
                  <IdentityFacts identity={current()} control={state().control} receivedAt={props.receivedAt} />
                )}
              </Show>
              <ActionError message={errorFor("import", "replace")} />
            </SettingsSection>
            <Show when={identity()}>
              <TeamMembers
                members={state().members}
                online={state().control.status === "online"}
                unhidingServerId={props.unhidingServerId}
                onUnhide={(serverId) => props.onUnhide(serverId)}
                error={errorFor("unhide")}
                emptyKey={copy().membersEmpty}
                selfKey={copy().memberSelf}
              />
            </Show>
            <Show when={props.onSetHosting}>
              {(setHosting) => (
                <SettingsSection title={t("settings.team.hosting.title")}>
                  <ItemGroup class="settings-modal-card">
                    <SwitchField
                      data-settings-row="settings.team.hosting.switch"
                      checked={state().hosting}
                      disabled={props.busy === "hosting"}
                      onChange={(checked) => setHosting()(checked)}
                      label={t("settings.team.hosting.switch")}
                      description={t("settings.team.hosting.description")}
                    />
                    <HostingStatus state={state().hostingState} />
                  </ItemGroup>
                  <ActionError message={errorFor("hosting")} />
                </SettingsSection>
              )}
            </Show>
            <Show when={identity()}>
              <SettingsSection title={t("settings.team.file.title")}>
                <ItemGroup class="settings-modal-card">
                  <Show when={props.onReplace}>
                    <Item data-settings-row="settings.team.replace.title" class="settings-modal-row">
                      <ItemContent>
                        <ItemTitle>{t("settings.team.replace.title")}</ItemTitle>
                        <ItemDescription>{t("settings.team.replace.description")}</ItemDescription>
                      </ItemContent>
                      <ItemActions>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          loading={props.busy === "replace"}
                          disabled={props.busy !== null && props.busy !== "replace"}
                          onClick={() => setConfirm("replace")}
                        >
                          {t("settings.team.replace.action")}
                        </Button>
                      </ItemActions>
                    </Item>
                  </Show>
                  <Item data-settings-row="settings.team.remove.title" class="settings-modal-row">
                    <ItemContent>
                      <ItemTitle>{t("settings.team.remove.title")}</ItemTitle>
                      <ItemDescription>{t(copy().removeDescription)}</ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Button
                        type="button"
                        variant="destructive-ghost"
                        size="sm"
                        disabled={props.busy !== null}
                        onClick={() => setConfirm("remove")}
                      >
                        {t("settings.team.remove.action")}
                      </Button>
                    </ItemActions>
                  </Item>
                </ItemGroup>
                <ActionError message={errorFor("remove")} />
              </SettingsSection>
            </Show>
          </>
        )}
      </Show>
      <ConfirmDialog
        open={confirm() === "replace"}
        tone="default"
        icon={<RotateCcw />}
        title={t("settings.team.replace.confirmTitle")}
        description={t("settings.team.replace.confirmDescription")}
        confirmLabel={t("settings.team.replace.confirm")}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          props.onReplace?.();
        }}
      />
      <ConfirmDialog
        open={confirm() === "remove"}
        title={t("settings.team.remove.confirmTitle")}
        description={t(copy().removeConfirmDescription)}
        confirmLabel={t("settings.team.remove.confirm")}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          await props.onRemove();
          setConfirm(null);
        }}
      />
    </>
  );
}

function TeamLoading(props: { shown: boolean }) {
  const { t } = useText();
  return (
    <Show when={props.shown}>
      <div class="settings-team-loading" role="status">
        <Spinner size="sm" label={t("settings.team.loading")} />
        <Text as="span" variant="caption" tone="muted">
          {t("settings.team.loading")}
        </Text>
      </div>
    </Show>
  );
}

function NoIdentity(props: { busy: boolean; onImport: (() => void) | undefined }) {
  const { t } = useText();
  return (
    <div class="settings-team-empty">
      <span class="settings-team-empty-icon" aria-hidden="true">
        <KeyRound />
      </span>
      <Text variant="body" class="settings-team-empty-title">
        {t("settings.team.empty.title")}
      </Text>
      <Text variant="caption" tone="muted">
        {t("settings.team.empty.description")}
      </Text>
      <Show when={props.onImport}>
        {(importIdentity) => (
          <Button
            type="button"
            size="sm"
            loading={props.busy}
            loadingLabel={t("settings.team.importing")}
            onClick={() => importIdentity()()}
          >
            <Upload aria-hidden="true" />
            {t("settings.team.import")}
          </Button>
        )}
      </Show>
    </div>
  );
}

function IdentityIssue(props: { message: string }) {
  const { sourceText } = useText();
  return (
    <Alert tone="danger" role="alert" report={{ operation: "team", source: "system", cause_code: "unknown" }}>
      <AlertIcon>
        <CircleAlert />
      </AlertIcon>
      <AlertContent>
        <AlertDescription>{sourceText(props.message)}</AlertDescription>
      </AlertContent>
    </Alert>
  );
}

function IdentityFacts(props: { identity: RelayIdentitySummary; control: RelayConnectionState; receivedAt: number }) {
  const { t, format } = useText();
  const daysLeft = () => Math.ceil((props.identity.expiresAt - Date.now()) / DAY_MS);
  const connection = () => CONNECTION_STATUS[props.control.status];
  return (
    <>
      <Show when={daysLeft() < EXPIRY_WARNING_DAYS}>
        <Alert tone="warning" role="status" report={false}>
          <AlertIcon>
            <TriangleAlert />
          </AlertIcon>
          <AlertContent>
            <AlertTitle>
              {daysLeft() > 0
                ? t("settings.team.expiry.soon", { count: daysLeft() })
                : t("settings.team.expiry.expired")}
            </AlertTitle>
            <AlertDescription>{t("settings.team.expiry.action")}</AlertDescription>
          </AlertContent>
        </Alert>
      </Show>
      <dl class="settings-team-facts">
        <Fact label={t("settings.team.fact.team")}>{props.identity.team}</Fact>
        <Fact label={t("settings.team.fact.user")}>{props.identity.user}</Fact>
        <Fact label={t("settings.team.fact.device")}>{props.identity.device ?? t("settings.team.fact.none")}</Fact>
        <Fact label={t("settings.team.fact.server")}>
          <span class="settings-team-address" dir="ltr">
            {props.identity.relayUrl ?? t("settings.team.fact.none")}
          </span>
        </Fact>
        <Fact label={t("settings.team.fact.expires")}>
          <span data-warning={daysLeft() < EXPIRY_WARNING_DAYS ? "" : undefined}>
            {format.date(props.identity.expiresAt, { dateStyle: "medium" })}
          </span>
        </Fact>
        <Fact label={t("settings.team.fact.connection")}>
          <StatusPill status={connection().status} label={t(connection().label)} />
        </Fact>
      </dl>
      <ConnectionProblem control={props.control} receivedAt={props.receivedAt} />
    </>
  );
}

function Fact(props: { label: string; children: JSX.Element }) {
  return (
    <div>
      <dt>{props.label}</dt>
      <dd>{props.children}</dd>
    </div>
  );
}

function ConnectionProblem(props: { control: RelayConnectionState; receivedAt: number }) {
  const { t, sourceText } = useText();
  const [now, setNow] = createSignal(Date.now());
  const offline = () => (props.control.status === "offline" ? props.control : null);
  const retryAt = () => {
    const control = offline();
    if (!control || control.retryInMs === null) return null;
    return props.receivedAt + control.retryInMs;
  };
  createEffect(retryAt, (at) => {
    if (at === null) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  });
  const retrySeconds = () => {
    const at = retryAt();
    return at === null ? null : Math.max(0, Math.ceil((at - now()) / 1_000));
  };
  return (
    <Show when={offline()?.message ? offline() : null}>
      {(control) => (
        <Alert tone={control().retryInMs === null ? "danger" : "warning"} role="status" report={false}>
          <AlertIcon>
            <CircleAlert />
          </AlertIcon>
          <AlertContent>
            <AlertDescription>{sourceText(control().message ?? "")}</AlertDescription>
            <Show when={retrySeconds()}>
              {(seconds) => (
                <AlertDescription>{t("settings.team.connection.retry", { count: seconds() })}</AlertDescription>
              )}
            </Show>
          </AlertContent>
        </Alert>
      )}
    </Show>
  );
}

function TeamMembers(props: {
  members: readonly RelayMemberSummary[];
  online: boolean;
  unhidingServerId: string | null;
  onUnhide: (serverId: string) => void;
  error: string | null;
  emptyKey: AppTextKey;
  selfKey: AppTextKey;
}) {
  const { t } = useText();
  const members = () => [...props.members].sort(memberOrder);
  return (
    <SettingsSection
      title={t("settings.team.members.title")}
      description={t("settings.team.members.description")}
      data-settings-row="settings.team.members.title"
    >
      <Show
        when={props.online && members().length > 0}
        fallback={
          <Text class="settings-team-members-empty" variant="caption" tone="muted">
            {t(props.emptyKey)}
          </Text>
        }
      >
        <ItemGroup class="settings-modal-card">
          <For each={members()} keyed={(member) => member.keyId}>
            {(member) => (
              <Item class="settings-modal-row settings-team-member">
                <ItemContent>
                  <ItemTitle>{member().user}</ItemTitle>
                  <Show when={[member().device, member().label].filter((part) => part !== null).join(" · ")}>
                    {(detail) => <ItemDescription>{detail()}</ItemDescription>}
                  </Show>
                </ItemContent>
                <ItemActions class="settings-team-member-actions">
                  <Show when={member().self}>
                    <Badge variant="outline">{t(props.selfKey)}</Badge>
                  </Show>
                  <Show when={member().hosting}>
                    <Badge variant="info-light">{t("settings.team.member.hosting")}</Badge>
                  </Show>
                  <StatusPill status="connected" label={t("settings.team.member.online")} />
                  <Show when={member().hidden ? member().serverId : null}>
                    {(serverId) => (
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        loading={props.unhidingServerId === serverId()}
                        aria-label={t("settings.team.member.showAgainLabel", { name: member().label ?? member().user })}
                        onClick={() => props.onUnhide(serverId())}
                      >
                        <Eye aria-hidden="true" />
                        {t("settings.team.member.showAgain")}
                      </Button>
                    )}
                  </Show>
                </ItemActions>
              </Item>
            )}
          </For>
        </ItemGroup>
      </Show>
      <ActionError message={props.error} />
    </SettingsSection>
  );
}

function HostingStatus(props: { state: RelayHostingState }) {
  const { t, sourceText } = useText();
  const status = () => (props.state.status === "off" ? null : props.state.status);
  const detail = (current: Exclude<RelayHostingState["status"], "off">) =>
    current === "offline" || current === "error"
      ? props.state.message
        ? sourceText(props.state.message)
        : t(HOSTING_DETAIL[current])
      : t(HOSTING_DETAIL[current]);
  return (
    <Show when={status()}>
      {(current) => (
        <Item class="settings-team-hosting-state" data-status={current()}>
          <ItemContent>
            <ItemDescription>{detail(current())}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <StatusPill status={HOSTING_STATUS[current()].status} label={t(HOSTING_STATUS[current()].label)} />
          </ItemActions>
        </Item>
      )}
    </Show>
  );
}

function ActionError(props: { message: string | null }) {
  return (
    <Show when={props.message}>
      {(message) => (
        <Text class="settings-modal-error" variant="caption" role="alert">
          {message()}
        </Text>
      )}
    </Show>
  );
}
