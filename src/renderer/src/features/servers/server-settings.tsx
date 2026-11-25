import { parseHostedServerName } from "@openbot/contracts/hosted-servers";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AvatarImageInput,
  ServerAppearance,
  ServerSummary,
  TeamPresenceMember,
  UpdateTeamMemberInput,
  UserProfile,
} from "@openbot/contracts/ipc";
import { currentText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, flush, onCleanup } from "solid-js";
import { createSimpleContext } from "../../simple-context";
import { useAuth } from "../account/account-context";
import type { ServerSettingsSection } from "./ServerSettingsModal";
import { serverCanAdminister, serverRoleCanAdminister, serverSupportsCapability } from "./server-capabilities";
import { useServers } from "./servers-context";
import { serverMemberPort, serversPort } from "./servers-port";

const FALLBACK_SERVER_NAME = "OpenBot";

function generatedServerName(user: UserProfile | null): string {
  const person = (user?.name?.trim() || "").split(/\s+/u)[0] ?? "";
  if (!person) return FALLBACK_SERVER_NAME;
  const { t } = currentText();
  const characters = Array.from(person);
  let name = t("server.settings.generatedName", { name: person });
  for (let length = characters.length - 1; name.length > INPUT_LIMITS.serverName && length > 0; length--)
    name = t("server.settings.generatedName", { name: characters.slice(0, length).join("") });
  return parseHostedServerName(name) ?? FALLBACK_SERVER_NAME;
}

