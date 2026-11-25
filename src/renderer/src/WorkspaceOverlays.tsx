import { type CentralAuthUser, LOCAL_SERVER_LIMIT, type ServerSummary } from "@openbot/contracts/ipc";
import { BROWSER_PROFILES_CAPABILITY } from "@openbot/contracts/team-protocol/browser-profiles-v1";
import { PROVIDER_DETECTION_CAPABILITY } from "@openbot/contracts/team-protocol/provider-detection-v1";
import { VAULT_IMPORT_CAPABILITY } from "@openbot/contracts/team-protocol/vault-import-v1";
import { VAULT_CAPABILITY } from "@openbot/contracts/team-protocol/vault-v1";
import { VAULT_V2_CAPABILITY } from "@openbot/contracts/team-protocol/vault-v2";
import { VAULT_V3_CAPABILITY } from "@openbot/contracts/team-protocol/vault-v3";
import { classifyFailure } from "@openbot/telemetry";
import { isAgentAccount } from "@openbot/ui/components/provider-accounts";
import type { AcpRegistrySettingsApi } from "@openbot/ui/features/custom-providers/AcpRegistrySettings";
import type { CustomAgentSettingsApi } from "@openbot/ui/features/custom-providers/CustomAgentSettings";
import { providerDiagnosticsText } from "@openbot/ui/features/provider-diagnostics/provider-diagnostics";
import { LeaveServerDialog } from "@openbot/ui/features/servers/LeaveServerDialog";
import { RestartServerDialog } from "@openbot/ui/features/servers/RestartServerDialog";
import { sidebarAgentOrder } from "@openbot/ui/features/sidebar/sidebar-agent-order";
import { currentText } from "@openbot/ui/text";
import { createEffect, createMemo, Loading, Show, untrack } from "solid-js";
import { actionToast } from "./action-toast";
import { appPort } from "./app-port";
import { useAuth } from "./features/account/account-context";
import { useAgents } from "./features/agents/agents-context";
import { desktopBrowserProfileCalls } from "./features/browser/browser-profiles-port";
import { createBrowserProfilesStore } from "./features/browser/stores/browser-profiles-store";
import { useConnectors } from "./features/connectors/connectors-context";
import { desktopCrmHost } from "./features/crm/crm-port";
import { useCustomAgents } from "./features/custom-agents/custom-agents-context";
import { useCustomProviders } from "./features/custom-providers/custom-providers-context";
import { desktopProviderDetectionCalls } from "./features/custom-providers/custom-providers-port";
import { useProviderDetection } from "./features/custom-providers/provider-detection-context";
import { createProviderDetectionStore } from "./features/custom-providers/stores/provider-detection-store";
import type { ServerStorageOptions } from "./features/files/ServerStoragePanel";
import { useSetup } from "./features/onboarding/onboarding-context";
import { mcpToolRuntimeNote } from "./features/servers/mcp-servers";
import type { ServerCopyOptions } from "./features/servers/ServerTransferPanel";
import { serverCanAdminister, serverSupportsCapability } from "./features/servers/server-capabilities";
import { useServerSelection } from "./features/servers/server-selection";
import { useServerSettings } from "./features/servers/server-settings";
import { useServerSwitch } from "./features/servers/server-switch";
import { useServers } from "./features/servers/servers-context";
import type { HostProviderSettings } from "./features/settings/ProviderSettingsSection";
import { useSettings } from "./features/settings/settings-context";
import { useSidebar } from "./features/sidebar/sidebar-context";
import { useUpdates } from "./features/updates/updates-context";
import { useWhatsNew } from "./features/updates/whats-new-context";
import { usePlanLimitRows } from "./features/usage/plan-limit-rows";
import { createLinkAccountStore } from "./features/vault/stores/link-account-store";
import { createVaultStore } from "./features/vault/stores/vault-store";
import { desktopVaultCalls, hostVaultCalls } from "./features/vault/vault-port";
import { useWindowPage } from "./features/window/window-page-context";
import { useGlobalSearchSources } from "./global-search-sources";
import { CreateLocalServerDialog, SettingsModal } from "./lazy-views";
import { useNavigation } from "./navigation";
import { usePlatform } from "./platform";
import { useProviders } from "./providers";
import {
  ChannelCreateOverlay,
  GlobalSearchOverlay,
  MarketplaceOverlay,
  ServerSettingsOverlay,
} from "./WorkspaceOverlayViews";

