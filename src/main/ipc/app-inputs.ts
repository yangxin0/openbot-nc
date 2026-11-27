import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AgentDefaults,
  AgentDockAction,
  AgentDockDragPhase,
  AgentDockExtent,
  AgentDockInputRect,
  AgentDockPresentation,
  AgentMemoryLimitPreference,
  AgentProviderId,
  AppBehaviorPreferenceChange,
  AppFontFamily,
  AvatarColor,
  BrowserDockAction,
  BrowserDockFrame,
  BrowserDockPresentation,
  BrowserTakeoverPage,
  BusyMessageModePreference,
  ChatBackgroundColor,
  ChatWindowTarget,
  DynamicIslandAction,
  DynamicIslandPreference,
  DynamicIslandPresentation,
  ExternalDestination,
  ExternalLinkPreference,
  HostUpdateSettingsChange,
  IdleRestartTarget,
  InstallSkillInput,
  MacAutomationTarget,
  MacPermissionId,
  MemoryReviewPreference,
  NotificationPreference,
  RendererTimingReport,
  SaveSetupInput,
  SetAgentDockInteractiveInput,
  SetAgentDockXWaylandInput,
  SetAppAppearancePreferenceInput,
  SetAppInterfaceSizePreferenceInput,
  SetAppLanguagePreferenceInput,
  SetAppLogoColorPreferenceInput,
  SetDynamicIslandInteractiveInput,
  SetEnabledSkillInput,
  UninstallSkillInput,
  UpdatePreferenceChange,
} from "@openbot/contracts/ipc";
import {
  decodeExternalLinkTarget,
  GITHUB_SKILL_ID_MAX_LENGTH,
  IDLE_RESTART_TARGETS,
  isAgentDefaults,
  isAgentDockAction,
  isAgentDockDragPhase,
  isAgentDockExtent,
  isAgentDockInputRegion,
  isAgentDockInteractive,
  isAgentDockPresentation,
  isAgentDockXWayland,
  isAgentMemoryLimit,
  isAgentModel,
  isAgentProvider,
  isAppAppearance,
  isAppFontFamily,
  isAppInterfaceSize,
  isAppLanguage,
  isAppLogoColor,
  isAppThemePaletteId,
  isAvatarColor,
  isBrowserDockAction,
  isBrowserDockFrame,
  isBrowserDockPresentation,
  isBrowserTakeoverPage,
  isBusyMessageMode,
  isChatBackgroundColor,
  isDynamicIslandAction,
  isDynamicIslandInteractive,
  isDynamicIslandPreference,
  isDynamicIslandPresentation,
  isMemoryReviewInterval,
  MAC_AUTOMATION_TARGETS,
  QUIT_GUARDS,
  RENDERER_TIMING_LIMITS,
} from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord, isNumber, isOneOf } from "@openbot/contracts/runtime-values";
import { validateProfileName } from "@openbot/contracts/validation";
import { isObject, optionalBoolean, requireString } from "./validation";

export function parseSetup(input: unknown): SaveSetupInput {
  if (!isDynamicRecord(input)) throw new Error("Setup input is required.");
  const provider = input.preferredProvider;
  if (!isAgentProvider(provider)) throw new Error("Unknown provider.");
  const model = input.preferredModel;
  if (model !== null && !isAgentModel(model)) throw new Error("Unknown model.");
  return { preferredProvider: provider, preferredModel: model };
}

export function parseProviderId(input: unknown): AgentProviderId {
  if (!isAgentProvider(input)) throw new Error("Unknown provider.");
  return input;
}

function isCount(value: unknown, max: number): value is number {
  return isNumber(value) && Number.isSafeInteger(value) && value >= 0 && value <= max;
}

export function parseRendererTimingReport(input: unknown): RendererTimingReport {
  if (!isDynamicRecord(input)) throw new Error("Renderer timing is required.");
  const { workspaceReady, longTasks, inputs, inputDelaysMs } = input;
  if (workspaceReady !== undefined && workspaceReady !== true) throw new Error("Workspace ready is not valid.");
  if (!isCount(longTasks, RENDERER_TIMING_LIMITS.longTasks) || !isCount(inputs, RENDERER_TIMING_LIMITS.inputs))
    throw new Error("Renderer timing is not valid.");
  if (
    !Array.isArray(inputDelaysMs) ||
    inputDelaysMs.length > Math.min(RENDERER_TIMING_LIMITS.inputDelays, inputs) ||
    !inputDelaysMs.every((delay) => isCount(delay, RENDERER_TIMING_LIMITS.inputDelayMs))
  ) {
    throw new Error("Input delays are not valid.");
  }
  return { ...(workspaceReady ? { workspaceReady } : {}), longTasks, inputs, inputDelaysMs: [...inputDelaysMs] };
}

