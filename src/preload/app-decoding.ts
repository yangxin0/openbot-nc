import {
  AGENT_DEFAULT_KEYS,
  type AgentDefaults,
  type AgentMemoryLimitPreference,
  type AppAppearancePreference,
  type AppBehaviorPreference,
  type AppFontFamily,
  type AppInfo,
  type AppInterfaceSizePreference,
  type AppLanguagePreference,
  type AppLogoColorPreference,
  type ApprovalAutomationPreference,
  type AppSetupState,
  type AppThemePalette,
  type BitwardenConnectorStatus,
  type BusyMessageModePreference,
  type ChatBackgroundColor,
  type ChatWindowTarget,
  CUSTOM_AGENT_LIMITS,
  type CustomAgentCheckResult,
  type CustomAgentResult,
  type CustomAgentSummary,
  type CustomAgentUsage,
  type CustomProviderResult,
  type CustomProviderSummary,
  DEFAULT_AGENT_DEFAULTS,
  type DetectedAcpAgent,
  type DetectedModelServer,
  type DiscoverModelsResult,
  decodeExternalLinkTarget,
  decodeScheduledUpdateRestart,
  type ExportResult,
  type ExternalLinkBrowser,
  type ExternalLinkBrowsers,
  type ExternalLinkFallback,
  type ExternalLinkPreference,
  IDLE_RESTART_TARGETS,
  type IdleRestart,
  isAgentMemoryLimit,
  isAgentModel,
  isAgentProvider,
  isAppAppearance,
  isAppFontFamily,
  isAppInterfaceSize,
  isAppLanguage,
  isAppLogoColor,
  isApprovalAutomationPreference,
  isAppThemePalette,
  isAppThemePaletteId,
  isAutomationRunsPerHour,
  isAvatarColor,
  isBusyMessageMode,
  isChatBackgroundColor,
  isCustomAgentCheckResult,
  isCustomAgentResult,
  isCustomAgentSummary,
  isCustomAgentUsage,
  isCustomProviderResult,
  isCustomProviderSummary,
  isDetectedAcpAgent,
  isDetectedModelServer,
  isDiscoverModelsResult,
  isElevenLabsSpeechVoice,
  isPlanStartAfterMs,
  isProviderDetectionSettings,
  isSpeechModelId,
  isSpeechSpeed,
  isSpeechVoice,
  isVoiceLanguage,
  isVoiceModelId,
  isVoiceServerProbe,
  isVoiceServerSettings,
  isVoiceTurnPause,
  isXaiSpeechVoice,
  type LinkAccountStatus,
  type NotificationOpenedEvent,
  type NotificationPreference,
  type OnePasswordConnectorStatus,
  type ProviderDetectionSettings,
  parseLinkAccountStatus,
  parseOnePasswordConnectorStatus,
  QUIT_GUARDS,
  type SentMessageStats,
  type SpeechAudio,
  type SpeechModelStatus,
  type SpeechSettings,
  UPDATE_PHASES,
  type UpdatePreference,
  type UpdateStatus,
  type UserProfile,
  type VoiceModelStatus,
  type VoiceServerProbe,
  type VoiceServerSettings,
  type VoiceSettings,
  type VoiceSettingsState,
  type VoiceStream,
  type VoiceStreamTranscript,
  type VoiceTranscriptionResult,
  type WorkflowNotificationOpenedEvent,
} from "@openbot/contracts/ipc";
import {
  decodeList,
  decodeRecord,
  emptyDecoder,
  guardedDecoder,
  nullableBoolean,
  nullableNumber,
  nullableString,
  requiredBoolean,
  requiredNumber,
  requiredString,
} from "@openbot/contracts/ipc-decoding";
import { isPluginSlug } from "@openbot/contracts/plugin-links";
import { type DynamicRecord, isBoolean, isNumber, isOneOf, isString } from "@openbot/contracts/runtime-values";

