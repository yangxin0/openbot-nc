import type {
  AppAppearancePreference,
  AppInfo,
  ApprovalAutomationPreference,
  AppSetupState,
  AppThemePalette,
  NotificationOpenedEvent,
  UpdateStatus,
  WorkflowNotificationOpenedEvent,
} from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import {
  decodeAppAppearancePreference,
  decodeAppBehaviorPreference,
  decodeAppInfo,
  decodeAppLanguagePreference,
  decodeApprovalAutomationPreference,
  decodeAppSetupState,
  decodeChatWindowTargets,
  decodeCustomAgentResult,
  decodeCustomAgents,
  decodeCustomAgentUsage,
  decodeDetectedModelServers,
  decodeDiscoverModelsResult,
  decodeInstalledFonts,
  decodeNotificationOpenedEvent,
  decodeNotificationPreference,
  decodeProviderDetectionSettings,
  decodeSentMessageStats,
  decodeUpdatePreference,
  decodeUpdateStatus,
  decodeUserProfile,
  decodeVoiceServerProbe,
  decodeVoiceServerSettings,
  decodeWorkflowNotificationOpenedEvent,
} from "./app-decoding";

const omarchyPalette = {
  id: "omarchy",
  name: "Omarchy",
  scheme: "dark",
  colors: {
    canvas: "#1a1b26",
    frame: "#13141c",
    sidebar: "#13141c",
    surface: "#24283b",
    text: "#a9b1d6",
    textMuted: "#565f89",
    border: "#414868",
    accent: "#7aa2f7",
    accentForeground: "#1a1b26",
    success: "#9ece6a",
    warning: "#e0af68",
    danger: "#f7768e",
  },
} satisfies AppThemePalette;

const updateStatus = {
  phase: "downloading",
  currentVersion: "1.0.0",
  availableVersion: "1.1.0",
  progress: 40,
  checkedAt: "2026-09-23T10:00:00.000Z",
  message: null,
  errorCode: null,
} satisfies UpdateStatus;

const detectedServer = {
  id: "ollama",
  name: "Ollama",
  baseUrl: "http://127.0.0.1:11434/v1",
  models: [{ id: "qwen3" }],
};

const customAgent = {
  id: "goose",
  name: "Goose",
  command: "goose",
  args: ["acp"],
  envNames: ["OPENAI_API_KEY"],
  usagePrompt: null,
  resolvedCommand: "/opt/homebrew/bin/goose",
};

const voiceServer = {
  address: "http://studio.local:8000/v1",
  hasApiKey: true,
  routes: {
    dictation: true,
    speech: false,
    transcriptionModel: "Systran/faster-whisper-large-v3",
    speechModel: null,
    voice: null,
  },
};