export function parseBusyMessageModePreference(input: unknown): BusyMessageModePreference {
  if (!isDynamicRecord(input) || !isBusyMessageMode(input.mode)) throw new Error("Busy message mode is required.");
  return { mode: input.mode };
}

export function parseAgentDefaults(input: unknown): AgentDefaults {
  if (!isAgentDefaults(input)) throw new Error("Agent defaults are required.");
  return {
    allowAutomation: input.allowAutomation,
    allowNewChat: input.allowNewChat,
    quickAcknowledgement: input.quickAcknowledgement,
    planStartAfterMs: input.planStartAfterMs,
    automationRunsPerHour: input.automationRunsPerHour,
    commitCoAuthor: input.commitCoAuthor,
  };
}

export function parseAgentMemoryLimitPreference(input: unknown): AgentMemoryLimitPreference {
  if (!isDynamicRecord(input) || !isAgentMemoryLimit(input.limit)) throw new Error("Agent memory limit is required.");
  return { limit: input.limit };
}

export function parseMemoryReviewPreference(input: unknown): MemoryReviewPreference {
  if (!isDynamicRecord(input) || !isMemoryReviewInterval(input.interval))
    throw new Error("Memory review interval is required.");
  return { interval: input.interval };
}

export function parseChatWindowTarget(input: unknown): ChatWindowTarget {
  if (!isDynamicRecord(input)) throw new Error("A chat is required.");
  return { serverId: requireString(input.serverId, "Server"), agentId: requireString(input.agentId, "Agent") };
}

export function parseExternalLinkPreference(input: unknown): ExternalLinkPreference {
  const target = isDynamicRecord(input) ? decodeExternalLinkTarget(input.target) : null;
  if (!target) throw new Error("The external link setting is required.");
  return { target };
}

export function parseAppLanguagePreference(input: unknown): SetAppLanguagePreferenceInput {
  if (!isDynamicRecord(input) || !isAppLanguage(input.language)) throw new Error("Language preference is required.");
  return { language: input.language };
}

export function parseAppLogoColorPreference(input: unknown): SetAppLogoColorPreferenceInput {
  if (!isDynamicRecord(input) || !isAppLogoColor(input.color)) throw new Error("Logo color is required.");
  return { color: input.color };
}

function parseChatBackground(value: unknown): ChatBackgroundColor | null {
  if (value !== null && !isChatBackgroundColor(value)) throw new Error("Chat background is invalid.");
  return value;
}

function parseFontFamily(value: unknown): AppFontFamily | null {
  if (value !== null && !isAppFontFamily(value)) throw new Error("Font is invalid.");
  return value;
}

export function parseAppAppearancePreference(input: unknown): SetAppAppearancePreferenceInput {
  if (!isDynamicRecord(input)) throw new Error("Appearance is required.");
  const { appearance, transparentWindow, palette, chatBackgroundLight, chatBackgroundDark, interfaceFont, codeFont } =
    input;
  if (appearance !== undefined && !isAppAppearance(appearance)) throw new Error("Appearance is invalid.");
  if (transparentWindow !== undefined && typeof transparentWindow !== "boolean")
    throw new Error("Transparent window must be true or false.");
  if (palette !== undefined && palette !== null && !isAppThemePaletteId(palette))
    throw new Error("Theme palette is invalid.");
  if (
    appearance === undefined &&
    transparentWindow === undefined &&
    palette === undefined &&
    chatBackgroundLight === undefined &&
    chatBackgroundDark === undefined &&
    interfaceFont === undefined &&
    codeFont === undefined
  )
    throw new Error("Appearance is required.");
  return {
    ...(appearance === undefined ? {} : { appearance }),
    ...(transparentWindow === undefined ? {} : { transparentWindow }),
    ...(palette === undefined ? {} : { palette }),
    ...(chatBackgroundLight === undefined ? {} : { chatBackgroundLight: parseChatBackground(chatBackgroundLight) }),
    ...(chatBackgroundDark === undefined ? {} : { chatBackgroundDark: parseChatBackground(chatBackgroundDark) }),
    ...(interfaceFont === undefined ? {} : { interfaceFont: parseFontFamily(interfaceFont) }),
    ...(codeFont === undefined ? {} : { codeFont: parseFontFamily(codeFont) }),
  };
}

