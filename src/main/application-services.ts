import { existsSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import { homedir, hostname, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isManagedRuntimeProvider } from "@openbot/contracts/agent-providers";
import { APP_HOME_FOLDER, APP_ID, APP_LINK_SCHEME } from "@openbot/contracts/app-identity";
import { leadingAddress } from "@openbot/contracts/chat-tag-references";
import type {
  AgentStatus,
  AppVariant,
  BrowserDisplayState,
  CapabilityState,
  ComputerUseState,
  HostVoiceModelChange,
  ProviderRuntimeSnapshot,
  SpeechModelStatus,
  VoiceModelStatus,
  VoiceServerSettings,
  VoiceStreamTranscript,
} from "@openbot/contracts/ipc";
import {
  agentBrowserProfile,
  agentMemoryEnabled,
  type ChannelCommand,
  DEFAULT_APP_LANGUAGE,
  DEFAULT_DYNAMIC_ISLAND_PREFERENCE,
  decodeChannel,
  defaultVoiceSettings,
  IPC_ENDPOINTS,
  isGroqVoiceModelId,
  isLocalVoiceModelId,
  isManagedToolRuntime,
  isUpdateBusyPhase,
  LOCAL_SERVER_ID,
  latestTurnAnswer,
} from "@openbot/contracts/ipc";
import { isValidSemver } from "@openbot/contracts/release-version";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import { localeDirection } from "@openbot/i18n";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, redactSecrets, toLogValue } from "@openbot/logging";
import { installRemoteSyncProfileSink } from "@openbot/team-client/sync-profile";
import { makeWASocket } from "@openbot/whatsapp/baileys";
import { makeOpenBotSignalRepository } from "@openbot/whatsapp/signal-repository";
import { Effect, Fiber, Schema } from "effect";
import {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  Menu,
  Notification,
  nativeImage,
  net,
  powerSaveBlocker,
  screen,
  shell,
  systemPreferences,
  webContents,
} from "electron";
import { toAgentRemovalFailed } from "../backend/agent/agent-removal";
import { pasteCodeLoginSupported } from "../backend/agent/cli-code-login";
import { ProviderAccountStore } from "../backend/agent/provider-account-store";
import { AgentApiKeys } from "../backend/agent-api-keys";
import { AgentDatabaseSupervisor } from "../backend/agent-data/agent-database-supervisor";
import { AgentTables } from "../backend/agent-data/agent-tables";
import { AgentMemoryStore } from "../backend/agent-memory-store";
import { AgentRoutineStore } from "../backend/agent-routine-store";
import { AgentLifecycleFailed, AgentService } from "../backend/agent-service";
import { AgentStore } from "../backend/agent-store";
import { AgentThreadStore } from "../backend/agent-threads/agent-thread-store";
import { type BrowserAgentChat, BrowserHost } from "../backend/browser-host";
import { BrowserProfileStore } from "../backend/browser-profiles/browser-profile-store";
import { BrowserProxyStore } from "../backend/browser-profiles/browser-proxy-store";
import { type CrmHandle, createCrm } from "../backend/crm/crm";
import { CrmError } from "../backend/crm/crm-handle";
import { stripeSource } from "../backend/crm/crm-stripe";
import { diskRestoreEnded, diskRestoring } from "../backend/disk-restore";
import { runCauseEffect } from "../backend/effect-boundary";
import { LIBRARY_FOLDERS_FILE, LibraryFoldersStore } from "../backend/library-folders-store";
import { MailboxStore } from "../backend/mailbox-store";
import { McpOAuth } from "../backend/mcp-oauth-provider";
import { MessagingService } from "../backend/messaging/messaging-service";
import { whatsAppDriver } from "../backend/messaging/whatsapp/whatsapp-driver";
import { WhatsAppRuntime } from "../backend/messaging/whatsapp/whatsapp-runtime";
import { OpenBotDatabase } from "../backend/openbot-database";
import { PASSWORD_MANAGER_BRANDS } from "../backend/password-vault";
import { passwordVaultRouter } from "../backend/password-vault-router";
import { perfTime } from "../backend/perf-probe-hooks";
import { sweepProviderTemp } from "../backend/provider-temp";
import { routineFlowRoutines } from "../backend/routine-flows/routine-flow-routines";
import { RoutineFlowStore } from "../backend/routine-flows/routine-flow-store";
import { createRoutineFlows, routineFlowNoticeEvent } from "../backend/routine-flows/routine-flows";
import { RoutineResultStore } from "../backend/routine-results/routine-result-store";
import {
  createRoutineResults,
  type RoutineResultsHandle,
  routineResultNoticeEvent,
} from "../backend/routine-results/routine-results";
import { SidebarLayoutStore } from "../backend/sidebar-layout-store";
import { StorageUsageScanner, StorageUsageService } from "../backend/storage-usage";
import { TeamChatStore } from "../backend/team-chat-store";
import { UserBrowsingLog } from "../backend/user-browsing-log";
import { WORKFLOW_FOLDERS_FILE, WorkflowFoldersStore } from "../backend/workflow-folders-store";
import { clearFlatBackground } from "../backend/workflows/flat-background";
import { workflowFileOwners } from "../backend/workflows/workflow-file-owners";
import { WorkflowGitHubStore } from "../backend/workflows/workflow-github-store";
import { WorkflowRunStore } from "../backend/workflows/workflow-run-store";
import { WorkflowStore } from "../backend/workflows/workflow-store";
import { WorkflowTriggers, workflowScheduleDueAt } from "../backend/workflows/workflow-triggers";
import {
  createWorkflows,
  type WorkflowNotice,
  type WorkflowsHandle,
  workflowNoticeEvent,
} from "../backend/workflows/workflows";
import { type AcpRegistry, createAcpRegistry } from "./acp-registry";
import { AGENT_ACCESS_FILE, AgentAccessStore } from "./agent-access-store";
import { type AgentAdminSettingsService, createAgentAdminSettings } from "./agent-admin-settings";
import { checkDatabaseIntegrityInHost, spawnAgentDatabaseHost } from "./agent-database-host-process";
import {
  type AgentDefaultsPreferenceStore,
  createAgentDefaultsPreferenceStore,
} from "./agent-defaults-preference-store";
import { type AgentDefaultsSettingsService, createAgentDefaultsSettings } from "./agent-defaults-settings";
import { agentDisplayEnvironment, hasSeparateAgentDisplay } from "./agent-display";
import { AgentDockFailed, AgentDockWindowController, toAgentDockFailed } from "./agent-dock-window";
import { type AgentFolders, createAgentFolders } from "./agent-folders";
import { type AgentHostSettingsService, createAgentHostSettings } from "./agent-host-settings";
import { compactScreenshot, fitImageForAgent } from "./agent-image-fit";
import { AgentImportService } from "./agent-import-service";
import { AgentInitializationGate } from "./agent-initialization";
import { type AgentInstructionsFiles, createAgentInstructionsFiles } from "./agent-instructions-files";
import {
  AgentMemoryLimitPreferenceStore,
  type AgentMemoryLimitSetting,
  reloadingAgentMemoryLimit,
} from "./agent-memory-limit-preference-store";
import { AgentNotificationLevelStore, OWNER_NOTIFICATION_KEY } from "./agent-notification-level-store";
import { catalogPluginSlug, loadCatalogPluginServers } from "./analytics-plugin-catalog";
import { AppBehaviorService } from "./app-behavior-service";
import { AppearanceService } from "./appearance-service";
import { ApprovalAutomation, readApprovalAutomation } from "./approval-automation-store";
import { AttachmentPreviews } from "./attachment-previews";
import { AutomationServer } from "./automation-server";
import { listBackgroundProcesses, stopBackgroundProcess } from "./background-processes";
import { managedBitwardenCli } from "./bitwarden-cli-installer";
import { BitwardenConnectorService } from "./bitwarden-connector-service";
import { BitwardenConnectorStore } from "./bitwarden-connector-store";
import { BrowserDockOverlay } from "./browser-dock-overlay";
import { BrowserEgressClient } from "./browser-egress-client";
import { BrowserEgressHost } from "./browser-egress-host";
import { BrowserPictureInPicture } from "./browser-picture-in-picture";
import {
  type BrowserProfileService,
  browserProxyConnection,
  createBrowserProfileService,
} from "./browser-profile-service";
import { BrowserViewClient } from "./browser-view-client";
import { BrowsingMemoryPreferenceStore } from "./browsing-memory-preference-store";
import { BusyMessageModePreferenceStore } from "./busy-message-mode-preference-store";
import {
  type CacheExpiryCompactionControl,
  cacheExpiryCompactionControl,
  createCacheExpiryCompactionPreferenceStore,
} from "./cache-expiry-compaction-preference-store";
import { type ChannelFolders, createChannelFolders } from "./channel-folders";
import { ChatVisualPreviewer } from "./chat-visual-preview";
import {
  type ClaudeCompactWindowControl,
  claudeCompactWindowControl,
  createClaudeCompactWindowPreferenceStore,
} from "./claude-compact-window-preference-store";
import {
  type ClaudeUserSetupControl,
  claudeUserSetupControl,
  createClaudeUserSetupPreferenceStore,
} from "./claude-user-setup-preference-store";
import { ClientBrowserHub } from "./client-browser-hub";
import { createComputerIdle } from "./computer-idle";
import { ComputerUseDisplayAwake } from "./computer-use-display-awake";
import { ComputerUseHighlightController } from "./computer-use-highlight-window";
import { applicationBundlePath, applicationIconName } from "./computer-use-permission-app";
import { ComputerUsePermissionHelpWindowController } from "./computer-use-permission-help-window";
import {
  COMPUTER_USE_ACTION_MAX_AGE_MS,
  COMPUTER_USE_CURSOR_MAX_AGE_MS,
  chooseTarget,
  liveSession,
  pointerOnDesktop,
} from "./computer-use-target-window";
import { createCrmPreferenceStore, crmSettingsStore } from "./crm-preference-store";
import { CuaDriverActionTap } from "./cua-driver-action-tap";
import { isSupportedCuaDriverTarget, resolveCuaDriver } from "./cua-driver-artifact";
import { CuaDriverDaemonClient } from "./cua-driver-daemon-client";
import {
  CuaDriverRuntime,
  cuaDriverCommandAlias,
  cuaDriverDrivesWayland,
  resolveCuaDriverEndpoint,
} from "./cua-driver-runtime";
import { type CustomAgentChanges, createCustomAgentChanges } from "./custom-agent-changes";
import { CUSTOM_AGENTS_FILE, CustomAgentStore } from "./custom-agent-store";
import { type CustomProviderChanges, createCustomProviderChanges } from "./custom-provider-changes";
import { CustomProviderStore } from "./custom-provider-store";
import { MCP_OAUTH_REDIRECT_URL } from "./deep-link-router";
import { DetachedBrowserWindow } from "./detached-browser-window";
import {
  applyDevelopmentRemoteProfile,
  type DevelopmentRemoteRole,
  readDevelopmentClientTransport,
  startDevelopmentRemoteRole,
} from "./development-remote-bootstrap";
import { performDynamicIslandCriticalAction } from "./dynamic-island-actions";
import { DynamicIslandFailed, DynamicIslandWindowController, toDynamicIslandFailed } from "./dynamic-island-window";
import {
  createExternalLinkPreferenceStore,
  ExternalLinkOpener,
  type ExternalLinkPreferenceStore,
} from "./external-link-opener";
import { githubSkillSource } from "./github-skill-source";
import { hermesRoot } from "./hermes-import-reader";
import { HermesImportService } from "./hermes-import-service";
import { HermesInstaller } from "./hermes-installer";
import { agentWebhookRoutineWriter, HostEventsService, hostAgentWebhookKeys } from "./host-events-service";
import { HostService } from "./host-service";
import { HostSignalHomeService, SIGNAL_HOME_PREFERENCE_FILE } from "./host-signal-home";
import { HostTurnLimitsPreferenceStore } from "./host-turn-limits-preference-store";
import { HostUpdateCoordinator } from "./host-update-coordinator";
import { HostVoiceModelService } from "./host-voice-model";
import { HostedServerStartRetry } from "./hosted-server-start-retry";
import {
  CONTAINER_UPDATE_PATHS,
  CONTAINER_UPDATE_TRIGGER,
  HOSTED_UPDATE_TRIGGER,
  HostedUpdateAdapter,
  readInstallationMode,
} from "./hosted-update-adapter";
import { IdleRestart } from "./idle-restart";
import { InstanceTransferService } from "./instance-transfer-service";
import { InterfaceSizeService } from "./interface-size-service";
import { prepareToolRuntimeForTest } from "./ipc/mcp-server-handlers";
import { LanguageService } from "./language-service";
import { LibraryFoldersService } from "./library-folders-service";
import { LinkAccountService } from "./link-account-service";
import { LinkAccountStore } from "./link-account-store";
import { relaunchApp } from "./linux-appimage-relaunch";
import {
  aboveAppsWindowKind,
  ozonePlatformArguments,
  setAboveAppsXWayland,
  usesX11Windows,
} from "./linux-wayland-output";
import { LOCAL_PROFILE_FILE, type LocalProfileStore, openLocalProfileStore } from "./local-profile-store";
import { localRoutineFeedDocument } from "./local-routine-calendar";
import {
  type LocalServerChildEnvironment,
  reportLocalServerWorkingAgents,
  startLocalServerChild,
} from "./local-server-child";
import { LOCAL_SERVERS_FILE } from "./local-servers/local-server-registry";
import { LocalServers, sandboxArguments } from "./local-servers/local-servers";
import { LocalSignInWindows } from "./local-sign-in-window";
import { localSkillLearner } from "./local-skill-learner";
import { LocalSkillLibrary } from "./local-skill-library";
import { localSkillTools } from "./local-skill-tools";
import { createLoginItem } from "./login-item";
import { LogoColorService } from "./logo-color-service";
import type { MacHapticFeedback } from "./mac-haptic-feedback";
import { restartFromInstalledCopy } from "./mac-installed-copy";
import { hidePanelFromWindowSwitchers } from "./mac-panel-activation";
import { MACHINE_ALERTS_PREFERENCE_FILE, MachineAlertMonitor, MachineAlertPreferenceStore } from "./machine-alerts";
import { MachineMetricsSampler } from "./machine-metrics";
import {
  computerUseCoveringWindowIds,
  computerUseDesktopPoint,
  computerUseDesktopRect,
  computerUseDisplays,
  createAgentDockWindow,
  createComputerUseHighlightWindow,
  createComputerUsePermissionHelpWindow,
  createDynamicIslandWindow,
  loadAgentDockRenderer,
  loadBrowserDockRenderer,
  loadComputerUseHighlightRenderer,
  loadComputerUsePermissionHelpRenderer,
  loadDynamicIslandRenderer,
  type MainWindowController,
  sendComputerUseHighlightPlacement,
  showMainWindow,
} from "./main-window";
import { DATA_SKILL_SLUG, ManagedSkillService, SKILL_CREATOR_SKILL_SLUG } from "./managed-skill-service";
import {
  MCP_ACCESS_FILE,
  type McpAccessControl,
  McpAccessStore,
  mcpAgentsOnlyAdded,
  sameMcpAgents,
} from "./mcp-access-store";
import { McpHostSignIns } from "./mcp-host-sign-ins";
import { McpOAuthProxySettingsFile } from "./mcp-oauth-proxy-store";
import {
  MCP_OAUTH_REDIRECT_PATHS,
  MCP_OAUTH_REDIRECT_PORT,
  startMcpOAuthRedirectServer,
} from "./mcp-oauth-redirect-server";
import { McpOAuthStore } from "./mcp-oauth-store";
import { MCP_SERVER_OWNERS_FILE, McpServerOwnersStore } from "./mcp-server-owners-store";
import { MemoryReviewPreferenceStore } from "./memory-review-preference-store";
import { MessagingCredentialStore } from "./messaging-credential-store";
import { createModelReasoningSupport, MODEL_REASONING_RETRY_WAITS_MS } from "./model-reasoning-probe";
import { ModelReleaseCatalog, ModelVisibility } from "./model-visibility";
import { NotificationPreferenceStore } from "./notification-preference-store";
import { OnePasswordConnectorService } from "./onepassword-connector-service";
import { OnePasswordConnectorStore } from "./onepassword-connector-store";
import { EncryptedRecordStore } from "./password-managers/encrypted-record-store";
import { PasswordManagersService } from "./password-managers/password-managers-service";
import { managedProtonPassCli } from "./password-managers/proton-pass-cli-installer";
import { ProtonPassDriver, protonPassRecordSchema } from "./password-managers/proton-pass-driver";
import { PointerForwardingGate } from "./pointer-forwarding-gate";
import { PromptCacheTtlPreferenceStore } from "./prompt-cache-ttl-preference-store";
import { ProviderAccountsHost } from "./provider-accounts-host";
import { ProviderCredentialStore } from "./provider-credential-store";
import { createProviderDetection, type ProviderDetection } from "./provider-detection";
import { PROVIDER_DETECTION_SETTINGS_FILE, ProviderDetectionSettingsStore } from "./provider-detection-settings-store";
import {
  createProviderEnvironmentPreferenceStore,
  type ProviderEnvironmentControl,
  providerEnvironmentControl,
} from "./provider-environment-store";
import { ProviderHostSignIns } from "./provider-host-sign-ins";
import { startAccountLog, startAgentLog, startProviderLog } from "./provider-log";
import { toProviderRuntimeFailure } from "./provider-runtime-effects";
import { ProviderRuntimeManager, providerRuntimeRoot, runtimeTarget } from "./provider-runtime-manager";
import { ProviderUseSettingsStore } from "./provider-use-settings-store";
import { RelayClientCoordinator } from "./relay/client-coordinator";
import { RelayIdentityStore } from "./relay/identity-store";
import { createRelayHostingPreferenceStore, RELAY_HOSTING_PREFERENCE_FILE } from "./relay-hosting-preference-store";
import type { RelayLaunchOptions } from "./relay-launch-options";
import { RELAY_IDENTITY_FILE, RelayService } from "./relay-service";
import { decodeQueuedMessageReceipt } from "./remote-agent-decoding";
import { RemoteConnectTrace } from "./remote-connect-trace";
import { appendRemoteDiagnosticLog } from "./remote-diagnostics";
import { decodeVoid } from "./remote-host-decoding";
import {
  createRemoteNetworkRoutePreferenceStore,
  type RemoteNetworkRoutePreferenceStore,
} from "./remote-network-route-preference-store";
import { RemoteServerManager } from "./remote-server-manager";
import { RemoteWorkflowError } from "./remote-service-effects";
import {
  createRemoteSessionReusePreferenceStore,
  type RemoteSessionReusePreferenceStore,
} from "./remote-session-reuse-preference-store";
import { remoteSyncProfileFile } from "./remote-sync-profile-file";
import { sendToRenderer } from "./renderer-ipc";
import { RequestedUpdate, RequestedUpdateRefusal } from "./requested-update";
import { ResourceMonitor } from "./resource-monitor";
import { StatementTimings } from "./resource-summary";
import { RoutineFeedServer } from "./routine-feed-server";
import { clearRoutineHold, ROUTINE_HOLD_FILE, takeRoutineHold, writeRoutineHold } from "./routine-hold-file";
import { ScreenCapturer } from "./screen-capture";
import type { SecretStorageCipher } from "./secret-storage-cipher";
import { SERVER_AUDIT_FILE, ServerAuditStore, serverAuditNames } from "./server-audit-store";
import { AGENT_PROCESS_VARIABLE, agentProcessEnvironment, ServerMemory } from "./server-memory";
import { ServerMode, type ServerModeEnvironment } from "./server-mode";
import { ServerPersonalityPreferenceStore } from "./server-personality-preference-store";
import { ServerSetupPage } from "./server-setup-page";
import { SERVER_TIMEZONE_PREFERENCE_FILE, ServerTimezonePreferenceStore } from "./server-timezone-preference-store";
import {
  configureApplicationProtocol,
  configureAttachmentProtocol,
  configureServerLogoProtocols,
} from "./session-configuration";
import { readSetupState, writeSetupState } from "./setup-store";
import { OWNER_PIN_KEY, SidebarPinStore } from "./sidebar-pin-store";
import { SignInRelayClient } from "./sign-in-relay-client";
import { agentPrintedLink, SignInRelayHost } from "./sign-in-relay-host";
import { SkillLearningPreferenceStore } from "./skill-learning-preference-store";
import { SkillMarketplaceService } from "./skill-marketplace-service";
import { SpeechPreferenceStore } from "./speech-preference-store";
import { StartupTiming } from "./startup-timing";
import { AGENT_CERTIFICATES_FILE, agentCertificateEnvironment } from "./system-certificates";
import { mcpSignInSharedWithOthers } from "./team-api/mcp-member-access";
import { LEGACY_TEAM_STORE_FILE, TEAM_STORE_FILE, TeamStore } from "./team-store";
import { TeamWebRtcBridge } from "./team-webrtc-bridge";
import type { TeardownRegistry } from "./teardown-registry";
import { THEME_PALETTE_DIRECTORY } from "./theme-palette-files";
import { TraceFile } from "./trace-file";
import {
  macShipItDirectory,
  readNotInstalledUpdate,
  UPDATE_HANDOVER_FILE,
  UPDATE_INSTALL_RECORD_FILE,
} from "./update-install-guard";
import { readUpdatePreference, UPDATE_PREFERENCE_FILE, writeUpdatePreference } from "./update-preference-store";
import { checkRestartReadiness, type RestartReadiness } from "./update-readiness";
import { createDisabledUpdateAdapter, type UpdateAdapter, UpdateService } from "./update-service";
import { listSiblingOpenBotInstances } from "./update-sibling-instances";
import { safeStorageCipher } from "./user-data-secret-storage";
import { VaultService } from "./vault-service";
import { VaultStore } from "./vault-store";
import { VideoReader } from "./video-reader";
import { VoiceApiKeyStore } from "./voice-api-key-store";
import { openScribeSocket } from "./voice-cloud-stream";
import {
  BARK_PLUS_MODEL_DIRECTORY,
  COHERE_TRANSCRIBE_MODEL_DIRECTORY,
  PARAKEET_MODEL_DIRECTORY,
  PARAKEET_UNIFIED_MODEL_DIRECTORY,
  removeLegacyWhisperCache,
  SUPERTONIC_MODEL_DIRECTORY,
  VoiceOperationError,
  WHISPER_TURBO_MODEL_DIRECTORY,
} from "./voice-model-service";
import { VoicePreferenceStore } from "./voice-preference-store";
import { createVoiceServerPreferenceStore, VoiceServerService } from "./voice-server-service";
import { spawnVoiceSpeechHost } from "./voice-speech-host-process";
import { VoiceSpeechService } from "./voice-speech-service";
import { spawnVoiceTranscriptionHost } from "./voice-transcription-host-process";
import { VoiceTranscriptionService } from "./voice-transcription-service";
import { WindowsTopmostKeeper } from "./windows-topmost-keeper";
import { createWorkflowFileExporter, type WorkflowFileExporter } from "./workflow-file-export";
import { WorkflowFoldersService } from "./workflow-folders-service";
import { sizeWorkflowPicture } from "./workflow-picture-size";