const valid: [string, (value: unknown) => unknown, unknown][] = [
  [
    "app behavior with a quit guard",
    decodeAppBehaviorPreference,
    {
      launchAtLogin: true,
      keepRunningInBackground: false,
      keepAwake: null,
      keepAwakeOnBattery: null,
      quitGuard: "always",
    },
  ],
  [
    "app behavior with no quit guard",
    decodeAppBehaviorPreference,
    { launchAtLogin: true, keepRunningInBackground: false, keepAwake: null, keepAwakeOnBattery: null, quitGuard: null },
  ],
  ["a voice server", decodeVoiceServerSettings, voiceServer],
  ["no voice server", decodeVoiceServerSettings, null],
  [
    "a voice server test that found models",
    decodeVoiceServerProbe,
    { ok: true, models: { transcription: ["whisper-1"], speech: ["kokoro"], voices: ["af_heart"] } },
  ],
  [
    "a voice server test that failed",
    decodeVoiceServerProbe,
    { ok: false, field: "apiKey", message: "studio.local:8000 refused the API key." },
  ],
  [
    "app info",
    decodeAppInfo,
    { name: "OpenBot", version: "1.0.0", platform: "darwin", variant: "dev" } satisfies AppInfo,
  ],
  [
    "app info drawn on the CPU",
    decodeAppInfo,
    {
      name: "OpenBot",
      version: "1.0.0",
      platform: "linux",
      variant: "production",
      softwareRendering: true,
    } satisfies AppInfo,
  ],
  [
    "app info on a Mac set to a 24-hour clock",
    decodeAppInfo,
    {
      name: "OpenBot",
      version: "1.0.0",
      platform: "darwin",
      variant: "production",
      hourCycle: "h23",
    } satisfies AppInfo,
  ],
  [
    "app info on an X11 desktop with no compositor",
    decodeAppInfo,
    {
      name: "OpenBot",
      version: "1.0.0",
      platform: "linux",
      variant: "production",
      aboveAppsSupport: "no-compositor",
    } satisfies AppInfo,
  ],
  [
    "app info on a server with no Dynamic Island",
    decodeAppInfo,
    {
      name: "OpenBot",
      version: "1.0.0",
      platform: "linux",
      variant: "production",
      dynamicIslandUnavailable: true,
    } satisfies AppInfo,
  ],
  ["sent message stats", decodeSentMessageStats, { firstSentAt: "2026-11-01T09:30:00.000Z", sentCount: 12 }],
  ["sent message stats before the first message", decodeSentMessageStats, { firstSentAt: null, sentCount: 0 }],
  [
    "setup state",
    decodeAppSetupState,
    { completed: true, preferredProvider: "codex", preferredModel: null } satisfies AppSetupState,
  ],
  [
    "approval automation",
    decodeApprovalAutomationPreference,
    {
      defaultAutoApprove: true,
      autoApproveOverrides: { "agent-1": false },
    } satisfies ApprovalAutomationPreference,
  ],
  ["language preference", decodeAppLanguagePreference, { language: "fr" }],
  [
    "appearance preference",
    decodeAppAppearancePreference,
    {
      appearance: "light",
      transparentWindow: true,
      palette: null,
      palettes: [],
      chatBackgroundLight: null,
      chatBackgroundDark: null,
      interfaceFont: null,
      codeFont: null,
    } satisfies AppAppearancePreference,
  ],
  [
    "appearance preference with a theme palette",
    decodeAppAppearancePreference,
    {
      appearance: "dark",
      transparentWindow: false,
      palette: "omarchy",
      palettes: [omarchyPalette],
      chatBackgroundLight: null,
      chatBackgroundDark: null,
      interfaceFont: null,
      codeFont: null,
    },
  ],
  [
    "appearance preference with a chat background for each scheme",
    decodeAppAppearancePreference,
    {
      appearance: "system",
      transparentWindow: false,
      palette: null,
      palettes: [],
      chatBackgroundLight: "#f1f2ff",
      chatBackgroundDark: "#162232",
      interfaceFont: null,
      codeFont: null,
    } satisfies AppAppearancePreference,
  ],
  [
    "appearance preference with an interface font and a code font",
    decodeAppAppearancePreference,
    {
      appearance: "dark",
      transparentWindow: false,
      palette: null,
      palettes: [],
      chatBackgroundLight: null,
      chatBackgroundDark: null,
      interfaceFont: "Noto Sans Arabic",
      codeFont: "JetBrains Mono",
    } satisfies AppAppearancePreference,
  ],
  ["installed fonts", decodeInstalledFonts, ["Al Bayan", "DejaVu Sans", "Noto Kufi Arabic"]],
  ["a profile with a chat color", decodeUserProfile, { id: "user-1", name: null, chatColor: "#3b82f6" }],
  ["a profile with no chat color", decodeUserProfile, { id: "user-1", name: "Ada", chatColor: null }],
  ["update status", decodeUpdateStatus, updateStatus],
  ["host-managed update status", decodeUpdateStatus, { ...updateStatus, managedByHost: true } satisfies UpdateStatus],
  [
    "update status with a staged release",
    decodeUpdateStatus,
    { ...updateStatus, phase: "up-to-date", stagedVersion: "0.68.0" } satisfies UpdateStatus,
  ],
  [
    "update status below the minimum version",
    decodeUpdateStatus,
    { ...updateStatus, phase: "downloading", requiredVersion: "0.70.0" } satisfies UpdateStatus,
  ],
  ["update preference", decodeUpdatePreference, { autoDownload: true, allowRemoteUpdates: true, autoInstall: false }],
  ["notification preference", decodeNotificationPreference, { desktopNotifications: true, messagePreview: false }],
  [
    "opened notification",
    decodeNotificationOpenedEvent,
    { serverId: "local", agentId: "agent-1", threadId: null } satisfies NotificationOpenedEvent,
  ],
  [
    "opened channel notification",
    decodeNotificationOpenedEvent,
    { serverId: "local", agentId: "agent-1", threadId: null, channelId: "channel-1" } satisfies NotificationOpenedEvent,
  ],
  [
    "opened workflow notification",
    decodeWorkflowNotificationOpenedEvent,
    { serverId: "local", workflowId: "workflow-1" } satisfies WorkflowNotificationOpenedEvent,
  ],
  ["chat windows", decodeChatWindowTargets, [{ serverId: "local", agentId: "agent-1" }]],
  ["detected model servers", decodeDetectedModelServers, [detectedServer]],
  ["custom agents", decodeCustomAgents, [customAgent, { ...customAgent, id: "qwen", resolvedCommand: null }]],
  ["a custom agent with a usage prompt", decodeCustomAgents, [{ ...customAgent, usagePrompt: "/usage" }]],
  [
    "a registry install result with no usage prompt",
    decodeCustomAgentResult,
    {
      agents: [Object.fromEntries(Object.entries(customAgent).filter(([key]) => key !== "usagePrompt"))],
      restart: "not-running",
    },
  ],
  ["custom agent usage", decodeCustomAgentUsage, [{ id: "devin", text: "Plan: Pro\n42% left" }]],
  ["a model list", decodeDiscoverModelsResult, { models: [{ id: "qwen3" }] }],
  [
    "detection settings",
    decodeProviderDetectionSettings,
    { enabled: true, addresses: ["http://192.168.1.20:11434/v1"], folders: ["~/bin"], hiddenIds: [] },
  ],
];