export function decodeAppInfo(value: unknown): AppInfo {
  const info = decodeRecord(value, "app info");
  const { platform, variant, softwareRendering, hourCycle, aboveAppsSupport, dynamicIslandUnavailable } = info;
  if (!isOneOf(["darwin", "win32", "linux"] as const, platform)) throw new Error("Invalid platform.");
  if (!isOneOf(["production", "dev", "preview"] as const, variant)) throw new Error("Invalid variant.");
  if (softwareRendering !== undefined && !isBoolean(softwareRendering))
    throw new Error("Invalid software rendering flag.");
  if (hourCycle !== undefined && !isOneOf(["h12", "h23"] as const, hourCycle)) throw new Error("Invalid hour cycle.");
  if (
    aboveAppsSupport !== undefined &&
    !isOneOf(["restart", "unsupported", "no-compositor"] as const, aboveAppsSupport)
  )
    throw new Error("Invalid agent dock screen support.");
  if (dynamicIslandUnavailable !== undefined && !isBoolean(dynamicIslandUnavailable))
    throw new Error("Invalid Dynamic Island availability.");
  return {
    name: requiredString(info, "name"),
    version: requiredString(info, "version"),
    platform,
    variant,
    ...(softwareRendering === undefined ? {} : { softwareRendering }),
    ...(hourCycle === undefined ? {} : { hourCycle }),
    ...(aboveAppsSupport === undefined ? {} : { aboveAppsSupport }),
    ...(dynamicIslandUnavailable === undefined ? {} : { dynamicIslandUnavailable }),
  };
}

export function decodeSentMessageStats(value: unknown): SentMessageStats {
  const stats = decodeRecord(value, "sent message stats");
  const sentCount = requiredNumber(stats, "sentCount");
  if (!Number.isSafeInteger(sentCount) || sentCount < 0) throw new Error("Invalid sentCount.");
  return { firstSentAt: nullableString(stats, "firstSentAt"), sentCount };
}

export function decodeAppSetupState(value: unknown): AppSetupState {
  const state = decodeRecord(value, "setup state");
  const { preferredProvider, preferredModel } = state;
  if (preferredProvider !== null && !isAgentProvider(preferredProvider)) throw new Error("Invalid preferredProvider.");
  if (preferredModel !== null && !isAgentModel(preferredModel)) throw new Error("Invalid preferredModel.");
  return { completed: requiredBoolean(state, "completed"), preferredProvider, preferredModel };
}

export const decodeApprovalAutomationPreference: (value: unknown) => ApprovalAutomationPreference = guardedDecoder(
  isApprovalAutomationPreference,
  "approval automation preference",
);

export function decodeBusyMessageModePreference(value: unknown): BusyMessageModePreference {
  const preference = decodeRecord(value, "busy message mode preference");
  if (!isBusyMessageMode(preference.mode)) throw new Error("Invalid busy message mode.");
  return { mode: preference.mode };
}

export function decodeAgentDefaults(value: unknown): AgentDefaults {
  const defaults = decodeRecord(value, "agent defaults");
  const decoded = { ...DEFAULT_AGENT_DEFAULTS };
  for (const key of AGENT_DEFAULT_KEYS) decoded[key] = requiredBoolean(defaults, key);
  if (!isPlanStartAfterMs(defaults.planStartAfterMs)) throw new Error("Invalid plan start time.");
  decoded.planStartAfterMs = defaults.planStartAfterMs;
  if (!isAutomationRunsPerHour(defaults.automationRunsPerHour)) throw new Error("Invalid local script limit.");
  decoded.automationRunsPerHour = defaults.automationRunsPerHour;
  decoded.commitCoAuthor = requiredBoolean(defaults, "commitCoAuthor");
  return decoded;
}

export function decodeAgentMemoryLimitPreference(value: unknown): AgentMemoryLimitPreference {
  const preference = decodeRecord(value, "agent memory limit preference");
  if (!isAgentMemoryLimit(preference.limit)) throw new Error("Invalid agent memory limit.");
  return { limit: preference.limit };
}

export function decodeAppLanguagePreference(value: unknown): AppLanguagePreference {
  const preference = decodeRecord(value, "language preference");
  if (!isAppLanguage(preference.language)) throw new Error("Invalid language.");
  return { language: preference.language };
}

export function decodeAppLogoColorPreference(value: unknown): AppLogoColorPreference {
  const preference = decodeRecord(value, "logo color preference");
  if (!isAppLogoColor(preference.color)) throw new Error("Invalid logo color.");
  return { color: preference.color };
}