const logger = createOpenBotLogger("application-services");
const SETUP_FILE = "openbot-setup-v2.json";
const APPROVAL_AUTOMATION_FILE = "openbot-approval-automation-v3.json";
const V2_APPROVAL_AUTOMATION_FILE = "openbot-approval-automation-v2.json";
const ROUTINE_FEED_FILE = "openbot-routine-feed-v1.json";
const LEGACY_APPROVAL_AUTOMATION_FILE = "openbot-approval-automation-v1.json";
const LANGUAGE_PREFERENCE_FILE = "openbot-language-preference-v1.json";
const LOGO_COLOR_PREFERENCE_FILE = "openbot-logo-color-preference-v1.json";
export const APPEARANCE_PREFERENCE_FILE = "openbot-appearance-preference-v1.json";
const INTERFACE_SIZE_PREFERENCE_FILE = "openbot-interface-size-preference-v1.json";
const NOTIFICATION_PREFERENCE_FILE = "openbot-notification-preference-v1.json";
const BUSY_MESSAGE_MODE_PREFERENCE_FILE = "openbot-busy-message-mode-v1.json";
const AGENT_DEFAULTS_PREFERENCE_FILE = "openbot-agent-defaults-v1.json";
const AGENT_MEMORY_LIMIT_PREFERENCE_FILE = "openbot-agent-memory-limit-v1.json";
const MEMORY_REVIEW_PREFERENCE_FILE = "openbot-memory-review-v1.json";
const SKILL_LEARNING_PREFERENCE_FILE = "openbot-skill-learning-v1.json";
const BROWSING_MEMORY_PREFERENCE_FILE = "openbot-browsing-memory-v1.json";
const USER_BROWSING_FILE = "openbot-browsing-steps-v1.json";
const AGENT_NOTIFICATION_LEVELS_FILE = "openbot-agent-notification-levels-v1.json";
const SIDEBAR_PINS_FILE = "openbot-sidebar-pins-v1.json";
const HOST_TURN_LIMITS_PREFERENCE_FILE = "openbot-host-turn-limits-v1.json";
const SERVER_PERSONALITY_PREFERENCE_FILE = "openbot-server-personality-v1.json";
const PROMPT_CACHE_TTL_PREFERENCE_FILE = "openbot-prompt-cache-ttl-v1.json";
const CLAUDE_USER_SETUP_PREFERENCE_FILE = "openbot-claude-user-setup-v1.json";
const CACHE_EXPIRY_COMPACTION_PREFERENCE_FILE = "openbot-cache-expiry-compaction-v1.json";
const CRM_PREFERENCE_FILE = "openbot-crm-v1.json";
const CLAUDE_COMPACT_WINDOW_PREFERENCE_FILE = "openbot-claude-compact-window-v1.json";
const PROVIDER_ENVIRONMENT_PREFERENCE_FILE = "openbot-provider-environment-v1.json";
const MODEL_VISIBILITY_PREFERENCE_FILE = "openbot-model-visibility-v1.json";
const REMOTE_SESSION_REUSE_PREFERENCE_FILE = "openbot-remote-session-reuse-preference-v1.json";
const EXTERNAL_LINK_PREFERENCE_FILE = "openbot-external-link-preference-v1.json";
const REMOTE_NETWORK_ROUTE_PREFERENCE_FILE = "openbot-remote-network-route-v1.json";
const APP_BEHAVIOR_PREFERENCE_FILE = "openbot-app-behavior-preference-v1.json";
const DYNAMIC_ISLAND_PREFERENCE_FILE = "openbot-dynamic-island-preference-v1.json";
const BROWSER_STATE_FILE = "openbot-browser-state-v1.json";
const SIDEBAR_LAYOUT_FILE = "openbot-sidebar-layout-v1.json";
const REMOTE_SERVERS_FILE = "openbot-remote-servers-v1.json";
const LEGACY_REMOTE_DESKTOP_CREDENTIAL_FILE = "openbot-remote-desktop-credential-v1.json";
const CUSTOM_PROVIDERS_FILE = "openbot-custom-providers-v1.json";
const PROVIDER_CREDENTIAL_FILE = "openbot-provider-credentials-v1.json";
const MESSAGING_CREDENTIAL_FILE = "openbot-messaging-credentials-v1.json";
const MCP_OAUTH_FILE = "openbot-mcp-oauth-v1.json";
const MCP_OAUTH_PROXY_FILE = "openbot-mcp-oauth-proxy-v1.json";
const LINK_ACCOUNT_FILE = "openbot-link-account-v1.json";
const ONEPASSWORD_CONNECTOR_FILE = "openbot-onepassword-connector-v1.json";
const BITWARDEN_CONNECTOR_FILE = "openbot-bitwarden-connector-v1.json";
const PROTONPASS_CONNECTOR_FILE = "openbot-protonpass-connector-v1.json";
const VAULT_FILE = "openbot-vault-v1.json";
const HERMES_IMPORT_LINKS_FILE = "openbot-hermes-imports-v1.json";

const PACKAGED_BUNDLE_IDENTIFIER = APP_ID;
const DEVELOPMENT_BUNDLE_IDENTIFIER = "com.github.Electron";

const TEARDOWN_ORDER = {
  resourceMonitor: 9,
  startupTiming: 9.5,
  updater: 10,
  idleRestart: 11,
  hostUpdateCoordinator: 12,
  requestedUpdate: 13,
  serverMemory: 16,
  serverMode: 17,
  computerUseHighlight: 18,
  computerUsePermissionHelp: 19,
  dynamicIsland: 20,
  agentDock: 20.5,
  machineAlerts: 21,
  themePalettes: 22,
  providerAccountsHost: 27,
  providerHostSignIns: 28,
  mcpHostSignIns: 29,
  browser: 30,
  browserPictureInPicture: 40,
  detachedBrowserWindow: 40.5,
  localSignIn: 41,
  browserDock: 42,
  browserView: 45,
  providerDetection: 48,
  providerRuntimes: 50,
  localServers: 57,
  relayHosting: 58,
  relayClient: 59,
  remoteServers: 60,
  voice: 70,
  speech: 71,
  routineResults: 84,
  messaging: 85,
  host: 90,
  clientBrowser: 98,
  browserEgress: 99,
  teamWebRtcBridge: 100,
  routineFlows: 103,
  workflows: 103.5,
  crm: 103.75,
  routineFeed: 104,
  mcpOAuthRedirect: 105,
  onePasswordConnector: 106,
  bitwardenConnector: 106.5,
  passwordManagers: 106.75,
  linkAccount: 107.5,
  automation: 108,
  storageUsage: 109,
  service: 110,
  cuaDriver: 110.5,
  mcpOAuth: 111,
  trace: 120,
  providerLog: 121,
  agentLog: 122,
  accountLog: 123,
  database: 130,
} as const;

export interface ApplicationServiceContext {
  mainWindow: BrowserWindow;
  windows: MainWindowController;
  appIconPath: string;
  appVariant: AppVariant;
  developmentRemoteRole: DevelopmentRemoteRole | null;
  developmentTestClientEnabled: boolean;
  serverMode: ServerModeEnvironment | null;
  localServerChild: LocalServerChildEnvironment | null;
  relayLaunch: RelayLaunchOptions;
  systemTimezone: () => string;
  macHapticFeedback: MacHapticFeedback;
  teardown: TeardownRegistry;
  forwardBrowserDisplayState: (serverId: string, state: BrowserDisplayState) => void;
  forwardProviderRuntimeStatus: (snapshot: ProviderRuntimeSnapshot) => void;
  forwardVoiceModelStatus: (status: VoiceModelStatus) => void;
  forwardVoiceStreamTranscript: (transcript: VoiceStreamTranscript) => void;
  forwardSpeechModelStatus: (status: SpeechModelStatus) => void;
  forwardVoiceServerSettings: (settings: VoiceServerSettings | null) => void;
  forwardWorkflowNotice: (notice: WorkflowNotice) => void;
  prepareForUpdateInstall: () => Promise<void>;
  quitting: () => boolean;
}

export interface ApplicationServices {
  service: AgentService;
  workflows: WorkflowsHandle;
  workflowFiles: WorkflowFileExporter;
  crm: CrmHandle;
  routineResults: RoutineResultsHandle;
  providerRuntimes: ProviderRuntimeManager;
  providerCredentials: ProviderCredentialStore;
  messaging: MessagingService;
  teamWebRtcBridge: TeamWebRtcBridge;
  mcpOAuth: McpOAuth;
  signInRelayClient: SignInRelayClient;
  linkAccount: LinkAccountService;
  onePasswordConnector: OnePasswordConnectorService;
  bitwardenConnector: BitwardenConnectorService;
  passwordManagers: PasswordManagersService;
  vault: VaultService;
  mailbox: MailboxStore;
  storageUsage: StorageUsageService;
  libraryFoldersService: LibraryFoldersService;
  workflowFoldersService: WorkflowFoldersService;
  browser: BrowserHost;
  browserPictureInPicture: BrowserPictureInPicture;
  detachedBrowserWindow: DetachedBrowserWindow;
  localSignIn: LocalSignInWindows;
  browserDock: BrowserDockOverlay;
  browserView: BrowserViewClient;
  updater: UpdateService;
  describeRestartReadiness: () => RestartReadiness;
  hostUpdateCoordinator: HostUpdateCoordinator;
  requestedUpdate: RequestedUpdate;
  idleRestart: IdleRestart;
  setupFile: string;
  updatePreferenceFile: string;
  approvalAutomation: ApprovalAutomation;
  agentAdminSettings: AgentAdminSettingsService;
  agentHostSettings: AgentHostSettingsService;
  agentDefaultsSettings: AgentDefaultsSettingsService;
  agentFolders: AgentFolders;
  channelFolders: ChannelFolders;
  agentInstructions: AgentInstructionsFiles;
  browserProfiles: BrowserProfileService;
  language: LanguageService;
  logoColor: LogoColorService;
  appearance: AppearanceService;
  interfaceSize: InterfaceSizeService;
  notificationPreference: NotificationPreferenceStore;
  busyMessageMode: BusyMessageModePreferenceStore;
  agentDefaults: AgentDefaultsPreferenceStore;
  agentMemoryLimit: AgentMemoryLimitSetting;
  memoryReview: MemoryReviewPreferenceStore;
  skillLearning: SkillLearningPreferenceStore;
  browsingMemory: BrowsingMemoryPreferenceStore;
  agentNotificationLevels: AgentNotificationLevelStore;
  sidebarPins: SidebarPinStore;
  agentAccess: AgentAccessStore;
  mcpAccess: McpAccessControl;
  serverAudit: ServerAuditStore;
  serverTimezone: ServerTimezonePreferenceStore;
  hostSignalHome: HostSignalHomeService;
  hostTurnLimits: HostTurnLimitsPreferenceStore;
  serverPersonality: ServerPersonalityPreferenceStore;
  promptCacheTtl: PromptCacheTtlPreferenceStore;
  claudeUserSetup: ClaudeUserSetupControl;
  cacheExpiryCompaction: CacheExpiryCompactionControl;
  claudeCompactWindow: ClaudeCompactWindowControl;
  providerEnvironment: ProviderEnvironmentControl;
  modelVisibility: ModelVisibility;
  remoteSessionReuse: RemoteSessionReusePreferenceStore;
  externalLinkPreference: ExternalLinkPreferenceStore;
  externalLinks: ExternalLinkOpener;
  openLink: (url: string) => Promise<void>;
  remoteNetworkRoute: RemoteNetworkRoutePreferenceStore;
  appBehavior: AppBehaviorService;
  agentInitialization: AgentInitializationGate<AgentLifecycleFailed>;
  sidebarLayout: SidebarLayoutStore;
  host: HostService;
  remoteServers: RemoteServerManager;
  relay: RelayService;
  localServers: LocalServers | null;
  localProfile: LocalProfileStore;
  skills: SkillMarketplaceService;
  routineFeed: RoutineFeedServer;
  events: HostEventsService;
  serverMode: ServerMode | null;
  customProviders: CustomProviderStore;
  customProviderChanges: CustomProviderChanges;
  customAgentChanges: CustomAgentChanges;
  acpRegistry: AcpRegistry;
  providerDetection: ProviderDetection;
  providerDetectionSettings: ProviderDetectionSettingsStore;
  agentImport: AgentImportService;
  hermesImport: HermesImportService;
  instanceTransfer: InstanceTransferService;
  voice: VoiceTranscriptionService;
  hostVoiceModel: HostVoiceModelService;
  speech: VoiceSpeechService;
  voiceServer: VoiceServerService;
  dynamicIsland: DynamicIslandWindowController;
  agentDock: AgentDockWindowController;
  cuaDriver: CuaDriverRuntime;
  computerUseHighlight: ComputerUseHighlightController;
  computerUsePermissionHelp: ComputerUsePermissionHelpWindowController;
  prewarmAgentDatabase: Effect.Effect<void>;
  trace: TraceFile;
  resourceMonitor: ResourceMonitor;
  startup: StartupTiming | null;
  machineAlerts: MachineAlertMonitor;
  teamStore: TeamStore;
}

function computerUseCapability(state: ComputerUseState): CapabilityState {
  if (state.status === "ready") return "ready";
  if (state.status === "permissions-required" || state.status === "restart-required") return "setup-required";
  return "unavailable";
}

interface MessagingServicesContext {
  teardown: TeardownRegistry;
  secretCipher: SecretStorageCipher;
  service: AgentService;
  sidebarLayout: SidebarLayoutStore;
}

async function createMessagingServices({
  teardown,
  secretCipher,
  service,
  sidebarLayout,
}: MessagingServicesContext): Promise<MessagingService> {
  const messagingCredentials = new MessagingCredentialStore(
    join(app.getPath("userData"), MESSAGING_CREDENTIAL_FILE),
    secretCipher,
  );
  const messagingCredentialLoadError = await Effect.runPromise(messagingCredentials.load());
  if (messagingCredentialLoadError)
    logger.warn(
      `OpenBot could not read the messaging token file (${messagingCredentialLoadError.name}). It was left unchanged.`,
    );
  const whatsapp = new WhatsAppRuntime({
    root: join(app.getPath("userData"), "whatsapp"),
    createSocket: (config) => makeWASocket(config),
    makeSignalRepository: makeOpenBotSignalRepository,
  });
  const messaging = new MessagingService({
    threads: service.messaging,
    agents: {
      listAgents: () => service.listAgents(),
      respondToApproval: (input) => service.respondToApproval(input, { owner: false }),
      approvalExecutionThreadId: (requestId) => service.approvalExecutionThreadId(requestId),
      onEvent: (listener) => {
        service.on("event", listener);
        return () => service.off("event", listener);
      },
      createAgentProfile: (input) => service.createAgentProfile(input),
      createMemory: (input) => service.createMemory(input),
      ensureDeletable: (agentId) => service.ensureAgentDeletable(agentId),
      deleteAgent: (agentId) => service.deleteAgent(agentId),
      sidebarChatIds: () => service.sidebarChatIds(),
    },
    credentials: messagingCredentials,
    drivers: [whatsAppDriver({ runtime: whatsapp })],
    downloadsRoot: join(app.getPath("userData"), "messaging-downloads"),
    statusPath: join(app.getPath("userData"), "openbot-messaging-status-v1.json"),
    whatsapp,
    sidebar: sidebarLayout,
  });
  void runCauseEffect(messaging.start()).catch((error) =>
    logger.warn("Messaging connections did not start.", toLogValue(error)),
  );
  teardown.push(TEARDOWN_ORDER.messaging, "the messaging connections", () => Effect.runPromise(messaging.stop()));
  return messaging;
}

