import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type AppInfo,
  type AppSetupState,
  type AppVariant,
  type ChatWindowTarget,
  type ExternalDestination,
  type ExternalLinkBrowser,
  externalLinkAppName,
  GROK_BOT_EXPORT_URL,
} from "@openbot/contracts/ipc";
import { app, type BrowserWindow, dialog, type OpenDialogOptions, type WebContents } from "electron";
import { version as developmentVersion } from "../../../package.json";
import type { AgentService } from "../../backend/agent-service";
import type { BrowserHost } from "../../backend/browser-host";
import type { MailboxStore } from "../../backend/mailbox-store";
import type { AgentDefaultsPreferenceStore } from "../agent-defaults-preference-store";
import type { AgentMemoryLimitSetting } from "../agent-memory-limit-preference-store";
import type { AppBehaviorService } from "../app-behavior-service";
import type { AppearanceService } from "../appearance-service";
import type { ApprovalAutomation } from "../approval-automation-store";
import type { BusyMessageModePreferenceStore } from "../busy-message-mode-preference-store";
import type { ExternalLinkOpener, ExternalLinkPreferenceStore } from "../external-link-opener";
import { listInstalledFonts } from "../installed-fonts";
import type { InterfaceSizeService } from "../interface-size-service";
import type { LanguageService } from "../language-service";
import { aboveAppsScreenSupport } from "../linux-wayland-output";
import type { LogoColorService } from "../logo-color-service";
import { MAC_PERMISSION_URLS } from "../mac-permission-urls";
import { exportDiagnostics, exportOpenBotData } from "../maintenance-service";
import { isTailscaleConnected } from "../private-network-detection";
import type { RemoteNetworkRoutePreferenceStore } from "../remote-network-route-preference-store";
import type { RemoteSessionReusePreferenceStore } from "../remote-session-reuse-preference-store";
import { readSetupState, writeSetupState } from "../setup-store";
import { systemHourCycle } from "../system-hour-cycle";
import type { UpdateService } from "../update-service";
import {
  parseAppAppearancePreference,
  parseAppBehaviorPreferenceChange,
  parseAppInterfaceSizePreference,
  parseAppLanguagePreference,
  parseAppLogoColorPreference,
  parseChatWindowTarget,
  parseExternalDestination,
  parseExternalLinkPreference,
  parseRemoteNetworkRoutePreference,
  parseRemoteSessionReusePreference,
  parseRendererTimingReport,
  parseSetup,
} from "./app-inputs";
import { stringPayload } from "./validation";

const EXTERNAL_DESTINATIONS: Record<ExternalDestination, string> = {
  "opencode-install": "https://opencode.ai/docs/",
  "opencode-auth": "https://opencode.ai/auth",
  "claude-install": "https://code.claude.com/docs",
  "hermes-install": "https://hermes-agent.nousresearch.com/docs/getting-started/installation",
  "grok-bot-export": GROK_BOT_EXPORT_URL,
  "mac-screen-recording": MAC_PERMISSION_URLS["screen-recording"],
};

