import type { ServerSummary } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { classifyFailure } from "@openbot/telemetry";
import type { ServerActionCallbacks } from "@openbot/ui/features/servers/ServerActionItems";
import type { HiddenServer } from "@openbot/ui/features/servers/ServerRail";
import { useText } from "@openbot/ui/text";
import { actionToast } from "../../action-toast";
import { usePlatform } from "../../platform";
import { useRelay } from "../relay/relay-context";
import { useSettings } from "../settings/settings-context";
import { serverSupportsCapability } from "./server-capabilities";
import { useServerSelection } from "./server-selection";
import { useServerSettings } from "./server-settings";
import { useServers } from "./servers-context";

export function useServerActions() {
  const platform = usePlatform();
  const { t, errorMessage } = useText();
  const { servers, setServerMuted, setCreateLocalServerOpen, localServerHidden, setLocalServerHidden, reorderServers } =
    useServers();
  const { selectServer } = useServerSelection();
  const { openServerSettings, requestLeaveServer, requestRestartServer } = useServerSettings();
  const { openAppSettings, openNotificationLevels } = useSettings();
  const relay = useRelay();

  function remoteServers(): ServerSummary[] {
    return servers().filter((server) => server.kind === "remote");
  }

  function isHidden(server: ServerSummary): boolean {
    return server.kind === "local" && localServerHidden() && remoteServers().length > 0;
  }

  function shown(server: ServerSummary): boolean {
    return server.active || !isHidden(server);
  }

  function allServers(): ServerSummary[] {
    return [...servers().filter((server) => server.kind === "local"), ...remoteServers()];
  }

  function orderedServers(): ServerSummary[] {
    return allServers().filter(shown);
  }

  function reorder(visibleIds: string[]): void {
    const visible = new Set(visibleIds);
    let index = 0;
    const serverIds = remoteServers().map((server) =>
      visible.has(server.id) ? (visibleIds[index++] ?? server.id) : server.id,
    );
    void reorderServers(serverIds);
  }

  function selectFailed(error: unknown): void {
    actionToast.error(t("server.select.failedTitle"), {
      ...{
        description: errorMessage(error, t("server.select.failedDescription")),
      },
      report: { operation: "team", source: "action", cause_code: classifyFailure(error) },
    });
  }

  function select(serverId: string): void {
    void selectServer(serverId).catch(selectFailed);
  }

  function add(): void {
    if (platform.landingPreview) return;
    openAppSettings(undefined, "team");
  }

  function addLabel(): AppTextKey {
    return relay.hasIdentity() ? "server.rail.teamServers" : "server.rail.connectTeam";
  }

  const createLocal = platform.landingPreview ? undefined : () => setCreateLocalServerOpen(true);

  function canHide(serverId: string): boolean {
    const server = servers().find((candidate) => candidate.id === serverId);
    if (!server || isHidden(server) || server.kind !== "local") return false;
    return allServers().some((candidate) => candidate.id !== serverId && !isHidden(candidate));
  }

  async function hide(serverId: string): Promise<void> {
    const server = servers().find((candidate) => candidate.id === serverId);
    if (!server || !canHide(serverId)) return;
    const others = orderedServers().filter((candidate) => candidate.id !== serverId);
    const other = others.find((candidate) => candidate.state === "online") ?? others[0];
    if (!other) return;
    if (server.active) {
      try {
        if (!(await selectServer(other.id))) return;
      } catch (error) {
        selectFailed(error);
        return;
      }
    }
    setLocalServerHidden(true);
  }

  function show(server: ServerSummary): void {
    if (server.kind === "local") setLocalServerHidden(false);
  }

  function hiddenServers(): HiddenServer[] {
    return allServers()
      .filter(isHidden)
      .map((server) => ({
        id: server.id,
        name: server.name,
        logoUrl: server.logoUrl,
        ...(server.appearance === undefined ? {} : { appearance: server.appearance }),
        show: () => show(server),
      }));
  }

  function onThisComputer(serverId: string): boolean {
    return servers().some((server) => server.id === serverId && server.thisComputer === true);
  }

  const callbacks = {
    onSetMuted: (serverId, muted, durationMs) => void setServerMuted(serverId, muted, durationMs),
    onOpenNotificationSettings: openNotificationLevels,
    onOpenSettings: openServerSettings,
    onLeave: requestLeaveServer,
    onRemove: requestLeaveServer,
    canRemove: (serverId) => !onThisComputer(serverId),
    onDelete: requestLeaveServer,
    canDelete: onThisComputer,
    onRestart: requestRestartServer,
    canRestart: (serverId) => {
      if (onThisComputer(serverId)) return true;
      const server = servers().find((candidate) => candidate.id === serverId);
      return server?.state === "online" && serverSupportsCapability(server, "host-restart-v1");
    },
    onHide: (serverId) => void hide(serverId),
    canHide,
  } satisfies ServerActionCallbacks;

  return {
    allServers,
    orderedServers,
    reorder,
    select,
    add,
    addLabel,
    createLocal,
    hiddenServers,
    callbacks,
  };
}