function decodeThemePalette(palette: DynamicRecord): AppThemePalette {
  if (!isAppThemePalette(palette)) throw new Error("Invalid theme palette.");
  return { id: palette.id, name: palette.name, scheme: palette.scheme, colors: { ...palette.colors } };
}

function decodeChatBackground(value: unknown): ChatBackgroundColor | null {
  if (value !== null && !isChatBackgroundColor(value)) throw new Error("Invalid chat background.");
  return value;
}

function decodeFontFamily(value: unknown): AppFontFamily | null {
  if (value !== null && !isAppFontFamily(value)) throw new Error("Invalid font.");
  return value;
}

export function decodeInstalledFonts(value: unknown): AppFontFamily[] {
  if (!Array.isArray(value) || !value.every(isAppFontFamily)) throw new Error("Invalid installed fonts.");
  return [...value];
}

export function decodeAppAppearancePreference(value: unknown): AppAppearancePreference {
  const preference = decodeRecord(value, "appearance preference");
  if (!isAppAppearance(preference.appearance)) throw new Error("Invalid appearance.");
  if (typeof preference.transparentWindow !== "boolean") throw new Error("Invalid transparent window.");
  if (preference.palette !== null && !isAppThemePaletteId(preference.palette))
    throw new Error("Invalid theme palette.");
  const palettes = decodeList(preference.palettes, "theme palettes", decodeThemePalette);
  return {
    appearance: preference.appearance,
    transparentWindow: preference.transparentWindow,
    palette: preference.palette,
    palettes,
    chatBackgroundLight: decodeChatBackground(preference.chatBackgroundLight),
    chatBackgroundDark: decodeChatBackground(preference.chatBackgroundDark),
    interfaceFont: decodeFontFamily(preference.interfaceFont),
    codeFont: decodeFontFamily(preference.codeFont),
  };
}

export function decodeAppInterfaceSizePreference(value: unknown): AppInterfaceSizePreference {
  const preference = decodeRecord(value, "interface size preference");
  if (!isAppInterfaceSize(preference.percent)) throw new Error("Invalid interface size.");
  return { percent: preference.percent };
}

export function decodeChatWindowTargets(value: unknown): ChatWindowTarget[] {
  if (!Array.isArray(value)) throw new Error("Invalid chat windows.");
  return value.map((item) => {
    const target = decodeRecord(item, "chat window");
    if (!isString(target.serverId) || !isString(target.agentId)) throw new Error("Invalid chat window.");
    return { serverId: target.serverId, agentId: target.agentId };
  });
}

export function decodeUserProfile(value: unknown): UserProfile {
  const profile = decodeRecord(value, "profile");
  const { chatColor } = profile;
  if (chatColor !== null && !isAvatarColor(chatColor)) throw new Error("Invalid chatColor.");
  return { id: requiredString(profile, "id"), name: nullableString(profile, "name"), chatColor };
}

export function decodeUpdateStatus(value: unknown): UpdateStatus {
  const status = decodeRecord(value, "update status");
  const { phase, errorCode, managedByHost, scheduledRestart, idleRestart, stagedVersion, requiredVersion } = status;
  if (!isOneOf(UPDATE_PHASES, phase)) throw new Error("Invalid phase.");
  if (errorCode !== null && !isOneOf(["check_failed", "download_failed", "install_failed"] as const, errorCode)) {
    throw new Error("Invalid errorCode.");
  }
  if (managedByHost !== undefined && !isBoolean(managedByHost)) throw new Error("Invalid managedByHost.");
  if (stagedVersion !== undefined && !isString(stagedVersion)) throw new Error("Invalid stagedVersion.");
  if (requiredVersion !== undefined && !isString(requiredVersion)) throw new Error("Invalid requiredVersion.");
  return {
    phase,
    currentVersion: requiredString(status, "currentVersion"),
    availableVersion: nullableString(status, "availableVersion"),
    progress: nullableNumber(status, "progress"),
    checkedAt: nullableString(status, "checkedAt"),
    message: nullableString(status, "message"),
    errorCode,
    ...(managedByHost === undefined ? {} : { managedByHost }),
    ...(scheduledRestart === undefined ? {} : { scheduledRestart: decodeScheduledUpdateRestart(scheduledRestart) }),
    ...(idleRestart === undefined ? {} : { idleRestart: decodeIdleRestart(idleRestart) }),
    ...(stagedVersion === undefined ? {} : { stagedVersion }),
    ...(requiredVersion === undefined ? {} : { requiredVersion }),
  };
}