import { runCauseEffect } from "../../backend/effect-boundary";
import { openHttpLink } from "../message-link-relay";
import type { ResourceMonitor } from "../resource-monitor";
import type { StartupTiming } from "../startup-timing";
import type { TraceFile } from "../trace-file";
import { eventPayloadHandler, handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";

export interface AppIpcDependencies {
  service: AgentService;
  mailbox: MailboxStore;
  browser: BrowserHost;
  updater: UpdateService;
  setupFile: string;
  approvalAutomation: ApprovalAutomation;
  busyMessageMode: BusyMessageModePreferenceStore;
  agentDefaults: AgentDefaultsPreferenceStore;
  agentMemoryLimit: AgentMemoryLimitSetting;
  remoteSessionReuse: RemoteSessionReusePreferenceStore;
  remoteNetworkRoute: RemoteNetworkRoutePreferenceStore;
  applyRemoteNetworkRoute: () => Promise<void>;
  externalLinkPreference: ExternalLinkPreferenceStore;
  externalLinks: ExternalLinkOpener;
  openLink: (url: string) => Promise<void>;
  appBehavior: AppBehaviorService;
  language: LanguageService;
  logoColor: LogoColorService;
  appearance: AppearanceService;
  interfaceSize: InterfaceSizeService;
  initializeAgent: () => Promise<void>;
  appVariant: AppVariant;
  dynamicIslandAvailable: boolean;
  getMainWindow: () => BrowserWindow | null;
  isMainWindow: (sender: WebContents) => boolean;
  openChatWindow: (target: ChatWindowTarget) => void;
  chatWindowTargets: () => ChatWindowTarget[];
  trace: TraceFile;
  resources: ResourceMonitor;
  startup: StartupTiming | null;
}

export function appIpcHandlers({
  service,
  mailbox,
  browser,
  updater,
  setupFile,
  approvalAutomation,
  busyMessageMode,
  agentDefaults,
  agentMemoryLimit,
  remoteSessionReuse,
  remoteNetworkRoute,
  applyRemoteNetworkRoute,
  externalLinkPreference,
  externalLinks,
  openLink,
  appBehavior,
  language,
  logoColor,
  appearance,
  interfaceSize,
  initializeAgent,
  appVariant,
  dynamicIslandAvailable,
  getMainWindow,
  isMainWindow,
  openChatWindow,
  chatWindowTargets,
  trace,
  resources,
  startup,
}: AppIpcDependencies): Pick<IpcGroupHandlers, "app" | "maintenance"> {
  return {
    app: {
      getAppInfo: handler((): AppInfo => {
        const platform = process.platform;
        if (platform !== "darwin" && platform !== "win32" && platform !== "linux") {
          throw new Error(`Unsupported desktop platform: ${platform}`);
        }
        const version = app.isPackaged ? app.getVersion() : developmentVersion;
        const softwareRendering = !app.getGPUFeatureStatus().gpu_compositing.startsWith("enabled");
        const hourCycle = systemHourCycle();
        const aboveAppsSupport = aboveAppsScreenSupport();
        return {
          name: app.getName(),
          version,
          platform,
          variant: appVariant,
          ...(softwareRendering ? { softwareRendering } : {}),
          ...(hourCycle ? { hourCycle } : {}),
          ...(aboveAppsSupport ? { aboveAppsSupport } : {}),
          ...(dynamicIslandAvailable ? {} : { dynamicIslandUnavailable: true }),
        };
      }),
      getSetupState: handler(() => runCauseEffect(readSetupState(setupFile))),
      reportRendererTiming: eventPayloadHandler(parseRendererTimingReport, (event, report) => {
        if (report.workspaceReady && isMainWindow(event.sender)) startup?.workspaceReady();
        resources.observeRendererTiming(report);
      }),
      getApprovalAutomation: handler(() => approvalAutomation.current()),
      getBusyMessageModePreference: handler(() => busyMessageMode.get()),
      getAgentDefaults: handler(() => agentDefaults.get()),
      getAgentMemoryLimitPreference: handler(() => agentMemoryLimit.get()),
      getRemoteSessionReusePreference: handler(() => remoteSessionReuse.get()),
      setRemoteSessionReusePreference: payloadHandler(parseRemoteSessionReusePreference, (parsed) =>
        runCauseEffect(remoteSessionReuse.set(parsed)),
      ),
      getRemoteNetworkRoute: handler(() => ({
        ...remoteNetworkRoute.get(),
        tailscaleConnected: isTailscaleConnected(),
      })),
      setRemoteNetworkRoute: payloadHandler(parseRemoteNetworkRoutePreference, async (parsed) => {
        const previous = remoteNetworkRoute.get();
        const saved = await runCauseEffect(remoteNetworkRoute.set(parsed));
        await applyRemoteNetworkRoute().catch(async (error: unknown) => {
          await runCauseEffect(remoteNetworkRoute.set(previous));
          throw error;
        });
        return { ...saved, tailscaleConnected: isTailscaleConnected() };
      }),
      getAppBehaviorPreference: handler(() => runCauseEffect(appBehavior.get())),
      setAppBehaviorPreference: payloadHandler(parseAppBehaviorPreferenceChange, (parsed) =>
        runCauseEffect(appBehavior.set(parsed)),
      ),
      getAppLanguagePreference: handler(() => language.preference),
      setAppLanguagePreference: payloadHandler(parseAppLanguagePreference, (parsed) =>
        runCauseEffect(language.set(parsed)),
      ),
      getAppLogoColorPreference: handler(() => logoColor.preference),
      setAppLogoColorPreference: payloadHandler(parseAppLogoColorPreference, (parsed) =>
        runCauseEffect(logoColor.set(parsed)),
      ),
      getAppAppearancePreference: handler(() => appearance.preference),
      setAppAppearancePreference: payloadHandler(parseAppAppearancePreference, (parsed) =>
        runCauseEffect(appearance.set(parsed)),
      ),
      listInstalledFonts: handler(() => runCauseEffect(listInstalledFonts())),
      getAppInterfaceSizePreference: handler(() => interfaceSize.preference),
      setAppInterfaceSizePreference: payloadHandler(parseAppInterfaceSizePreference, (parsed) =>
        runCauseEffect(interfaceSize.set(parsed)),
      ),
      saveSetup: payloadHandler(parseSetup, async (input): Promise<AppSetupState> => {
        const state = await runCauseEffect(writeSetupState(setupFile, input));
        await runCauseEffect(service.setPreferredProvider(input.preferredProvider, input.preferredModel));
        await initializeAgent();
        return state;
      }),
      openExternal: payloadHandler(parseExternalDestination, (parsed) => openLink(EXTERNAL_DESTINATIONS[parsed])),
      getSentMessageStats: handler(() => service.readSentMessageStats()),
      openUrl: payloadHandler(stringPayload("URL", INPUT_LIMITS.browserUrl), (url) => openHttpLink(url, openLink)),
      getExternalLinkPreference: handler(() => externalLinkPreference.get()),
      setExternalLinkPreference: payloadHandler(parseExternalLinkPreference, (parsed) =>
        runCauseEffect(externalLinkPreference.set(parsed)),
      ),
      listExternalLinkBrowsers: handler(() => runCauseEffect(externalLinks.listBrowsers())),
      chooseExternalLinkApp: handler(async (): Promise<ExternalLinkBrowser | null> => {
        const mainWindow = getMainWindow();
        const options: OpenDialogOptions = {
          title: language.translate("dialog.chooseExternalLinkApp"),
          properties: ["openFile"],
          ...(process.platform === "darwin"
            ? {
                defaultPath: "/Applications",
                filters: [{ name: language.translate("dialog.filter.applications"), extensions: ["app"] }],
              }
            : {}),
        };
        const result = mainWindow
          ? await dialog.showOpenDialog(mainWindow, options)
          : await dialog.showOpenDialog(options);
        const path = result.canceled ? undefined : result.filePaths[0];
        return path ? { name: externalLinkAppName(path), path } : null;
      }),
      openChatWindow: payloadHandler(parseChatWindowTarget, openChatWindow),
      getChatWindows: handler(chatWindowTargets),
    },
    maintenance: {
      exportData: handler(() =>
        runCauseEffect(
          exportOpenBotData({ service, mailbox, parentWindow: getMainWindow(), translate: language.translate }),
        ),
      ),
      exportDiagnostics: handler(() =>
        runCauseEffect(
          exportDiagnostics({
            service,
            browser,
            updater,
            trace,
            resources,
            parentWindow: getMainWindow(),
            translate: language.translate,
          }),
        ),
      ),
    },
  };
}