export function parseAppInterfaceSizePreference(input: unknown): SetAppInterfaceSizePreferenceInput {
  if (!isDynamicRecord(input) || !isAppInterfaceSize(input.percent)) throw new Error("Interface size is required.");
  return { percent: input.percent };
}

export function parseIdleRestartTarget(input: unknown): IdleRestartTarget {
  if (!isOneOf(IDLE_RESTART_TARGETS, input)) throw new Error("A restart target is required.");
  return input;
}

const APP_BEHAVIOR_SWITCHES = ["launchAtLogin", "keepRunningInBackground", "keepAwake", "keepAwakeOnBattery"] as const;

export function parseAppBehaviorPreferenceChange(input: unknown): AppBehaviorPreferenceChange {
  const message = "The app behavior setting is required.";
  if (!isDynamicRecord(input)) throw new Error(message);
  const hasSwitch = APP_BEHAVIOR_SWITCHES.some((key) => input[key] !== undefined);
  const change: AppBehaviorPreferenceChange = hasSwitch ? parseSwitches(input, APP_BEHAVIOR_SWITCHES, message) : {};
  if (input.quitGuard !== undefined) {
    if (!isOneOf(QUIT_GUARDS, input.quitGuard)) throw new Error(message);
    change.quitGuard = input.quitGuard;
  }
  if (Object.keys(change).length === 0) throw new Error(message);
  return change;
}

export function parseUpdatePreference(input: unknown): UpdatePreferenceChange {
  return parseSwitches(input, ["autoDownload", "allowRemoteUpdates", "autoInstall"], "Update preference is required.");
}

export function parseHostUpdateSettings(input: unknown): HostUpdateSettingsChange {
  return parseSwitches(input, ["autoDownload", "autoInstall"], "Update settings are required.");
}

function parseSwitches<Key extends string>(
  input: unknown,
  keys: readonly Key[],
  message: string,
): Partial<Record<Key, boolean>> {
  if (!isDynamicRecord(input)) throw new Error(message);
  const change: Partial<Record<Key, boolean>> = {};
  for (const key of keys) {
    const value = input[key];
    if (value === undefined) continue;
    if (!isBoolean(value)) throw new Error(message);
    change[key] = value;
  }
  if (Object.keys(change).length === 0) throw new Error(message);
  return change;
}

export function parseNotificationPreference(input: unknown): NotificationPreference {
  if (!isDynamicRecord(input) || !isBoolean(input.desktopNotifications) || !isBoolean(input.messagePreview)) {
    throw new Error("Notification preference is required.");
  }
  return { desktopNotifications: input.desktopNotifications, messagePreview: input.messagePreview };
}

export function parseDynamicIslandPreference(input: unknown): DynamicIslandPreference {
  if (!isDynamicIslandPreference(input)) {
    throw new Error("Dynamic Island preference is required.");
  }
  return input;
}

export function parseDynamicIslandInteractive(input: unknown): SetDynamicIslandInteractiveInput {
  if (!isDynamicIslandInteractive(input)) {
    throw new Error("Dynamic Island interaction state is required.");
  }
  return input;
}

export function parseDynamicIslandPresentation(input: unknown): DynamicIslandPresentation {
  if (!isDynamicIslandPresentation(input)) throw new Error("Dynamic Island presentation is invalid.");
  return input;
}

export function parseDynamicIslandAction(input: unknown): DynamicIslandAction {
  if (isDynamicIslandAction(input)) return input;
  throw new Error("Dynamic Island action is invalid.");
}

export function parseBrowserTakeoverPage(input: unknown): BrowserTakeoverPage {
  if (isBrowserTakeoverPage(input)) return input;
  throw new Error("Browser takeover page is invalid.");
}

export function parseBrowserDockPresentation(input: unknown): BrowserDockPresentation | null {
  if (input === null || isBrowserDockPresentation(input)) return input;
  throw new Error("Browser dock presentation is invalid.");
}

export function parseBrowserDockAction(input: unknown): BrowserDockAction {
  if (isBrowserDockAction(input)) return input;
  throw new Error("Browser dock action is invalid.");
}

export function parseBrowserDockFrame(input: unknown): BrowserDockFrame {
  if (isBrowserDockFrame(input)) return input;
  throw new Error("Browser dock frame is invalid.");
}

export function parseAgentDockPresentation(input: unknown): AgentDockPresentation | null {
  if (input === null || isAgentDockPresentation(input)) return input;
  throw new Error("Agent dock presentation is invalid.");
}