export async function createApplicationServices({
  mainWindow,
  windows,
  appIconPath,
  appVariant,
  developmentRemoteRole,
  developmentTestClientEnabled,
  serverMode: serverModeEnvironment,
  localServerChild,
  relayLaunch,
  systemTimezone,
  macHapticFeedback,
  teardown,
  forwardBrowserDisplayState,
  forwardProviderRuntimeStatus,
  forwardVoiceModelStatus,
  forwardVoiceStreamTranscript,
  forwardSpeechModelStatus,
  forwardVoiceServerSettings,
  forwardWorkflowNotice,
  prepareForUpdateInstall,
  quitting,
}: ApplicationServiceContext): Promise<ApplicationServices> {
  performance.mark("openbot:services.start");
  teardown.push(
    TEARDOWN_ORDER.providerLog,
    "the provider log",
    startProviderLog(join(app.getPath("userData"), "logs")),
  );
  teardown.push(TEARDOWN_ORDER.agentLog, "the agent log", startAgentLog(join(app.getPath("userData"), "logs")));
  teardown.push(TEARDOWN_ORDER.accountLog, "the account log", startAccountLog(join(app.getPath("userData"), "logs")));
  const externalLinkPreference = createExternalLinkPreferenceStore(
    join(app.getPath("userData"), EXTERNAL_LINK_PREFERENCE_FILE),
  );
  const externalLinks = new ExternalLinkOpener({
    preference: externalLinkPreference,
    platform: process.platform,
    openDefault: (url) => shell.openExternal(url),
    onFallback: (fallback) =>
      sendToRenderer(
        BrowserWindow.getFocusedWindow() ?? windows.getMainWindow(),
        IPC_ENDPOINTS.app.externalLinkFallback,
        fallback,
      ),
  });
  const openLink = (url: string) => runCauseEffect(externalLinks.open(url));
  let criticalActionTargets: { agents: AgentService; host: HostService; remoteServers: RemoteServerManager } | null =
    null;
  const windowKind = aboveAppsWindowKind(Boolean(serverModeEnvironment || localServerChild));
  const language = new LanguageService({
    path: join(app.getPath("userData"), LANGUAGE_PREFERENCE_FILE),
    systemLocale: app.getLocale(),
  });
  const pointerForwarding =
    windowKind === "tool" ? new PointerForwardingGate(() => screen.getCursorScreenPoint()) : null;
  const topmost = windowKind === "tool" ? new WindowsTopmostKeeper() : null;
  const dynamicIsland = new DynamicIslandWindowController({
    windowKind,
    preferencePath: join(app.getPath("userData"), DYNAMIC_ISLAND_PREFERENCE_FILE),
    ...(process.env.ELECTRON_RENDERER_URL
      ? { defaultPreference: { ...DEFAULT_DYNAMIC_ISLAND_PREFERENCE, enabled: false } }
      : {}),
    createWindow: createDynamicIslandWindow,
    loadWindow: (window, display) => loadDynamicIslandRenderer(window, display, appVariant),
    getDisplays: () => screen.getAllDisplays(),
    getPrimaryDisplay: () => screen.getPrimaryDisplay(),
    getMainWindow: windows.getMainWindow,
    getFocusedWindow: () => BrowserWindow.getFocusedWindow(),
    ensureMainWindow: windows.ensureMainWindow,
    presentMainWindow: showMainWindow,
    performHaptic: () => macHapticFeedback.performAlignment(),
    showContextMenu: (window) =>
      Menu.buildFromTemplate([
        {
          label: language.translate("menu.hideDynamicIsland"),
          click: () =>
            void runCauseEffect(
              dynamicIsland
                .hide()
                .pipe(
                  Effect.andThen(
                    setAboveAppsXWayland(app.getPath("userData"), "dynamic-island", false).pipe(Effect.ignore),
                  ),
                ),
            ).catch((error: unknown) => logger.warn("The Dynamic Island did not turn off.", toLogValue(error))),
        },
      ]).popup({ window }),
    pointerForwarding,
    topmost,
    performCriticalAction: (action) =>
      Effect.suspend(() => {
        if (!criticalActionTargets) {
          return Effect.fail(new DynamicIslandFailed({ cause: new Error(sourceText("error.app.notReady")) }));
        }
        const { agents, host, remoteServers } = criticalActionTargets;
        return performDynamicIslandCriticalAction(
          action,
          agents,
          remoteServers,
          { decodeVoid, decodeQueuedMessageReceipt },
          () => host.conversationSender(),
        ).pipe(toDynamicIslandFailed);
      }),
  });
  teardown.push(TEARDOWN_ORDER.dynamicIsland, "the Dynamic Island", () => dynamicIsland.destroy());
  const agentDock = new AgentDockWindowController({
    windowKind,
    createWindow: createAgentDockWindow,
    loadWindow: loadAgentDockRenderer,
    screen,
    getMainWindow: windows.getMainWindow,
    ensureMainWindow: windows.ensureMainWindow,
    presentMainWindow: showMainWindow,
    pointerForwarding,
    topmost,
    sendMessage: (action) =>
      Effect.suspend(() => {
        if (!criticalActionTargets) {
          return Effect.fail(new AgentDockFailed({ cause: new Error(sourceText("error.app.notReady")) }));
        }
        const { agents, host, remoteServers } = criticalActionTargets;
        if (action.seat.kind === "channel") {
          const command: ChannelCommand = {
            type: "send",
            operationId: action.clientMessageId,
            channelId: action.seat.id,
            text: action.text,
            recipientAgentId: leadingAddress(action.text).mentions[0]?.id ?? null,
            replyToMessageId: null,
            attachmentDraftIds: [],
          };
          const sent =
            action.serverId === LOCAL_SERVER_ID
              ? agents.channels.command(command, host.channelActor()).pipe(Effect.asVoid)
              : remoteServers
                  .request(action.serverId, CHANNEL_ROUTES.command, decodeChannel, { method: "POST", body: command })
                  .pipe(Effect.asVoid);
          return sent.pipe(toAgentDockFailed);
        }
        return performDynamicIslandCriticalAction(
          {
            type: "send-message",
            serverId: action.serverId,
            agentId: action.seat.id,
            text: action.text,
            clientMessageId: action.clientMessageId,
          },
          agents,
          remoteServers,
          { decodeVoid, decodeQueuedMessageReceipt },
          () => host.conversationSender(),
        ).pipe(toAgentDockFailed);
      }),
  });
  teardown.push(TEARDOWN_ORDER.agentDock, "the agent dock", () => agentDock.destroy());
  const teamStore = new TeamStore(
    join(app.getPath("userData"), TEAM_STORE_FILE),
    join(app.getPath("userData"), LEGACY_TEAM_STORE_FILE),
  );
  await runCauseEffect(teamStore.initialize());
  const localProfile = await runCauseEffect(
    openLocalProfileStore(join(app.getPath("userData"), LOCAL_PROFILE_FILE), () => teamStore.localProfileSeed()),
  );
  const agentDefaults = createAgentDefaultsPreferenceStore(
    join(app.getPath("userData"), AGENT_DEFAULTS_PREFERENCE_FILE),
  );
  await runCauseEffect(agentDefaults.load());
  const store = new AgentStore(
    app.getPath("userData"),
    homedir(),
    new OpenBotDatabase(app.getPath("userData"), checkDatabaseIntegrityInHost),
    () => agentDefaults.get(),
    localServerChild?.agentRoot,
  );
  performance.mark("openbot:services.pre-store");
  await runCauseEffect(store.initialize());
  performance.mark("openbot:services.store");
  teardown.push(TEARDOWN_ORDER.database, "the database", () => store.database.close(), { afterAbandonedSteps: true });
  const skillCreator = new ManagedSkillService(
    app.isPackaged
      ? join(process.resourcesPath, "managed-skills", "openbot-skill-creator", "SKILL.md")
      : resolve(__dirname, "../../resources/managed-skills/openbot-skill-creator/SKILL.md"),
    undefined,
    undefined,
    SKILL_CREATOR_SKILL_SLUG,
  );
  const dataSkill = new ManagedSkillService(
    app.isPackaged
      ? join(process.resourcesPath, "managed-skills", "openbot-data", "SKILL.md")
      : resolve(__dirname, "../../resources/managed-skills/openbot-data/SKILL.md"),
    undefined,
    undefined,
    DATA_SKILL_SLUG,
  );
  await Effect.runPromise(
    Effect.all(
      [skillCreator, dataSkill].map((skill) => skill.syncAll(store.list())),
      {
        concurrency: "unbounded",
        discard: true,
      },
    ),
  );
  performance.mark("openbot:services.skills");
  const sidebarLayout = new SidebarLayoutStore(join(app.getPath("userData"), SIDEBAR_LAYOUT_FILE));
  await runCauseEffect(sidebarLayout.initialize());
  const libraryFolders = new LibraryFoldersStore(join(app.getPath("userData"), LIBRARY_FOLDERS_FILE));
  await runCauseEffect(libraryFolders.initialize());
  const workflowFolders = new WorkflowFoldersStore(join(app.getPath("userData"), WORKFLOW_FOLDERS_FILE));
  await runCauseEffect(workflowFolders.initialize());
  const mailbox = new MailboxStore(app.getPath("userData"), store.sharedRoot, store.database);
  await runCauseEffect(mailbox.initialize());
  configureApplicationProtocol();
  const developmentUrl = process.env.ELECTRON_RENDERER_URL;
  const teamWebRtcBridge = new TeamWebRtcBridge({
    developmentUrl: developmentUrl ?? null,
    iceTransportPolicy: developmentUrl && process.env.OPENBOT_DEV_ICE_TRANSPORT_POLICY === "relay" ? "relay" : "all",
  });
  teardown.push(TEARDOWN_ORDER.teamWebRtcBridge, "the team WebRTC bridge", () =>
    runCauseEffect(teamWebRtcBridge.stop()),
  );
  const browserEgress = new BrowserEgressHost(teamWebRtcBridge);
  teardown.push(TEARDOWN_ORDER.browserEgress, "the computer proxies of members", () => browserEgress.dispose());
  const clientBrowser = new ClientBrowserHub();
  teardown.push(TEARDOWN_ORDER.clientBrowser, "the shared Chrome tabs of members", () => clientBrowser.dispose());
  const hostMemory = serverModeEnvironment
    ? new ServerMemory({
        onError: (message, error) => logger.warn(message, toLogValue(error)),
        onAgentProcessStopped: (stopped) =>
          logger.warn("Stopped a leftover agent process to free memory.", { ...stopped }),
      })
    : null;
  const cpuLimitModule = app.isPackaged
    ? join(process.resourcesPath, "agent-runtime", "cpu-limit.cjs")
    : resolve(__dirname, "../../resources/agent-runtime/cpu-limit.cjs");
  const certificateEnvironment = await Effect.runPromise(
    agentCertificateEnvironment(join(app.getPath("userData"), AGENT_CERTIFICATES_FILE)).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          logger.warn("Could not give the system root certificates to agent processes:", toLogValue(error));
          return {};
        }),
      ),
    ),
  );
  const serverEnvironment = {
    ...(hostMemory
      ? agentProcessEnvironment(existsSync(cpuLimitModule) ? cpuLimitModule : null)
      : { [AGENT_PROCESS_VARIABLE]: "1" }),
    ...certificateEnvironment,
  };
  if (hostMemory) {
    hostMemory.start();
    teardown.push(TEARDOWN_ORDER.serverMemory, "the server memory reading", () => Effect.runPromise(hostMemory.stop()));
  }
  const browserProfileStore = new BrowserProfileStore(store.database);
  const browserProxyStore = new BrowserProxyStore(store.database);
  const siteMemoryStore = new AgentMemoryStore(store.database);
  const browserProxyCipher = safeStorageCipher("error.app.secretStorageUnavailable");
  const browsingMemory = new BrowsingMemoryPreferenceStore(
    join(app.getPath("userData"), BROWSING_MEMORY_PREFERENCE_FILE),
  );
  await runCauseEffect(browsingMemory.load());
  const userBrowsing = new UserBrowsingLog(join(app.getPath("userData"), USER_BROWSING_FILE));
  await Effect.runPromise(userBrowsing.load());
  browsingMemory.onChange(({ enabled }) => {
    if (!enabled) Effect.runFork(userBrowsing.clear());
  });
  let browserProxyStatusChanged = () => {};
  let agentBrowserProfiles: BrowserProfileService | null = null;
  let crmHandle: CrmHandle | null = null;
  const agentThreads = new AgentThreadStore(store.database);
  const agentMemoryOn = (agentId: string) => {
    const agent = store.get(agentId);
    return agent === undefined || agentMemoryEnabled(agent);
  };
  const browser = new BrowserHost(mainWindow, store.downloadsRoot, join(app.getPath("userData"), BROWSER_STATE_FILE), {
    memoryLow: () => (hostMemory?.level() ?? "ok") !== "ok",
    memoryCritical: () => hostMemory?.level() === "critical",
    ...(hostMemory ? { tabLimit: () => hostMemory.browserTabLimit() } : {}),
    browserProfile: (agentId) => {
      const agent = store.get(agentId);
      return agent ? agentBrowserProfile(agent) : { kind: "shared" };
    },
    profileExists: (profileId) => browserProfileStore.get(profileId) !== undefined,
    agentChat: (threadId) => browserAgentChat(store, agentThreads, threadId),
    profileProxy: (profileId) => browserProxyConnection(browserProxyStore, browserProxyCipher, profileId),
    onProxyStatusChanged: () => browserProxyStatusChanged(),
    computerExit: (memberId) => browserEgress.exit(memberId),
    quitShortcut: (input) => windows.handleQuitShortcut(mainWindow, input),
    pagePreload: join(__dirname, "../preload/browserPage.cjs"),
    siteMemories: (agentId, hostname) =>
      agentMemoryOn(agentId)
        ? siteMemoryStore
            .forHost(agentId, hostname)
            .flatMap(({ id, site, text }) => (site ? [{ id, site, text: redactSecrets(text) }] : []))
        : [],
    userBrowsing: {
      enabled: () => browsingMemory.get().enabled,
      record: (agentId, step) => {
        if (agentMemoryOn(agentId)) Effect.runFork(userBrowsing.record(agentId, step));
      },
    },
    hideFromWindowSwitchers: hidePanelFromWindowSwitchers,
  });
  teardown.push(TEARDOWN_ORDER.browser, "the browser", () => runCauseEffect(browser.destroy()));
  await runCauseEffect(browser.restore(store.list().map((agent) => ({ id: agent.id, threadId: agent.threadId }))));
  performance.mark("openbot:services.browser");
  const browserPictureInPicture = new BrowserPictureInPicture({
    mainWindow,
    browser,
    preloadPath: join(__dirname, "../preload/index.cjs"),
    iconPath: appIconPath,
    ...(developmentUrl === undefined ? {} : { developmentUrl }),
    onEvent: (event) => {
      const window = windows.getMainWindow();
      if (!window || window.isDestroyed()) return;
      sendToRenderer(window, IPC_ENDPOINTS.browser.pictureInPictureEvent, event);
    },
  });
  teardown.push(TEARDOWN_ORDER.browserPictureInPicture, "picture in picture", () => browserPictureInPicture.destroy());
  const detachedBrowserWindow = new DetachedBrowserWindow({
    mainWindow,
    browser,
    preloadPath: join(__dirname, "../preload/index.cjs"),
    iconPath: appIconPath,
    title: () => language.translate("browser.panel.label"),
    ...(developmentUrl === undefined ? {} : { developmentUrl }),
    onEvent: (event) => {
      const window = windows.getMainWindow();
      if (!window || window.isDestroyed()) return;
      sendToRenderer(window, IPC_ENDPOINTS.browser.windowEvent, event);
    },
    onModel: (window, model) => {
      sendToRenderer(window, IPC_ENDPOINTS.browser.windowModel, model);
    },
  });
  teardown.push(TEARDOWN_ORDER.detachedBrowserWindow, "the browser window", () => detachedBrowserWindow.destroy());
  const localSignIn = new LocalSignInWindows();
  teardown.push(TEARDOWN_ORDER.localSignIn, "the local sign-in window", () => Effect.runPromise(localSignIn.discard()));
  const browserDock = new BrowserDockOverlay({
    mainWindow,
    preloadPath: join(__dirname, "../preload/index.cjs"),
    load: loadBrowserDockRenderer,
    forwardShortcut: (input) => windows.handleQuitShortcut(mainWindow, input) || browser.forwardDockShortcut(input),
  });
  browser.setMainPageListener((page) => browserDock.setPage(page));
  teardown.push(TEARDOWN_ORDER.browserDock, "the browser dock", () => {
    browser.setMainPageListener(null);
    browserDock.destroy();
  });
  browser.onChanged((tabs, activeTabId) => forwardBrowserDisplayState(LOCAL_SERVER_ID, { tabs, activeTabId }));
  const setupFile = join(app.getPath("userData"), SETUP_FILE);
  const updatePreferenceFile = join(app.getPath("userData"), UPDATE_PREFERENCE_FILE);
  const routineHoldFile = join(app.getPath("userData"), ROUTINE_HOLD_FILE);
  const logoColor = new LogoColorService({ path: join(app.getPath("userData"), LOGO_COLOR_PREFERENCE_FILE) });
  const appearance = new AppearanceService({
    path: join(app.getPath("userData"), APPEARANCE_PREFERENCE_FILE),
    paletteDirectory: join(app.getPath("userData"), THEME_PALETTE_DIRECTORY),
    supportsTransparentWindow: process.platform === "darwin",
  });
  const interfaceSize = new InterfaceSizeService({
    path: join(app.getPath("userData"), INTERFACE_SIZE_PREFERENCE_FILE),
  });
  const notificationPreference = new NotificationPreferenceStore(
    join(app.getPath("userData"), NOTIFICATION_PREFERENCE_FILE),
  );
  const busyMessageMode = new BusyMessageModePreferenceStore(
    join(app.getPath("userData"), BUSY_MESSAGE_MODE_PREFERENCE_FILE),
  );
  const agentMemoryLimit = new AgentMemoryLimitPreferenceStore(
    join(app.getPath("userData"), AGENT_MEMORY_LIMIT_PREFERENCE_FILE),
  );
  const memoryReview = new MemoryReviewPreferenceStore(join(app.getPath("userData"), MEMORY_REVIEW_PREFERENCE_FILE));
  const agentNotificationLevels = new AgentNotificationLevelStore(
    join(app.getPath("userData"), AGENT_NOTIFICATION_LEVELS_FILE),
  );
  const sidebarPins = new SidebarPinStore(join(app.getPath("userData"), SIDEBAR_PINS_FILE));
  const skillLearning = new SkillLearningPreferenceStore(join(app.getPath("userData"), SKILL_LEARNING_PREFERENCE_FILE));
  const serverAudit = new ServerAuditStore(join(app.getPath("userData"), SERVER_AUDIT_FILE));
  const agentAccess = new AgentAccessStore(join(app.getPath("userData"), AGENT_ACCESS_FILE), {
    audit: (serverId, before, after, actor) =>
      serverAudit.recordAgentAccess(serverId, actor, before, after, () =>
        serverAuditNames(teamStore.configured ? teamStore.listMembers() : [], service.listAgents()),
      ),
  });
  const mcpServerOwners = new McpServerOwnersStore(join(app.getPath("userData"), MCP_SERVER_OWNERS_FILE));
  const mcpAccessStore = new McpAccessStore(join(app.getPath("userData"), MCP_ACCESS_FILE));
  const serverTimezone = new ServerTimezonePreferenceStore(
    join(app.getPath("userData"), SERVER_TIMEZONE_PREFERENCE_FILE),
    systemTimezone,
  );
  const hostSignalHome = new HostSignalHomeService({
    path: join(app.getPath("userData"), SIGNAL_HOME_PREFERENCE_FILE),
    fetch: (url, init) => net.fetch(url, { ...init, credentials: "omit", cache: "no-store" }),
    listHomes: () => Effect.succeed([]),
    currentHome: () => host.signalHome(),
    followHome: () => host.followSignalHome(),
  });
  const hostTurnLimits = new HostTurnLimitsPreferenceStore(
    join(app.getPath("userData"), HOST_TURN_LIMITS_PREFERENCE_FILE),
    () => hostMemory?.turnLimit() ?? null,
  );
  const serverPersonality = new ServerPersonalityPreferenceStore(
    join(app.getPath("userData"), SERVER_PERSONALITY_PREFERENCE_FILE),
  );
  const promptCacheTtl = new PromptCacheTtlPreferenceStore(
    join(app.getPath("userData"), PROMPT_CACHE_TTL_PREFERENCE_FILE),
  );
  const claudeUserSetup = createClaudeUserSetupPreferenceStore(
    join(app.getPath("userData"), CLAUDE_USER_SETUP_PREFERENCE_FILE),
  );
  const cacheExpiryCompaction = createCacheExpiryCompactionPreferenceStore(
    join(app.getPath("userData"), CACHE_EXPIRY_COMPACTION_PREFERENCE_FILE),
  );
  const crmPreference = createCrmPreferenceStore(join(app.getPath("userData"), CRM_PREFERENCE_FILE));
  const claudeCompactWindow = createClaudeCompactWindowPreferenceStore(
    join(app.getPath("userData"), CLAUDE_COMPACT_WINDOW_PREFERENCE_FILE),
  );
  const providerEnvironment = createProviderEnvironmentPreferenceStore(
    join(app.getPath("userData"), PROVIDER_ENVIRONMENT_PREFERENCE_FILE),
  );
  const remoteSessionReuse = createRemoteSessionReusePreferenceStore(
    join(app.getPath("userData"), REMOTE_SESSION_REUSE_PREFERENCE_FILE),
  );
  const remoteNetworkRoute = createRemoteNetworkRoutePreferenceStore(
    join(app.getPath("userData"), REMOTE_NETWORK_ROUTE_PREFERENCE_FILE),
  );
  const appBehavior = new AppBehaviorService({
    path: join(app.getPath("userData"), APP_BEHAVIOR_PREFERENCE_FILE),
    loginItem: createLoginItem({
      appVariant,
      server: Boolean(serverModeEnvironment || localServerChild),
    }),
    offersBackground: !serverModeEnvironment && !localServerChild,
    menuBar: process.platform === "darwin",
    offersKeepAwake: process.platform !== "linux" && !serverModeEnvironment && !localServerChild,
    offersQuitGuard: process.platform === "darwin" && !serverModeEnvironment && !localServerChild,
  });
  const loadPreferences = Effect.all(
    [
      language.load(),
      logoColor.load(),
      interfaceSize.load(),
      notificationPreference.load(),
      busyMessageMode.load(),
      agentMemoryLimit.load(),
      agentNotificationLevels.load(),
      sidebarPins.load(),
      memoryReview.load(),
      skillLearning.load(),
      serverAudit.load(),
      mcpServerOwners.load(),
      serverTimezone.load(),
      hostSignalHome.load(),
      hostTurnLimits.load(),
      serverPersonality.load(),
      promptCacheTtl.load(),
      claudeUserSetup.load(),
      cacheExpiryCompaction.load(),
      crmPreference.load(),
      claudeCompactWindow.load(),
      providerEnvironment.load(),
      remoteSessionReuse.load(),
      externalLinkPreference.load(),
      remoteNetworkRoute.load(),
      appBehavior.load(),
    ],
    { concurrency: "unbounded", discard: true },
  );
  const [setupState, palettesWatch, rolesLoaded, mcpAccessLoaded] = await Promise.all([
    runCauseEffect(readSetupState(setupFile)),
    runCauseEffect(appearance.load()).then(() => Effect.runPromise(appearance.followPalettes())),
    runCauseEffect(agentAccess.load()),
    runCauseEffect(mcpAccessStore.load()),
    runCauseEffect(loadPreferences),
  ]);
  teardown.push(TEARDOWN_ORDER.themePalettes, "the theme palette watch", palettesWatch);
  if (!rolesLoaded)
    logger.warn("The roles file did not load. Members get no access to agents until an admin saves the roles.");
  if (!mcpAccessLoaded)
    logger.warn(
      "The MCP access file did not load. No agent or member gets an MCP server until an admin saves its access.",
    );
  void Effect.runPromise(appBehavior.refreshLoginItem()).catch((error) =>
    logger.warn("The login item did not refresh.", toLogValue(error)),
  );
  const updatePreference = await runCauseEffect(readUpdatePreference(updatePreferenceFile));
  const approvalAutomationFile = join(app.getPath("userData"), APPROVAL_AUTOMATION_FILE);
  const approvalAutomation = new ApprovalAutomation({
    path: approvalAutomationFile,
    initial: await runCauseEffect(
      readApprovalAutomation(
        approvalAutomationFile,
        store.list().map((agent) => agent.id),
        [V2_APPROVAL_AUTOMATION_FILE, LEGACY_APPROVAL_AUTOMATION_FILE].map((file) =>
          join(app.getPath("userData"), file),
        ),
      ),
    ),
    knownAgentIds: () => store.list().map((agent) => agent.id),
  });
  const providerUse = new ProviderUseSettingsStore(join(app.getPath("userData"), "openbot-provider-use-v1.json"));
  const providerAccounts = new ProviderAccountStore(
    join(app.getPath("userData"), "openbot-provider-accounts-v1.json"),
    join(app.getPath("userData"), "provider-accounts"),
  );
  await Promise.all([runCauseEffect(providerUse.load()), runCauseEffect(providerAccounts.load())]);
  const providerRuntimesRoot =
    localServerChild?.runtimeRoot ??
    providerRuntimeRoot({
      appData: app.getPath("appData"),
      userDataOverride: app.commandLine.getSwitchValue("user-data-dir"),
    });
  const providerDownloads = join(app.getPath("userData"), "provider-runtimes", ".downloads");
  const hermesInstaller = new HermesInstaller({
    downloadRoot: providerDownloads,
    refreshProvider: () => service.refreshProvider("hermes"),
  });
  const providerRuntimes = new ProviderRuntimeManager({
    isProviderOn: (provider) => !providerUse.off().includes(provider),
    root: providerRuntimesRoot,
    downloadRoot: providerDownloads,
    hermesInstaller,
    updateRuntime: (runtime, install, signal, onWait) => {
      if (isManagedToolRuntime(runtime)) return install().pipe(Effect.asVoid);
      return service
        .updateProviderCli(
          runtime,
          () =>
            install().pipe(
              Effect.mapError(
                (error) => new AgentLifecycleFailed({ operation: "updateProviderCli.install", cause: error.cause }),
              ),
            ),
          signal,
          onWait,
        )
        .pipe(Effect.asVoid, toProviderRuntimeFailure);
    },
  });
  let updateCheckWait: Fiber.Fiber<void> | null = null;
  let modelReasoningWait: Fiber.Fiber<void> | null = null;
  teardown.push(TEARDOWN_ORDER.providerRuntimes, "the provider runtimes", () =>
    runCauseEffect(
      Effect.gen(function* () {
        if (updateCheckWait) yield* Fiber.interrupt(updateCheckWait);
        if (modelReasoningWait) yield* Fiber.interrupt(modelReasoningWait);
        yield* providerRuntimes.stop();
      }),
    ),
  );
  const secretCipher = safeStorageCipher("error.app.secretStorageUnavailable");
  const customProviders = new CustomProviderStore({
    path: join(app.getPath("userData"), CUSTOM_PROVIDERS_FILE),
    cipher: secretCipher,
  });
  const modelReasoning = createModelReasoningSupport(() => customProviders.configs());
  const customAgents = new CustomAgentStore({
    path: join(app.getPath("userData"), CUSTOM_AGENTS_FILE),
    cipher: secretCipher,
  });
  await Promise.all([
    runCauseEffect(providerRuntimes.initialize()),
    runCauseEffect(customProviders.load()),
    runCauseEffect(customAgents.load()),
  ]);
  const providerDetectionSettings = new ProviderDetectionSettingsStore(
    join(app.getPath("userData"), PROVIDER_DETECTION_SETTINGS_FILE),
  );
  performance.mark("openbot:services.preferences");
  await runCauseEffect(providerDetectionSettings.load());
  const modelReleaseCatalog = new ModelReleaseCatalog();
  const providerDetection = await Effect.runPromise(
    createProviderDetection({
      settings: providerDetectionSettings,
      customProviders,
      customAgents,
      catalog: modelReleaseCatalog,
    }),
  );
  teardown.push(TEARDOWN_ORDER.providerDetection, "model server discovery", () =>
    Effect.runPromise(providerDetection.close()),
  );
  const providerCredentials = new ProviderCredentialStore(
    join(app.getPath("userData"), PROVIDER_CREDENTIAL_FILE),
    secretCipher,
  );
  performance.mark("openbot:services.provider-detection");
  const credentialLoadError = await Effect.runPromise(providerCredentials.load());
  if (credentialLoadError) {
    logger.warn(`OpenBot could not read the provider key file (${credentialLoadError.name}). It was left unchanged.`);
  }
  const providerEnvironmentSetting = providerEnvironmentControl(providerEnvironment, providerCredentials, (provider) =>
    service.providerSpawnSettingsChanged(provider).pipe(
      Effect.catch((failure) =>
        Effect.sync(() =>
          logger.warn(`${provider} did not restart after its variables changed.`, toLogValue(failure.cause)),
        ),
      ),
      Effect.tap(() => Effect.sync(() => service.notifyProviderSettingsChanged())),
      Effect.asVoid,
    ),
  );
  const mcpOAuthStore = new McpOAuthStore(join(app.getPath("userData"), MCP_OAUTH_FILE), secretCipher);
  const mcpOAuthLoadError = await Effect.runPromise(mcpOAuthStore.load());
  if (mcpOAuthLoadError) {
    logger.warn(`OpenBot could not read the MCP sign-in file (${mcpOAuthLoadError.name}). It was left unchanged.`);
  }
  const mcpOAuthProxySettings = new McpOAuthProxySettingsFile(
    join(app.getPath("userData"), MCP_OAUTH_PROXY_FILE),
    secretCipher,
  );
  const mcpOAuthProxyLoadError = await Effect.runPromise(mcpOAuthProxySettings.load());
  if (mcpOAuthProxyLoadError) {
    logger.warn(
      `OpenBot could not read the MCP sign-in proxy file (${mcpOAuthProxyLoadError.name}). A new port is used.`,
    );
  }
  let mcpOAuthAuthority: McpOAuth | null = null;
  const mcpOAuthDeepLink = () =>
    (process.platform === "linux" || app.isPackaged) && app.isDefaultProtocolClient(APP_LINK_SCHEME)
      ? MCP_OAUTH_REDIRECT_URL
      : undefined;
  const signInRelayClient = new SignInRelayClient({
    openExternal: openLink,
    language,
    deepLinkRedirectUrl: mcpOAuthDeepLink,
    ownListener: () =>
      mcpOAuthRedirect
        ? { port: Number(new URL(mcpOAuthRedirect.redirectUrl).port), paths: MCP_OAUTH_REDIRECT_PATHS }
        : null,
  });
  performance.mark("openbot:services.mcp-sign-in-file");
  const mcpOAuthRedirect = await startMcpOAuthRedirectServer({
    language,
    preferredPort: MCP_OAUTH_REDIRECT_PORT,
    deliver: (state, code, query) => {
      const elsewhere = mcpOAuthAuthority?.openedElsewhere(state) ?? false;
      const exchange = elsewhere ? null : (mcpOAuthAuthority?.grantExchange(state) ?? null);
      if (!mcpOAuthAuthority?.receiveAuthorizationCode(state, code))
        return signInRelayClient.deliver(state, query) ? "relayed" : false;
      if (elsewhere) return true;
      const current = windows.getMainWindow();
      if (current && !current.isDestroyed()) showMainWindow(current);
      return exchange ? Effect.runPromise(exchange) : true;
    },
    relayRefusal: (state, query) => {
      signInRelayClient.deliver(state, query);
    },
  }).catch((error: unknown) => {
    logger.warn(
      `OpenBot could not listen for MCP sign-ins on this machine, so the ${APP_LINK_SCHEME}:// link is used instead. Servers that refuse it cannot be signed in to:`,
      toLogValue(error),
    );
    return null;
  });
  if (mcpOAuthRedirect) {
    teardown.push(TEARDOWN_ORDER.mcpOAuthRedirect, "the MCP sign-in listener", () => mcpOAuthRedirect.close());
  }
  const mcpOAuth = new McpOAuth({
    storage: mcpOAuthStore,
    openExternal: openLink,
    redirectUrl: mcpOAuthRedirect?.redirectUrl ?? MCP_OAUTH_REDIRECT_URL,
    deepLinkRedirectUrl: mcpOAuthDeepLink,
    logger: createOpenBotLogger("mcp-oauth"),
  });
  mcpOAuthAuthority = mcpOAuth;
  teardown.push(TEARDOWN_ORDER.mcpOAuth, "MCP token refresh", () => Effect.runPromise(mcpOAuth.close()));
  const linkAccount = new LinkAccountService({
    store: new LinkAccountStore(join(app.getPath("userData"), LINK_ACCOUNT_FILE), secretCipher),
    openExternal: openLink,
  });
  await Effect.runPromise(linkAccount.load());
  teardown.push(TEARDOWN_ORDER.linkAccount, "the Link account", () => Effect.runPromise(linkAccount.dispose()));
  const bitwardenCliTarget = runtimeTarget(process.platform, process.arch);
  const bitwardenConnector = new BitwardenConnectorService({
    host: {
      store: new BitwardenConnectorStore(join(app.getPath("userData"), BITWARDEN_CONNECTOR_FILE), secretCipher),
      dataDirectory: join(app.getPath("userData"), "provider-state", "bitwarden-host"),
      installCli: bitwardenCliTarget
        ? (signal) =>
            managedBitwardenCli({
              directory: join(app.getPath("userData"), "provider-state", "bitwarden-cli"),
              target: bitwardenCliTarget,
              signal,
            })
        : null,
    },
  });
  await runCauseEffect(bitwardenConnector.load());
  teardown.push(TEARDOWN_ORDER.bitwardenConnector, "the Bitwarden connection", async () => {
    await runCauseEffect(bitwardenConnector.dispose());
  });

  const vault = new VaultService({
    store: new VaultStore(join(app.getPath("userData"), VAULT_FILE), secretCipher),
    canPersist: secretCipher.canPersist,
  });
  await Effect.runPromise(vault.load());

  const onePasswordCliTarget = runtimeTarget(process.platform, process.arch);
  const onePasswordConnector = new OnePasswordConnectorService({
    store: new OnePasswordConnectorStore(join(app.getPath("userData"), ONEPASSWORD_CONNECTOR_FILE), secretCipher),
    hostName: hostname(),
    appVersion: app.getVersion(),
    cliInstall: onePasswordCliTarget
      ? { directory: join(app.getPath("userData"), "provider-state", "1password-cli"), target: onePasswordCliTarget }
      : null,
    openExternal: openLink,
  });
  await runCauseEffect(onePasswordConnector.load());
  performance.mark("openbot:services.connectors");
  teardown.push(TEARDOWN_ORDER.onePasswordConnector, "the 1Password connection", () =>
    runCauseEffect(onePasswordConnector.dispose()),
  );
  const protonPassCliTarget = runtimeTarget(process.platform, process.arch);
  const passwordManagers = new PasswordManagersService([
    new ProtonPassDriver({
      store: new EncryptedRecordStore({
        path: join(app.getPath("userData"), PROTONPASS_CONNECTOR_FILE),
        cipher: secretCipher,
        decode: Schema.decodeUnknownSync(protonPassRecordSchema),
        unreadable: sourceText("error.connector.protonPassFileUnreadable"),
      }),
      dataDirectory: join(app.getPath("userData"), "provider-state", "protonpass-host"),
      hostName: hostname(),
      installCli: protonPassCliTarget
        ? (signal) =>
            managedProtonPassCli({
              directory: join(app.getPath("userData"), "provider-state", "protonpass-cli"),
              target: protonPassCliTarget,
              signal,
            })
        : null,
    }),
  ]);
  await runCauseEffect(passwordManagers.load());
  teardown.push(TEARDOWN_ORDER.passwordManagers, "the password managers", () =>
    runCauseEffect(passwordManagers.dispose()),
  );
  const statementTimings = new StatementTimings();
  const tables = new AgentTables({
    sharedRoot: store.sharedRoot,
    supervisor: new AgentDatabaseSupervisor({
      spawnHost: spawnAgentDatabaseHost,
      onStatementSettled: (durationMs, request) => {
        statementTimings.record(durationMs);
        perfTime(`agentdb.${request}`, durationMs);
      },
      onHostStartFailed: ({ reason, output, consecutiveFailures, retryAfterMs }) =>
        logger.warn(
          `The shared data process ${reason} (failed starts in a row: ${consecutiveFailures}, next start after ${retryAfterMs} ms).`,
          output.length > 0 ? `Its last output: ${output}` : "It wrote no output.",
        ),
    }),
  });
  const resolveCuaDriverExecutable = () => {
    const installDirectory = process.env.CUA_DRIVER_RS_INSTALL_DIR ?? process.env.CUA_DRIVER_BIN_DIR;
    const localAppDataDirectory = process.env.LOCALAPPDATA;
    return resolveCuaDriver({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      sourceRoot: resolve(__dirname, "../.."),
      platform: process.platform,
      architecture: process.arch,
      homeDirectory: homedir(),
      pathVariable: process.env.PATH ?? null,
      overrides: [process.env.OPENBOT_CUA_DRIVER_PATH, process.env.CUA_DRIVER_PATH],
      ...(installDirectory === undefined ? {} : { installDirectory }),
      ...(localAppDataDirectory === undefined ? {} : { localAppDataDirectory }),
      applicationsDirectory: "/Applications",
    });
  };
  const cuaDriver = new CuaDriverRuntime({
    actionTap: new CuaDriverActionTap(Date.now, undefined, compactScreenshot),
    executable: await Effect.runPromise(resolveCuaDriverExecutable()),
    resolveExecutable: resolveCuaDriverExecutable,
    commandAlias: cuaDriverCommandAlias({
      platform: process.platform,
      isPackaged: app.isPackaged,
      appImagePath: process.env.APPIMAGE ?? null,
      userDataPath: app.getPath("userData"),
    }),
    endpoint: await runCauseEffect(
      resolveCuaDriverEndpoint({
        platform: process.platform,
        userDataPath: app.getPath("userData"),
        temporaryDirectory: tmpdir(),
        runtimeDirectory: process.env.XDG_RUNTIME_DIR ?? null,
      }),
    ),
    supported: isSupportedCuaDriverTarget(process.platform, process.arch),
    hostBundleId: app.isPackaged ? PACKAGED_BUNDLE_IDENTIFIER : DEVELOPMENT_BUNDLE_IDENTIFIER,
    platform: process.platform,
    onDiagnostic: (message) => {
      Effect.runFork(appendRemoteDiagnosticLog(join(app.getPath("userData"), "logs", "remote"), "cua-driver", message));
    },
    quitting,
  });
  teardown.push(TEARDOWN_ORDER.cuaDriver, "the Computer Use driver", () => runCauseEffect(cuaDriver.stop()));
  const computerUseDisplayAwake = new ComputerUseDisplayAwake({
    turnRunning: () => service.earliestRunningTurnStartedAt() !== null,
    start: () => powerSaveBlocker.start("prevent-display-sleep"),
    stop: (id) => powerSaveBlocker.stop(id),
  });
  if (process.platform === "darwin") cuaDriver.onToolCall(() => computerUseDisplayAwake.noteToolCall());
  teardown.push(TEARDOWN_ORDER.cuaDriver, "the Computer Use display hold", () => computerUseDisplayAwake.release());
  const computerUseReads = new CuaDriverDaemonClient(() =>
    cuaDriver.mcpServerForProviders() ? cuaDriver.socketPath() : null,
  );
  let computerUseWindows: unknown = null;
  const computerUseHighlight = new ComputerUseHighlightController({
    createWindow: createComputerUseHighlightWindow,
    loadWindow: loadComputerUseHighlightRenderer,
    place: sendComputerUseHighlightPlacement,
    displays: computerUseDisplays,
    idle: () => service.earliestRunningTurnStartedAt() === null,
    readPointer: () => {
      const pointer = cuaDriver.lastPointer(COMPUTER_USE_CURSOR_MAX_AGE_MS);
      const point = pointer ? pointerOnDesktop(pointer, computerUseWindows) : null;
      return point ? computerUseDesktopPoint(point) : null;
    },
    readTarget: (previous) =>
      Effect.gen(function* () {
        if (!cuaDriver.mcpServerForProviders()) return null;
        const turnStartedAt = service.earliestRunningTurnStartedAt();
        if (turnStartedAt === null) return null;
        const session = liveSession(yield* computerUseReads.sessions(), (Date.now() - turnStartedAt) / 1000);
        if (!session) return null;
        const windows = yield* computerUseReads.listWindows();
        computerUseWindows = windows;
        const action = cuaDriver.lastAction(COMPUTER_USE_ACTION_MAX_AGE_MS);
        return chooseTarget({
          windows,
          session,
          action,
          ownPid: process.pid,
          ownCoveringWindowIds: computerUseCoveringWindowIds(),
          previous,
          toDesktop: computerUseDesktopRect,
        });
      }),
  });
  teardown.push(TEARDOWN_ORDER.computerUseHighlight, "the Computer Use highlight", async () => {
    computerUseHighlight.destroy();
    await Effect.runPromise(computerUseReads.close());
  });
  const agentsShareDisplay = !hasSeparateAgentDisplay(process.platform);
  const drawsComputerUseHighlight = agentsShareDisplay && (process.platform !== "linux" || usesX11Windows());
  const computerUsePermissionHelp = new ComputerUsePermissionHelpWindowController({
    createWindow: () =>
      createComputerUsePermissionHelpWindow(language.translate, () => localeDirection(language.locale)),
    loadWindow: loadComputerUsePermissionHelpRenderer,
    bundlePath: () => applicationBundlePath(app.getPath("exe"), process.platform),
    bundleIcon: async (path) => {
      const resources = join(path, "Contents", "Resources");
      const names: string[] = await readdir(resources).catch(() => []);
      const iconName = applicationIconName(path, names);
      const icon = iconName ? nativeImage.createFromPath(join(resources, iconName)) : nativeImage.createEmpty();
      return (icon.isEmpty() ? nativeImage.createFromPath(appIconPath) : icon).resize({ width: 32, height: 32 });
    },
    revealPath: (path) => shell.showItemInFolder(path),
  });
  teardown.push(TEARDOWN_ORDER.computerUsePermissionHelp, "the Computer Use permission help", () => {
    computerUsePermissionHelp.close();
  });
  const providerTempDirectory = join(app.getPath("userData"), "provider-temp");
  performance.mark("openbot:services.computer-use");
  if (process.platform === "win32") await Effect.runPromise(sweepProviderTemp(providerTempDirectory));
  const agentApiKeys = new AgentApiKeys(join(app.getPath("userData"), "agent-api-keys"), vault.items);
  await Effect.runPromise(agentApiKeys.registerSaved());
  await Effect.runPromise(agentApiKeys.syncVault().pipe(Effect.ignore));
  let workflowTriggers: WorkflowTriggers | null = null;
  const catalogPluginServers = await Effect.runPromise(
    loadCatalogPluginServers(
      app.isPackaged
        ? join(process.resourcesPath, "plugin-catalog")
        : resolve(__dirname, "../../resources/plugin-catalog"),
    ),
  );
  providerRuntimes.setCatalogNpxApps(
    (config) =>
      config.transport === "stdio" &&
      config.command === "npx" &&
      catalogPluginSlug(config, catalogPluginServers, homedir()) !== null,
  );
  const workflowStore = new WorkflowStore({
    database: store.database,
    nextDueAt: workflowScheduleDueAt(() => serverTimezone.effective()),
  });
  const workflowRuns = new WorkflowRunStore({ database: store.database });
  const userData = app.getPath("userData");
  const storageSources = {
    libraryFiles: () => new Set(Object.keys(libraryFolders.getSnapshot().placement)),
    roots: {
      database: store.database.path,
      downloads: store.downloadsRoot,
      caches: ["remote-attachments", "remote-shared-files", "remote-workspace-files"].map((name) =>
        join(userData, name),
      ),
      logs: [
        join(userData, "logs", "remote"),
        join(userData, "logs", "update"),
        join(userData, "logs", "providers"),
        join(userData, "logs", "agents"),
        join(userData, "logs", "main"),
      ],
      runtimes: providerRuntimesRoot,
      data: userData,
    },
    database: () => store.database.connection,
    mailbox,
    agents: () => service.listAgents(),
    channelFiles: (channelId: string) =>
      service.channels.store.exists(channelId)
        ? service.channels.store.messages(channelId).flatMap((entry) =>
            (entry.message.attachments ?? []).map((attachment) => ({
              attachmentId: attachment.id,
              messageId: entry.id,
            })),
          )
        : null,
    workflowFiles: () =>
      workflowFileOwners({
        outputs: () => workflowRuns.mediaOutputs(),
        workflows: () => workflowStore.list(),
        folders: (workflowIds) => workflowFolders.getSnapshot({ workflowIds }),
      }),
  };
  const storageUsage = new StorageUsageService(new StorageUsageScanner(storageSources), storageSources);
  teardown.push(TEARDOWN_ORDER.storageUsage, "storage scans", () => Effect.runPromise(storageUsage.dispose()));
  const libraryFoldersService = new LibraryFoldersService({
    store: libraryFolders,
    storage: storageUsage,
    agents: () => service.listAgents(),
  });
  const service: AgentService = new AgentService({
    store,
    mailbox,
    browser,
    finishCheck: true,
    cacheExpiryCompaction: () => cacheExpiryCompaction.get().enabled,
    visualPreview: new ChatVisualPreviewer(),
    avatarDecoder: (bytes) => !nativeImage.createFromBuffer(Buffer.from(bytes)).isEmpty(),
    setCommitCoAuthor: (enabled) => agentDefaultsSettings.update({ commitCoAuthor: enabled }),
    clearPictureBackground: (bytes) => {
      const picture = nativeImage.createFromBuffer(Buffer.from(bytes));
      if (picture.isEmpty()) return null;
      const size = picture.getSize();
      const pixels = picture.toBitmap();
      if (!clearFlatBackground(pixels, size.width, size.height)) return null;
      return nativeImage.createFromBitmap(pixels, size).toPNG();
    },
    fitImage: fitImageForAgent,
    videoReader: new VideoReader({
      runtimeDirectory: join(app.getPath("userData"), "runtimes", "yt-dlp"),
      target: runtimeTarget(process.platform, process.arch),
      transcribe: (audio) => {
        if (voiceServer.dictates()) return voiceServer.transcribe(audio, voice.getSettings().language);
        return voice.getModelStatus().pipe(
          Effect.flatMap((status) =>
            status.phase === "ready" && (isLocalVoiceModelId(status.modelId) || isGroqVoiceModelId(status.modelId))
              ? voice.transcribe(audio)
              : Effect.fail(
                  new VoiceOperationError({
                    cause: new Error(
                      sourceText(
                        serverModeEnvironment || localServerChild
                          ? "error.voice.videoModelMissingServer"
                          : "error.voice.videoModelMissing",
                      ),
                    ),
                  }),
                ),
          ),
        );
      },
    }),
    marketplaceAppServer: (appId) => {
      const listed = catalogPluginServers.filter((server) => server.slug === appId);
      const [server] = listed;
      if (!server || listed.length !== 1) return null;
      const config = service.listMcpServers().find((saved) => catalogPluginSlug(saved, listed, homedir()) === appId);
      return config ? { config, setupSteps: server.setupSteps } : null;
    },
    passwordManagerConnected: (manager) => {
      if (manager === "onepassword") return onePasswordConnector.connected();
      if (manager === "bitwarden") return bitwardenConnector.connected();
      return passwordManagers.list().some((status) => status.manager === manager && status.state === "connected");
    },
    mcpAgentAccess: (mcpServerId, agentId) => mcpAccessStore.allowsAgent(mcpServerId, agentId),
    hiddenModels: (provider) => modelVisibility.hiddenIn(provider),
    prepareMcpTest: (config) =>
      prepareToolRuntimeForTest(config, {
        startToolRuntimes: () => {
          Effect.runFork(providerRuntimes.ensureToolRuntimes());
        },
        ensureToolRuntimesReady: () => providerRuntimes.ensureToolRuntimesReady(),
        toolRuntimes: () => providerRuntimes.mcpToolRuntimes(),
      }),
    screenCapture: hasSeparateAgentDisplay(process.platform)
      ? null
      : new ScreenCapturer({
          platform: process.platform,
          screenAccess: () => systemPreferences.getMediaAccessStatus("screen"),
          displays: () => screen.getAllDisplays(),
          primaryDisplayId: () => screen.getPrimaryDisplay().id,
          getSources: (options) => desktopCapturer.getSources(options),
        }),
    hostMemory,
    hostTurnLimits,
    agentCursorDrawn: drawsComputerUseHighlight,
    computerUseOnWayland: agentsShareDisplay && cuaDriverDrivesWayland(process.platform),
    computerUseInputRefused: () => agentsShareDisplay && cuaDriver.waylandInputRefused(),
    requestTimeoutMs: 30_000,
    offProviders: providerUse.off(),
    providerAccounts,
    saveProviderUse: (provider, on) =>
      providerUse.set(provider, on).pipe(
        Effect.tap(() => providerRuntimes.providerUseChanged()),
        Effect.mapError((error) => new AgentLifecycleFailed({ operation: "saveProviderUse", cause: error.cause })),
      ),
    installedCliProviders: providerUse.installed(),
    saveInstalledCliChoice: (provider, installed) =>
      isManagedRuntimeProvider(provider)
        ? providerUse
            .setInstalled(provider, installed)
            .pipe(
              Effect.mapError(
                (error) => new AgentLifecycleFailed({ operation: "saveInstalledCliChoice", cause: error.cause }),
              ),
            )
        : Effect.void,
    preferredProvider: setupState.preferredProvider ?? "codex",
    bundledExecutables: providerRuntimes.bundledExecutables(),
    prepareAgentWorkspace: (agent) =>
      Effect.gen(function* () {
        yield* skillCreator.syncAgent(agent);
        yield* dataSkill.syncAgent(agent);
      }),
    sidebarLayout,
    libraryFolders: libraryFoldersService.forAgents(),
    preferredModel: setupState.preferredModel,
    developmentDefaults: appVariant === "dev",
    credentials: {
      apiKey: (provider) => providerCredentials.get(provider),
      accountKeys: {
        get: (provider, accountId) => providerCredentials.accountKey(provider, accountId),
        set: (provider, accountId, key) => providerCredentials.setAccountKey(provider, accountId, key),
      },
      promptCacheTtl: () => promptCacheTtl.get().ttl,
      claudeUserSetup: () => claudeUserSetup.get().enabled,
      claudeCompactWindow: () => claudeCompactWindow.get().tokens,
      providerEnvironment: (provider) => providerEnvironmentSetting.resolve(provider),
      customProviders: () => modelReasoning.configs(),
      customAgents: () => customAgents.configs(),
      mcpServers: () => service.enabledMcpServers(),
      mcpToolRuntimes: () => providerRuntimes.mcpToolRuntimes(),
      mcpOAuth,
      mcpOAuthProxySettings,
      systemProxyFetch: (url, init) => net.fetch(url, { ...init, credentials: "omit", cache: "no-store" }),
      appVersion: app.getVersion(),
      providerStateDirectory: join(app.getPath("userData"), "provider-state"),
      ...(process.platform === "win32" ? { providerTempDirectory } : {}),
      serverEnvironment,
      agentEnvironment: () => agentDisplayEnvironment(process.platform),
    },
    computerUseMcpServer: () => cuaDriver.mcpServerForProviders(),
    passwordVault: passwordVaultRouter([
      { prefix: "", name: PASSWORD_MANAGER_BRANDS.onepassword, vault: onePasswordConnector },
      { prefix: "bitwarden:", name: PASSWORD_MANAGER_BRANDS.bitwarden, vault: bitwardenConnector },
      ...passwordManagers.routes(),
      { prefix: "openbot:", name: "the OpenBot Vault", vault: vault.logins },
    ]),
    vaultItems: vault.items,
    linkWallet: linkAccount,
    agentApiKeys,
    localSkillTools: () => localSkillTools(skills),
    browserProfiles: () => agentBrowserProfiles,
    clientBrowser,
    crm: () => crmHandle,
    crmAgentVisibleToMembers: (agentId) => host.agentVisibleToMembers(agentId),
    personCanAdminister: (personId) => host.personCanAdminister(personId),
    mcpServerOwners: {
      added: (mcpServerId, personId) =>
        mcpSignInSharedWithOthers(service.listMcpServers(), mcpServerId, (id) => mcpServerOwners.addedBy(id, personId))
          ? Effect.void
          : mcpServerOwners.add(mcpServerId, personId),
      removed: (mcpServerId) =>
        mcpServerOwners.remove(mcpServerId).pipe(Effect.andThen(mcpAccessStore.remove(mcpServerId))),
    },
    reviewSkills: (agentId) => skills.listInstalledForChatTags(agentId),
    routineFlowTools: () => routineFlowRuntime,
    workflowTools: () => workflowRuntime,
    webhookRoutines: () => agentWebhookRoutineWriter(events),
    approvalAutomation,
    busyMessageMode: () => busyMessageMode.get().mode,
    agentMemoryLimit: () => agentMemoryLimit.get().limit,
    memoryReviewInterval: () => memoryReview.get().interval,
    skillLearning: () => skillLearning.get().mode,
    userBrowsing: {
      pending: (agentId) => (browsingMemory.get().enabled ? userBrowsing.pending(agentId) : Effect.succeed([])),
      reviewed: (agentId, through) => userBrowsing.reviewed(agentId, through),
      forgetAgent: (agentId) => userBrowsing.forgetAgent(agentId),
    },
    skillLearner: () => localSkillLearner(skills),
    responseStyle: () => serverPersonality.responseStyle(),
    timezone: () => serverTimezone.effective(),
    extraRoutineSources: () => (workflowTriggers ? [workflowTriggers] : []),
    channelPersonAgentLevel: (personId, agentId) => host.channelPersonAgentLevel(personId, agentId),
    channelRemotePerson: (personId) => host.channelPersonIsRemote(personId),
    deleteWithRevokedApproval: (agentId, remove) =>
      Effect.suspend(() => {
        const workflowIds = workflowStore.workflowsOfAgent(agentId);
        return approvalAutomation.deleteAgent(agentId, remove).pipe(
          toAgentRemovalFailed,
          Effect.tap(() =>
            Effect.sync(() => {
              for (const workflowId of workflowIds) service.notifyWorkflowsChanged(workflowId);
            }),
          ),
        );
      }),
    tables,
  });
  teardown.push(TEARDOWN_ORDER.service, "the agent service", () => runCauseEffect(service.stop()));
  serverPersonality.onChange(() => service.responseStyleChanged());
  hostTurnLimits.onChange(() => service.turnLimitsChanged());
  let skillRevision = skillLearning.get().mode === "automatic";
  skillLearning.onChange(({ mode }) => {
    if ((mode === "automatic") === skillRevision) return;
    skillRevision = mode === "automatic";
    service.skillRevisionChanged();
  });
  const agentMemoryLimitSetting = reloadingAgentMemoryLimit(agentMemoryLimit, service);
  promptCacheTtl.onChange(() => service.notifyProviderSettingsChanged());
  const cacheExpiryCompactionSetting = cacheExpiryCompactionControl(cacheExpiryCompaction);
  const claudeUserSetupSetting = claudeUserSetupControl(claudeUserSetup, () => service.notifyProviderSettingsChanged());
  const claudeCompactWindowSetting = claudeCompactWindowControl(claudeCompactWindow, () =>
    service.notifyProviderSettingsChanged(),
  );
  const modelVisibility = new ModelVisibility({
    path: join(app.getPath("userData"), MODEL_VISIBILITY_PREFERENCE_FILE),
    catalog: modelReleaseCatalog,
    listModels: () => service.listModels(),
    listAgents: () => service.listAgents(),
    customEndpoints: () => customProviders.list(),
    modelsChanged: () => service.notifyProviderSettingsChanged(),
  });
  await runCauseEffect(modelVisibility.load());
  const turnAnswer = (agentId: string, turnId: string): string | null =>
    latestTurnAnswer(store.database.readTurnAssistantMessages(agentId, turnId), turnId)?.text ?? null;
  const automation = new AutomationServer({
    root: store.automationRoot,
    listAgents: () => service.listAgents(),
    agentDefaults: () => agentDefaults.get(),
    listModels: () => service.listModels(),
    providerStatuses: () => service.getStatus().providers ?? [],
    listRoutines: (agentId) => service.listRoutines(agentId),
    runRoutine: (input) => service.runRoutineFromAutomation(input),
    sendMessage: (input) => service.sendMessage(input),
    getLocalAttention: (agentId) => service.getLocalAttention(agentId),
    respondToLocalAttention: (agentId, input) => service.respondToLocalAttention(agentId, input),
    delivery: (deliveryId) => mailbox.getDelivery(deliveryId)?.delivery ?? null,
    turnAnswer,
    updateAgent: (input) => service.updateAgent(input),
    clearAgentContext: (agentId) => service.clearAgentContext(agentId),
  });
  await Effect.runPromise(automation.removeStaleFiles());
  service.on("event", (event) => {
    if (event.type === "agents-changed") Effect.runFork(automation.requestSync());
  });
  teardown.push(TEARDOWN_ORDER.automation, "the automation server", () => Effect.runPromise(automation.stop()));
  const stopHandoff = (agentId: string, deliveryId: string) => {
    const found = mailbox.getDelivery(deliveryId)?.delivery;
    if (
      !found ||
      found.status === "completed" ||
      found.status === "failed" ||
      found.status === "interrupted" ||
      found.status === "cancelled"
    )
      return Effect.void;
    return found.status !== "queued" && found.turnId
      ? service.interrupt(agentId, found.turnId)
      : service.cancelQueuedMessage(agentId, deliveryId);
  };
  const routineFlowRuntime = await Effect.runPromise(
    createRoutineFlows({
      store: new RoutineFlowStore({ database: store.database }),
      routines: routineFlowRoutines(new AgentRoutineStore(store.database)),
      delivery: (deliveryId) => {
        const found = mailbox.getDelivery(deliveryId)?.delivery;
        return found ? { status: found.status, turnId: found.turnId, error: found.error } : null;
      },
      turnAnswer,
      agentName: (agentId) => store.list().find((agent) => agent.id === agentId)?.name ?? agentId,
      sendHandoff: (input) => service.enqueueRoutineHandoff(input),
      stopRoutineRun: (input) => service.stopRoutineRun(input),
      stopDelivery: stopHandoff,
      changed: (agentIds) => {
        for (const agentId of agentIds) service.notifyRoutineFlowsChanged(agentId);
      },
    }),
  );
  teardown.push(TEARDOWN_ORDER.routineFlows, "the routine flows", () => Effect.runPromise(routineFlowRuntime.close()));
  const workflowRuntime = await Effect.runPromise(
    createWorkflows({
      store: workflowStore,
      runs: workflowRuns,
      github: new WorkflowGitHubStore({ database: store.database }),
      githubApp: () => null,
      delivery: (deliveryId) => {
        const found = mailbox.getDelivery(deliveryId)?.delivery;
        return found ? { status: found.status, turnId: found.turnId, error: found.error } : null;
      },
      turnAnswer,
      sendHandoff: (input) => service.enqueueRoutineHandoff(input),
      filePath: (attachmentId) =>
        mailbox.resolveAttachment(attachmentId).pipe(Effect.map((file) => file?.path ?? null)),
      stopDelivery: stopHandoff,
      generateText: (request) =>
        service.generateWorkflowText(request).pipe(
          Effect.mapError((failure) => ({
            message: failure.cause instanceof Error ? failure.cause.message : sourceText("error.workflow.modelFailed"),
          })),
        ),
      chooseTextModel: (request) =>
        service.chooseWorkflowModel(request).pipe(
          Effect.mapError((failure) => ({
            message: failure.cause instanceof Error ? failure.cause.message : sourceText("error.workflow.modelFailed"),
          })),
        ),
      generateMedia: (request) =>
        service.generateWorkflowMedia(request).pipe(
          Effect.mapError((failure) => ({
            message: failure.cause instanceof Error ? failure.cause.message : sourceText("error.workflow.mediaFailed"),
          })),
        ),
      sizePicture: (attachmentId, size) =>
        Effect.gen(function* () {
          const file = yield* mailbox.resolveAttachment(attachmentId);
          if (!file) return yield* Effect.fail(new Error("The generated picture is gone."));
          const source = yield* Effect.tryPromise(() => readFile(file.path));
          const bytes = yield* Effect.try(() => sizeWorkflowPicture(source, size));
          if (!bytes) return yield* Effect.fail(new Error("The generated picture could not be decoded."));
          const stored = yield* mailbox.storeGeneratedAttachment({
            bytes,
            name: "generated-image.png",
            mimeType: "image/png",
          });
          yield* mailbox.deleteStoredFile(attachmentId).pipe(Effect.ignore);
          return stored.id;
        }).pipe(
          Effect.mapError((failure) => ({
            message: failure instanceof Error ? failure.message : String(failure),
          })),
        ),
      mediaProviders: () => service.workflowMediaProviders(),
      mediaCredits: (only) => service.workflowMediaCredits(only),
      mediaCatalog: (only) => service.workflowMediaCatalog(only),
      mediaPrice: (request) => service.workflowMediaPrice(request),
      keepPicture: (draftId, types) =>
        mailbox.keepDraft(draftId, types).pipe(
          Effect.map((kept) => (typeof kept === "string" ? kept : kept.id)),
          Effect.ensuring(Effect.sync(() => storageUsage.invalidate())),
        ),
      notify: (notice) => forwardWorkflowNotice(notice),
      connectionOn: (connectionId) => service.messaging.store.connection(connectionId)?.enabled === true,
      post: (connectionId, placeId, markdown) => service.messaging.deliver(connectionId, placeId, markdown),
      channelPost: (input) => service.channels.postNote(input),
      changed: (workflowId, agentId) => service.notifyWorkflowsChanged(workflowId, agentId),
      rearm: () => service.armRoutines(),
      timezone: () => serverTimezone.effective(),
      runEnded: (end) => service.notifyWorkflowRunEnded(end),
    }),
  );
  const workflowFoldersService = new WorkflowFoldersService({ store: workflowFolders, workflows: workflowRuntime });
  const workflowFiles = createWorkflowFileExporter({
    agents: () => service.listAgents(),
    channelName: (channelId) =>
      service.channels.store.ids().includes(channelId) ? service.channels.store.get(channelId).name : null,
    attachment: (fileId) => mailbox.resolveAttachment(fileId).pipe(Effect.orElseSucceed(() => null)),
    timezone: () => serverTimezone.effective(),
    appVersion: app.getVersion(),
  });
  workflowTriggers = new WorkflowTriggers({
    store: workflowStore,
    timezone: () => serverTimezone.effective(),
    start: (start) => workflowRuntime.startScheduled(start),
    changed: (workflowId) => service.notifyWorkflowsChanged(workflowId),
  });
  service.armRoutines();
  vault.onChanged(() => service.notifyVaultChanged());
  vault.onChanged(() => void Effect.runPromise(agentApiKeys.syncVault().pipe(Effect.ignore)));
  teardown.push(TEARDOWN_ORDER.workflows, "the workflows", () => Effect.runPromise(workflowRuntime.close()));
  const stripeCrmKey = new VoiceApiKeyStore({
    path: join(app.getPath("userData"), "crm-stripe-key.json"),
    cipher: secretCipher,
  });
  await runCauseEffect(stripeCrmKey.load());
  const crm = await Effect.runPromise(
    createCrm({
      database: store.database,
      changed: () => service.notifyCrmChanged(),
      settings: crmSettingsStore(crmPreference),
      sources: {
        keys: {
          get: () => stripeCrmKey.get(),
          set: (_kind, key) =>
            stripeCrmKey.set(key).pipe(
              Effect.mapError(
                (failure) =>
                  new CrmError({
                    code: "refused",
                    message:
                      failure.cause instanceof Error &&
                      failure.cause.message === sourceText("error.app.secretStorageUnavailable")
                        ? failure.cause.message
                        : sourceText("error.crm.sourceKeySaveFailed"),
                  }),
              ),
            ),
        },
        adapters: [
          stripeSource({
            fetch: (input, init) => net.fetch(input.href, init),
            ...(app.isPackaged || !process.env.OPENBOT_DEV_STRIPE_API_BASE
              ? {}
              : { apiBase: process.env.OPENBOT_DEV_STRIPE_API_BASE }),
          }),
        ],
      },
    }),
  );
  crmHandle = crm;
  teardown.push(TEARDOWN_ORDER.crm, "the CRM", () => {
    crmHandle = null;
    return Effect.runPromise(crm.close());
  });
  const routineResultRuntime = await Effect.runPromise(
    createRoutineResults({
      store: new RoutineResultStore(store.database),
      runTurns: (deliveryId) => mailbox.routineRunTurns(deliveryId),
      turnAnswer,
      connection: (connectionId) => {
        const record = service.messaging.store.connection(connectionId);
        return record?.enabled ? { platform: record.platform, name: record.workspaceName } : null;
      },
      options: () => service.messaging.destinationOptions(),
      post: (connectionId, placeId, markdown) => service.messaging.deliver(connectionId, placeId, markdown),
      changed: (agentIds) => {
        for (const agentId of agentIds) service.notifyRoutineResultsChanged(agentId);
      },
    }),
  );
  service.on("event", (event) => {
    if (routineFlowNoticeEvent(event)) Effect.runFork(routineFlowRuntime.notice(event));
    if (routineResultNoticeEvent(event)) Effect.runFork(routineResultRuntime.notice(event));
    if (workflowNoticeEvent(event)) Effect.runFork(workflowRuntime.notice(event));
  });
  teardown.push(TEARDOWN_ORDER.routineResults, "the routine results", () =>
    Effect.runPromise(routineResultRuntime.close()),
  );
  const routineFeed = new RoutineFeedServer({
    path: join(app.getPath("userData"), ROUTINE_FEED_FILE),
    cipher: secretCipher,
    document: localRoutineFeedDocument(service, language.translate),
  });
  await Effect.runPromise(routineFeed.start());
  teardown.push(TEARDOWN_ORDER.routineFeed, "the routine feed", () => Effect.runPromise(routineFeed.stop()));
  performance.mark("openbot:services.routines");
  const messaging = await createMessagingServices({ teardown, secretCipher, service, sidebarLayout });
  service.setComputerUseCapability(computerUseCapability(cuaDriver.lastState));
  cuaDriver.onStateChanged((state) => service.setComputerUseCapability(computerUseCapability(state)));
  cuaDriver.onMcpServerChanged(() => {
    void runCauseEffect(service.notifyComputerUseChanged()).catch((error) =>
      logger.warn("Provider tools did not refresh.", toLogValue(error)),
    );
  });
  const startComputerUseHighlight = () => {
    if (drawsComputerUseHighlight && cuaDriver.mcpServerForProviders()) computerUseHighlight.start();
  };
  cuaDriver.onMcpServerChanged(() => {
    if (cuaDriver.mcpServerForProviders()) {
      startComputerUseHighlight();
    } else {
      computerUseHighlight.stop();
      void Effect.runPromise(computerUseReads.close());
    }
  });
  const computerUseWarmUp = Effect.runFork(
    cuaDriver.warmUp().pipe(
      Effect.tap(() => Effect.sync(startComputerUseHighlight)),
      Effect.exit,
    ),
  );
  service.on("event", (event) => {
    if (event.type === "turn-started") startComputerUseHighlight();
    if (event.type === "turn-completed" && !event.continues) computerUseDisplayAwake.turnEnded();
  });
  if (!setupState.completed || service.enabledMcpServers().length > 0)
    Effect.runFork(providerRuntimes.ensureToolRuntimes());
  performance.mark("openbot:services.messaging");
  await runCauseEffect(sidebarLayout.reconcileAgents(service.sidebarChatIds()));
  libraryFolders.onChanged(() => service.notifyLibraryFoldersChanged());
  workflowFolders.onChanged(() => service.notifyWorkflowFoldersChanged());
  await runCauseEffect(libraryFolders.reconcileAgents(new Set(service.listAgents().map((agent) => agent.id))));
  await runCauseEffect(
    libraryFolders.reconcileFiles(new Set(mailbox.listStoredFiles().map((stored) => stored.attachment.id))),
  );

  const trackSystemCliVersions = (status: AgentStatus): void => {
    let copyInUse = false;
    for (const provider of status.providers ?? []) {
      if (!isManagedRuntimeProvider(provider.id)) continue;
      const version = provider.cliSource === "system" ? (provider.version ?? null) : null;
      if (providerRuntimes.setSystemVersion(provider.id, version, provider.cliIncomplete === true)) copyInUse = true;
    }
    if (copyInUse) Effect.runFork(providerRuntimes.providerUseChanged());
    hermesInstaller.setProvider(status.providers?.find((provider) => provider.id === "hermes"));
  };
  trackSystemCliVersions(service.getStatus());
  service.on("event", (event) => {
    if (event.type === "status") trackSystemCliVersions(event.status);
  });
  providerRuntimes.on("status", forwardProviderRuntimeStatus);
  if (diskRestoring()) {
    updateCheckWait = Effect.runFork(
      diskRestoreEnded.pipe(Effect.andThen(Effect.sync(() => providerRuntimes.startUpdateChecks()))),
    );
  } else {
    providerRuntimes.startUpdateChecks();
  }
  providerRuntimes.on("ready", (runtime) => {
    if (isManagedToolRuntime(runtime)) Effect.runFork(service.refreshAllAgentRuntimes("after-background-work"));
  });
  service.on("event", (event) => {
    if (event.type === "agents-changed") storageUsage.invalidate();
  });
  approvalAutomation.subscribe(() => service.notifyAgentsChanged());
  const skills = new SkillMarketplaceService(
    () => service.listAgents(),
    (agentId) =>
      service
        .refreshAgentRuntime(agentId)
        .pipe(Effect.ensuring(Effect.sync(() => service.notifySkillsChanged(agentId)))),
    new LocalSkillLibrary(join(app.getPath("userData"), "local-skills"), () => service.listAgents()),
    githubSkillSource((url, init) => fetch(url, init)),
  );
  performance.mark("openbot:services.team");
  const machineAlertStore = new MachineAlertPreferenceStore(
    join(app.getPath("userData"), MACHINE_ALERTS_PREFERENCE_FILE),
  );
  await runCauseEffect(machineAlertStore.load());
  const machineMetrics = new MachineMetricsSampler(storageSources.roots.data);
  const machineAlertMetrics = new MachineMetricsSampler(storageSources.roots.data);
  const machineAlerts = new MachineAlertMonitor({
    read: () => machineAlertMetrics.read(),
    display: () => machineMetrics.read(),
    store: machineAlertStore,
    members: () => (teamStore.configured ? teamStore.listMembers() : []),
    onError: (message, error) => logger.warn(message, toLogValue(error)),
  });
  teardown.push(TEARDOWN_ORDER.machineAlerts, "the machine alert check", () => machineAlerts.close());
  const events = new HostEventsService({
    routines: service.routineRecords,
    agentKeys: hostAgentWebhookKeys(agentApiKeys),
  });
  if (developmentRemoteRole) {
    await runCauseEffect(
      applyDevelopmentRemoteProfile({
        role: developmentRemoteRole,
        testClientEnabled: developmentTestClientEnabled,
        profile: localProfile.get(),
        teamStore,
        setupFile,
        setupCompleted: setupState.completed,
      }),
    );
  }
  const teamChatStore = new TeamChatStore(store.database);
  performance.mark("openbot:services.hosted");
  const agentAdminSettings = createAgentAdminSettings({ agents: service, approvalAutomation });
  const agentHostSettings = createAgentHostSettings({ agents: service, busyMessageMode, agentDefaults });
  const agentDefaultsSettings = createAgentDefaultsSettings({ agents: service, agentDefaults, busyMessageMode });
  const agentFolders = createAgentFolders({ service, userDataPath: app.getPath("userData") });
  const channelFolders = createChannelFolders({
    service,
    userDataPath: app.getPath("userData"),
    browse: agentFolders.browse,
  });
  const agentInstructions = createAgentInstructionsFiles(service);
  const browserProfiles = createBrowserProfileService({
    store: browserProfileStore,
    proxies: browserProxyStore,
    cipher: browserProxyCipher,
    agents: service,
    browser,
    memberName: (memberId) => {
      const member = teamStore.getMember(memberId);
      return member ? (member.name ?? member.username) : null;
    },
    computerOnline: (memberId) => browserEgress.online(memberId),
    onChanged: () => service.notifyBrowserProfilesChanged(),
  });
  browserProxyStatusChanged = () => service.notifyBrowserProfilesChanged();
  agentBrowserProfiles = browserProfiles;
  browserEgress.on("connected", (memberId) => browser.forgetComputerFailures(memberId));
  browserEgress.on("changed", () => service.notifyBrowserProfilesChanged());
  const customProviderChanges = createCustomProviderChanges({
    service,
    customProviders,
    providerRuntimes,
    refreshModelReasoning: () => modelReasoning.refresh().pipe(Effect.map(({ changed }) => changed)),
  });
  modelReasoningWait = Effect.runFork(
    Effect.gen(function* () {
      for (const wait of MODEL_REASONING_RETRY_WAITS_MS) {
        yield* Effect.sleep(wait);
        const { changed, unreachable } = yield* modelReasoning.refresh();
        if (changed) yield* service.reloadCustomProviderConfig("opencode").pipe(Effect.ignore);
        if (!unreachable) return;
      }
    }),
  );
  const customAgentChanges = createCustomAgentChanges({ service, customAgents });
  const acpRegistry = createAcpRegistry({
    directory: app.getPath("userData"),
    customAgentChanges,
    withRuntimeRemoval: (ids, operation) =>
      service
        .withCustomAgentRuntimeRemoval(ids, () =>
          operation.pipe(
            Effect.mapError(
              (failure) => new AgentLifecycleFailed({ operation: "removeCustomAgentRuntime", cause: failure.cause }),
            ),
          ),
        )
        .pipe(toProviderRuntimeFailure),
  });
  teardown.push(TEARDOWN_ORDER.providerRuntimes - 1, "ACP registry installations", () =>
    runCauseEffect(acpRegistry.close()),
  );
  let requestedUpdate: RequestedUpdate | undefined;
  const installationMode =
    app.isPackaged && process.platform === "linux" ? await runCauseEffect(readInstallationMode()) : null;
  const scheduledUpdate = (): RequestedUpdate => {
    if (!requestedUpdate) throw new RequestedUpdateRefusal("unsupported");
    return requestedUpdate;
  };
  const agentImport = new AgentImportService(
    service,
    {
      library: () => skills.requireLocalLibrary(),
      installLocal: (input) => skills.installLocal(input),
    },
    () => host.channelActor(),
    () => serverTimezone.effective(),
    join(app.getPath("userData"), "agent-import-uploads"),
  );
  const hermesImport = new HermesImportService(
    {
      listAgents: () => service.listAgents(),
      createAgentProfile: (input) => service.createAgentProfile(input),
      updateAgent: (input) => service.updateAgent(input),
      deleteAgent: (agentId) => service.deleteAgent(agentId),
      createRoutine: (input, options) => service.createRoutine(input, options),
      listRoutines: (agentId) => service.listRoutines(agentId),
      createMemory: (input) => service.createMemory(input),
      listMemories: (agentId) => service.listMemories(agentId),
      memoryLimit: () => service.memoryLimit(),
      initializeMemorySelection: (agentId) => service.initializeMemorySelection(agentId),
      listMcpServers: () => service.listMcpServers(),
      saveMcpServer: (config) => service.saveMcpServer({ config }),
    },
    { library: () => skills.requireLocalLibrary(), installLocal: (input) => skills.installLocal(input) },
    join(app.getPath("userData"), HERMES_IMPORT_LINKS_FILE),
    () => serverTimezone.effective(),
  );
  const instanceTransfer = new InstanceTransferService({
    agents: service,
    skills: { library: () => skills.requireLocalLibrary(), installLocal: (input) => skills.installLocal(input) },
    sharedRoot: store.sharedRoot,
    channelActor: () => host.channelActor(),
    webhookRoutines: {
      list: (owner) => events.listRoutines({ owner }),
      save: (input) => events.saveRoutine(input),
    },
    preferences: {
      notificationLevel: (agentId) => agentNotificationLevels.levels(OWNER_NOTIFICATION_KEY).get(agentId) ?? null,
      setNotificationLevel: (agentId, level) => agentNotificationLevels.set(OWNER_NOTIFICATION_KEY, { agentId, level }),
      pinned: (agentId) =>
        sidebarPins.snapshot(OWNER_PIN_KEY).items.some((pin) => pin.kind === "agent" && pin.id === agentId),
      pin: (agentId) =>
        sidebarPins.set(OWNER_PIN_KEY, [...sidebarPins.snapshot(OWNER_PIN_KEY).items, { kind: "agent", id: agentId }]),
      autoApproves: (agentId) => approvalAutomation.autoApproves(agentId),
      setAutoApprove: (agentId, autoApprove) => approvalAutomation.set({ agentId, autoApprove }),
      apiKeyNames: (agentId) =>
        agentApiKeys
          .list(agentId)
          .pipe(Effect.map((keys) => keys.filter((key) => key.source !== "vault").map((key) => key.name))),
    },
    ownerMemberId: () => (teamStore.configured ? teamStore.getOwnerMemberId() : null),
    memberPreferences: {
      read: () =>
        (teamStore.configured ? teamStore.memberAccounts() : [])
          .filter((member) => !member.owner)
          .map(({ memberId, accountId }) => ({
            accountId,
            server: agentNotificationLevels.serverLevel(memberId),
            agents: [...agentNotificationLevels.levels(memberId)].map(([agentId, level]) => ({ agentId, level })),
            pins: sidebarPins.snapshot(memberId).items,
          })),
      apply: (preferences, owner) =>
        Effect.gen(function* () {
          const member = (teamStore.configured ? teamStore.memberAccounts() : []).find(
            (candidate) => candidate.accountId === preferences.accountId,
          );
          if (!member || (member.owner && !owner)) return false;
          const levelKey = member.owner ? OWNER_NOTIFICATION_KEY : member.memberId;
          const pinKey = member.owner ? OWNER_PIN_KEY : member.memberId;
          if (preferences.server !== null) yield* agentNotificationLevels.setServer(levelKey, preferences.server);
          for (const choice of preferences.agents) yield* agentNotificationLevels.set(levelKey, choice);
          const current = sidebarPins.snapshot(pinKey).items;
          const added = preferences.pins.filter(
            (pin) => !current.some((item) => item.kind === pin.kind && item.id === pin.id),
          );
          if (added.length > 0) yield* sidebarPins.set(pinKey, [...current, ...added]);
          return true;
        }),
    },
    sharedSkills: (() => {
      const library = Effect.try({ try: () => skills.requireLocalLibrary(), catch: (cause) => cause });
      return {
        list: () =>
          library.pipe(
            Effect.flatMap((local) => local.listWithUnreadable()),
            Effect.map(({ skills, unreadable }) => ({
              skills: skills.map(({ id, slug, name, version }) => ({ id, slug, name, version })),
              unreadable: unreadable.map(({ skillId }) => skillId),
            })),
          ),
        assigned: (agentIds: readonly string[]) =>
          Effect.forEach(agentIds, (agentId) =>
            skills.lockedSkillIds(agentId).pipe(Effect.orElseSucceed(() => [])),
          ).pipe(Effect.map((ids) => new Set(ids.flat()))),
        bundle: (id: string, version: number) => library.pipe(Effect.flatMap((local) => local.bundle(id, version))),
        add: (bytes: Uint8Array) => library.pipe(Effect.flatMap((local) => local.createFromBundle(bytes))),
      };
    })(),
    serverIdentity: {
      read: () => {
        const identity = teamStore.configured ? teamStore.getIdentity() : null;
        if (!identity) return null;
        const logo = teamStore.resolveLogo();
        return { name: identity.serverName, logo: logo ? { path: logo.path, mimeType: logo.mimeType } : null };
      },
      save: (input) => host.updateIdentity(input),
    },
    serverPreferences: {
      timezone: { get: () => serverTimezone.get().timezone, set: (timezone) => serverTimezone.set(timezone) },
      personality: { get: () => serverPersonality.get(), set: (personality) => serverPersonality.set(personality) },
      busyMessageMode: { get: () => busyMessageMode.get(), set: (mode) => busyMessageMode.set(mode) },
      agentDefaults: {
        get: () => agentDefaults.get(),
        set: (defaults) => {
          const previous = agentDefaults.get();
          return agentDefaults
            .set(defaults)
            .pipe(Effect.tap(() => Effect.sync(() => service.agentDefaultsChanged(previous))));
        },
      },
      memoryLimit: { get: () => agentMemoryLimit.get(), set: (limit) => agentMemoryLimit.set(limit) },
      memoryReview: { get: () => memoryReview.get(), set: (review) => memoryReview.set(review) },
      skillLearning: { get: () => skillLearning.get(), set: (mode) => skillLearning.set(mode) },
      promptCacheTtl: { get: () => promptCacheTtl.get().ttl, set: (ttl) => promptCacheTtl.set(ttl) },
      ownerNotificationLevel: {
        get: () => agentNotificationLevels.serverLevel(OWNER_NOTIFICATION_KEY),
        set: (level) => agentNotificationLevels.setServer(OWNER_NOTIFICATION_KEY, level),
      },
      browsingMemory: { get: () => browsingMemory.get(), set: (value) => browsingMemory.set(value) },
      claudeUserSetup: {
        get: () => claudeUserSetupSetting.get().enabled,
        set: (enabled) => claudeUserSetupSetting.set(enabled),
      },
      cacheExpiryCompaction: {
        get: () => cacheExpiryCompaction.get().enabled,
        set: (enabled) => cacheExpiryCompactionSetting.set(enabled),
      },
      claudeCompactWindow: {
        get: () => claudeCompactWindowSetting.get().tokens,
        set: (tokens) => claudeCompactWindowSetting.set(tokens),
      },
      machineAlerts: { get: () => machineAlerts.alerts(), set: (settings) => machineAlerts.setAlerts(settings) },
      modelVisibility: {
        get: () => modelVisibility.hiddenModels(),
        set: (models) => modelVisibility.replaceHidden(models),
      },
      turnLimits: {
        get: () => {
          const { turnLimit, agentTaskLimit } = hostTurnLimits.get();
          return { turnLimit, agentTaskLimit };
        },
        set: (limits) => hostTurnLimits.set(limits),
      },
    },
    appVersion: app.getVersion(),
    uploadDirectory: join(app.getPath("userData"), "instance-transfer-uploads"),
    timezone: () => serverTimezone.effective(),
    settings: {
      mcpServers: () => service.listMcpServers(),
      saveMcpServer: (config) => service.saveMcpServer({ config }),
      customProviders: () => customProviderChanges.list(),
      saveCustomProvider: (input) => customProviderChanges.save(input),
      customAgents: () => customAgentChanges.list(),
      providersOff: () => providerUse.off(),
      sidebar: () => sidebarLayout.getSnapshot(),
      mutateSidebar: (action) => sidebarLayout.mutate(action, service.sidebarChatIds()),
      routineFlowLinks: (agentId) => routineFlowRuntime.canvas(agentId).pipe(Effect.map((canvas) => canvas.links)),
      connectRoutineFlow: (input) => routineFlowRuntime.connect(input),
      routineFlowPositions: (agentId) =>
        routineFlowRuntime.canvas(agentId).pipe(Effect.map((canvas) => canvas.positions)),
      saveRoutineFlowPosition: (input) => routineFlowRuntime.savePosition(input),
      workflows: {
        workflows: () =>
          workflowRuntime.listWithGraphs().pipe(
            Effect.map((list) =>
              list.map(({ summary, graph, needsNewerApp }) => ({
                title: summary.title,
                graph,
                ...(needsNewerApp ? { needsNewerApp } : {}),
              })),
            ),
          ),
        createWorkflow: (input) => workflowRuntime.createCopy(input),
      },
      signedInProviders: () =>
        (service.getStatus().providers ?? [])
          .filter((provider) => provider.state === "available" && !provider.off)
          .map((provider) => provider.id),
    },
  });
  const mcpHostSignIns = new McpHostSignIns({ service, browser });
  const providerSignIns = new ProviderHostSignIns({ service, browser });
  const providerAccountsHost = new ProviderAccountsHost({ service, browser });
  const signInRelayHost = new SignInRelayHost({
    mcp: mcpHostSignIns,
    providers: providerSignIns,
    accounts: providerAccountsHost,
    receiveMcpGrant: (state, code) => mcpOAuth.receiveAuthorizationCode(state, code),
    receiveMcpRefusal: (state) => mcpOAuth.refuseAuthorization(state),
    cancelMcpSignInPage: (state) => mcpOAuth.cancelSignInPage(state),
    printedLink: (agentId, url) =>
      agentPrintedLink(
        service.searchConversationMessages(url, agentId, undefined, 20).results.map(({ message }) => message),
        url,
        Date.now(),
      ),
    atHost: (sessionId) => localServerChild !== null && teamStore.isStoredOwnerSession(sessionId),
  });
  teardown.push(TEARDOWN_ORDER.mcpHostSignIns, "MCP sign-ins of joined servers", () =>
    Effect.runPromise(mcpHostSignIns.close()),
  );
  teardown.push(TEARDOWN_ORDER.providerAccountsHost, "Provider account sign-ins of joined servers", () =>
    Effect.runPromise(providerAccountsHost.close()),
  );
  teardown.push(TEARDOWN_ORDER.providerHostSignIns, "Provider sign-ins of joined servers", () =>
    Effect.runPromise(providerSignIns.close()),
  );
  const providerHostSignIns = process.platform === "linux" ? providerSignIns : undefined;
  let localServersForTeam: LocalServers | null = null;
  const availableLocalServers = () =>
    Effect.suspend(() =>
      localServersForTeam
        ? Effect.succeed(localServersForTeam)
        : Effect.fail(new RemoteWorkflowError({ cause: new Error(sourceText("error.team.localServersUnsupported")) })),
    );
  const awaySeconds = app.isPackaged ? Number.NaN : Number(process.env.OPENBOT_DEV_AWAY_SECONDS);
  const awayAfterMs = Number.isInteger(awaySeconds) && awaySeconds > 0 ? awaySeconds * 1_000 : 30_000;
  const computerIdle = createComputerIdle(
    (contents) =>
      windows.getMainWindow()?.webContents === contents ||
      windows.getChatWindows().some((chat) => chat.webContents === contents),
  );
  const mcpAccess: McpAccessControl = {
    revision: () => mcpAccessStore.revision(),
    get: (mcpServerId) => mcpAccessStore.get(mcpServerId),
    set: (change, existing) =>
      Effect.suspend(() => {
        const before = mcpAccessStore.get(change.mcpServerId).agents;
        return mcpAccessStore
          .set(change, existing)
          .pipe(
            Effect.andThen(
              sameMcpAgents(before, change.access.agents)
                ? Effect.void
                : service.refreshAllAgentRuntimes(
                    mcpAgentsOnlyAdded(before, change.access.agents) ? "after-background-work" : "now",
                  ),
            ),
          );
      }),
    remove: (mcpServerId) => mcpAccessStore.remove(mcpServerId),
  };
  const attachmentPreviews = new AttachmentPreviews(join(app.getPath("userData"), "attachment-previews"));
  const host = new HostService({
    appVersion: app.getVersion(),
    store: teamStore,
    agents: service,
    agentsReady: () => agentInitialization.awaitRoster(),
    events,
    skills,
    sidebarLayout,
    mailbox,
    attachmentPreviews,
    browser,
    chat: teamChatStore,
    channels: service.channels,
    mcpServers: service,
    mcpServerOwners,
    mcpAccess,
    mcpSignIns: mcpHostSignIns,
    signInRelay: signInRelayHost,
    connectors: { messaging },
    onePasswordConnector,
    bitwardenConnector,
    passwordManagers,
    vault,
    providerHostSignIns,
    providerAccounts: providerAccountsHost,
    providerUsageResets: service,
    providerSignOut: service,
    storage: storageUsage,
    libraryFolders: libraryFoldersService,
    workflowFolders: workflowFoldersService,
    machine: machineAlerts,
    backgroundProcesses: {
      list: () => listBackgroundProcesses(process.platform, service.listAgents()),
      stop: (id) => stopBackgroundProcess(process.platform, id),
    },
    clientBrowser,
    voiceTranscription: {
      transcribe: (audio) => {
        if (voiceServer.dictates()) return voiceServer.transcribe(audio, voice.getSettings().language);
        return voice.getModelStatus().pipe(
          Effect.flatMap((status) => {
            if (status.phase === "ready" && (isLocalVoiceModelId(status.modelId) || isGroqVoiceModelId(status.modelId)))
              return voice.transcribe(audio);
            const preparing =
              isLocalVoiceModelId(status.modelId) && (status.phase === "missing" || status.phase === "downloading");
            const refusal = Effect.fail(
              new VoiceOperationError({
                cause: new Error(sourceText(preparing ? "error.voice.host.preparing" : "error.voice.host.notSetUp")),
              }),
            );
            return preparing && status.phase === "missing"
              ? Effect.forkDetach(Effect.ignore(voice.prepareModel())).pipe(Effect.andThen(refusal))
              : refusal;
          }),
        );
      },
    },
    agentImport,
    hermesImport: {
      read: () => hermesImport.stage(hermesRoot()),
      apply: (input) => hermesImport.apply(input),
      discard: (token) => hermesImport.discard(token),
    },
    instanceTransfer,
    routineFlows: routineFlowRuntime,
    workflows: {
      ...workflowRuntime,
      files: workflowFiles,
    },
    crm,
    hiddenAgents: service,
    routineRunPlaces: service.routineRecords,
    agentNotificationLevels,
    sidebarPins,
    agentAccess,
    serverAudit,
    agentTasks: service,
    browserProfiles,
    focusUse: false,
    admin: {
      agents: agentAdminSettings,
      agentHost: agentHostSettings,
      agentDefaults: agentDefaultsSettings,
      folders: agentFolders,
      channelFolders,
      instructions: agentInstructions,
      sessionSettings: service,
      acpRegistry,
      customAgents: customAgentChanges,
      skills,
      sharedTables: service,
      providers: {
        service,
        credentials: providerCredentials,
        runtimes: providerRuntimes,
        customProviders: customProviderChanges,
        pasteSignIn: pasteCodeLoginSupported(),
      },
      update: {
        snapshot: () => scheduledUpdate().snapshot(),
        check: () => scheduledUpdate().check(),
        start: (member, mode) => scheduledUpdate().start(member, mode),
        requestWhenIdle: (member) => scheduledUpdate().requestWhenIdle(member),
        cancel: () => scheduledUpdate().cancel(),
        changeSettings: (change) => scheduledUpdate().changeSettings(change),
      },
      timezone: serverTimezone,
      signalHome: hostSignalHome,
      ...(serverModeEnvironment || localServerChild
        ? {
            voiceModel: {
              snapshot: () => hostVoiceModel.snapshot(),
              change: (change: HostVoiceModelChange) => hostVoiceModel.change(change),
            },
          }
        : {}),
      turnLimits: hostTurnLimits,
      ...(serverModeEnvironment
        ? {
            restart: {
              request: (memberId) => {
                logger.info(`Member ${memberId} asked this server to restart.`);
                setImmediate(() => app.quit());
              },
            },
          }
        : {}),
      personality: serverPersonality,
      memoryLimit: agentMemoryLimitSetting,
      memoryReview,
      skillLearning,
      browsingMemory,
      promptCacheTtl,
      claudeUserSetup: claudeUserSetupSetting,
      cacheExpiryCompaction: cacheExpiryCompactionSetting,
      claudeCompactWindow: claudeCompactWindowSetting,
      providerEnvironment: providerEnvironmentSetting,
      providerDetection: { detection: providerDetection, settings: providerDetectionSettings },
      modelVisibility,
      defaultProvider: {
        get: () =>
          readSetupState(setupFile).pipe(
            Effect.map((state) => ({
              provider: service.preferredProvider(),
              model: state.preferredProvider === service.preferredProvider() ? state.preferredModel : null,
            })),
          ),
        set: (input) =>
          readSetupState(setupFile).pipe(
            Effect.flatMap(() => writeSetupState(setupFile, input)),
            Effect.tap(() => service.setPreferredProvider(input.preferredProvider, input.preferredModel)),
            Effect.tap((state) =>
              Effect.sync(() => {
                for (const window of BrowserWindow.getAllWindows())
                  sendToRenderer(window, IPC_ENDPOINTS.app.setupState, state);
              }),
            ),
            Effect.map((state) => ({ provider: state.preferredProvider, model: state.preferredModel })),
          ),
      },
      routineResults: routineResultRuntime,
      routineRunCommand: service,
      ...(localServerChild || serverModeEnvironment
        ? {}
        : {
            localServers: {
              list: () => Effect.suspend(() => availableLocalServers().pipe(Effect.map((servers) => servers.list()))),
              create: (name: string) =>
                availableLocalServers().pipe(
                  Effect.flatMap((servers) =>
                    servers.create(name).pipe(
                      Effect.mapError(({ cause }) => new RemoteWorkflowError({ cause })),
                      Effect.map(
                        (summary) =>
                          servers.list().servers.find((server) => server.serverId === summary.id) ?? {
                            serverId: summary.id,
                            name: summary.name,
                            published: false,
                          },
                      ),
                    ),
                  ),
                ),
              delete: (serverId: string) =>
                availableLocalServers().pipe(
                  Effect.flatMap((servers) =>
                    servers.delete(serverId).pipe(Effect.mapError(({ cause }) => new RemoteWorkflowError({ cause }))),
                  ),
                ),
            },
          }),
    },
    mcpToolRuntimePreparation: {
      startToolRuntimes: () => {
        Effect.runFork(providerRuntimes.ensureToolRuntimes());
      },
      ensureToolRuntimesReady: () => providerRuntimes.ensureToolRuntimesReady(),
      toolRuntimes: () => providerRuntimes.mcpToolRuntimes(),
    },
    teamWebRtcBridge,
    peerMemberChanged: browserEgress.peerMemberChanged,
    privateNetwork: () => remoteNetworkRoute.get().route === "private",
    preferredSignalHome: () => hostSignalHome.preferred(),
    signalHomeAnswers: (home) => hostSignalHome.answers(home),
    localDevelopmentHost: developmentRemoteRole === "host",
    passwordOwner: localServerChild !== null,
    logDirectory: join(app.getPath("userData"), "logs", "remote"),
    removeLegacyRemoteDesktopCredential: () =>
      Effect.tryPromise({
        try: async () => {
          const credentialPath = join(app.getPath("userData"), LEGACY_REMOTE_DESKTOP_CREDENTIAL_FILE);
          await Promise.all([rm(credentialPath, { force: true }), rm(`${credentialPath}.tmp`, { force: true })]);
        },
        catch: (cause) => new RemoteWorkflowError({ cause }),
      }),
    ...(localServerChild ? {} : { getLocalProfile: () => localProfile.get() }),
  });
  teardown.push(TEARDOWN_ORDER.host, "the local host", () => runCauseEffect(host.shutdown()));
  if (!localServerChild) await runCauseEffect(host.applyLocalProfile(localProfile.get()));
  const trace = new TraceFile({ directory: join(app.getPath("userData"), "logs") });
  teardown.push(TEARDOWN_ORDER.trace, "the trace file", () => Effect.runPromise(trace.close()));
  const resourceMonitor = new ResourceMonitor({
    userDataPath: app.getPath("userData"),
    server: serverModeEnvironment !== null,
    trace,
    statementTimings,
    tabProcessIds: () => browser.tabProcessIds(),
    appWindowContents: () => BrowserWindow.getAllWindows().map((window) => window.webContents),
    turnRunning: () => service.earliestRunningTurnStartedAt() !== null,
    appPath: app.getAppPath(),
  });
  teardown.push(TEARDOWN_ORDER.resourceMonitor, "the resource monitor", () =>
    Effect.runPromise(resourceMonitor.close()),
  );
  service.on("event", (event) => resourceMonitor.observeAgentEvent(event));
  resourceMonitor.start();
  const startup = localServerChild
    ? null
    : new StartupTiming({
        userDataPath: app.getPath("userData"),
        appVersion: app.getVersion(),
        server: serverModeEnvironment !== null,
        send: (properties) => logger.info("Startup timing.", properties),
      });
  if (startup) {
    Effect.runFork(startup.recordStart());
    teardown.push(TEARDOWN_ORDER.startupTiming, "the startup timing", () => startup.dispose());
  }
  const connectTrace = new RemoteConnectTrace((span) => trace.record(span));
  const developmentRoundTripMs = app.isPackaged ? 0 : Math.max(0, Number(process.env.OPENBOT_DEV_RTT_MS) || 0);
  installRemoteSyncProfileSink(
    remoteSyncProfileFile({
      isPackaged: app.isPackaged,
      setting: process.env.OPENBOT_DEV_SYNC_PROFILE,
      userData: app.getPath("userData"),
      roundTripMs: developmentRoundTripMs,
    }),
  );
  const relayIdentity = new RelayIdentityStore({
    path: join(app.getPath("userData"), RELAY_IDENTITY_FILE),
    cipher: safeStorageCipher("error.app.secretStorageUnavailable"),
  });
  const relayClient = new RelayClientCoordinator({
    identity: relayIdentity,
    logger: createOpenBotLogger("relay-client"),
  });
  teardown.push(TEARDOWN_ORDER.relayClient, "the relay connection", () => Effect.runPromise(relayClient.stop()));
  const remoteServers = new RemoteServerManager(
    join(app.getPath("userData"), REMOTE_SERVERS_FILE),
    safeStorageCipher("error.app.macSecureStorageUnavailable"),
    {
      appVersion: app.getVersion(),
      connectTrace,
      localNotificationLevels: {
        snapshot: () => agentNotificationLevels.snapshot(OWNER_NOTIFICATION_KEY),
        setServer: (level) => agentNotificationLevels.setServer(OWNER_NOTIFICATION_KEY, level),
        setAgent: (input) => agentNotificationLevels.set(OWNER_NOTIFICATION_KEY, input),
        subscribe: (listener) =>
          agentNotificationLevels.subscribe((key) => {
            if (key === OWNER_NOTIFICATION_KEY) listener();
          }),
      },
      relayTransport: relayClient,
      headlessHost: Boolean(serverModeEnvironment),
      ...(serverModeEnvironment || localServerChild
        ? {}
        : {
            computerActivity: {
              awayAfterMs,
              idleSeconds: () => computerIdle.seconds(),
              showsEvents: (server) => {
                const window = windows.getMainWindow();
                if (!window || window.isDestroyed()) return false;
                if (window.isFocused() || windows.getChatWindows().some((chat) => chat.isFocused())) return true;
                return (
                  Notification.isSupported() &&
                  notificationPreference.get().desktopNotifications &&
                  !server.notificationsMuted &&
                  server.notificationLevel !== "nothing"
                );
              },
            },
          }),
      getLocalHostId: () => teamStore.getIdentity()?.serverId ?? null,
    },
  );
  teardown.push(TEARDOWN_ORDER.remoteServers, "the remote servers", () => {
    return runCauseEffect(remoteServers.stop());
  });
  const relay = new RelayService({
    identity: relayIdentity,
    client: relayClient,
    hosting: createRelayHostingPreferenceStore(join(app.getPath("userData"), RELAY_HOSTING_PREFERENCE_FILE)),
    host,
    servers: remoteServers,
    logger: createOpenBotLogger("relay"),
  });
  teardown.push(TEARDOWN_ORDER.relayHosting, "relay hosting", () => runCauseEffect(host.stopRelayHosting()));
  const browserEgressClient = new BrowserEgressClient(teamWebRtcBridge, {
    serverIds: () => remoteServers.list().map((server) => server.id),
    browserEgressWanted: (serverId) => remoteServers.browserEgressWanted(serverId),
  });
  remoteServers.on("changed", browserEgressClient.reconcile);
  teardown.push(TEARDOWN_ORDER.browserEgress, "the computer proxy of this computer", () => {
    remoteServers.off("changed", browserEgressClient.reconcile);
    browserEgressClient.dispose();
  });
  performance.mark("openbot:services.plugin-catalog");
  const localServers =
    localServerChild || serverModeEnvironment
      ? null
      : new LocalServers({
          registryPath: join(app.getPath("userData"), LOCAL_SERVERS_FILE),
          userDataRoot: join(app.getPath("userData"), "local-servers"),
          agentRoot: join(homedir(), APP_HOME_FOLDER, "Servers"),
          runtimeRoot: providerRuntimesRoot,
          cipher: safeStorageCipher("error.app.macSecureStorageUnavailable"),
          remoteServers,
          command: {
            executable: process.execPath,
            args: [
              ...(app.isPackaged ? [] : [app.getAppPath()]),
              ...ozonePlatformArguments(),
              ...sandboxArguments(process.argv.slice(1)),
            ],
          },
          trash: (path) => shell.trashItem(path),
          log: {
            info: (message) => logger.info(message),
            warn: (message, detail) => logger.warn(message, detail === undefined ? "" : toLogValue(detail)),
          },
          platform: process.platform,
        });
  if (localServers) {
    localServersForTeam = localServers;
    teardown.push(TEARDOWN_ORDER.localServers, "the servers on this computer", () =>
      Effect.runPromise(localServers.stop()),
    );
    await Effect.runPromise(localServers.load());
  }
  await runCauseEffect(remoteServers.initialize());
  performance.mark("openbot:services.remote-servers");
  await runCauseEffect(relay.initialize(relayLaunch)).catch((error) =>
    logger.warn("The relay connection did not start.", toLogValue(error)),
  );
  criticalActionTargets = { agents: service, host, remoteServers };
  if (developmentRemoteRole) {
    await runCauseEffect(remoteServers.awaitHostDirectory());
    await runCauseEffect(
      startDevelopmentRemoteRole({
        role: developmentRemoteRole,
        testClientEnabled: developmentTestClientEnabled,
        clientTransport: readDevelopmentClientTransport(process.env.OPENBOT_DEV_CLIENT_TRANSPORT),
        host,
        remoteServers,
      }),
    );
  }
  if (localServers) await Effect.runPromise(localServers.initialize());
  if (localServerChild) {
    await runCauseEffect(
      startLocalServerChild({
        environment: localServerChild,
        teamStore,
        host,
        writeReady: (line) => process.stdout.write(line),
      }),
    );
    reportLocalServerWorkingAgents({
      read: () => service.workingAgents(),
      subscribe: (listener) => service.on("event", listener),
      write: (line) => process.stdout.write(line),
    });
  }
  configureAttachmentProtocol({ mailbox, agents: service, remoteServers });
  configureServerLogoProtocols({ teamStore, remoteServers });
  const browserView = new BrowserViewClient({
    servers: remoteServers,
    onEvent: (event, owner) => {
      const contents = webContents.fromId(owner);
      sendToRenderer(contents && BrowserWindow.fromWebContents(contents), IPC_ENDPOINTS.browser.liveViewEvent, event);
    },
    writeClipboard: (text) => clipboard.writeText(text),
  });
  teardown.push(TEARDOWN_ORDER.browserView, "the live browser view", () => runCauseEffect(browserView.stop()));
  const voicePreferences = new VoicePreferenceStore(join(app.getPath("userData"), "voice-preference.json"), () => {
    const chosen = language.preference.language;
    return defaultVoiceSettings(chosen === DEFAULT_APP_LANGUAGE ? app.getLocale() : chosen);
  });
  await runCauseEffect(voicePreferences.load());
  const voiceApiKeys = new VoiceApiKeyStore({
    path: join(app.getPath("userData"), "voice-api-key.json"),
    cipher: secretCipher,
  });
  await runCauseEffect(voiceApiKeys.load());
  const groqVoiceKeys = new VoiceApiKeyStore({
    path: join(app.getPath("userData"), "groq-api-key.json"),
    cipher: secretCipher,
  });
  await runCauseEffect(groqVoiceKeys.load());
  const voiceModelFetch = (input: string | URL | Request, init?: RequestInit) =>
    net.fetch(input instanceof URL ? input.href : input, init);
  const voice = new VoiceTranscriptionService({
    resourcesRoot: app.isPackaged ? join(process.resourcesPath, "voice") : resolve(".openbot-build/voice"),
    modelDirectories: {
      "parakeet-tdt-0.6b-v3": app.isPackaged
        ? join(app.getPath("userData"), "runtimes", PARAKEET_MODEL_DIRECTORY)
        : resolve(".openbot-build/voice/model"),
      "parakeet-unified-en-0.6b": app.isPackaged
        ? join(app.getPath("userData"), "runtimes", PARAKEET_UNIFIED_MODEL_DIRECTORY)
        : resolve(".openbot-build/voice", PARAKEET_UNIFIED_MODEL_DIRECTORY),
      "bark-3.0-plus": app.isPackaged
        ? join(app.getPath("userData"), "runtimes", BARK_PLUS_MODEL_DIRECTORY)
        : resolve(".openbot-build/voice", BARK_PLUS_MODEL_DIRECTORY),
      "whisper-turbo": app.isPackaged
        ? join(app.getPath("userData"), "runtimes", WHISPER_TURBO_MODEL_DIRECTORY)
        : resolve(".openbot-build/voice", WHISPER_TURBO_MODEL_DIRECTORY),
      "cohere-transcribe-03-2026": app.isPackaged
        ? join(app.getPath("userData"), "runtimes", COHERE_TRANSCRIBE_MODEL_DIRECTORY)
        : resolve(".openbot-build/voice", COHERE_TRANSCRIBE_MODEL_DIRECTORY),
    },
    preferences: voicePreferences,
    apiKeys: { elevenlabs: voiceApiKeys, groq: groqVoiceKeys },
    spawnHost: spawnVoiceTranscriptionHost,
    openStreamSocket: openScribeSocket,
    modelFetch: voiceModelFetch,
  });
  const hostVoiceModel = new HostVoiceModelService(voice);
  if (app.isPackaged) {
    void Effect.runPromise(removeLegacyWhisperCache(join(app.getPath("userData"), "runtimes", "whisper"))).catch(
      (error) => logger.warn("Could not remove the old Whisper model cache.", toLogValue(error)),
    );
  }
  void Effect.runPromise(voice.removeRetiredModelFiles()).catch((error) =>
    logger.warn("Could not remove the old voice model files.", toLogValue(error)),
  );
  teardown.push(TEARDOWN_ORDER.voice, "voice transcription", () => Effect.runPromise(voice.shutdown()));
  voice.on("modelStatus", forwardVoiceModelStatus);
  voice.on("streamTranscript", forwardVoiceStreamTranscript);
  const speechPreferences = new SpeechPreferenceStore(join(app.getPath("userData"), "speech-preference.json"));
  await runCauseEffect(speechPreferences.load());
  const xaiSpeechKeys = new VoiceApiKeyStore({
    path: join(app.getPath("userData"), "xai-api-key.json"),
    cipher: secretCipher,
  });
  await runCauseEffect(xaiSpeechKeys.load());
  const speech = new VoiceSpeechService({
    resourcesRoot: app.isPackaged ? join(process.resourcesPath, "voice") : resolve(".openbot-build/voice"),
    modelDirectory: app.isPackaged
      ? join(app.getPath("userData"), "runtimes", SUPERTONIC_MODEL_DIRECTORY)
      : resolve(".openbot-build/voice", SUPERTONIC_MODEL_DIRECTORY),
    preferences: speechPreferences,
    spawnHost: spawnVoiceSpeechHost,
    apiKeys: { elevenlabs: voiceApiKeys, xai: xaiSpeechKeys },
    modelFetch: voiceModelFetch,
  });
  teardown.push(TEARDOWN_ORDER.speech, "speech", () => Effect.runPromise(speech.shutdown()));
  speech.on("modelStatus", forwardSpeechModelStatus);
  const voiceServerPreferences = createVoiceServerPreferenceStore(join(app.getPath("userData"), "voice-server.json"));
  await runCauseEffect(voiceServerPreferences.load());
  const voiceServerKeys = new VoiceApiKeyStore({
    path: join(app.getPath("userData"), "voice-server-key.json"),
    cipher: secretCipher,
  });
  await runCauseEffect(voiceServerKeys.load());
  const voiceServer = new VoiceServerService({ preferences: voiceServerPreferences, apiKeys: voiceServerKeys });
  voiceServer.on("settings", forwardVoiceServerSettings);
  const currentVersion = app.getVersion();
  const containerInstaller =
    app.isPackaged &&
    process.platform === "linux" &&
    installationMode === "container" &&
    existsSync(CONTAINER_UPDATE_TRIGGER);
  const hostedInstaller =
    containerInstaller ||
    (app.isPackaged &&
      process.platform === "linux" &&
      (process.env.OPENBOT_HOSTED_SERVER === "1" || (serverModeEnvironment !== null && installationMode === "self")) &&
      existsSync(HOSTED_UPDATE_TRIGGER));
  const hostedUpdates = !localServerChild && hostedInstaller && isValidSemver(currentVersion);
  const updateAdapter: UpdateAdapter = hostedUpdates
    ? new HostedUpdateAdapter({
        currentVersion,
        ...(containerInstaller ? { paths: CONTAINER_UPDATE_PATHS } : {}),
      })
    : createDisabledUpdateAdapter();
  const updaterEnabled = hostedUpdates;
  const updater = new UpdateService(updateAdapter, {
    currentVersion,
    enabled: updaterEnabled,
    autoDownload: updatePreference.autoDownload,
    beforeInstall: prepareForUpdateInstall,
    ...(app.isPackaged
      ? {
          checkSiblingInstances: () =>
            listSiblingOpenBotInstances({
              executablePath: app.getPath("exe"),
              currentPid: process.pid,
              platform: process.platform,
              ...(localServers ? { excludedPids: () => localServers.pids() } : {}),
            }).pipe(
              Effect.tap((siblings) =>
                Effect.sync(() => {
                  if (siblings.length === 0) return;
                  const list = siblings.map(({ pid, uid }) => `pid ${pid} (uid ${uid})`).join(", ");
                  logger.warn(
                    `OpenBot update install refused: other OpenBot processes run from this application: ${list}`,
                  );
                }),
              ),
            ),
        }
      : {}),
    ...(typeof process.getuid === "function" ? { currentUid: process.getuid() } : {}),
    platform: process.platform,
    logDirectory: join(app.getPath("userData"), "logs", "update"),
    ...(process.platform === "darwin"
      ? {
          shipItDirectory: macShipItDirectory(),
          handoverPath: join(app.getPath("userData"), UPDATE_HANDOVER_FILE),
          installRecordPath: join(app.getPath("userData"), UPDATE_INSTALL_RECORD_FILE),
          notInstalledVersion: Effect.runSync(
            readNotInstalledUpdate(join(app.getPath("userData"), UPDATE_INSTALL_RECORD_FILE), app.getVersion()),
          ),
          appBundlePath: join(app.getPath("exe"), "..", "..", ".."),
          restartFromInstalledCopy: (bundlePath: string) => restartFromInstalledCopy(app, bundlePath, currentVersion),
        }
      : {}),
  });
  teardown.push(TEARDOWN_ORDER.updater, "the update service", () => Effect.runPromise(updater.stop()));
  const agentInitialization = new AgentInitializationGate((rosterLoaded) =>
    Effect.gen(function* () {
      yield* service.initialize({
        heldRoutines: takeRoutineHold(routineHoldFile, (message) => logger.warn(message)),
        rosterLoaded,
        beforeProviderStart: Fiber.join(computerUseWarmUp).pipe(Effect.asVoid),
      });
      yield* automation.sync();
      yield* routineFlowRuntime.sweep();
      yield* workflowRuntime.sweep();
      yield* routineResultRuntime.recover();
    }),
  );
  const describeRestartReadiness = (): RestartReadiness =>
    checkRestartReadiness({
      agentWork: [
        ...service.workBeforeRestart(),
        ...(workflowRuntime.working() ? ["routine-run"] : []),
        ...(localServers && localServers.workingAgents().length > 0 ? ["agent-turn"] : []),
      ],
      hostBlockers: host.describeRestartBlockers(),
      activeBrowserControls: browser.getControlState().sessions.length,
      activeFileTransfers: remoteServers.hasActiveTransfers(),
      updaterBusy: !updater.getStatus().managedByHost && isUpdateBusyPhase(updater.getStatus().phase),
      initializationPending: !agentInitialization.succeeded,
    });
  const hostUpdateCoordinator = new HostUpdateCoordinator({
    uid: typeof process.getuid === "function" ? process.getuid() : 0,
    pid: process.pid,
    currentVersion,
    describeReadiness: describeRestartReadiness,
    setManagedByHost: (managed) => updater.setManagedByHost(managed),
    setHostState: (state) => updater.setHostState(state),
    onDiagnostic: (message) => logger.warn(message),
    checkHealth: () =>
      Effect.sync(() => {
        if (!agentInitialization.succeeded) return { ok: false, checks: ["initialization-not-ready"] };
        try {
          service.listAgents();
        } catch {
          return { ok: false, checks: ["agent-list-failed"] };
        }
        return { ok: true, checks: ["initialization-succeeded", "agent-list"] };
      }),
  });
  requestedUpdate = new RequestedUpdate({
    updater,
    describeReadiness: describeRestartReadiness,
    preference: updatePreference,
    savePreference: (change) => writeUpdatePreference(updatePreferenceFile, change),
    log: (message) => logger.info(message),
    announce: (state, version) => host.announceRestart(state, version),
  });
  const remoteUpdate = requestedUpdate;
  teardown.push(TEARDOWN_ORDER.requestedUpdate, "the requested update", () =>
    Effect.runPromise(remoteUpdate.dispose()),
  );
  const idleRestart = new IdleRestart({
    updater,
    describeReadiness: describeRestartReadiness,
    holdRoutines: () => service.holdRoutines(),
    releaseRoutines: () => service.releaseRoutines(),
    recordHold: (window) => {
      try {
        if (window) writeRoutineHold(routineHoldFile, window);
        else clearRoutineHold(routineHoldFile);
      } catch (error) {
        logger.warn("The routine hold could not be saved.", toLogValue(error));
      }
    },
    relaunch: () => {
      if (app.isPackaged) relaunchApp(app, process.argv.slice(1));
      app.quit();
    },
    log: (message) => logger.info(message),
  });
  teardown.push(TEARDOWN_ORDER.idleRestart, "the restart when idle", () => idleRestart.dispose());
  const serverMode = serverModeEnvironment
    ? new ServerMode({
        environment: serverModeEnvironment,
        version: app.getVersion(),
        relay,
        host,
        memory: hostMemory && {
          level: () => hostMemory.level(),
          sample: () => hostMemory.sample(),
          turnLimit: () => hostTurnLimits.turnLimit() ?? hostMemory.turnLimit(),
        },
        onError: (message, error) => logger.warn(message, toLogValue(error)),
      })
    : null;
  if (serverMode) {
    await runCauseEffect(serverMode.listen()).catch((error) =>
      logger.error("The server control socket did not start:", toLogValue(error)),
    );
    const serverStartRetry = new HostedServerStartRetry({
      hostPhase: () => host.getStatus().phase,
      startHost: () => serverMode.publish(),
      onError: (message, error) => logger.warn(message, toLogValue(error)),
    });
    serverStartRetry.start();
    const setupPagePort = serverModeEnvironment?.setupPagePort ?? null;
    let setupPage: ServerSetupPage | null = null;
    if (setupPagePort !== null && installationMode !== "container") {
      logger.warn("OPENBOT_SETUP_PAGE_PORT works only in the OpenBot container. The setup page did not start.");
    } else if (setupPagePort !== null) {
      const page = new ServerSetupPage({
        port: setupPagePort,
        address: "0.0.0.0",
        rendererRoot: resolve(__dirname, "../renderer"),
        request: serverMode.setupRequest,
        onError: (message, error) => logger.warn(message, toLogValue(error)),
      });
      await runCauseEffect(page.listen()).then(
        () => {
          setupPage = page;
        },
        (error) => logger.error("The server setup page did not start:", toLogValue(error)),
      );
    }
    teardown.push(TEARDOWN_ORDER.serverMode, "the server control socket", async () => {
      await Effect.runPromise(serverStartRetry.stop());
      if (setupPage) await Effect.runPromise(setupPage.close());
      await Effect.runPromise(serverMode.close());
    });
  }
  performance.mark("openbot:services.updates");
  await runCauseEffect(hostUpdateCoordinator.tick());
  performance.mark("openbot:services.host-update");
  hostUpdateCoordinator.start();
  teardown.push(TEARDOWN_ORDER.hostUpdateCoordinator, "the host update coordinator", () =>
    Effect.runPromise(hostUpdateCoordinator.stop()),
  );

  return {
    service,
    workflows: workflowRuntime,
    workflowFiles,
    crm,
    routineResults: routineResultRuntime,
    providerRuntimes,
    providerCredentials,
    messaging,
    teamWebRtcBridge,
    mcpOAuth,
    signInRelayClient,
    linkAccount,
    onePasswordConnector,
    bitwardenConnector,
    passwordManagers,
    vault,
    mailbox,
    storageUsage,
    libraryFoldersService,
    workflowFoldersService,
    browser,
    browserPictureInPicture,
    detachedBrowserWindow,
    localSignIn,
    browserDock,
    browserView,
    updater,
    setupFile,
    updatePreferenceFile,
    approvalAutomation,
    agentAdminSettings,
    agentHostSettings,
    agentDefaultsSettings,
    agentFolders,
    channelFolders,
    agentInstructions,
    browserProfiles,
    language,
    logoColor,
    appearance,
    interfaceSize,
    notificationPreference,
    busyMessageMode,
    agentDefaults,
    agentMemoryLimit: agentMemoryLimitSetting,
    memoryReview,
    skillLearning,
    browsingMemory,
    agentNotificationLevels,
    sidebarPins,
    agentAccess,
    mcpAccess,
    serverAudit,
    serverTimezone,
    hostSignalHome,
    hostTurnLimits,
    serverPersonality,
    promptCacheTtl,
    claudeUserSetup: claudeUserSetupSetting,
    cacheExpiryCompaction: cacheExpiryCompactionSetting,
    claudeCompactWindow: claudeCompactWindowSetting,
    providerEnvironment: providerEnvironmentSetting,
    modelVisibility,
    remoteSessionReuse,
    externalLinkPreference,
    externalLinks,
    openLink,
    remoteNetworkRoute,
    appBehavior,
    agentInitialization,
    hostUpdateCoordinator,
    requestedUpdate: remoteUpdate,
    idleRestart,
    describeRestartReadiness,
    sidebarLayout,
    host,
    remoteServers,
    relay,
    localServers,
    localProfile,
    skills,
    routineFeed,
    events,
    serverMode,
    customProviders,
    customProviderChanges,
    customAgentChanges,
    acpRegistry,
    providerDetection,
    providerDetectionSettings,
    agentImport,
    hermesImport,
    instanceTransfer,
    voice,
    hostVoiceModel,
    speech,
    voiceServer,
    dynamicIsland,
    agentDock,
    cuaDriver,
    computerUseHighlight,
    computerUsePermissionHelp,
    prewarmAgentDatabase: tables.prewarm(),
    trace,
    resourceMonitor,
    startup,
    machineAlerts,
    teamStore,
  };
}

function browserAgentChat(store: AgentStore, threads: AgentThreadStore, threadId: string): BrowserAgentChat | null {
  const mainAgentId = store.mainThreadAgentId(threadId);
  if (mainAgentId !== null) return { agentId: mainAgentId, sideThread: null };
  const thread = threads.taskForThread(threadId);
  return thread ? { agentId: thread.agentId, sideThread: { taskId: thread.taskId, title: thread.title } } : null;
}
