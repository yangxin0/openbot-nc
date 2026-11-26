import type { RelayTeamMember } from "@openbot/contracts/relay-protocol/messages";
import {
  CLIENT_BROWSER_CAPABILITY,
  type ClientBrowserPresence,
} from "@openbot/contracts/team-protocol/client-browser-v1";
import type { AppTextKey } from "@openbot/i18n";
import {
  type RelayBrowserControl,
  type RelayBrowserIdentity,
  type RelayControlSnapshot,
  type RelayHubProvider,
  RelaySocketError,
  relayTeamHost,
  startRelayControl,
} from "@openbot/team-client/relay-client";
import type { RemoteTeamHost } from "@openbot/team-client/remote-directory";
import { useText } from "@openbot/ui/text";
import { createSignal, createStore, Match, onSettled, Show, Switch } from "solid-js";
import { AgentSettingsScreen } from "./AgentSettingsScreen";
import { BrowserAsks } from "./BrowserSharing";
import { ChannelScreen } from "./ChannelScreen";
import { ChatScreen } from "./ChatScreen";
import { type ClientBrowserLink, createClientBrowserLink } from "./client-browser-link";
import {
  type IdentitySource,
  identityErrorKey,
  importIdentity,
  joinIdentity,
  loadIdentity,
  openIdentityStore,
  relayFinalCode,
  relayStateKey,
  removeIdentity,
} from "./extension-identity";
import { PANEL_PORT } from "./extension-messages";
import { clearIdentityData, readSavedHost, saveHost } from "./extension-storage";
import { HomeScreen } from "./HomeScreen";
import { createHostConnection, type HostConnection } from "./host-connection";
import { IdentityScreen } from "./IdentityScreen";
import { NewAgentScreen } from "./NewAgentScreen";
import { NewChannelScreen, NewFolderScreen } from "./NewChatItemScreens";
import { SettingsScreen } from "./SettingsScreen";
import { createWorkspace, type Workspace } from "./workspace";

const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;

export function App() {
  const store = openIdentityStore();
  const [identity, setIdentity] = createSignal<RelayBrowserIdentity | null>(null);
  const [loaded, setLoaded] = createSignal(false);
  const [loadError, setLoadError] = createSignal<AppTextKey | null>(null);

  onSettled(() => {
    void loadIdentity(store).then(
      (saved) => {
        setIdentity(saved);
        setLoaded(true);
      },
      (error: unknown) => {
        setLoadError(identityErrorKey(error));
        setLoaded(true);
      },
    );
  });

  async function imported(source: IdentitySource): Promise<void> {
    const next = await importIdentity(store, source);
    await clearIdentityData();
    setLoadError(null);
    setIdentity(next);
  }

  async function joined(code: string): Promise<void> {
    const next = await joinIdentity(store, code);
    await clearIdentityData();
    setLoadError(null);
    setIdentity(next);
  }

  async function removed(): Promise<void> {
    await removeIdentity(store);
    await clearIdentityData();
    setIdentity(null);
  }

  return (
    <main class="ext-app">
      <Show when={loaded()}>
        <Show
          when={identity()}
          keyed
          fallback={
            <div class="ext-login">
              <IdentityScreen error={loadError()} onImport={imported} onJoin={joined} />
            </div>
          }
        >
          {(current) => <ServerView identity={current} onRemoveIdentity={removed} />}
        </Show>
      </Show>
    </main>
  );
}

type PushedScreen =
  | { kind: "chat" | "channel" | "new-agent" | "new-channel" | "new-folder" | "settings" }
  | { kind: "agent-settings"; agentId: string };

interface ServerState {
  hosts: RemoteTeamHost[];
  hostId: string | null;
  status: "waiting" | "connecting" | "ready" | "failed" | "empty";
  message: string | null;
  offline: boolean;
}

const INITIAL_RELAY: RelayControlSnapshot = { state: { status: "connecting" }, roster: [], self: null, team: null };

function rosterHosts(members: readonly RelayTeamMember[], selfKeyId: string): RemoteTeamHost[] {
  return members
    .filter((member) => member.hosting && member.keyId !== selfKeyId)
    .map((member) => relayTeamHost(member, "member"));
}

