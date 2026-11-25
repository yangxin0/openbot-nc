import type { SettingsPageBack, SettingsPagePlacement } from "@openbot/ui/features/settings/SettingsDialogShell";
import { createEffect, createMemo, createSignal, untrack } from "solid-js";
import { createSimpleContext } from "../../simple-context";
import { useServerSettings } from "../servers/server-settings";
import { useServers } from "../servers/servers-context";
import { useSettings } from "../settings/settings-context";
import { useUsage } from "../usage/usage-context";

export type WindowPage =
  | "agents"
  | "tasks"
  | "schedule"
  | "workflows"
  | "usage"
  | "library"
  | "crm"
  | "marketplace"
  | "settings"
  | "server-settings";

export type WindowPageKind = "agents" | "settings" | "titled";

export function windowPageKind(page: WindowPage): WindowPageKind {
  if (page === "settings" || page === "server-settings") return "settings";
  return page === "agents" || page === "tasks" ? "agents" : "titled";
}

export type SettingsKind = "personal" | "server";

const context = createSimpleContext({
  name: "WindowPageProvider",
  init: () => {
    const settings = useSettings();
    const serverSettings = useServerSettings();
    const usage = useUsage();
    const { activeServerId } = useServers();
    const [settingsMounts, setSettingsMounts] = createSignal<SettingsPagePlacement | undefined>();
    const [serverSettingsQuery, setServerSettingsQuery] = createSignal("");
    const [openFirstServerSectionRequest, setOpenFirstServerSectionRequest] = createSignal(0);

    const basePage = createMemo<WindowPage>(() => {
      if (serverSettings.serverSettingsOpen()) return "server-settings";
      if (settings.appSettingsOpen()) return "settings";
      if (settings.skillsMarketplaceOpen()) return "marketplace";
      return usage.state.serverId ? usage.state.view : "agents";
    });
    const page = basePage;

    createEffect(settings.appSettingsOpenRequest, (request, previous) => {
      if (previous === undefined || request === previous) return;
      usage.dismissUsage();
      if (untrack(settings.skillsMarketplaceOpen)) settings.setSkillsMarketplaceOpen(false);
      if (untrack(serverSettings.serverSettingsOpen)) serverSettings.setServerSettingsOpen(false);
    });

    createEffect(serverSettings.serverSettingsOpenRequest, (request, previous) => {
      if (previous === undefined || request === previous) return;
      usage.dismissUsage();
      if (untrack(settings.skillsMarketplaceOpen)) settings.setSkillsMarketplaceOpen(false);
      if (untrack(settings.appSettingsOpen)) settings.setAppSettingsOpen(false);
    });

    createEffect(
      () => usage.state.serverId,
      (serverId) => {
        if (!serverId) return;
        if (untrack(settings.appSettingsOpen)) settings.setAppSettingsOpen(false);
        if (untrack(serverSettings.serverSettingsOpen)) serverSettings.setServerSettingsOpen(false);
        if (untrack(settings.skillsMarketplaceOpen)) settings.setSkillsMarketplaceOpen(false);
      },
    );

    createEffect(settings.skillsMarketplaceOpen, (open) => {
      if (!open) return;
      usage.dismissUsage();
      if (untrack(settings.appSettingsOpen)) settings.setAppSettingsOpen(false);
      if (untrack(serverSettings.serverSettingsOpen)) serverSettings.setServerSettingsOpen(false);
    });

    createEffect(activeServerId, (serverId, previous) => {
      if (previous === undefined || serverId === previous || !serverId) return;
      if (untrack(serverSettings.serverSettingsOpen)) untrack(() => serverSettings.openServerSettings(serverId, null));
    });

    const [personalBack, setPersonalBack] = createSignal<SettingsPageBack | null>(null);
    const [serverBack, setServerBack] = createSignal<SettingsPageBack | null>(null);
    const placementFor = (kind: SettingsKind) =>
      createMemo<SettingsPagePlacement | undefined>(() => {
        const mounts = settingsMounts();
        if (!mounts || page() !== (kind === "personal" ? "settings" : "server-settings")) return undefined;
        return { ...mounts, onBack: (back) => (kind === "personal" ? setPersonalBack(back) : setServerBack(back)) };
      });
    const placements = { personal: placementFor("personal"), server: placementFor("server") };

    function settingsPlacement(kind: SettingsKind): SettingsPagePlacement | undefined {
      return placements[kind]();
    }

    function pageBack(): SettingsPageBack | null {
      if (page() === "settings") return personalBack();
      return page() === "server-settings" ? serverBack() : null;
    }

    return {
      page,
      conversationCovered: () => page() !== "agents",
      setSettingsMounts,
      settingsPlacement,
      serverSettingsQuery,
      setServerSettingsQuery: (query: string) => setServerSettingsQuery(query),
      openFirstServerSectionRequest,
      openFirstServerSection: () => setOpenFirstServerSectionRequest((request) => request + 1),
      pageBack,
      showAgents() {
        settings.setAppSettingsOpen(false);
        serverSettings.setServerSettingsOpen(false);
        settings.setSkillsMarketplaceOpen(false);
        usage.dismissUsage();
      },
      openTasks(source: HTMLElement | null) {
        const serverId = activeServerId();
        if (serverId) usage.openTasks(serverId, source);
      },
      openSchedule(source: HTMLElement | null) {
        const serverId = activeServerId();
        if (serverId) usage.openSchedule(serverId, source);
      },
      openWorkflows(source: HTMLElement | null, workflow?: { serverId: string; workflowId: string }) {
        const serverId = workflow?.serverId ?? activeServerId();
        if (serverId) usage.openWorkflows(serverId, source, workflow?.workflowId);
      },
      openUsage(source: HTMLElement | null) {
        const serverId = activeServerId();
        if (serverId) usage.openUsage(serverId, source);
      },
      openLibrary(source: HTMLElement | null) {
        const serverId = activeServerId();
        if (serverId) usage.openLibrary(serverId, source);
      },
      openCrm(source: HTMLElement | null, connectors = false) {
        const serverId = activeServerId();
        if (serverId) usage.openCrm(serverId, source, connectors);
      },
      openSettings(source: HTMLElement | null) {
        settings.openAppSettings(source);
      },
    };
  },
});

export const WindowPageProvider = context.provider;
export const useWindowPage = context.use;