const malformed: [string, (value: unknown) => unknown, unknown][] = [
  [
    "an unknown quit guard",
    decodeAppBehaviorPreference,
    {
      launchAtLogin: true,
      keepRunningInBackground: false,
      keepAwake: null,
      keepAwakeOnBattery: null,
      quitGuard: "sometimes",
    },
  ],
  [
    "a missing quit guard",
    decodeAppBehaviorPreference,
    { launchAtLogin: true, keepRunningInBackground: false, keepAwake: null, keepAwakeOnBattery: null },
  ],
  ["sent message stats with a negative count", decodeSentMessageStats, { firstSentAt: null, sentCount: -1 }],
  [
    "app info with a software rendering flag that is not a boolean",
    decodeAppInfo,
    { name: "OpenBot", version: "1.0.0", platform: "linux", variant: "production", softwareRendering: "yes" },
  ],
  [
    "app info with an unknown hour cycle",
    decodeAppInfo,
    { name: "OpenBot", version: "1.0.0", platform: "darwin", variant: "production", hourCycle: "h24" },
  ],
  [
    "app info with an unknown agent dock screen support",
    decodeAppInfo,
    { name: "OpenBot", version: "1.0.0", platform: "linux", variant: "production", aboveAppsSupport: "no-composer" },
  ],
  [
    "app info with a Dynamic Island availability that is not a boolean",
    decodeAppInfo,
    { name: "OpenBot", version: "1.0.0", platform: "linux", variant: "production", dynamicIslandUnavailable: "yes" },
  ],
  ["a voice server with its key", decodeVoiceServerSettings, { ...voiceServer, apiKey: "sk-secret" }],
  [
    "a voice server that dictates with no model",
    decodeVoiceServerSettings,
    { ...voiceServer, routes: { ...voiceServer.routes, transcriptionModel: null } },
  ],
  [
    "a voice server that speaks with no voice",
    decodeVoiceServerSettings,
    { ...voiceServer, routes: { ...voiceServer.routes, speech: true, speechModel: "kokoro", voice: null } },
  ],
  ["a voice server test with an unknown field", decodeVoiceServerProbe, { ok: false, field: "model", message: "" }],
  [
    "a voice server test with an empty model",
    decodeVoiceServerProbe,
    { ok: true, models: { transcription: [""], speech: [], voices: [] } },
  ],
  [
    "app info on an unknown platform",
    decodeAppInfo,
    { name: "OpenBot", version: "1", platform: "aix", variant: "dev" },
  ],
  [
    "setup state with an unknown provider",
    decodeAppSetupState,
    { completed: true, preferredProvider: "other", preferredModel: null },
  ],
  ["approval automation without overrides", decodeApprovalAutomationPreference, { defaultAutoApprove: true }],
  ["language preference with an unknown tag", decodeAppLanguagePreference, { language: "xx" }],
  ["appearance preference with no transparent window", decodeAppAppearancePreference, { appearance: "dark" }],
  [
    "appearance preference with a string transparent window",
    decodeAppAppearancePreference,
    { appearance: "dark", transparentWindow: "true" },
  ],
  [
    "appearance preference with no theme palettes",
    decodeAppAppearancePreference,
    { appearance: "dark", transparentWindow: false, palette: null },
  ],
  [
    "a theme palette id with a path",
    decodeAppAppearancePreference,
    { appearance: "dark", transparentWindow: false, palette: "../omarchy", palettes: [] },
  ],
  [
    "a theme palette color that is not hex",
    decodeAppAppearancePreference,
    {
      appearance: "dark",
      transparentWindow: false,
      palette: null,
      palettes: [{ ...omarchyPalette, colors: { ...omarchyPalette.colors, accent: "red; background: url(x)" } }],
    },
  ],
  [
    "a theme palette with a missing color",
    decodeAppAppearancePreference,
    {
      appearance: "dark",
      transparentWindow: false,
      palette: null,
      palettes: [{ ...omarchyPalette, colors: { canvas: "#1a1b26" } }],
    },
  ],
  [
    "appearance preference with no chat background",
    decodeAppAppearancePreference,
    { appearance: "dark", transparentWindow: false, palette: null, palettes: [] },
  ],
  [
    "appearance preference with no font",
    decodeAppAppearancePreference,
    {
      appearance: "dark",
      transparentWindow: false,
      palette: null,
      palettes: [],
      chatBackgroundLight: null,
      chatBackgroundDark: null,
    },
  ],
  [
    "a font name that ends the CSS string",
    decodeAppAppearancePreference,
    {
      appearance: "dark",
      transparentWindow: false,
      palette: null,
      palettes: [],
      chatBackgroundLight: null,
      chatBackgroundDark: null,
      interfaceFont: 'Arial"; background: url(x)',
      codeFont: null,
    },
  ],
  ["an installed font with a semicolon", decodeInstalledFonts, ["Arial", "Menlo; color: red"]],
  ["installed fonts that are not a list", decodeInstalledFonts, "Arial"],
  [
    "a chat background that is not a hex color",
    decodeAppAppearancePreference,
    {
      appearance: "dark",
      transparentWindow: false,
      palette: null,
      palettes: [],
      chatBackgroundLight: null,
      chatBackgroundDark: "red; background: url(x)",
    },
  ],
  [
    "a chat background with an alpha channel",
    decodeAppAppearancePreference,
    {
      appearance: "light",
      transparentWindow: false,
      palette: null,
      palettes: [],
      chatBackgroundLight: "#f1f2ff00",
      chatBackgroundDark: null,
    },
  ],
  ["update status in an unknown phase", decodeUpdateStatus, { ...updateStatus, phase: "done" }],
  ["update status with an unknown failure", decodeUpdateStatus, { ...updateStatus, errorCode: "boom" }],
  ["update status with a staged release that is not text", decodeUpdateStatus, { ...updateStatus, stagedVersion: 68 }],
  [
    "update status with a minimum version that is not text",
    decodeUpdateStatus,
    { ...updateStatus, requiredVersion: 70 },
  ],
  ["update preference without a switch", decodeUpdatePreference, null],
  ["notification preference without a switch", decodeNotificationPreference, { desktopNotifications: "yes" }],
  ["opened notification without an agent", decodeNotificationOpenedEvent, { serverId: "local", threadId: null }],
  [
    "opened notification with a non-string channel",
    decodeNotificationOpenedEvent,
    { serverId: "local", agentId: "agent-1", threadId: null, channelId: 7 },
  ],
  ["opened workflow notification without a workflow", decodeWorkflowNotificationOpenedEvent, { serverId: "local" }],
  ["a chat window without an agent", decodeChatWindowTargets, [{ serverId: "local" }]],
  ["chat windows that are not a list", decodeChatWindowTargets, { serverId: "local", agentId: "agent-1" }],
  ["a detected server with a key", decodeDetectedModelServers, [{ ...detectedServer, apiKey: "sk-x" }]],
  ["a detected server with headers", decodeDetectedModelServers, [{ ...detectedServer, headers: [] }]],
  ["a custom agent with its environment", decodeCustomAgents, [{ ...customAgent, env: [] }]],
  ["a custom agent with its ciphertext", decodeCustomAgents, [{ ...customAgent, secret: "c2VhbGVk" }]],
  ["a custom agent with a value", decodeCustomAgents, [{ ...customAgent, value: "sk-x" }]],
  ["a custom agent with a two-line usage prompt", decodeCustomAgents, [{ ...customAgent, usagePrompt: "/usage\nrm" }]],
  ["custom agent usage of an invalid id", decodeCustomAgentUsage, [{ id: "Not An Id", text: "42%" }]],
  ["custom agent usage with no text", decodeCustomAgentUsage, [{ id: "devin", text: null }]],
  [
    "a profile chat color that is not a lower-case hex color",
    decodeUserProfile,
    { id: "user-1", name: null, chatColor: "#3B82F6" },
  ],
  [
    "a profile chat color that is a CSS expression",
    decodeUserProfile,
    { id: "user-1", name: null, chatColor: "red;x:url(a)" },
  ],
  ["a model list with an empty id", decodeDiscoverModelsResult, { models: [{ id: "" }] }],
  [
    "detection settings without a switch",
    decodeProviderDetectionSettings,
    { addresses: [], folders: [], hiddenIds: [] },
  ],
];

describe("app decoding", () => {
  it.each(valid)("keeps %s unchanged", (_name, decode, value) => {
    expect(decode(value)).toEqual(value);
  });

  it.each(malformed)("rejects %s", (_name, decode, value) => {
    expect(() => decode(value)).toThrow(/^Invalid /);
  });
});