function decodeIdleRestart(value: unknown): IdleRestart {
  const restart = decodeRecord(value, "idle restart");
  const { target, waitingFor, error } = restart;
  if (!isOneOf(IDLE_RESTART_TARGETS, target)) throw new Error("Invalid target.");
  if (!Array.isArray(waitingFor) || !waitingFor.every(isString)) throw new Error("Invalid waitingFor.");
  if (error !== undefined && !isString(error)) throw new Error("Invalid error.");
  return { target, waitingFor: [...waitingFor], ...(error === undefined ? {} : { error }) };
}

export function decodeUpdatePreference(value: unknown): UpdatePreference {
  const preference = decodeRecord(value, "update preference");
  return {
    autoDownload: requiredBoolean(preference, "autoDownload"),
    allowRemoteUpdates: requiredBoolean(preference, "allowRemoteUpdates"),
    autoInstall: requiredBoolean(preference, "autoInstall"),
  };
}

export function decodeAppBehaviorPreference(value: unknown): AppBehaviorPreference {
  const preference = decodeRecord(value, "app behavior preference");
  return {
    launchAtLogin: nullableBoolean(preference, "launchAtLogin"),
    keepRunningInBackground: nullableBoolean(preference, "keepRunningInBackground"),
    keepAwake: nullableBoolean(preference, "keepAwake"),
    keepAwakeOnBattery: nullableBoolean(preference, "keepAwakeOnBattery"),
    quitGuard: decodeQuitGuard(preference.quitGuard),
  };
}

function decodeQuitGuard(value: unknown): AppBehaviorPreference["quitGuard"] {
  if (value === null) return null;
  if (!isOneOf(QUIT_GUARDS, value)) throw new Error("Invalid quitGuard.");
  return value;
}

export function decodeExternalLinkPreference(value: unknown): ExternalLinkPreference {
  const target = decodeExternalLinkTarget(decodeRecord(value, "external link preference").target);
  if (!target) throw new Error("Invalid external link target.");
  return { target };
}

function decodeExternalLinkBrowser(value: unknown): ExternalLinkBrowser {
  const browser = decodeRecord(value, "browser");
  return { name: requiredString(browser, "name"), path: requiredString(browser, "path") };
}

export function decodeExternalLinkBrowserOrNull(value: unknown): ExternalLinkBrowser | null {
  return value === null ? null : decodeExternalLinkBrowser(value);
}

export function decodeExternalLinkBrowsers(value: unknown): ExternalLinkBrowsers {
  const list = decodeRecord(value, "browser list");
  if (!Array.isArray(list.browsers)) throw new Error("Invalid browser list.");
  return {
    defaultBrowser: decodeExternalLinkBrowserOrNull(list.defaultBrowser),
    browsers: list.browsers.map(decodeExternalLinkBrowser),
  };
}

export function decodeExternalLinkFallback(value: unknown): ExternalLinkFallback {
  return { name: requiredString(decodeRecord(value, "external link fallback"), "name") };
}

export function decodeNotificationPreference(value: unknown): NotificationPreference {
  const preference = decodeRecord(value, "notification preference");
  return {
    desktopNotifications: requiredBoolean(preference, "desktopNotifications"),
    messagePreview: requiredBoolean(preference, "messagePreview"),
  };
}

export function decodeNotificationOpenedEvent(value: unknown): NotificationOpenedEvent {
  const opened = decodeRecord(value, "opened notification");
  return {
    serverId: requiredString(opened, "serverId"),
    agentId: requiredString(opened, "agentId"),
    threadId: nullableString(opened, "threadId"),
    ...(opened.channelId === undefined ? {} : { channelId: requiredString(opened, "channelId") }),
  };
}