function ServerView(props: { identity: RelayBrowserIdentity; onRemoveIdentity: () => Promise<void> }) {
  const { t } = useText();
  const [view, setView] = createStore<ServerState>({
    hosts: [],
    hostId: null,
    status: "waiting",
    message: null,
    offline: false,
  });
  const [relay, setRelay] = createSignal<RelayControlSnapshot>(INITIAL_RELAY);
  const [workspace, setWorkspace] = createSignal<Workspace | null>(null);
  const [pushed, setPushed] = createSignal(false);
  const [screen, setScreen] = createSignal<PushedScreen>({ kind: "chat" });
  let connection: HostConnection | null = null;
  let stopControl: (() => void) | null = null;
  let control: RelayBrowserControl | null = null;
  const sessions: RelayHubProvider = {
    hub: async () => {
      if (control) return control;
      throw new RelaySocketError({ code: "closed", message: "The relay connection is not running." });
    },
  };
  let savedHostId: string | null = null;
  let hosts: RemoteTeamHost[] = [];
  let selectedHostId: string | null = null;
  let attempt = 0;
  let browserLink: ClientBrowserLink | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectAttempt = 0;
  let closed = false;
  const [presence, setPresence] = createSignal<ClientBrowserPresence>({ sharing: false, tabs: [] });
  const [canShare, setCanShare] = createSignal(false);
  const [settingsAlone, setSettingsAlone] = createSignal(false);

  const host = () => view.hosts.find((entry) => entry.hostId === view.hostId) ?? null;
  const selectedHost = () => hosts.find((entry) => entry.hostId === selectedHostId) ?? null;
  const finalCode = () => relayFinalCode(relay());

  function showRoster(snapshot: RelayControlSnapshot): void {
    setRelay(snapshot);
    if (snapshot.state.status !== "online") return;
    const listed = rosterHosts(snapshot.roster, snapshot.self?.keyId ?? props.identity.keyId);
    const selected = selectedHost();
    const kept = selected && !listed.some((entry) => entry.hostId === selected.hostId) ? [selected] : [];
    hosts = [...listed, ...kept];
    setView((draft) => {
      draft.hosts = [...hosts];
    });
    if (selectedHostId === null) {
      if (!listed.length) {
        setView((draft) => {
          draft.status = "empty";
        });
        return;
      }
      const first = listed.find((entry) => entry.hostId === savedHostId) ?? listed[0];
      if (first) void open(first.hostId);
      return;
    }
    const back = listed.find((entry) => entry.hostId === selectedHostId);
    if (!back) return;
    if (selected && back.devicePublicKey !== selected.devicePublicKey) void open(back.hostId);
    else if (view.offline && view.status === "ready") reconnectNow();
  }

  function startControl(): void {
    stopControl?.();
    const next = startRelayControl(props.identity);
    control = next;
    const unsubscribe = next.subscribe(showRoster);
    stopControl = () => {
      unsubscribe();
      next.stop();
      if (control === next) control = null;
    };
  }

  function cancelReconnect(): void {
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  }

  function scheduleReconnect(): void {
    if (closed || reconnectTimer !== undefined || view.status !== "ready") return;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** reconnectAttempt);
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      void reconnect();
    }, delay);
  }

  function reconnectNow(): void {
    cancelReconnect();
    void reconnect();
  }

  async function reconnect(): Promise<void> {
    const target = selectedHost();
    if (!target || !connection || view.status !== "ready") return;
    const current = attempt;
    try {
      await connection.connect(target);
      if (current === attempt) reconnectAttempt = 0;
    } catch {
      if (current === attempt) scheduleReconnect();
    }
  }

  async function open(hostId: string) {
    const current = ++attempt;
    const target = hosts.find((entry) => entry.hostId === hostId);
    if (!target || !connection) return;
    selectedHostId = hostId;
    cancelReconnect();
    reconnectAttempt = 0;
    workspace()?.dispose();
    setWorkspace(null);
    browserLink?.dispose();
    browserLink = null;
    setPushed(false);
    setView((draft) => {
      draft.hostId = hostId;
      draft.status = "connecting";
      draft.message = null;
      draft.offline = false;
    });
    savedHostId = hostId;
    void saveHost({
      identityKeyId: props.identity.keyId,
      hostId,
      name: target.name,
      devicePublicKey: target.devicePublicKey,
    });
    try {
      const granted = await connection.connect(target);
      if (current !== attempt) return;
      setCanShare(granted.includes(CLIENT_BROWSER_CAPABILITY));
      browserLink = createClientBrowserLink({
        request: connection.request,
        capabilities: granted,
        onPresence: setPresence,
      });
      const next = createWorkspace(connection.request, granted, connection.download, connection.transcribe);
      setWorkspace(() => next);
      setView((draft) => {
        draft.status = "ready";
      });
      await next.load();
    } catch (error) {
      if (current !== attempt) return;
      setView((draft) => {
        draft.status = "failed";
        draft.message =
          error instanceof Error ? error.message : t("extension.connection.offline", { server: target.name });
      });
    }
  }

  async function start() {
    const saved = await readSavedHost().catch(() => null);
    savedHostId = saved?.identityKeyId === props.identity.keyId ? saved.hostId : null;
    if (closed) return;
    connection = await createHostConnection(props.identity, sessions, {
      event: (event) => {
        browserLink?.handleEvent(event);
        workspace()?.handleEvent(event);
      },
      state: (update) => {
        if (update.hostId !== selectedHostId) return;
        setView((draft) => {
          draft.offline = update.state === "offline";
        });
        if (update.state === "offline") scheduleReconnect();
        if (update.state !== "online") return;
        reconnectAttempt = 0;
        void workspace()?.reloadChat();
        browserLink?.refresh();
      },
    });
    if (closed) {
      void connection.dispose();
      return;
    }
    startControl();
  }

  function retry(): void {
    if (finalCode()) {
      startControl();
      return;
    }
    if (selectedHostId) void open(selectedHostId);
  }

  onSettled(() => {
    void start().catch((error: unknown) => {
      setView((draft) => {
        draft.status = "failed";
        draft.message = error instanceof Error ? error.message : t("extension.connection.requestFailed");
      });
    });
    let port: chrome.runtime.Port | null = null;
    const holdPort = () => {
      if (closed) return;
      port = chrome.runtime.connect({ name: PANEL_PORT });
      port.onDisconnect.addListener(() => window.setTimeout(holdPort, 1_000));
    };
    holdPort();
    const leave = () => {
      stopControl?.();
      void connection?.dispose();
    };
    window.addEventListener("pagehide", leave);
    return () => {
      closed = true;
      cancelReconnect();
      port?.disconnect();
      window.removeEventListener("pagehide", leave);
      browserLink?.dispose();
      workspace()?.dispose();
      stopControl?.();
      void connection?.dispose();
    };
  });

  function push(kind: Exclude<PushedScreen["kind"], "agent-settings">) {
    setScreen({ kind });
    setPushed(true);
  }
  function openAgent(agentId: string, taskId: string | null = null) {
    workspace()?.openChat(agentId, taskId);
    if (screen().kind !== "chat" || !pushed()) push("chat");
  }
  function openChannel(channelId: string) {
    workspace()?.openChannel(channelId);
    push("channel");
  }
  function startThread(agentId: string, text: string) {
    const current = workspace();
    if (!current) return;
    if (current.threadsAvailable()) current.newThread(agentId);
    else current.openChat(agentId, null);
    push("chat");
    void current.send(text).catch(() => undefined);
  }
  function back() {
    setPushed(false);
  }

  const settings = (onBack: () => void) => (
    <SettingsScreen
      canShare={canShare()}
      identity={props.identity}
      connection={relay().state}
      onBack={onBack}
      onRemoveIdentity={props.onRemoveIdentity}
    />
  );
  const stateActions = () => (
    <>
      <button type="button" class="ext-text-button" onClick={retry}>
        {t("common.retry")}
      </button>
      <button type="button" class="ext-text-button" onClick={() => setSettingsAlone(true)}>
        {t("extension.home.settings")}
      </button>
    </>
  );
  const waitingText = () => {
    const current = host();
    if (current) return t("extension.connection.connecting", { server: current.name });
    const state = relay().state;
    return state.status === "offline" && state.code !== "stopped"
      ? t(relayStateKey(state.code))
      : t("webClient.relay.connecting");
  };

  return (
    <>
      <Switch>
        <Match when={settingsAlone()}>{settings(() => setSettingsAlone(false))}</Match>
        <Match when={finalCode()}>
          {(code) => (
            <div class="ext-state">
              <p role="alert">{t(relayStateKey(code()))}</p>
              {stateActions()}
            </div>
          )}
        </Match>
        <Match when={view.status === "failed"}>
          <div class="ext-state">
            <p role="alert">{view.message}</p>
            {stateActions()}
          </div>
        </Match>
        <Match when={workspace()}>
          {(current) => (
            <div class="ext-stack" data-pushed={pushed() ? "" : undefined}>
              <section class="ext-layer ext-home" inert={pushed()}>
                <HomeScreen
                  workspace={current()}
                  serverName={host()?.name ?? ""}
                  hosts={view.hosts}
                  hostId={view.hostId}
                  offline={view.offline}
                  onOpenAgent={(agentId) => openAgent(agentId)}
                  onOpenChannel={openChannel}
                  onCreate={(kind) =>
                    push(kind === "agent" ? "new-agent" : kind === "channel" ? "new-channel" : "new-folder")
                  }
                  onStartThread={startThread}
                  onSelectHost={(hostId) => void open(hostId)}
                  onOpenSettings={() => push("settings")}
                  sharing={presence().sharing}
                  canShare={canShare()}
                />
              </section>
              <section class="ext-layer ext-chat-layer" inert={!pushed()}>
                <Show when={screen()} keyed>
                  {(shown) => (
                    <Switch>
                      <Match when={shown.kind === "new-agent"}>
                        <NewAgentScreen
                          workspace={current()}
                          onClose={back}
                          onCreated={(agentId) => openAgent(agentId)}
                        />
                      </Match>
                      <Match when={shown.kind === "new-channel"}>
                        <NewChannelScreen workspace={current()} onClose={back} onCreated={openChannel} />
                      </Match>
                      <Match when={shown.kind === "settings"}>{settings(back)}</Match>
                      <Match when={shown.kind === "new-folder"}>
                        <NewFolderScreen workspace={current()} onClose={back} onCreated={back} />
                      </Match>
                      <Match when={shown.kind === "agent-settings" ? shown.agentId : undefined}>
                        {(agentId) => (
                          <AgentSettingsScreen
                            workspace={current()}
                            settings={current().settings}
                            agentId={agentId()}
                            onClose={() => push("chat")}
                          />
                        )}
                      </Match>
                      <Match when={shown.kind === "channel"}>
                        <ChannelScreen
                          workspace={current()}
                          onBack={back}
                          onOpenAgent={(agentId) => openAgent(agentId)}
                        />
                      </Match>
                      <Match when={current().state.chat}>
                        <ChatScreen
                          workspace={current()}
                          onBack={back}
                          onOpenSettings={(agentId) => setScreen({ kind: "agent-settings", agentId })}
                          onOpen={(agentId, taskId) => openAgent(agentId, taskId)}
                        />
                      </Match>
                    </Switch>
                  )}
                </Show>
              </section>
            </div>
          )}
        </Match>
        <Match when={view.status === "empty"}>
          <div class="ext-state">
            <p>
              <strong>{t("webClient.relay.noServers")}</strong>
            </p>
            <p>{t("webClient.relay.noServersDescription")}</p>
            <button type="button" class="ext-text-button" onClick={() => setSettingsAlone(true)}>
              {t("extension.home.settings")}
            </button>
          </div>
        </Match>
        <Match when={true}>
          <p class="ext-state" aria-live="polite">
            {waitingText()}
          </p>
        </Match>
      </Switch>
      <BrowserAsks />
    </>
  );
}
