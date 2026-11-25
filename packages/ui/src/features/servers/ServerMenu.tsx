import type { ServerSummary } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  AppWindow,
  BellOff,
  buttonVariants,
  Check,
  ChevronRight,
  ChevronsUpDown,
  ContextMenu,
  DropdownMenu,
  MotionTooltip,
  PanelLeft,
  Plus,
  Server,
} from "@openbot/ui";
import { SwapLabel } from "@openbot/ui/components/SwapLabel";
import { createEffect, createSignal, For, Show, untrack } from "solid-js";
import { useText } from "../../text";
import { type ServerActionCallbacks, ServerActionItems } from "./ServerActionItems";
import {
  addServerLabel,
  type HiddenServer,
  HiddenServerFolderItem,
  ServerMark,
  serverRelayHostLabel,
  serverStatusLabels,
} from "./ServerRail";

export type ServerView = "rail" | "menu";

const SERVER_VIEWS: readonly ServerView[] = ["rail", "menu"];

const SERVER_VIEW_LABELS = {
  rail: "server.menu.layoutRail",
  menu: "server.menu.layoutMenu",
} as const satisfies Record<ServerView, AppTextKey>;

const SERVER_VIEW_ICONS = { rail: PanelLeft, menu: ChevronsUpDown } as const satisfies Record<
  ServerView,
  typeof PanelLeft
>;

export interface ServerMenuProps extends ServerActionCallbacks {
  servers: ServerSummary[];
  serverName: string;
  view: ServerView;
  onViewChange: (view: ServerView) => void;
  onSelect: (serverId: string) => void;
  onAdd?: () => void;
  addLabel?: AppTextKey | undefined;
  onCreateLocal?: (() => void) | undefined;
  onInstallServer?: (() => void) | undefined;
  hiddenServers?: HiddenServer[] | undefined;
  compact?: boolean;
  rail?: boolean;
}

function isContextMenuKey(event: KeyboardEvent): boolean {
  return event.key === "ContextMenu" || (event.shiftKey && event.key === "F10");
}

function CheckCircle(props: { checked: boolean }) {
  return (
    <span class="ui-menu-check" data-checked={props.checked ? "" : undefined} aria-hidden="true">
      <Show when={props.checked}>
        <Check />
      </Show>
    </span>
  );
}

let lastShown: { id: string | undefined; name: string } | undefined;