interface AccountProps {
  account: () => CentralAuthUser;
}

export function WorkspaceOverlays(props: AccountProps) {
  const { skillsMarketplaceOpen } = useSettings();
  const connectors = useConnectors();
  createEffect(skillsMarketplaceOpen, (open) => {
    if (!open) return;
    connectors.active.reload();
  });
  return (
    <>
      <CreateLocalServer />
      <LeaveServer />
      <RestartServer />
      <ServerSettings />
      <AppSettings account={props.account} />
      <GlobalMessageSearch />
      <ChannelCreateOverlay />
    </>
  );
}

export function SkillsMarketplace() {
  const {
    skillsMarketplaceOpen,
    setSkillsMarketplaceOpen,
    pendingPluginSlug,
    setPendingPluginSlug,
    pendingPluginConnect,
    setPendingPluginConnect,
    pendingMcpSignIn,
    setPendingMcpSignIn,
    setMcpSignIns,
  } = useSettings();
  const { agentList, activeAgent, agentStatus, agentSetupOpen, creatingAgent } = useAgents();
  const { toolRuntimeStatuses, providerAdminServerId } = useProviders();
  const { selectAgent } = useNavigation();
  const { activeServer } = useServers();
  const connectors = useConnectors();
  const platform = usePlatform();
  const mcpRuntimeNote = () => {
    const server = activeServer();
    if (!server) return null;
    const held =
      server.kind === "local" ? providerAdminServerId() === undefined : server.id === providerAdminServerId();
    return held ? mcpToolRuntimeNote(toolRuntimeStatuses().bun) : null;
  };
  createEffect(skillsMarketplaceOpen, (open) => {
    if (!open) setPendingMcpSignIn(null);
  });

  return (
    <MarketplaceOverlay
      open={skillsMarketplaceOpen()}
      onOpenChange={setSkillsMarketplaceOpen}
      server={activeServer()}
      agents={agentList()}
      activeAgentId={activeAgent()?.id ?? ""}
      composerAvailable={agentStatus().phase === "ready" && !(agentSetupOpen() && creatingAgent())}
      onOpenAgent={selectAgent}
      pluginSlug={pendingPluginSlug()}
      pluginConnect={pendingPluginConnect()}
      onPluginSlugConsumed={() => {
        setPendingPluginSlug(null);
        setPendingPluginConnect(false);
      }}
      connectors={connectors.active}
      macOS={platform.appInfo() ? platform.appInfo()?.platform === "darwin" : undefined}
      mcpToolRuntimeNote={mcpRuntimeNote()}
      mcpSignInRequest={pendingMcpSignIn()}
      onMcpSignInRequestHandled={() => setPendingMcpSignIn(null)}
      onMcpSignIns={(serverId, states) => setMcpSignIns({ serverId, states })}
    />
  );
}

function CreateLocalServer() {
  const { servers, createLocalServerOpen, setCreateLocalServerOpen } = useServers();
  const { createLocalServer } = useServerSelection();
  const limitReached = () => servers().filter((server) => server.thisComputer).length >= LOCAL_SERVER_LIMIT;
  return (
    <Show when={createLocalServerOpen()}>
      <Loading>
        <CreateLocalServerDialog
          limitReached={limitReached()}
          onClose={() => setCreateLocalServerOpen(false)}
          onCreate={createLocalServer}
        />
      </Loading>
    </Show>
  );
}

function LeaveServer() {
  const { leaveConfirmServer, leaveRestoreTarget, cancelLeaveServer, leaveConfirmedServer } = useServerSettings();
  return (
    <LeaveServerDialog
      server={leaveConfirmServer()}
      removeOwned={leaveConfirmServer()?.role === "owner"}
      deleteLocal={leaveConfirmServer()?.thisComputer === true}
      onClose={cancelLeaveServer}
      onLeave={leaveConfirmedServer}
      restoreFocusTarget={leaveRestoreTarget()}
    />
  );
}

function RestartServer() {
  const { servers } = useServers();
  const { restartConfirmServer, restartRestoreTarget, cancelRestartServer, restartConfirmedServer } =
    useServerSettings();
  return (
    <RestartServerDialog
      server={restartConfirmServer()}
      servers={servers()}
      onClose={cancelRestartServer}
      onRestart={restartConfirmedServer}
      restoreFocusTarget={restartRestoreTarget()}
    />
  );
}