export function decodeWorkflowNotificationOpenedEvent(value: unknown): WorkflowNotificationOpenedEvent {
  const opened = decodeRecord(value, "opened workflow notification");
  return { serverId: requiredString(opened, "serverId"), workflowId: requiredString(opened, "workflowId") };
}

const VOICE_MODEL_PHASES: readonly VoiceModelStatus["phase"][] = ["missing", "downloading", "ready", "error"];

export function decodeVoiceModelStatus(value: unknown): VoiceModelStatus {
  const status = decodeRecord(value, "voice model status");
  const { modelId, phase, progress } = status;
  if (!isVoiceModelId(modelId) || !isOneOf(VOICE_MODEL_PHASES, phase) || (progress !== null && !isNumber(progress))) {
    throw new Error("Invalid voice model status.");
  }
  return { modelId, phase, progress, message: nullableString(status, "message") };
}

export function decodeVoiceModelStatuses(value: unknown): VoiceModelStatus[] {
  return decodeList(value, "voice model status list", decodeVoiceModelStatus);
}

export function decodeVoiceSettings(value: unknown): VoiceSettings {
  const { modelId, language } = decodeRecord(value, "voice settings");
  if (!isVoiceModelId(modelId) || !isVoiceLanguage(language)) throw new Error("Invalid voice settings.");
  return { modelId, language };
}

export function decodeVoiceSettingsState(value: unknown): VoiceSettingsState {
  return { ...decodeVoiceSettings(value), saved: requiredBoolean(decodeRecord(value, "voice settings"), "saved") };
}

export function decodeVoiceTranscriptionResult(value: unknown): VoiceTranscriptionResult {
  return { text: requiredString(decodeRecord(value, "voice transcription"), "text") };
}

export function decodeVoiceStream(value: unknown): VoiceStream {
  return { streamId: requiredString(decodeRecord(value, "voice stream"), "streamId") };
}

export function decodeVoiceStreamTranscript(value: unknown): VoiceStreamTranscript {
  const transcript = decodeRecord(value, "voice stream transcript");
  return { streamId: requiredString(transcript, "streamId"), text: requiredString(transcript, "text") };
}

export function decodeSpeechModelStatus(value: unknown): SpeechModelStatus {
  const status = decodeRecord(value, "speech model status");
  const { modelId, phase, progress } = status;
  if (!isSpeechModelId(modelId) || !isOneOf(VOICE_MODEL_PHASES, phase) || (progress !== null && !isNumber(progress))) {
    throw new Error("Invalid speech model status.");
  }
  return { modelId, phase, progress, message: nullableString(status, "message") };
}

export function decodeSpeechSettings(value: unknown): SpeechSettings {
  const settings = decodeRecord(value, "speech settings");
  const { modelId, voice, elevenLabsVoice, xaiVoice, speed, turnPauseMs } = settings;
  if (
    !isSpeechModelId(modelId) ||
    !isSpeechVoice(voice) ||
    !isElevenLabsSpeechVoice(elevenLabsVoice) ||
    !isXaiSpeechVoice(xaiVoice) ||
    !isSpeechSpeed(speed) ||
    !isVoiceTurnPause(turnPauseMs)
  )
    throw new Error("Invalid speech settings.");
  return {
    readReplies: requiredBoolean(settings, "readReplies"),
    modelId,
    voice,
    elevenLabsVoice,
    xaiVoice,
    speed,
    turnPauseMs,
  };
}

export function decodeSpeechAudio(value: unknown): SpeechAudio {
  const audio = decodeRecord(value, "speech audio");
  const { pcm, sampleRate } = audio;
  if (!(pcm instanceof Uint8Array) || pcm.byteLength % 2 !== 0 || !isNumber(sampleRate) || sampleRate <= 0) {
    throw new Error("Invalid speech audio.");
  }
  return { pcm, sampleRate };
}

export function decodeVoiceServerSettings(value: unknown): VoiceServerSettings | null {
  if (value === null) return null;
  if (!isVoiceServerSettings(value)) throw new Error("Invalid voice server settings.");
  const { address, hasApiKey, routes } = value;
  const { dictation, speech, transcriptionModel, speechModel, voice } = routes;
  return { address, hasApiKey, routes: { dictation, speech, transcriptionModel, speechModel, voice } };
}

