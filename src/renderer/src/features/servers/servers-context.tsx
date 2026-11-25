import type { HostStatus, ServerNotificationLevel, ServerSummary } from "@openbot/contracts/ipc";
import type { TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";
import { classifyFailure } from "@openbot/telemetry";
import { toast } from "@openbot/ui";
import { currentText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, flush, onSettled, untrack } from "solid-js";
import { actionToast } from "../../action-toast";
import { FALLBACK_HOST_STATUS } from "../../app-defaults";
import { createSimpleContext } from "../../simple-context";
import {
  olderAppSide,
  remoteUpdateServer,
  serverRoleCanAdminister,
  serverSupportsCapability,
} from "./server-capabilities";
import { checkServerUpdate, offerServerUpdate, type ServerUpdateTarget } from "./server-update-flow";
import { serversPort } from "./servers-port";

const LOCAL_SERVER_HIDDEN_STORAGE_KEY = "openbot:local-server-hidden";

function readLocalServerHidden(): boolean {
  try {
    return window.localStorage.getItem(LOCAL_SERVER_HIDDEN_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

const Servers = createSimpleContext({
  name: "Servers",
  init: () => {
    const [serversLoaded, setServersLoaded] = createSignal(false);
    const [serversLoadFailed, setServersLoadFailed] = createSignal(false);
    const [servers, setServers] = createSignal<ServerSummary[]>([]);
    const [hostStatus, setHostStatus] = createSignal<HostStatus>(FALLBACK_HOST_STATUS);
    const [joinServerOpen, setJoinServerOpen] = createSignal(false);
    const [createLocalServerOpen, setCreateLocalServerOpen] = createSignal(false);
    const [serverLoadRequest, setServerLoadRequest] = createSignal<{
      serverId: string;
      nonce: number;
      connectionSequence?: number;
    } | null>(null);
    const [localServerHidden, setLocalServerHiddenSignal] = createSignal(readLocalServerHidden());
    let loadRequestNonce = 0;
    let pendingCompatibilityRetryServerId: string | null = null;
    let serverSelectionGeneration = 0;

    function beginServerSelection(): () => boolean {
      const generation = ++serverSelectionGeneration;
      return () => generation === serverSelectionGeneration;
    }

    function currentServerSelection(): () => boolean {
      const generation = serverSelectionGeneration;
      return () => generation === serverSelectionGeneration;
    }

    const activeServer = createMemo(() => servers().find((server) => server.active));
    const activeServerId: () => string = createMemo((): string => activeServer()?.id ?? "local");

    function activeServerSupportsCapability(capability: TeamCurrentCapability): boolean {
      return serverSupportsCapability(activeServer(), capability);
    }

    let openHostUpdate: ((serverId: string) => void) | undefined;
    function setHostUpdateOpener(opener: ((serverId: string) => void) | undefined): void {
      openHostUpdate = opener;
    }

    const updateChecks = new Map<string, number>();
    let entry: { id: string; offered: boolean } | null = null;

    function updateTarget(server: ServerSummary): ServerUpdateTarget {
      return {
        serverId: server.id,
        name: server.name,
        canManage: serverRoleCanAdminister(server),
        calls: serversPort().hostAdmin,
      };
    }

    function applyServerSummaries(value: ServerSummary[]): void {
      setServersLoaded(true);
      setServersLoadFailed(false);
      const previous = new Map(servers().map((server) => [server.id, server]));
      for (const server of value) {
        const sequence = server.connectionSequence ?? 0;
        const previousSequence = previous.get(server.id)?.connectionSequence ?? 0;
        const compatibility = server.compatibility;
        const canUpdate = remoteUpdateServer(server);
        if (
          server.kind === "remote" &&
          sequence > previousSequence &&
          compatibility?.hostAppVersion &&
          compatibility.hostAppVersion !== compatibility.localAppVersion
        ) {
          const { t } = currentText();
          const opener = openHostUpdate;
          const serverId = server.id;
          const older = olderAppSide(compatibility.localAppVersion, compatibility.hostAppVersion);
          const descriptionParams = {
            name: server.name,
            protocol: String(compatibility.negotiatedProtocol),
            clientVersion: compatibility.localAppVersion,
            hostVersion: compatibility.hostAppVersion,
          };
          const offerUpdate = opener && canUpdate && older !== "client";
          toast.warning(t("server.compatibility.versionMismatchTitle", { name: server.name }), {
            ...{
              description:
                older === "host"
                  ? t("server.compatibility.versionMismatchUpdateHostDescription", descriptionParams)
                  : older === "client"
                    ? t("server.compatibility.versionMismatchUpdateClientDescription", descriptionParams)
                    : t("server.compatibility.versionMismatchDescription", descriptionParams),
              action:
                opener && offerUpdate
                  ? { label: t("server.update.hostAction"), onClick: () => opener(serverId) }
                  : undefined,
            },
            report: { operation: "team", source: "system", cause_code: "unknown" },
          });
        }
        if (canUpdate && server.state === "online" && updateChecks.get(server.id) !== sequence) {
          updateChecks.set(server.id, sequence);
          if (!server.active || (entry?.id === server.id && entry.offered))
            void checkServerUpdate(updateTarget(server));
        }
      }
      setServers(value);
      if (!value.some((server) => server.kind === "remote") && untrack(localServerHidden)) setLocalServerHidden(false);
      moveLocalServerHiddenToAccount(value.find((server) => server.kind === "local"));
      const retryTarget = value.find(
        (server) => server.id === pendingCompatibilityRetryServerId && server.active && server.state === "online",
      );
      const negotiatedTarget = value.find((server) => {
        const oldCompatibility = previous.get(server.id)?.compatibility;
        return (
          server.kind === "remote" &&
          server.active &&
          server.state === "online" &&
          oldCompatibility?.hostAppVersion === null &&
          Boolean(server.compatibility?.hostAppVersion)
        );
      });
      const reconnectedTarget = value.find((server) => {
        const old = previous.get(server.id);
        return (
          old?.active &&
          server.active &&
          server.kind === "remote" &&
          server.state === "online" &&
          (old.state !== "online" || (server.connectionSequence ?? 0) > (old.connectionSequence ?? 0))
        );
      });
      const loadTarget = retryTarget ?? negotiatedTarget ?? reconnectedTarget;
      if (loadTarget) {
        pendingCompatibilityRetryServerId = null;
        loadRequestNonce += 1;
        const connectionSequence = retryTarget ? undefined : loadTarget.connectionSequence;
        setServerLoadRequest({
          serverId: loadTarget.id,
          nonce: loadRequestNonce,
          ...(connectionSequence === undefined ? {} : { connectionSequence }),
        });
      }
    }

    function setLocalServerHidden(hidden: boolean): void {
      setLocalServerHiddenSignal(hidden);
      try {
        if (hidden) window.localStorage.setItem(LOCAL_SERVER_HIDDEN_STORAGE_KEY, "true");
        else window.localStorage.removeItem(LOCAL_SERVER_HIDDEN_STORAGE_KEY);
      } catch {}
    }

    let localServerHiddenMoveStarted = false;
    function moveLocalServerHiddenToAccount(local: ServerSummary | undefined): void {
      if (!local || local.hidden === undefined || !untrack(localServerHidden)) return;
      if (local.hidden) {
        setLocalServerHidden(false);
        return;
      }
      if (localServerHiddenMoveStarted) return;
      localServerHiddenMoveStarted = true;
      void serversPort()
        .servers.setHidden({ serverId: local.id, hidden: true })
        .then(applyServerSummaries)
        .catch(() => undefined);
    }

    async function setServerHidden(serverId: string, hidden: boolean): Promise<void> {
      applyServerSummaries(await serversPort().servers.setHidden({ serverId, hidden }));
    }

    async function refreshServers(): Promise<void> {
      setServersLoadFailed(false);
      try {
        applyServerSummaries(await serversPort().servers.list());
      } catch {
        setServersLoadFailed(true);
      }
    }

    let markServersLoaded: () => void = () => undefined;
    const initialServersReady = new Promise<void>((resolve) => {
      markServersLoaded = resolve;
    });

    onSettled(() => {
      const unsubscribeServers = serversPort().servers.onEvent((value) => flush(() => applyServerSummaries(value)));
      const unsubscribeHost = serversPort().host.onEvent((status) => flush(() => setHostStatus(status)));
      void refreshServers().finally(markServersLoaded);
      void serversPort()
        .host.getStatus()
        .then(setHostStatus)
        .catch(() => undefined);
      return () => {
        unsubscribeServers();
        unsubscribeHost();
      };
    });

    createEffect(
      () => {
        const active = servers().find((server) => server.active);
        return active ? { id: active.id, online: active.state === "online" } : null;
      },
      (current) => {
        if (current?.id !== entry?.id) {
          entry = current ? { id: current.id, offered: false } : null;
          void offerServerUpdate(null);
        }
        if (!current?.online || !entry || entry.offered) return;
        entry.offered = true;
        const active = untrack(servers).find((server) => server.id === current.id);
        void offerServerUpdate(remoteUpdateServer(active) && active ? updateTarget(active) : null);
      },
    );

    async function retryServerConnection(serverId: string): Promise<void> {
      if (servers().find((server) => server.id === serverId)?.state !== "online")
        pendingCompatibilityRetryServerId = serverId;
      try {
        await serversPort().servers.retryConnection(serverId);
      } catch (error) {
        pendingCompatibilityRetryServerId = null;
        const text = currentText();
        actionToast.error(text.t("server.connection.failedTitle"), {
          error,
          fallback: text.t("server.connection.failedDescription"),
          report: { operation: "team", source: "action", cause_code: classifyFailure(error) },
        });
      }
    }

    async function setServerMuted(serverId: string, muted: boolean, durationMs?: number): Promise<void> {
      try {
        applyServerSummaries(
          await serversPort().servers.setMuted(
            durationMs === undefined ? { serverId, muted } : { serverId, muted, durationMs },
          ),
        );
      } catch (error) {
        const text = currentText();
        actionToast.error(text.t("server.notifications.changeFailedTitle"), {
          error,
          fallback: text.t("server.notifications.changeFailedDescription"),
          report: { operation: "team", source: "action", cause_code: classifyFailure(error) },
        });
      }
    }

    async function setServerNotificationLevel(serverId: string, level: ServerNotificationLevel): Promise<void> {
      try {
        applyServerSummaries(await serversPort().servers.setNotificationLevel({ serverId, level }));
      } catch (error) {
        const text = currentText();
        actionToast.error(text.t("server.notifications.changeFailedTitle"), {
          error,
          fallback: text.t("server.notifications.changeFailedDescription"),
          report: { operation: "team", source: "action", cause_code: classifyFailure(error) },
        });
      }
    }

    async function reorderServers(serverIds: string[]): Promise<void> {
      const previous = servers();
      const serversById = new Map(previous.map((server) => [server.id, server]));
      setServers([
        ...previous.filter((server) => server.kind === "local"),
        ...serverIds.flatMap((serverId) => {
          const server = serversById.get(serverId);
          return server?.kind === "remote" ? [server] : [];
        }),
      ]);
      try {
        setServers(await serversPort().servers.reorder({ serverIds }));
      } catch (error) {
        setServers(
          await serversPort()
            .servers.list()
            .catch(() => previous),
        );
        throw error;
      }
    }

    return {
      servers,
      serversLoaded,
      serversLoadFailed,
      refreshServers,
      setServers,
      setHostUpdateOpener,
      activeServer,
      activeServerId,
      activeServerSupportsCapability,
      hostStatus,
      setHostStatus,
      joinServerOpen,
      setJoinServerOpen,
      createLocalServerOpen,
      setCreateLocalServerOpen,
      reorderServers,
      localServerHidden,
      setLocalServerHidden,
      setServerHidden,
      setServerMuted,
      setServerNotificationLevel,
      retryServerConnection,
      serverLoadRequest,
      initialServersReady,
      beginServerSelection,
      currentServerSelection,
    };
  },
});

export const ServersProvider = Servers.provider;
export const useServers = Servers.use;