function ServerSettings() {
  const windowPage = useWindowPage();
  const usageRows = usePlanLimitRows();
  const platform = usePlatform();
  const { servers, activeServer, hostStatus } = useServers();
  const { selectAgent, selectGlobalSearchMessage } = useNavigation();
  const { selectServer } = useServerSelection();
  const { setPendingAgentSelection } = useServerSwitch();
  const { agentList, agentStatus } = useAgents();
  const { setupState, saveSetup } = useSetup();
  const { setSkillsMarketplaceOpen, setPendingPluginSlug, setPendingPluginConnect } = useSettings();
  const {
    providerAdminServerId,
    providerRuntimeStatuses,
    providerAvailableVersions,
    providerRuntimeDownloadsAvailable,
    downloadProviderRuntime,
    startProviderUpdate,
    cancelProviderRuntimeDownload,
    cancelProviderSignIn,
    openProviderInstallGuide,
    setProviderOn,
    providerUseServerId,
    hostOffProviders,
    refreshHostProviderUse,
    measureProviderDownload,
    removeProviderDownload,
    providerAccounts,
    restartProvider,
    cancelProviderRestart,
    chooseInstalledCli,
    connection,
    providerKeys,
    hostCustomProviders,
    customAgentsServerId,
    hostCustomAgents,
  } = useProviders();
  const localEndpoints = useCustomProviders();
  const localAgents = useCustomAgents();
  const detection = useProviderDetection();
  const hostDetectionServerId = createMemo(() => {
    const serverId = customAgentsServerId();
    const server = activeServer();
    return serverId !== undefined &&
      serverId === providerAdminServerId() &&
      server?.id === serverId &&
      serverCanAdminister(server, PROVIDER_DETECTION_CAPABILITY)
      ? serverId
      : undefined;
  });
  const hostDetection = createMemo(() => {
    const serverId = hostDetectionServerId();
    if (serverId === undefined) return undefined;
    return createProviderDetectionStore({
      api: () => desktopProviderDetectionCalls(serverId),
      endpoints: hostCustomProviders,
      agents: { customAgents: hostCustomAgents.customAgents, saveCustomAgent: hostCustomAgents.saveCustomAgent },
    });
  });
  const customAgents: CustomAgentSettingsApi = {
    get agents() {
      return localAgents.customAgents();
    },
    save: localAgents.saveCustomAgent,
    remove: localAgents.deleteCustomAgent,
    check: localAgents.checkCustomAgent,
    get restartPending() {
      return agentStatus().providers?.some((provider) => provider.id === "acp" && provider.restartPending) === true;
    },
    get lastError() {
      return agentStatus().providers?.find((provider) => provider.id === "acp")?.lastError;
    },
    get diagnostics() {
      const status = agentStatus().providers?.find((provider) => provider.id === "acp");
      return status ? providerDiagnosticsText(status) : undefined;
    },
    restart: () => restartProvider("acp"),
    cancelRestart: () => cancelProviderRestart("acp"),
  };
  const hostAgentSettings: CustomAgentSettingsApi = {
    host: true,
    get agents() {
      return hostCustomAgents.customAgents();
    },
    save: hostCustomAgents.saveCustomAgent,
    remove: hostCustomAgents.deleteCustomAgent,
    get restartPending() {
      return customAgents.restartPending;
    },
    get lastError() {
      return customAgents.lastError;
    },
    get diagnostics() {
      return customAgents.diagnostics;
    },
  };
  const {
    openServerSettings,
    serverSettingsTarget,
    serverSettingsSection,
    setServerSettingsShownSection,
    serverSettingsOpenRequest,
    serverSettingsOpen,
    setServerSettingsOpen,
    serverSettingsRestoreTarget,
    serverSettingsMembers,
    serverSettingsLoading,
    serverSettingsError,
    refreshServerSettings,
    saveServerIdentity,
    saveServerAppearance,
    setServerPublished,
    updateServerMember,
    removeServerMember,
    leaveServer,
  } = useServerSettings();
  const browserProfileServerId = createMemo(() => serverSettingsTarget()?.id);
  const browserProfiles = createMemo(() => {
    const calls = desktopBrowserProfileCalls(browserProfileServerId());
    return createBrowserProfilesStore(() => calls);
  });
  const vaultServerId = createMemo(() => {
    const target = serverSettingsTarget();
    return serverCanAdminister(target, VAULT_CAPABILITY) ? target.id : undefined;
  });
  const vaultApiKeys = createMemo(() => serverCanAdminister(serverSettingsTarget(), VAULT_V2_CAPABILITY));
  const vaultTwoStep = createMemo(() => serverCanAdminister(serverSettingsTarget(), VAULT_V3_CAPABILITY));
  const vaultImport = createMemo(() => serverCanAdminister(serverSettingsTarget(), VAULT_IMPORT_CAPABILITY));
  const vault = createMemo(() => {
    const serverId = vaultServerId();
    if (serverId === undefined) return undefined;
    const local = untrack(serverSettingsTarget)?.kind === "local";
    return {
      store: createVaultStore(local ? desktopVaultCalls() : hostVaultCalls(serverId, vaultImport())),
      apiKeys: vaultApiKeys(),
      twoStep: vaultTwoStep(),
      link: local ? createLinkAccountStore() : undefined,
      listAgents: () => appPort().agent.listAgents(serverId),
    };
  });
  const copyOptions = (): ServerCopyOptions | undefined => {
    const eligible = servers().filter((entry) => serverCanAdminister(entry, "instance-transfer-v1"));
    if (eligible.length < 2) return undefined;
    return {
      servers: eligible,
      onOpenServer: (serverId) => {
        setServerSettingsOpen(false);
        if (!eligible.find((entry) => entry.id === serverId)?.active) void selectServer(serverId);
      },
    };
  };
  const openOnServer = (server: ServerSummary, agentId: string, open: () => void) => {
    setServerSettingsOpen(false);
    if (server.active) return open();
    void selectServer(server.id).then((selected) => {
      if (selected) setPendingAgentSelection(agentId);
    });
  };

  const registryApis = new Map<string, AcpRegistrySettingsApi>();
  function registryFor(server: ServerSummary): AcpRegistrySettingsApi {
    const existing = registryApis.get(server.id);
    if (existing) return existing;
    const api: AcpRegistrySettingsApi = {
      search: (query) => appPort().acpRegistry.search(query, server.id),
      status: () => appPort().acpRegistry.status(server.id),
      install: async (input) => {
        const result = await appPort().acpRegistry.install(input, server.id);
        if (server.kind === "local") await localAgents.refreshCustomAgents();
        else if (server.id === customAgentsServerId()) await hostCustomAgents.refreshCustomAgents();
        return result;
      },
      cancel: (id) => appPort().acpRegistry.cancel(id, server.id),
      remove: (id) => appPort().acpRegistry.remove(id, server.id),
    };
    registryApis.set(server.id, api);
    return api;
  }
  const providerSettings = (server: ServerSummary): HostProviderSettings | undefined => {
    const local = server.kind === "local";
    if (!server.active || (!local && server.id !== providerAdminServerId())) return undefined;
    const endpoints = local ? localEndpoints : hostCustomProviders;
    const detectionOf = () => (local ? detection : hostDetection());
    return {
      get defaultProvider() {
        const state = setupState();
        return local && state ? { ...state, save: saveSetup } : undefined;
      },
      get agentStatus() {
        return agentStatus();
      },
      get providerRuntimeStatuses() {
        return providerRuntimeDownloadsAvailable() ? providerRuntimeStatuses() : undefined;
      },
      get providerAvailableVersions() {
        return providerRuntimeDownloadsAvailable() ? providerAvailableVersions() : undefined;
      },
      get onUpdateProvider() {
        return providerRuntimeDownloadsAvailable() ? startProviderUpdate : undefined;
      },
      get onDownloadProvider() {
        return providerRuntimeDownloadsAvailable() ? downloadProviderRuntime : undefined;
      },
      get onCancelProviderDownload() {
        return providerRuntimeDownloadsAvailable() ? cancelProviderRuntimeDownload : undefined;
      },
      get customProviders() {
        return endpoints.customProviders();
      },
      onAddCustomProvider: endpoints.saveCustomProvider,
      onDeleteCustomProvider: endpoints.deleteCustomProvider,
      get onUpdateCustomProvider() {
        if (local) return endpoints.updateCustomProvider;
        const editable =
          serverSupportsCapability(server, "custom-provider-edit-v1") &&
          endpoints.customProviders().every((provider) => provider.headerNames !== undefined);
        return editable ? endpoints.updateCustomProvider : undefined;
      },
      get customProviderHarnessChoice() {
        return !local && serverSupportsCapability(server, "custom-provider-harness-choice-v1");
      },
      get providerKeys() {
        return providerRuntimeDownloadsAvailable() ? providerKeys() : undefined;
      },
      get connection() {
        return providerRuntimeDownloadsAvailable() ? connection : undefined;
      },
      get onCancelProviderSignIn() {
        return local && providerRuntimeDownloadsAvailable() ? cancelProviderSignIn : undefined;
      },
      get onInstallProvider() {
        return local && providerRuntimeDownloadsAvailable() ? openProviderInstallGuide : undefined;
      },
      get onSetProviderOn() {
        return local || server.id === providerUseServerId() ? setProviderOn : undefined;
      },
      get offProviders() {
        return local ? undefined : hostOffProviders();
      },
      onMeasureProviderDownload: local ? measureProviderDownload : undefined,
      onRemoveProviderDownload: local ? removeProviderDownload : undefined,
      get providerUsers() {
        return Object.fromEntries(
          (agentStatus().providers ?? []).map((provider) => [
            provider.id,
            agentList()
              .filter((agent) => agent.provider === provider.id)
              .map((agent) => agent.name),
          ]),
        );
      },
      get providerAccountUsers() {
        return Object.fromEntries(
          (agentStatus().providers ?? []).map((provider) => [
            provider.id,
            Object.fromEntries(
              (provider.accounts ?? []).map((account) => [
                account.id,
                agentList()
                  .filter(
                    (agent) => agent.provider === provider.id && isAgentAccount(agent.providerAccountId, account.id),
                  )
                  .map((agent) => agent.name),
              ]),
            ),
          ]),
        );
      },
      get accountActions() {
        return providerAccounts();
      },
      get usage() {
        return usageRows();
      },
      onRestartProvider: local ? restartProvider : undefined,
      onCancelProviderRestart: local ? cancelProviderRestart : undefined,
      onChooseInstalledCli: local ? chooseInstalledCli : undefined,
      get providerDetection() {
        return detectionOf()?.detection();
      },
      get detectedProviderApi() {
        return detectionOf()?.api;
      },
      get takenAgentIds() {
        return detectionOf()?.takenAgentIds() ?? hostCustomAgents.customAgents().map((agent) => agent.id);
      },
      get customAgents() {
        if (local) return customAgents;
        return server.id === customAgentsServerId() ? hostAgentSettings : undefined;
      },
      acpRegistry: serverCanAdminister(server, "acp-registry-v1") ? registryFor(server) : undefined,
      get detectionSettings() {
        return detectionOf()?.settingsValue() ?? undefined;
      },
      get onDetectionSettingsChange() {
        return detectionOf()?.setSettings;
      },
      get detectionSettingsError() {
        return detectionOf()?.settingsError() ?? null;
      },
      get onShown() {
        const store = detectionOf();
        const readsUse = !local && server.id === providerUseServerId();
        if (!store && !readsUse) return undefined;
        return () => {
          if (store) void store.scan();
          if (readsUse) refreshHostProviderUse();
        };
      },
    };
  };

  const switchToManageProviders = (server: ServerSummary) => {
    setServerSettingsOpen(false);
    void selectServer(server.id).then(
      (selected) => {
        if (selected) openServerSettings(server.id, null, "providers");
      },
      (error: unknown) => {
        const text = currentText();
        actionToast.error(text.t("server.select.failedTitle"), {
          ...{
            description: text.errorMessage(error, text.t("server.select.failedDescription")),
          },
          report: { operation: "other", source: "action", cause_code: classifyFailure(error) },
        });
        openServerSettings(server.id, null, "providers");
      },
    );
  };

  const storageOptions = (server: ServerSummary): Omit<ServerStorageOptions, "canManage"> => ({
    hostName:
      server.kind === "local"
        ? platform.appInfo()?.platform === "darwin"
          ? currentText().t("app.host.thisMac")
          : currentText().t("app.host.thisComputer")
        : server.name,
    onOpenAgent: (agentId) => openOnServer(server, agentId, () => selectAgent(agentId)),
    onShowMessage: (agentId, messageId) =>
      openOnServer(server, agentId, () => selectGlobalSearchMessage(agentId, messageId)),
  });

  return (
    <Show when={serverSettingsTarget()}>
      {(server) => (
        <ServerSettingsOverlay
          open={serverSettingsOpen() && windowPage.settingsPlacement("server") !== undefined}
          page={windowPage.settingsPlacement("server")}
          sectionQuery={windowPage.serverSettingsQuery()}
          openFirstSectionRequest={windowPage.openFirstServerSectionRequest()}
          onFirstSectionOpened={() => windowPage.setServerSettingsQuery("")}
          onOpenMarketplaceApps={
            server().id === activeServer()?.id
              ? () => {
                  windowPage.setServerSettingsQuery("");
                  setPendingPluginConnect(false);
                  setPendingPluginSlug(null);
                  setSkillsMarketplaceOpen(true);
                }
              : undefined
          }
          restoreFocusTarget={serverSettingsRestoreTarget()}
          platform={platform.appInfo()?.platform ?? "darwin"}
          server={server()}
          hostStatus={server().kind === "local" ? hostStatus() : null}
          members={serverSettingsMembers()}
          loading={serverSettingsLoading()}
          loadError={serverSettingsError()}
          onRetry={() => refreshServerSettings(server().id)}
          onSaveIdentity={saveServerIdentity}
          onSaveAppearance={saveServerAppearance}
          onSetPublished={setServerPublished}
          onUpdateMember={updateServerMember}
          onRemoveMember={removeServerMember}
          onLeaveServer={leaveServer}
          onRemoveServer={leaveServer}
          onOpenScreenRecordingSettings={() => appPort().openExternal("mac-screen-recording")}
          storage={storageOptions(server())}
          providers={providerSettings(server())}
          onSwitchToManageProviders={
            !server().active && serverCanAdminister(server(), "providers-v1")
              ? () => switchToManageProviders(server())
              : undefined
          }
          hostUpdate={{}}
          hostTimezone={{}}
          hostVoiceModel={{}}
          hostSignalHome={{}}
          hostTurnLimits={{}}
          hostPersonality={{}}
          hostMemoryLimit={{}}
          memoryReview={{}}
          skillLearning={{}}
          browsingMemory={{}}
          hostPromptCacheTtl={{}}
          claudeUserSetup={{}}
          claudeCompactWindow={{}}
          providerEnvironment={{}}
          hostModelVisibility={{}}
          hostDefaultProvider={{}}
          agentAccess={{ listAgents: () => appPort().agent.listAgents(server().id) }}
          serverAudit={{ listAgents: () => appPort().agent.listAgents(server().id) }}
          agentDefaults={{ listAgents: () => appPort().agent.listAgents(server().id) }}
          initialSection={serverSettingsSection()}
          initialSectionRequest={serverSettingsOpenRequest()}
          onSectionChange={setServerSettingsShownSection}
          agentImport={
            serverSupportsCapability(server(), "agent-import-v1")
              ? {
                  onOpenAgent: (agentId) => openOnServer(server(), agentId, () => selectAgent(agentId)),
                  onClose: () => setServerSettingsOpen(false),
                }
              : undefined
          }
          instanceTransfer={
            server().kind === "local"
              ? {
                  onSignIn: (provider) => void connection.connect(provider),
                  history: true,
                  fullCopy: true,
                  copy: copyOptions(),
                }
              : serverCanAdminister(server(), "instance-transfer-v1")
                ? // Only the transfer in parts carries the chat history; the full copy chooses each part.
                  {
                    history: serverCanAdminister(server(), "instance-transfer-chunks-v1"),
                    fullCopy:
                      serverCanAdminister(server(), "instance-transfer-chunks-v1") &&
                      serverCanAdminister(server(), "instance-transfer-full-copy-v1"),
                    copy: copyOptions(),
                  }
                : undefined
          }
          routineFeed={
            server().kind === "local"
              ? { api: appPort().routineFeed, listAgents: () => appPort().agent.listAgents(server().id) }
              : undefined
          }
          browserProfiles={
            serverCanAdminister(server(), BROWSER_PROFILES_CAPABILITY)
              ? { store: browserProfiles(), listAgents: () => appPort().agent.listAgents(server().id) }
              : undefined
          }
          vault={vault()}
          crm={desktopCrmHost(server().id)}
        />
      )}
    </Show>
  );
}