const ServerSettings = createSimpleContext({
  name: "Server settings",
  init: () => {
    const { servers, setServers, hostStatus, setHostStatus, setHostUpdateOpener } = useServers();
    const { profile } = useAuth();
    const [serverSettingsTargetId, setServerSettingsTargetId] = createSignal<string | null>(null);
    const [serverSettingsSection, setServerSettingsSection] = createSignal<ServerSettingsSection | null>(null);
    const [serverSettingsShownSection, setServerSettingsShownSection] = createSignal<ServerSettingsSection | null>(
      null,
    );
    const [serverSettingsOpen, setServerSettingsOpen] = createSignal(false);
    const [serverSettingsOpenRequest, setServerSettingsOpenRequest] = createSignal(0);
    const [serverSettingsMembers, setServerSettingsMembers] = createSignal<TeamPresenceMember[]>([]);
    const [serverSettingsLoading, setServerSettingsLoading] = createSignal(false);
    const [serverSettingsError, setServerSettingsError] = createSignal<string | null>(null);
    let serverSettingsRequest = 0;
    let serverSettingsRestoreTarget: HTMLElement | null = null;

    const serverSettingsTarget = createMemo(() => servers().find((server) => server.id === serverSettingsTargetId()));
    const [leaveRequest, setLeaveRequest] = createSignal<{ serverId: string; trigger: HTMLElement | null } | null>(
      null,
    );
    const leaveConfirmServer = createMemo(
      () => servers().find((server) => server.id === leaveRequest()?.serverId) ?? null,
    );
    createEffect(
      () => leaveRequest() !== null && leaveConfirmServer() === null,
      (gone) => {
        if (gone) setLeaveRequest(null);
      },
    );
    const [restartRequest, setRestartRequest] = createSignal<{ serverId: string; trigger: HTMLElement | null } | null>(
      null,
    );
    const restartConfirmServer = createMemo(
      () => servers().find((server) => server.id === restartRequest()?.serverId) ?? null,
    );
    createEffect(
      () => restartRequest() !== null && restartConfirmServer() === null,
      (gone) => {
        if (gone) setRestartRequest(null);
      },
    );

    createEffect(
      () => ({ open: serverSettingsOpen(), id: serverSettingsTargetId() }),
      ({ open, id }) => {
        if (!open || !id) return;
        let previous = "";
        return serversPort().servers.onPresence((presence) => {
          const signature = JSON.stringify(
            presence.members.map((member) => [member.id, member.role, member.disabled, member.online]),
          );
          if (signature === previous) return;
          previous = signature;
          flush(() => setServerSettingsMembers(presence.members));
          void refreshServerSettings(id);
        }, id);
      },
    );

    async function refreshServerSettings(serverId = serverSettingsTargetId()): Promise<void> {
      if (!serverId) return;
      const request = ++serverSettingsRequest;
      setServerSettingsLoading(true);
      setServerSettingsError(null);
      try {
        let server = servers().find((item) => item.id === serverId);
        if (!server) throw new Error(currentText().t("server.settings.unavailable"));
        let identityError: string | null = null;
        if (server.kind === "remote") {
          try {
            const refreshed = await serversPort().servers.refreshIdentity(serverId);
            setServers((current) => current.map((item) => (item.id === serverId ? refreshed : item)));
            server = refreshed;
          } catch (error) {
            const text = currentText();
            identityError = text.errorMessage(error, text.t("server.settings.identityRefreshFailed"));
          }
        }
        const canManage = server.kind === "local" ? hostStatus().configured : serverRoleCanAdminister(server);
        const canUseNetwork = server.kind === "local" || server.state === "online";
        const admin = serverMemberPort(server);
        const [presence, members] = await Promise.all([
          admin.getPresence(),
          canManage && canUseNetwork ? admin.listMembers() : Promise.resolve(null),
        ]);
        if (request !== serverSettingsRequest || serverSettingsTargetId() !== serverId) return;
        const presenceById = new Map(presence.members.map((member) => [member.id, member]));
        setServerSettingsMembers(
          (members ?? presence.members).map((member) => ({
            ...member,
            online: presenceById.get(member.id)?.online ?? false,
            typingAgentId: presenceById.get(member.id)?.typingAgentId ?? null,
          })),
        );
        if (identityError) setServerSettingsError(identityError);
      } catch (error) {
        if (request === serverSettingsRequest && serverSettingsTargetId() === serverId) {
          const text = currentText();
          setServerSettingsError(text.errorMessage(error, text.t("server.settings.loadFailed")));
        }
      } finally {
        if (request === serverSettingsRequest) setServerSettingsLoading(false);
      }
    }

    function openServerSettings(
      serverId: string,
      trigger: HTMLElement | null,
      section: ServerSettingsSection | null = null,
    ): void {
      serverSettingsRequest += 1;
      setServerSettingsSection(section);
      serverSettingsRestoreTarget = trigger;
      setServerSettingsTargetId(serverId);
      setServerSettingsOpen(true);
      setServerSettingsOpenRequest((count) => count + 1);
      setServerSettingsMembers([]);
      setServerSettingsError(null);
      void refreshServerSettings(serverId);
    }

    async function saveServerIdentity(input: { serverName: string; logo?: AvatarImageInput | null }): Promise<void> {
      const server = serverSettingsTarget();
      if (!serverCanAdminister(server, "host-admin-v1"))
        throw new Error(currentText().t("server.settings.identityLocalOnly"));
      const serverKind = server.kind;
      if (serverKind === "local") {
        const status = hostStatus().configured
          ? await serversPort().host.updateIdentity(input)
          : await serversPort().host.configure(input);
        setHostStatus(status);
      } else {
        await serversPort().hostAdmin.updateIdentity(input, server.id);
      }
      setServers(await serversPort().servers.list());
      await refreshServerSettings(server.id);
    }

    async function saveServerAppearance(appearance: ServerAppearance | null): Promise<void> {
      const server = serverSettingsTarget();
      if (!serverCanAdminister(server, "host-appearance-v1"))
        throw new Error(currentText().t("error.team.hostIdentityUnsupported"));
      const serverId = server.id;
      const previous = server.appearance;
      const patch = (value: ServerAppearance | null | undefined) =>
        setServers((current) =>
          current.map((item) => {
            if (item.id !== serverId) return item;
            const { appearance: _previous, ...rest } = item;
            return value === undefined ? rest : { ...rest, appearance: value };
          }),
        );
      patch(appearance);
      try {
        if (server.kind === "local") setHostStatus(await serversPort().host.updateIdentity({ appearance }));
        else {
          const updated = await serversPort().hostAdmin.updateIdentity({ appearance }, serverId);
          setServers((current) => current.map((item) => (item.id === serverId ? updated : item)));
        }
      } catch (error) {
        patch(previous);
        throw error;
      }
      setServers(await serversPort().servers.list());
    }

    async function setServerPublished(published: boolean): Promise<void> {
      if (serverSettingsTarget()?.kind !== "local")
        throw new Error(currentText().t("server.settings.publicationLocalOnly"));
      await setLocalServerPublished(published);
    }

    async function setLocalServerPublished(published: boolean): Promise<void> {
      const server = servers().find((candidate) => candidate.kind === "local");
      if (!server) throw new Error(currentText().t("server.settings.publicationLocalOnly"));
      if (published && !hostStatus().configured)
        setHostStatus(await serversPort().host.configure({ serverName: generatedServerName(profile()) }));
      const status = published ? await serversPort().host.start() : await serversPort().host.stop();
      if (published && status.phase !== "online") throw new Error("publish_failed");
      setHostStatus(status);
      setServers(await serversPort().servers.list());
      if (serverSettingsTargetId() === server.id) await refreshServerSettings(server.id);
    }

    async function updateServerMember(input: UpdateTeamMemberInput): Promise<void> {
      const server = serverSettingsTarget();
      if (!server) throw new Error(currentText().t("server.settings.unavailable"));
      await serverMemberPort(server).updateMember(input);
      await refreshServerSettings(server.id);
    }

    async function removeServerMember(memberId: string): Promise<void> {
      const server = serverSettingsTarget();
      if (!server) throw new Error(currentText().t("server.settings.unavailable"));
      await serverMemberPort(server).removeMember(memberId);
      await refreshServerSettings(server.id);
    }

    async function leaveServer(): Promise<void> {
      const server = serverSettingsTarget();
      if (!server) throw new Error(currentText().t("server.settings.unavailable"));
      await removeMembership(server);
      setServerSettingsOpen(false);
    }

    async function leaveConfirmedServer(): Promise<void> {
      const server = leaveConfirmServer();
      if (!server) throw new Error(currentText().t("server.settings.unavailable"));
      if (server.thisComputer) await serversPort().localServers.delete(server.id);
      else await removeMembership(server);
      if (serverSettingsTarget()?.id === server.id) setServerSettingsOpen(false);
    }

    async function restartConfirmedServer(): Promise<void> {
      const server = restartConfirmServer();
      if (!server) throw new Error(currentText().t("server.settings.unavailable"));
      if (server.thisComputer) await serversPort().localServers.restart(server.id);
      else if (serverSupportsCapability(server, "host-restart-v1"))
        await serversPort().hostAdmin.restartHost(server.id);
    }

    async function removeMembership(server: ServerSummary): Promise<void> {
      await serversPort().servers.remove(server.id);
    }

    setHostUpdateOpener((serverId) => openServerSettings(serverId, null, "updates"));
    onCleanup(() => setHostUpdateOpener(undefined));

    return {
      serverSettingsTarget,
      serverSettingsSection,
      serverSettingsShownSection,
      setServerSettingsShownSection,
      serverSettingsOpen,
      setServerSettingsOpen,
      serverSettingsOpenRequest,
      serverSettingsRestoreTarget: () => serverSettingsRestoreTarget,
      serverSettingsMembers,
      serverSettingsLoading,
      serverSettingsError,
      openServerSettings,
      refreshServerSettings,
      saveServerIdentity,
      saveServerAppearance,
      setServerPublished,
      publishLocalServer: () => setLocalServerPublished(true),
      updateServerMember,
      removeServerMember,
      leaveServer,
      leaveConfirmServer,
      leaveRestoreTarget: () => leaveRequest()?.trigger ?? null,
      requestLeaveServer: (serverId: string, trigger: HTMLElement | null) => setLeaveRequest({ serverId, trigger }),
      cancelLeaveServer: () => setLeaveRequest(null),
      leaveConfirmedServer,
      restartConfirmServer,
      restartRestoreTarget: () => restartRequest()?.trigger ?? null,
      requestRestartServer: (serverId: string, trigger: HTMLElement | null) => setRestartRequest({ serverId, trigger }),
      cancelRestartServer: () => setRestartRequest(null),
      restartConfirmedServer,
      serverSettingsTargetId,
    };
  },
});

export const ServerSettingsProvider = ServerSettings.provider;
export const useServerSettings = ServerSettings.use;