export function parseAgentDockAction(input: unknown): AgentDockAction {
  if (isAgentDockAction(input)) return input;
  throw new Error("Agent dock action is invalid.");
}

export function parseAgentDockInteractive(input: unknown): SetAgentDockInteractiveInput {
  if (isAgentDockInteractive(input)) return input;
  throw new Error("Agent dock interaction state is required.");
}

export function parseAgentDockXWayland(input: unknown): SetAgentDockXWaylandInput {
  if (isAgentDockXWayland(input)) return input;
  throw new Error("Agent dock XWayland state is required.");
}

export function parseAgentDockInputRegion(input: unknown): AgentDockInputRect[] {
  if (isAgentDockInputRegion(input)) return input;
  throw new Error("Agent dock input region is invalid.");
}

export function parseAgentDockExtent(input: unknown): AgentDockExtent | null {
  if (isAgentDockExtent(input)) return input;
  throw new Error("Agent dock extent is invalid.");
}

export function parseDynamicIslandXWayland(input: unknown): SetAgentDockXWaylandInput {
  if (isAgentDockXWayland(input)) return input;
  throw new Error("Dynamic Island XWayland state is required.");
}

export function parseDynamicIslandInputRegion(input: unknown): AgentDockInputRect[] {
  if (isAgentDockInputRegion(input)) return input;
  throw new Error("Dynamic Island input region is invalid.");
}

export function parseAgentDockDragPhase(input: unknown): AgentDockDragPhase {
  if (isAgentDockDragPhase(input)) return input;
  throw new Error("Agent dock drag phase is invalid.");
}

export function parseMacPermission(input: unknown): MacPermissionId {
  if (input !== "screen-recording" && input !== "accessibility") {
    throw new Error("Unknown macOS permission.");
  }
  return input;
}

export function parseMacAutomationTargets(input: unknown): readonly MacAutomationTarget[] {
  if (!Array.isArray(input) || !input.every((target) => isOneOf(MAC_AUTOMATION_TARGETS, target))) {
    throw new Error("Unknown Apple app.");
  }
  return [...new Set(input)];
}

export function parseExternalDestination(input: unknown): ExternalDestination {
  if (
    input !== "claude-install" &&
    input !== "hermes-install" &&
    input !== "opencode-install" &&
    input !== "opencode-auth" &&
    input !== "grok-bot-export" &&
    input !== "mac-screen-recording"
  ) {
    throw new Error("Unknown external destination.");
  }
  return input;
}

export function parseProfileName(input: unknown): string {
  const validation = validateProfileName(requireString(input, "name", INPUT_LIMITS.accountName));
  if (validation.error) {
    throw new Error(`name must contain ${INPUT_LIMITS.profileNameMin} to ${INPUT_LIMITS.profileName} safe characters.`);
  }
  return validation.name;
}

export function parseChatColor(input: unknown): AvatarColor | null {
  if (input === null) return null;
  if (!isAvatarColor(input)) throw new Error("chatColor must be null or a lower-case #rrggbb color.");
  return input;
}

function requireSkillId(value: unknown): string {
  return requireString(value, "skillId", GITHUB_SKILL_ID_MAX_LENGTH);
}

export function parseInstallSkill(input: unknown): InstallSkillInput {
  if (!isObject(input)) throw new Error("Invalid skill installation.");
  return {
    agentId: requireString(input.agentId, "agentId"),
    skillId: requireSkillId(input.skillId),
    ...(input.versionId === undefined ? {} : { versionId: requireString(input.versionId, "versionId") }),
    ...(input.replaceModified === true ? { replaceModified: true } : {}),
  };
}

export function parseUninstallSkill(input: unknown): UninstallSkillInput {
  if (!isObject(input)) throw new Error("Invalid skill removal.");
  return {
    agentId: requireString(input.agentId, "agentId"),
    skillId: requireSkillId(input.skillId),
    ...(input.removeModified === true ? { removeModified: true } : {}),
  };
}

export function parseSetEnabledSkill(input: unknown): SetEnabledSkillInput {
  if (!isObject(input)) throw new Error("Invalid skill enablement.");
  const enabled = optionalBoolean(input.enabled, "enabled");
  if (enabled === undefined) throw new Error("Invalid skill enablement.");
  return {
    agentId: requireString(input.agentId, "agentId"),
    skillId: requireSkillId(input.skillId),
    enabled,
  };
}