function AppSettings(props: AccountProps) {
  const windowPage = useWindowPage();
  const platform = usePlatform();
  const auth = useAuth();
  const updates = useUpdates();
  const whatsNew = useWhatsNew();
  const { servers, activeServer, setServerMuted, setServerNotificationLevel } = useServers();
  const { agentList, userHiddenAgentIds } = useAgents();
  const { sidebarLayout, pinnedSidebarItems } = useSidebar();
  const agentDockSettings = createMemo(() => {
    const server = activeServer();
    return {
      server: server ? { id: server.id, name: server.name } : null,
      agents: sidebarAgentOrder(agentList(), {
        layout: sidebarLayout(),
        pinnedItems: pinnedSidebarItems(),
        hiddenAgentIds: userHiddenAgentIds(),
      }),
      hiddenAgentIds: userHiddenAgentIds(),
    };
  });
  const {
    appSettingsOpen,
    notificationFocusRequest,
    setAppSettingsOpen,
    appSettingsTab,
    generalSettings,
    builtInDisplayGeometry,
    updateGeneralSettings,
    appSettingsRestoreTarget,
    sendTestNotification,
    openNotificationSettings,
    preferencesLoadFailed,
    reloadPreferences,
  } = useSettings();
  return (
    <Loading>
      <SettingsModal
        open={appSettingsOpen() && windowPage.settingsPlacement("personal") !== undefined}
        page={windowPage.settingsPlacement("personal")}
        value={generalSettings()}
        onValueChange={updateGeneralSettings}
        preferencesLoadFailed={preferencesLoadFailed()}
        onRetryPreferencesLoad={reloadPreferences}
        appInfo={platform.appInfo()}
        chatWindow={platform.chatWindow !== null}
        builtInDisplayGeometry={builtInDisplayGeometry()}
        servers={servers()}
        agentDock={agentDockSettings()}
        updateStatus={updates.status()}
        onUpdateAction={updates.runAction}
        onOpenWhatsNew={
          whatsNew.state.version
            ? () => {
                setAppSettingsOpen(false);
                whatsNew.reopen();
              }
            : undefined
        }
        onCancelScheduledRestart={updates.cancelScheduledRestart}
        onRestartWhenIdle={updates.restartWhenIdle}
        onCancelIdleRestart={updates.cancelIdleRestart}
        onRestartNow={updates.restartNow}
        account={props.account()}
        onUpdateAccountName={auth.updateProfileName}
        onSetChatColor={auth.setChatColor}
        onTestNotification={sendTestNotification}
        onOpenNotificationSettings={openNotificationSettings}
        onSetServerNotificationLevel={setServerNotificationLevel}
        onSetServerMuted={setServerMuted}
        notificationFocusRequest={notificationFocusRequest()}
        restoreFocusTarget={appSettingsRestoreTarget()}
        openTab={appSettingsTab()}
      />
    </Loading>
  );
}

function GlobalMessageSearch() {
  const { agentList, userHiddenAgentIds } = useAgents();
  const { sidebarLayout, pinnedSidebarItems } = useSidebar();
  const agents = createMemo(() =>
    sidebarAgentOrder(agentList(), {
      layout: sidebarLayout(),
      pinnedItems: pinnedSidebarItems(),
      hiddenAgentIds: userHiddenAgentIds(),
    }),
  );
  const { globalSearchOpen, searchGlobalMessages, setGlobalSearchVisibility, selectAgent, selectGlobalSearchMessage } =
    useNavigation();
  const sources = useGlobalSearchSources(globalSearchOpen);

  return (
    <GlobalSearchOverlay
      open={globalSearchOpen()}
      agents={agents()}
      channels={sources.channels()}
      routines={sources.routines()}
      routinesLoading={sources.routinesLoading()}
      actions={sources.actions()}
      onSearchMessages={searchGlobalMessages}
      onSearchFiles={sources.searchFiles()}
      onOpenChange={setGlobalSearchVisibility}
      onSelectAgent={selectAgent}
      onSelectChannel={sources.openChannel}
      onSelectMessage={selectGlobalSearchMessage}
      onSelectRoutine={sources.selectRoutine}
    />
  );
}
