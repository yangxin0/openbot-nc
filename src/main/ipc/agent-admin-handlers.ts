import {
  type AgentAdminSettings,
  type AgentFastModeSettings,
  agentFastModeSettings,
  agentSpeed,
  type BrowserComputerSharing,
  decodeAgentAdminSettings,
  decodeAgentBackupModelSettings,
  decodeAgentBrowserProfile,
  decodeAgentBuiltinMemorySettings,
  decodeAgentDefaultsOverview,
  decodeAgentPlanCardSettings,
  decodeAgentSpeedSettings,
  decodeBrowserComputerSharing,
  decodeBrowserProfileList,
  decodeBrowserProfileSummary,
  decodeBrowserProxyList,
  decodeBrowserProxySummary,
  decodeHostBrowserTabProfiles,
  decodeInstalledSkills,
  type InstalledSkill,
  parseBrowserProfileId,
  parseBrowserProfileName,
  parseClearBrowserDataInput,
  parseDeleteBrowserProxyInput,
  parseSaveBrowserProxyInput,
  parseSetAgentDefaultChoiceInput,
  parseSetBrowserProfileProxyInput,
  parseUpdateAgentAdminSettingsInput,
  parseUpdateAgentBackupModelsInput,
  parseUpdateAgentBrowserProfileInput,
  parseUpdateAgentBuiltinMemoryInput,
  parseUpdateAgentDefaultsInput,
  parseUpdateAgentFastModeInput,
  parseUpdateAgentHostSettingsInput,
  parseUpdateAgentNewChatInput,
  parseUpdateAgentPlanCardInput,
  parseUpdateBrowserProfileInput,
  type UpdateAgentFastModeInput,
} from "@openbot/contracts/ipc";
import { AGENT_ADMIN_CAPABILITY, AGENT_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/agent-admin-v1";
import {
  AGENT_BACKUP_MODELS_CAPABILITY,
  AGENT_BACKUP_MODELS_ROUTES,
} from "@openbot/contracts/team-protocol/agent-backup-models-v1";
import {
  AGENT_BUILTIN_MEMORY_CAPABILITY,
  AGENT_BUILTIN_MEMORY_ROUTES,
} from "@openbot/contracts/team-protocol/agent-builtin-memory-v1";
import { AGENT_DEFAULTS_CAPABILITY, AGENT_DEFAULTS_ROUTES } from "@openbot/contracts/team-protocol/agent-defaults-v1";
import {
  AGENT_FAST_MODE_CAPABILITY,
  AGENT_FAST_MODE_ROUTES,
} from "@openbot/contracts/team-protocol/agent-fast-mode-v1";
import {
  AGENT_HOST_SETTINGS_CAPABILITY,
  AGENT_HOST_SETTINGS_ROUTES,
} from "@openbot/contracts/team-protocol/agent-host-settings-v1";
import { AGENT_NEW_CHAT_CAPABILITY, AGENT_NEW_CHAT_ROUTES } from "@openbot/contracts/team-protocol/agent-new-chat-v1";
import {
  AGENT_PLAN_CARD_CAPABILITY,
  AGENT_PLAN_CARD_ROUTES,
} from "@openbot/contracts/team-protocol/agent-plan-card-v1";
import { AGENT_SPEED_CAPABILITY, AGENT_SPEED_ROUTES } from "@openbot/contracts/team-protocol/agent-speed-v1";
import {
  BROWSER_PROFILES_CAPABILITY,
  BROWSER_PROFILES_ROUTES,
} from "@openbot/contracts/team-protocol/browser-profiles-v1";
import {
  BROWSER_PROXIES_CAPABILITY,
  BROWSER_PROXIES_ROUTES,
} from "@openbot/contracts/team-protocol/browser-proxies-v1";
import type { TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";
import { GITHUB_SKILLS_CAPABILITY, GITHUB_SKILLS_ROUTES } from "@openbot/contracts/team-protocol/github-skills-v1";
import { SKILLS_ADMIN_CAPABILITY, SKILLS_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/skills-admin-v1";
import { sourceText } from "@openbot/i18n/source";
import type { Effect } from "effect";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { AgentAdminSettingsService } from "../agent-admin-settings";
import type { AgentDefaultsSettingsService } from "../agent-defaults-settings";
import type { AgentHostSettingsService } from "../agent-host-settings";
import type { BrowserProfileService } from "../browser-profile-service";
import {
  decodeAgentHostSettingsFromHost,
  decodeGithubSkillSourceFromHost,
  decodeRemoteAgentFastModeSettings,
  decodeRemoteAgentNewChatSettings,
} from "../remote-agent-decoding";
import { acceptEmpty, type ResponseDecoder } from "../remote-host-decoding";
import type { RemoteRequestInit } from "../remote-server-client";
import type { RemoteWorkflowError } from "../remote-service-effects";
import type { SkillMarketplaceService } from "../skill-marketplace-service";
import { parseInstallSkill, parseSetEnabledSkill, parseUninstallSkill } from "./app-inputs";
import type { IpcGroupHandlers } from "./define-ipc-group";
import { scopedHandler, scopedQueryHandler } from "./scoped-handler";
import { requireString } from "./validation";

interface AgentAdminRemoteServers {
  supportsCapability(serverId: string, capability: TeamCurrentCapability): boolean;
  browserComputerSharing(serverId: string): BrowserComputerSharing | null;
  setBrowserComputerSharing(serverId: string, sharing: boolean): Effect.Effect<void, RemoteWorkflowError>;
  request<T>(
    serverId: string,
    path: string,
    decoder: ResponseDecoder<T>,
    init?: RemoteRequestInit,
  ): Effect.Effect<T, RemoteWorkflowError>;
}

interface AgentAdminIpcDependencies {
  settings: AgentAdminSettingsService;
  hostSettings: AgentHostSettingsService;
  defaultsSettings: AgentDefaultsSettingsService;
  browserProfiles: BrowserProfileService;
  skills: Pick<SkillMarketplaceService, "listInstalled" | "install" | "uninstall" | "setEnabled" | "readGithub">;
  remoteServers: AgentAdminRemoteServers;
}

function decodeRemoteInstalledSkill(value: unknown): InstalledSkill {
  const [skill] = decodeInstalledSkills([value]);
  if (!skill) throw new Error("Invalid installed skill.");
  return skill;
}

export function agentAdminIpcHandlers({
  settings,
  hostSettings,
  defaultsSettings,
  browserProfiles,
  skills,
  remoteServers,
}: AgentAdminIpcDependencies): Pick<IpcGroupHandlers, "agentAdmin"> {
  function remote(serverId: string, path: string, body: unknown): Promise<AgentAdminSettings> {
    if (!remoteServers.supportsCapability(serverId, AGENT_ADMIN_CAPABILITY))
      throw new Error(sourceText("error.agent.settingsLocalOnly"));
    return runCauseEffect(remoteServers.request(serverId, path, decodeAgentAdminSettings, { method: "POST", body }));
  }

  function remoteSkills<T>(serverId: string, path: string, body: unknown, decoder: ResponseDecoder<T>): Promise<T> {
    if (!remoteServers.supportsCapability(serverId, SKILLS_ADMIN_CAPABILITY))
      throw new Error(sourceText("error.agent.skillsLocalOnly"));
    return runCauseEffect(remoteServers.request(serverId, path, decoder, { method: "POST", body }));
  }

  return {
    agentAdmin: {
      getAgentHostSettings: scopedHandler((value) => requireString(value, "agentId"), {
        local: (agentId) => hostSettings.read(agentId),
        remote: (agentId, serverId) => remoteHostSettings(serverId, AGENT_HOST_SETTINGS_ROUTES.settings, { agentId }),
      }),
      updateAgentHostSettings: scopedHandler(parseUpdateAgentHostSettingsInput, {
        local: (input) => runCauseEffect(hostSettings.update(input)),
        remote: (input, serverId) => remoteHostSettings(serverId, AGENT_HOST_SETTINGS_ROUTES.update, input),
      }),
      getAgentBackupModels: scopedHandler((value) => requireString(value, "agentId"), {
        local: (agentId) => hostSettings.readBackupModels(agentId),
        remote: (agentId, serverId) => remoteBackupModels(serverId, AGENT_BACKUP_MODELS_ROUTES.settings, { agentId }),
      }),
      updateAgentBackupModels: scopedHandler(parseUpdateAgentBackupModelsInput, {
        local: (input) => runCauseEffect(hostSettings.updateBackupModels(input)),
        remote: (input, serverId) => remoteBackupModels(serverId, AGENT_BACKUP_MODELS_ROUTES.update, input),
      }),
      getAgentNewChat: scopedHandler((value) => requireString(value, "agentId"), {
        local: (agentId) => hostSettings.readNewChat(agentId),
        remote: (agentId, serverId) => remoteNewChat(serverId, AGENT_NEW_CHAT_ROUTES.settings, { agentId }),
      }),
      updateAgentNewChat: scopedHandler(parseUpdateAgentNewChatInput, {
        local: (input) => runCauseEffect(hostSettings.updateNewChat(input)),
        remote: (input, serverId) => remoteNewChat(serverId, AGENT_NEW_CHAT_ROUTES.update, input),
      }),
      getAgentPlanCard: scopedHandler((value) => requireString(value, "agentId"), {
        local: (agentId) => hostSettings.readPlanCard(agentId),
        remote: (agentId, serverId) => remotePlanCard(serverId, AGENT_PLAN_CARD_ROUTES.settings, { agentId }),
      }),
      updateAgentPlanCard: scopedHandler(parseUpdateAgentPlanCardInput, {
        local: (input) => runCauseEffect(hostSettings.updatePlanCard(input)),
        remote: (input, serverId) => remotePlanCard(serverId, AGENT_PLAN_CARD_ROUTES.update, input),
      }),
      getAgentBuiltinMemory: scopedHandler((value) => requireString(value, "agentId"), {
        local: (agentId) => hostSettings.readBuiltinMemory(agentId),
        remote: (agentId, serverId) => remoteBuiltinMemory(serverId, AGENT_BUILTIN_MEMORY_ROUTES.settings, { agentId }),
      }),
      updateAgentBuiltinMemory: scopedHandler(parseUpdateAgentBuiltinMemoryInput, {
        local: (input) => runCauseEffect(hostSettings.updateBuiltinMemory(input)),
        remote: (input, serverId) => remoteBuiltinMemory(serverId, AGENT_BUILTIN_MEMORY_ROUTES.update, input),
      }),
      getAgentFastMode: scopedHandler((value) => requireString(value, "agentId"), {
        local: (agentId) => hostSettings.readFastMode(agentId),
        remote: (agentId, serverId) => remoteFastMode(serverId, { agentId }),
      }),
      updateAgentFastMode: scopedHandler(parseUpdateAgentFastModeInput, {
        local: (input) => runCauseEffect(hostSettings.updateFastMode(input)),
        remote: (input, serverId) => remoteFastMode(serverId, { agentId: input.agentId }, input),
      }),
      listBrowserProfiles: scopedQueryHandler({
        local: () => browserProfiles.list(),
        remote: (serverId) =>
          remoteBrowserProfiles(serverId, BROWSER_PROFILES_ROUTES.list, {}, decodeBrowserProfileList),
      }),
      createBrowserProfile: scopedHandler(parseBrowserProfileName, {
        local: (name) => runCauseEffect(browserProfiles.create(name)),
        remote: (name, serverId) =>
          remoteBrowserProfiles(serverId, BROWSER_PROFILES_ROUTES.create, { name }, decodeBrowserProfileSummary),
      }),
      updateBrowserProfile: scopedHandler(parseUpdateBrowserProfileInput, {
        local: (input) => runCauseEffect(browserProfiles.update(input)),
        remote: (input, serverId) =>
          remoteBrowserProfiles(serverId, BROWSER_PROFILES_ROUTES.update, input, decodeBrowserProfileSummary),
      }),
      clearBrowserData: scopedHandler(parseClearBrowserDataInput, {
        local: (input) => runCauseEffect(browserProfiles.clear(input)),
        remote: (input, serverId) => remoteBrowserProfiles(serverId, BROWSER_PROFILES_ROUTES.clear, input, acceptEmpty),
      }),
      deleteBrowserProfile: scopedHandler(parseBrowserProfileId, {
        local: (profileId) => runCauseEffect(browserProfiles.delete(profileId)),
        remote: (profileId, serverId) =>
          remoteBrowserProfiles(serverId, BROWSER_PROFILES_ROUTES.delete, { profileId }, acceptEmpty),
      }),
      getAgentBrowserProfile: scopedHandler((value) => requireString(value, "agentId"), {
        local: (agentId) => browserProfiles.readAgent(agentId),
        remote: (agentId, serverId) =>
          remoteBrowserProfiles(serverId, BROWSER_PROFILES_ROUTES.agent, { agentId }, decodeAgentBrowserProfile),
      }),
      updateAgentBrowserProfile: scopedHandler(parseUpdateAgentBrowserProfileInput, {
        local: (input) => runCauseEffect(browserProfiles.updateAgent(input)),
        remote: (input, serverId) =>
          remoteBrowserProfiles(serverId, BROWSER_PROFILES_ROUTES.updateAgent, input, decodeAgentBrowserProfile),
      }),
      getAgentDefaultsOverview: scopedQueryHandler({
        local: () => defaultsSettings.read(),
        remote: (serverId) => remoteAgentDefaults(serverId, AGENT_DEFAULTS_ROUTES.settings, {}),
      }),
      updateAgentDefaultsOverview: scopedHandler(parseUpdateAgentDefaultsInput, {
        local: (input) => runCauseEffect(defaultsSettings.update(input)),
        remote: (input, serverId) => remoteAgentDefaults(serverId, AGENT_DEFAULTS_ROUTES.update, input),
      }),
      setAgentDefaultChoice: scopedHandler(parseSetAgentDefaultChoiceInput, {
        local: (input) => runCauseEffect(defaultsSettings.setChoice(input)),
        remote: (input, serverId) => remoteAgentDefaults(serverId, AGENT_DEFAULTS_ROUTES.choice, input),
      }),
      listBrowserProxies: scopedQueryHandler({
        local: () => browserProfiles.listProxies(),
        remote: (serverId) =>
          remoteServers.supportsCapability(serverId, BROWSER_PROXIES_CAPABILITY)
            ? remoteBrowserProxies(serverId, BROWSER_PROXIES_ROUTES.list, {}, decodeBrowserProxyList)
            : null,
      }),
      saveBrowserProxy: scopedHandler(parseSaveBrowserProxyInput, {
        local: (input) => runCauseEffect(browserProfiles.saveProxy(input)),
        remote: (input, serverId) =>
          remoteBrowserProxies(serverId, BROWSER_PROXIES_ROUTES.save, input, decodeBrowserProxySummary),
      }),
      deleteBrowserProxy: scopedHandler(parseDeleteBrowserProxyInput, {
        local: (input) => runCauseEffect(browserProfiles.deleteProxy(input)),
        remote: (input, serverId) => remoteBrowserProxies(serverId, BROWSER_PROXIES_ROUTES.delete, input, acceptEmpty),
      }),
      setBrowserProfileProxy: scopedHandler(parseSetBrowserProfileProxyInput, {
        local: (input) => runCauseEffect(browserProfiles.setProfileProxy(input)),
        remote: (input, serverId) => remoteBrowserProxies(serverId, BROWSER_PROXIES_ROUTES.profile, input, acceptEmpty),
      }),
      getBrowserComputerSharing: scopedQueryHandler({
        local: () => null,
        remote: (serverId) => remoteServers.browserComputerSharing(serverId),
      }),
      setBrowserComputerSharing: scopedHandler(decodeBrowserComputerSharing, {
        local: () => {
          throw new Error(sourceText("error.team.agentSettingsUnsupported"));
        },
        remote: ({ sharing }, serverId) => runCauseEffect(remoteServers.setBrowserComputerSharing(serverId, sharing)),
      }),
      listBrowserTabProfiles: scopedQueryHandler({
        local: () => browserProfiles.tabProfiles(),
        remote: (serverId) =>
          remoteServers.supportsCapability(serverId, BROWSER_PROFILES_CAPABILITY)
            ? remoteBrowserProfiles(serverId, BROWSER_PROFILES_ROUTES.tabs, {}, decodeHostBrowserTabProfiles)
            : [],
      }),
      getAgentAdminSettings: scopedHandler((value) => requireString(value, "agentId"), {
        local: (agentId) => settings.read(agentId),
        remote: (agentId, serverId) => remote(serverId, AGENT_ADMIN_ROUTES.settings, { agentId }),
      }),
      updateAgentAdminSettings: scopedHandler(parseUpdateAgentAdminSettingsInput, {
        local: (input) => runCauseEffect(settings.update(input)),
        remote: (input, serverId) => remote(serverId, AGENT_ADMIN_ROUTES.update, input),
      }),
      listAgentSkills: scopedHandler((value) => requireString(value, "agentId"), {
        local: (agentId) => runCauseEffect(skills.listInstalled(agentId)),
        remote: (agentId, serverId) =>
          remoteSkills(serverId, SKILLS_ADMIN_ROUTES.list, { agentId }, decodeInstalledSkills),
      }),
      installAgentSkill: scopedHandler(parseInstallSkill, {
        local: (input) => runCauseEffect(skills.install(input)),
        remote: (input, serverId) =>
          remoteSkills(serverId, SKILLS_ADMIN_ROUTES.install, input, decodeRemoteInstalledSkill),
      }),
      uninstallAgentSkill: scopedHandler(parseUninstallSkill, {
        local: (input) => runCauseEffect(skills.uninstall(input)),
        remote: (input, serverId) => remoteSkills(serverId, SKILLS_ADMIN_ROUTES.uninstall, input, acceptEmpty),
      }),
      setAgentSkillEnabled: scopedHandler(parseSetEnabledSkill, {
        local: (input) => runCauseEffect(skills.setEnabled(input)),
        remote: (input, serverId) =>
          remoteSkills(serverId, SKILLS_ADMIN_ROUTES.setEnabled, input, decodeRemoteInstalledSkill),
      }),
      readGithubSkills: scopedHandler((value) => requireString(value, "link", 2048), {
        local: (link) => runCauseEffect(skills.readGithub(link)),
        remote: (link, serverId) => {
          if (!remoteServers.supportsCapability(serverId, GITHUB_SKILLS_CAPABILITY))
            throw new Error(sourceText("error.skill.githubHostTooOld"));
          return runCauseEffect(
            remoteServers.request(serverId, GITHUB_SKILLS_ROUTES.read, decodeGithubSkillSourceFromHost, {
              method: "POST",
              body: { link },
            }),
          );
        },
      }),
    },
  };

  function remoteHostSettings(serverId: string, path: string, body: unknown) {
    if (!remoteServers.supportsCapability(serverId, AGENT_HOST_SETTINGS_CAPABILITY))
      throw new Error(sourceText("error.team.agentSettingsUnsupported"));
    return runCauseEffect(
      remoteServers.request(serverId, path, decodeAgentHostSettingsFromHost, { method: "POST", body }),
    );
  }

  function remoteBackupModels(serverId: string, path: string, body: unknown) {
    if (!remoteServers.supportsCapability(serverId, AGENT_BACKUP_MODELS_CAPABILITY))
      throw new Error(sourceText("error.team.agentSettingsUnsupported"));
    return runCauseEffect(
      remoteServers.request(serverId, path, decodeAgentBackupModelSettings, { method: "POST", body }),
    );
  }

  function remoteBrowserProfiles<A>(serverId: string, path: string, body: unknown, decode: ResponseDecoder<A>) {
    if (!remoteServers.supportsCapability(serverId, BROWSER_PROFILES_CAPABILITY))
      throw new Error(sourceText("error.team.agentSettingsUnsupported"));
    return runCauseEffect(remoteServers.request(serverId, path, decode, { method: "POST", body }));
  }

  function remoteBrowserProxies<A>(serverId: string, path: string, body: unknown, decode: ResponseDecoder<A>) {
    if (!remoteServers.supportsCapability(serverId, BROWSER_PROXIES_CAPABILITY))
      throw new Error(sourceText("error.team.agentSettingsUnsupported"));
    return runCauseEffect(remoteServers.request(serverId, path, decode, { method: "POST", body }));
  }

  function remoteAgentDefaults(serverId: string, path: string, body: unknown) {
    if (!remoteServers.supportsCapability(serverId, AGENT_DEFAULTS_CAPABILITY))
      throw new Error(sourceText("error.team.agentSettingsUnsupported"));
    return runCauseEffect(remoteServers.request(serverId, path, decodeAgentDefaultsOverview, { method: "POST", body }));
  }

  function remotePlanCard(serverId: string, path: string, body: unknown) {
    if (!remoteServers.supportsCapability(serverId, AGENT_PLAN_CARD_CAPABILITY))
      throw new Error(sourceText("error.team.agentSettingsUnsupported"));
    return runCauseEffect(remoteServers.request(serverId, path, decodeAgentPlanCardSettings, { method: "POST", body }));
  }

  function remoteBuiltinMemory(serverId: string, path: string, body: unknown) {
    if (!remoteServers.supportsCapability(serverId, AGENT_BUILTIN_MEMORY_CAPABILITY))
      throw new Error(sourceText("error.team.agentSettingsUnsupported"));
    return runCauseEffect(
      remoteServers.request(serverId, path, decodeAgentBuiltinMemorySettings, { method: "POST", body }),
    );
  }

  function remoteNewChat(serverId: string, path: string, body: unknown) {
    if (!remoteServers.supportsCapability(serverId, AGENT_NEW_CHAT_CAPABILITY))
      throw new Error(sourceText("error.team.agentSettingsUnsupported"));
    return runCauseEffect(
      remoteServers.request(serverId, path, decodeRemoteAgentNewChatSettings, { method: "POST", body }),
    );
  }

  async function remoteFastMode(
    serverId: string,
    { agentId }: { agentId: string },
    update?: UpdateAgentFastModeInput,
  ): Promise<AgentFastModeSettings> {
    if (remoteServers.supportsCapability(serverId, AGENT_SPEED_CAPABILITY)) {
      const path = update ? AGENT_SPEED_ROUTES.update : AGENT_SPEED_ROUTES.settings;
      const body = update ? { agentId, speed: agentSpeed(update) } : { agentId };
      const settings = await runCauseEffect(
        remoteServers.request(serverId, path, decodeAgentSpeedSettings, { method: "POST", body }),
      );
      return agentFastModeSettings(settings);
    }
    if (!remoteServers.supportsCapability(serverId, AGENT_FAST_MODE_CAPABILITY))
      throw new Error(sourceText("error.team.agentSettingsUnsupported"));
    if (update?.ultrafast) throw new Error(sourceText("error.agent.settingsLocalOnly"));
    const path = update ? AGENT_FAST_MODE_ROUTES.update : AGENT_FAST_MODE_ROUTES.settings;
    const body = update ? { agentId, fastMode: update.fastMode } : { agentId };
    return runCauseEffect(
      remoteServers.request(serverId, path, decodeRemoteAgentFastModeSettings, { method: "POST", body }),
    );
  }
}