export function ServerMenu(props: ServerMenuProps) {
  const { t } = useText();
  const [menuOpen, setMenuOpen] = createSignal(false);
  const rail = untrack(() => props.rail === true);
  let anchor: HTMLElement | undefined;
  let trigger: HTMLElement | undefined;
  const activeServer = () => props.servers.find((server) => server.active);
  const activeServers = () => props.servers.filter((server) => server.active);
  function changeMenuOpen(open: boolean): void {
    setMenuOpen(open);
  }
  const shownBefore = lastShown;
  let markId = shownBefore?.id;
  createEffect(
    () => ({ id: activeServer()?.id, name: props.serverName }),
    (shown) => {
      lastShown = shown;
    },
  );

  function openActions(clientX: number, clientY: number): void {
    anchor?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX, clientY }));
  }

  function selectServer(server: ServerSummary): void {
    setMenuOpen(false);
    if (!server.active) props.onSelect(server.id);
  }

  function selectOnKey(row: HTMLElement, server: () => ServerSummary): void {
    row.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      selectServer(server());
    });
  }

  const triggerButton = () => (
    <DropdownMenu.Trigger
      ref={(element) => (trigger = element)}
      class={
        rail
          ? "window-rail-button window-rail-server"
          : buttonVariants({ variant: "ghost", size: "sm", class: "sidebar-server-name no-drag" })
      }
      aria-label={t("server.menu.open", { name: props.serverName })}
      aria-hidden={props.compact ? "true" : undefined}
      aria-keyshortcuts="Shift+F10"
      tabindex={props.compact ? -1 : 0}
      title={rail ? undefined : props.serverName}
      onContextMenu={(event) => {
        event.preventDefault();
        openActions(event.clientX, event.clientY);
      }}
      onKeyDown={(event) => {
        if (!isContextMenuKey(event)) return;
        event.preventDefault();
        const bounds = event.currentTarget.getBoundingClientRect();
        if (rail) openActions(bounds.right, bounds.top);
        else openActions(bounds.left, bounds.bottom);
      }}
    >
      <For each={activeServers()} keyed={(server) => server.id}>
        {(server) => {
          const id = untrack(() => server().id);
          const entering = markId !== undefined && markId !== id;
          markId = id;
          return (
            <span
              class="server-menu-mark sidebar-server-name-mark"
              data-entering={entering ? "" : undefined}
              aria-hidden="true"
            >
              <ServerMark server={server()} />
            </span>
          );
        }}
      </For>
      <Show when={!rail}>
        <SwapLabel class="sidebar-server-name-label" text={props.serverName} from={shownBefore?.name} dir="auto" />
        <ChevronsUpDown class="sidebar-server-name-chevron" aria-hidden="true" />
      </Show>
    </DropdownMenu.Trigger>
  );

  return (
    <>
      <DropdownMenu.Root
        open={menuOpen()}
        onOpenChange={changeMenuOpen}
        placement={rail ? "right-end" : "bottom-start"}
        gutter={rail ? 10 : 6}
      >
        <Show when={rail} fallback={triggerButton()}>
          <MotionTooltip content={props.serverName} suppressed={menuOpen()}>
            {triggerButton()}
          </MotionTooltip>
        </Show>
        <DropdownMenu.Portal>
          <DropdownMenu.Content class="agent-context-menu server-menu" aria-label={t("server.menu.label")}>
            <Show
              when={props.view === "menu"}
              fallback={
                <Show when={props.onOpenSettings ? activeServer() : undefined}>
                  {(server) => (
                    <ServerActionItems
                      menu={DropdownMenu}
                      server={server()}
                      trigger={() => trigger ?? null}
                      onOpenSettings={props.onOpenSettings}
                      onLeave={props.onLeave}
                      onDelete={props.onDelete}
                      canDelete={props.canDelete}
                      onRestart={props.onRestart}
                      canRestart={props.canRestart}
                      onRemove={props.onRemove}
                      canRemove={props.canRemove}
                      onHide={props.onHide}
                      canHide={props.canHide}
                    />
                  )}
                </Show>
              }
            >
              <div class="ui-menu-label" aria-hidden="true">
                {t("server.rail.label")}
              </div>
              <For each={props.servers} keyed={(server) => server.id}>
                {(server) => (
                  <DropdownMenu.Sub>
                    <DropdownMenu.SubTrigger
                      class="server-menu-row"
                      aria-label={[
                        server().name,
                        ...(serverRelayHostLabel(server())
                          ? [t("server.rail.relayHost", { host: serverRelayHostLabel(server()) ?? "" })]
                          : []),
                        ...serverStatusLabels(server(), t),
                      ].join(", ")}
                      aria-current={server().active ? "true" : undefined}
                      data-cuelume-navigate=""
                      onClick={() => selectServer(server())}
                      ref={(row) => selectOnKey(row, server)}
                    >
                      <CheckCircle checked={server().active} />
                      <span class="server-menu-mark" aria-hidden="true">
                        <ServerMark server={server()} />
                      </span>
                      <span class="server-menu-name">{server().name}</span>
                      <Show when={serverRelayHostLabel(server())}>
                        {(host) => <span class="server-menu-host">{host()}</span>}
                      </Show>
                      <Show when={server().notificationsMuted}>
                        <BellOff class="server-menu-muted size-3" aria-hidden="true" />
                      </Show>
                      <ChevronRight class="agent-context-submenu-chevron size-4" aria-hidden="true" />
                    </DropdownMenu.SubTrigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.SubContent
                        class="ui-action-menu agent-context-menu server-submenu"
                        aria-label={t("server.rail.actions")}
                      >
                        <ServerActionItems
                          menu={DropdownMenu}
                          server={server()}
                          trigger={() => trigger ?? null}
                          onSetMuted={props.onSetMuted}
                          onOpenNotificationSettings={props.onOpenNotificationSettings}
                          onOpenSettings={props.onOpenSettings}
                          onLeave={props.onLeave}
                          onDelete={props.onDelete}
                          canDelete={props.canDelete}
                          onRestart={props.onRestart}
                          canRestart={props.canRestart}
                          onRemove={props.onRemove}
                          canRemove={props.canRemove}
                          onHide={props.onHide}
                          canHide={props.canHide}
                        />
                      </DropdownMenu.SubContent>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Sub>
                )}
              </For>
              <HiddenServerFolderItem servers={props.hiddenServers ?? []} />
              <Show when={props.onAdd}>
                <DropdownMenu.Item class="server-menu-add" onSelect={() => props.onAdd?.()}>
                  <span class="server-menu-add-circle" aria-hidden="true">
                    <Plus />
                  </span>
                  <span>{t(props.addLabel ?? addServerLabel())}</span>
                </DropdownMenu.Item>
              </Show>
              <Show when={props.onCreateLocal}>
                {(onCreateLocal) => (
                  <DropdownMenu.Item class="server-menu-add" onSelect={() => onCreateLocal()()}>
                    <span class="server-menu-add-circle" aria-hidden="true">
                      <Plus />
                    </span>
                    <span>{t("server.local.createTitle")}</span>
                  </DropdownMenu.Item>
                )}
              </Show>
              <Show when={props.onInstallServer}>
                {(onInstallServer) => (
                  <DropdownMenu.Item class="server-menu-add" onSelect={() => onInstallServer()()}>
                    <span class="server-menu-add-circle" aria-hidden="true">
                      <Server />
                    </span>
                    <span>{t("server.install.title")}</span>
                  </DropdownMenu.Item>
                )}
              </Show>
              <Show when={activeServer()}>
                {(server) => (
                  <>
                    <DropdownMenu.Separator />
                    <ServerActionItems
                      menu={DropdownMenu}
                      server={server()}
                      trigger={() => trigger ?? null}
                      onOpenSettings={props.onOpenSettings}
                      onLeave={props.onLeave}
                      onDelete={props.onDelete}
                      canDelete={props.canDelete}
                      onRestart={props.onRestart}
                      canRestart={props.canRestart}
                      onRemove={props.onRemove}
                      canRemove={props.canRemove}
                      onHide={props.onHide}
                      canHide={props.canHide}
                    />
                  </>
                )}
              </Show>
            </Show>
            <DropdownMenu.Separator />
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger>
                <AppWindow class="agent-context-icon size-4" aria-hidden="true" />
                <span>{t("server.menu.layout")}</span>
                <span class="ui-menu-trailing">{t(SERVER_VIEW_LABELS[props.view])}</span>
                <ChevronRight
                  class="agent-context-submenu-chevron server-menu-layout-chevron size-4"
                  aria-hidden="true"
                />
              </DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent class="ui-action-menu agent-context-menu">
                  <DropdownMenu.RadioGroup
                    aria-label={t("server.menu.layout")}
                    value={props.view}
                    onChange={(value) => {
                      const view = SERVER_VIEWS.find((candidate) => candidate === value);
                      if (view) props.onViewChange(view);
                    }}
                  >
                    <For each={SERVER_VIEWS}>
                      {(view) => {
                        const Icon = SERVER_VIEW_ICONS[view];
                        return (
                          <DropdownMenu.RadioItem value={view}>
                            <CheckCircle checked={props.view === view} />
                            <Icon class="agent-context-icon size-4" aria-hidden="true" />
                            <span>{t(SERVER_VIEW_LABELS[view])}</span>
                          </DropdownMenu.RadioItem>
                        );
                      }}
                    </For>
                  </DropdownMenu.RadioGroup>
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <ContextMenu.Root modal={false}>
        <ContextMenu.Trigger
          hidden
          ref={(element) => (anchor = element)}
          onContextMenu={(event) => {
            if (!activeServer()) event.preventDefault();
          }}
        />
        <ContextMenu.Portal>
          <ContextMenu.Content class="agent-context-menu" aria-label={t("server.rail.actions")}>
            <Show when={activeServer()}>
              {(server) => (
                <ServerActionItems
                  menu={ContextMenu}
                  server={server()}
                  trigger={() => trigger ?? null}
                  onSetMuted={props.onSetMuted}
                  onOpenNotificationSettings={props.onOpenNotificationSettings}
                  onOpenSettings={props.onOpenSettings}
                  onLeave={props.onLeave}
                  onDelete={props.onDelete}
                  canDelete={props.canDelete}
                  onRestart={props.onRestart}
                  canRestart={props.canRestart}
                  onRemove={props.onRemove}
                  canRemove={props.canRemove}
                  onHide={props.onHide}
                  canHide={props.canHide}
                />
              )}
            </Show>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
    </>
  );
}