export function decodeVoiceServerProbe(value: unknown): VoiceServerProbe {
  if (!isVoiceServerProbe(value)) throw new Error("Invalid voice server test result.");
  if (!value.ok) return { ok: false, field: value.field, message: value.message };
  const { transcription, speech, voices } = value.models;
  return { ok: true, models: { transcription: [...transcription], speech: [...speech], voices: [...voices] } };
}

export function decodeExportResult(value: unknown): ExportResult {
  return { saved: requiredBoolean(decodeRecord(value, "export result"), "saved") };
}

export function decodePendingListing(value: unknown): string | null {
  return typeof value === "string" && isPluginSlug(value) ? value : null;
}

export function decodeAgentImportSkill(value: unknown): string {
  if (!isString(value) || !value) throw new Error("Invalid export skill response.");
  return value;
}

export const decodeVoid = emptyDecoder("IPC returned unexpected data.");

export function decodeLinkAccountStatus(value: unknown): LinkAccountStatus {
  const status = parseLinkAccountStatus(value);
  if (!status) throw new Error("Invalid Link account response.");
  return status;
}

export function decodeOnePasswordConnectorStatus(value: unknown): OnePasswordConnectorStatus {
  const status = parseOnePasswordConnectorStatus(value);
  if (!status) throw new Error("Invalid 1Password connector response.");
  return status;
}

export function decodeCustomProviders(value: unknown): CustomProviderSummary[] {
  if (!Array.isArray(value) || !value.every(isCustomProviderSummary)) {
    throw new Error("Invalid custom provider list response.");
  }
  return value;
}

export function decodeCustomProviderResult(value: unknown): CustomProviderResult {
  if (!isCustomProviderResult(value)) throw new Error("Invalid custom provider response.");
  return value;
}

export function decodeDetectedModelServers(value: unknown): DetectedModelServer[] {
  if (!Array.isArray(value) || !value.every(isDetectedModelServer)) {
    throw new Error("Invalid model server list response.");
  }
  return value;
}

export function decodeDetectedAcpAgents(value: unknown): DetectedAcpAgent[] {
  if (!Array.isArray(value) || !value.every(isDetectedAcpAgent)) {
    throw new Error("Invalid agent list response.");
  }
  return value;
}

export function decodeCustomAgents(value: unknown): CustomAgentSummary[] {
  if (!Array.isArray(value) || !value.every(isCustomAgentSummary)) {
    throw new Error("Invalid custom agent list response.");
  }
  return value;
}

export function decodeCustomAgentResult(value: unknown): CustomAgentResult {
  if (!isCustomAgentResult(value)) throw new Error("Invalid custom agent response.");
  return value;
}

export function decodeCustomAgentUsage(value: unknown): CustomAgentUsage[] {
  if (!Array.isArray(value) || value.length > CUSTOM_AGENT_LIMITS.agents || !value.every(isCustomAgentUsage)) {
    throw new Error("Invalid custom agent usage response.");
  }
  return value;
}

export function decodeCustomAgentCheckResult(value: unknown): CustomAgentCheckResult {
  if (!isCustomAgentCheckResult(value)) throw new Error("Invalid agent check response.");
  return value;
}

export function decodeDiscoverModelsResult(value: unknown): DiscoverModelsResult {
  if (!isDiscoverModelsResult(value)) throw new Error("Invalid model list response.");
  return value;
}

export function decodeProviderDetectionSettings(value: unknown): ProviderDetectionSettings {
  if (!isProviderDetectionSettings(value)) throw new Error("Invalid detection settings response.");
  return value;
}

export function decodeBitwardenConnectorStatus(value: unknown): BitwardenConnectorStatus {
  if (
    !value ||
    typeof value !== "object" ||
    !("connected" in value) ||
    !isBoolean(value.connected) ||
    !("connecting" in value) ||
    !isBoolean(value.connecting) ||
    !("serverUrl" in value) ||
    !(value.serverUrl === null || isString(value.serverUrl)) ||
    !("error" in value) ||
    !(value.error === null || isString(value.error))
  )
    throw new Error("Invalid Bitwarden connector response.");
  return { connected: value.connected, connecting: value.connecting, serverUrl: value.serverUrl, error: value.error };
}
