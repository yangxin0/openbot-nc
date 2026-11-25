import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { open } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { isValidAvatarImage } from "@openbot/contracts/avatar-images";
import type {
  AgentEvent,
  AgentImportPreview,
  AgentRuntimeSnapshot,
  AttachmentDownloadProgress,
  AttachmentImportProgress,
  AvatarImageInput,
  ClientAgentSummary,
  ConversationPage,
  ConversationPageAnchor,
  ConversationReadState,
  ConversationSearchPage,
  ConversationWithReadState,
  DirectConversationPage,
  DirectConversationPageAnchor,
  DirectConversationReadState,
  DirectConversationSnapshot,
  DirectMessage,
  DirectMessageRealtimeEvent,
  DirectThreadSummary,
  DirectTypingInput,
  DirectTypingRealtimeEvent,
  DraftAttachment,
  DuplicateAgentResult,
  ExportInstanceInput,
  InstanceTransferPreview,
  LoginServerInput,
  MarkConversationReadInput,
  MarkDirectReadInput,
  SendDirectMessageInput,
  ServerNotificationLevel,
  ServerSummary,
  SetAgentChatColorInput,
  SetAgentColorInput,
  SetAgentNotificationLevelInput,
  SetTeamTypingInput,
  TeamMemberSummary,
  TeamPresenceSnapshot,
  TeamRole,
  UpdateTeamMemberInput,
} from "@openbot/contracts/ipc";
import {
  type AgentNotificationLevelsSnapshot,
  type Channel,
  decodeChannel,
  decodeRemoteAgentImportPreview,
  decodeRemoteInstanceTransferPreview,
  EMPTY_AGENT_NOTIFICATION_LEVELS,
  LOCAL_SERVER_ID,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES, WORKSPACE_FILE_EXACT_PATH_QUERY } from "@openbot/contracts/team-api-routes";
import { AGENT_COLORS_CAPABILITY, AGENT_COLORS_ROUTES } from "@openbot/contracts/team-protocol/agent-colors-v1";
import { AGENT_IMPORT_ROUTES } from "@openbot/contracts/team-protocol/agent-import-v1";
import {
  AGENT_IMPORT_V2_CHUNK_BYTES,
  AGENT_IMPORT_V2_ROUTES,
  agentImportV2ChunkPath,
} from "@openbot/contracts/team-protocol/agent-import-v2";
import {
  AGENT_NOTIFICATION_LEVELS_CAPABILITY,
  AGENT_NOTIFICATION_LEVELS_ROUTES,
} from "@openbot/contracts/team-protocol/agent-notification-levels-v1";
import { AGENT_USAGE_LIMIT_CAPABILITY } from "@openbot/contracts/team-protocol/agent-usage-limit-v1";
import { AGENT_WAITS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-waits-v1";
import { ATTACHMENT_PREVIEW_CAPABILITY } from "@openbot/contracts/team-protocol/attachment-preview-v1";
import { decodeBrowserViewSessionResponse } from "@openbot/contracts/team-protocol/browser-view-v1";
import {
  CHANNEL_PICTURE_CAPABILITY,
  CHANNEL_PICTURE_ROUTES,
} from "@openbot/contracts/team-protocol/channel-picture-v1";
import { CHAT_COLORS_CAPABILITY, CHAT_COLORS_ROUTES } from "@openbot/contracts/team-protocol/chat-colors-v1";
import {
  COMPUTER_ACTIVITY_CAPABILITY,
  COMPUTER_ACTIVITY_ROUTES,
} from "@openbot/contracts/team-protocol/computer-activity-v1";
import {
  TEAM_MEMBER_LEAVE_CAPABILITY,
  TEAM_RELAY_AUTH_CAPABILITY,
  type TeamCurrentCapability,
} from "@openbot/contracts/team-protocol/current";
import { FOCUS_USE_CAPABILITY, FOCUS_USE_ROUTES } from "@openbot/contracts/team-protocol/focus-use-v1";
import type { HostAppearanceEvent, ServerAppearance } from "@openbot/contracts/team-protocol/host-appearance-v1";
import type { HostRestartEvent } from "@openbot/contracts/team-protocol/host-update-v1";
import { INSTANCE_TRANSFER_CHUNKS_ROUTES } from "@openbot/contracts/team-protocol/instance-transfer-chunks-v1";
import { INSTANCE_TRANSFER_ROUTES } from "@openbot/contracts/team-protocol/instance-transfer-v1";
import type { MachineAlertEvent } from "@openbot/contracts/team-protocol/machine-resources-v1";
import { PROVIDER_MODEL_SOURCE_CAPABILITY } from "@openbot/contracts/team-protocol/provider-model-source-v1";
import { teamSideRouteCodec } from "@openbot/contracts/team-protocol/side-routes";
import {
  decodeThreadMessageSearchResponse,
  THREAD_MESSAGE_SEARCH_CAPABILITY,
  THREAD_MESSAGE_SEARCH_PAGE_LIMIT,
  THREAD_MESSAGE_SEARCH_ROUTES,
  type ThreadMessageSearchRequest,
} from "@openbot/contracts/team-protocol/thread-message-search-v1";
import { decodeTeamProtocolV1CurrentHttpResponse } from "@openbot/contracts/team-protocol/v1-adapter";
import { sourceText } from "@openbot/i18n/source";
import { createFocusUsePing } from "@openbot/team-client/focus-use";
import { retryOperationIds } from "@openbot/team-client/retry-operation-id";
import { Deferred, Effect, Exit, Layer, Result, Scope, Semaphore } from "effect";
import { ComputerActivityReport } from "./computer-activity-report";
import { contentDispositionFileName } from "./content-disposition";
import type { PreferenceFileFailure } from "./preference-file";
import { relayOrigin } from "./relay/fetch";
import {
  decodeAgentNotificationLevelsFromHost,
  decodeAgentSummary,
  decodeDraftAttachment,
  decodeDuplicateAgentResultFromHost,
  decodeRemoteAgentColors,
  decodeRemoteChatColors,
} from "./remote-agent-decoding";
import {
  AttachmentDownloadStopped,
  REMOTE_ATTACHMENT_PREVIEW_LIMITS,
  type RemoteAttachment,
  RemoteAttachmentCache,
} from "./remote-attachment-cache";
import {
  decodeConversationPageFromHost,
  decodeConversationReadState,
  decodeConversationReadStates,
  decodeConversationSearchPageFromHost,
  decodeConversationWithReadState,
  decodeDirectConversationPage,
  decodeDirectConversationReadState,
  decodeDirectConversationSnapshot,
  decodeDirectMessage,
  decodeDirectThreadSummaries,
} from "./remote-conversation-decoding";
import { acceptEmpty, decodeComputerActivityReply, decodeVoid, type ResponseDecoder } from "./remote-host-decoding";
import { type RemotePicture, RemotePictureCache } from "./remote-picture-cache";
import type { RelayHostRecord, RelayServerRecords } from "./remote-relay-directory";
import { type RemoteRequestInit, RemoteServerClient } from "./remote-server-client";
import { relayRefusal } from "./remote-server-connection-status";
import { RemoteServerConnections } from "./remote-server-connections";
import {
  RemoteProtocolError,
  RemoteRelayRefusal,
  type RemoteRelayRefusalCode,
  RemoteRequestError,
} from "./remote-server-errors";
import { RemoteEventRefresh } from "./remote-server-event-refresh";
import { openDirectEventSocket, type RemoteEventSocket, RemoteEventStream } from "./remote-server-event-stream";
import { type RemoteFetch, requestJson, throwRemoteResponseError } from "./remote-server-http";
import { RemotePresenceCache } from "./remote-server-presence";
import { RemoteServerStore, type StoredRemoteServerView, type TokenCipher } from "./remote-server-store";
import type { StoredRemoteServer } from "./remote-server-stored-shape";
import { remoteServerSummaries } from "./remote-server-summaries";
import { addRemotePreviewUrls, pageQuery } from "./remote-server-urls";
import {
  type RemoteFileProgress,
  RemoteRequest,
  RemoteWorkflowError,
  remoteCall,
  remoteDecode,
} from "./remote-service-effects";
import { decodeJoinResult, decodeTeamPresenceSnapshot } from "./remote-team-decoding";
import { RemoteTeamDirectory } from "./remote-team-directory";

const STOPPED_LOCAL_SERVER_URL = "http://127.0.0.1:0";

export interface LocalServerAttachInput {
  serverId: string;
  apiUrl: string;
  fingerprint: string;
  publicKey: string;
  username: string;
  password: string;
}

interface RemoteServerEvents {
  changed: [servers: ServerSummary[]];
  agent: [serverId: string, event: AgentEvent, bufferedLive?: boolean];
  receivedRuntimeSnapshot: [serverId: string, snapshot: AgentRuntimeSnapshot];
  presence: [serverId: string, snapshot: TeamPresenceSnapshot];
  directMessage: [serverId: string, event: DirectMessageRealtimeEvent];
  directTyping: [serverId: string, event: DirectTypingRealtimeEvent];
  machineAlert: [serverId: string, event: MachineAlertEvent];
  attachmentDownload: [progress: AttachmentDownloadProgress];
  attachmentImportProgress: [progress: AttachmentImportProgress];
}

const ATTACHMENT_PROGRESS_INTERVAL_MS = 100;

export interface RemoteRelayTransport {
  fetchFor(url: URL): RemoteFetch | null;
  openEventSocket(url: URL, protocols: string[]): RemoteEventSocket | null;
}

interface RemoteServerManagerOptions {
  appVersion?: string;
  relayTransport?: RemoteRelayTransport;
  localNotificationLevels?: LocalNotificationLevels;
  computerActivity?: ComputerActivityOptions;
  headlessHost?: boolean;
}

interface ComputerActivityOptions {
  awayAfterMs: number;
  idleSeconds(): number;
  showsEvents(server: ServerSummary): boolean;
}

export interface LocalNotificationLevels {
  snapshot(): AgentNotificationLevelsSnapshot;
  setServer(
    level: ServerNotificationLevel | null,
  ): Effect.Effect<AgentNotificationLevelsSnapshot, PreferenceFileFailure>;
  setAgent(
    input: SetAgentNotificationLevelInput,
  ): Effect.Effect<AgentNotificationLevelsSnapshot, PreferenceFileFailure>;
  subscribe(listener: () => void): () => void;
}

export interface DevelopmentRemoteServerConnection {
  serverId: string;
  serverName: string;
  apiUrl: string;
  fingerprint: string;
  publicKey: string;
  username: string;
  sessionToken: string;
  role?: TeamRole | undefined;
}

const REMOTE_LONG_REQUEST_TIMEOUT_MS = 10 * 60_000 + 30_000;
const REMOTE_DUPLICATION_TIMEOUT_MS = REMOTE_LONG_REQUEST_TIMEOUT_MS;
export const AGENT_IMPORT_UPLOAD_TIMEOUT_MS = REMOTE_LONG_REQUEST_TIMEOUT_MS;
const INSTANCE_TRANSFER_PART_TIMEOUT_MS = 3 * 60_000;
const REMOTE_PICTURES_DIRECTORY = "remote-pictures";
export class RemoteServerManager extends EventEmitter<RemoteServerEvents> {
  readonly #scope = Scope.makeUnsafe();
  readonly #platform: Layer.Layer<RemoteRequest>;
  #stopped = false;
  readonly #operations = new Set<Deferred.Deferred<void>>();
  #stopping: Deferred.Deferred<void, RemoteWorkflowError> | null = null;
  readonly #store: RemoteServerStore;
  readonly #connections: RemoteServerConnections;
  readonly #client: RemoteServerClient;
  readonly #refresh: RemoteEventRefresh;
  readonly #events: RemoteEventStream;
  readonly #presence: RemotePresenceCache;
  readonly #attachments = new RemoteAttachmentCache();
  readonly #attachmentPreviews = new RemoteAttachmentCache(Date.now, REMOTE_ATTACHMENT_PREVIEW_LIMITS);
  readonly #pictures: RemotePictureCache;
  readonly #attachmentStops = new Map<string, Deferred.Deferred<never, RemoteWorkflowError>>();
  readonly #localLevels: LocalNotificationLevels | null;
  readonly #syncedLevels = new Map<string, AgentNotificationLevelsSnapshot>();
  readonly #team: RemoteTeamDirectory;
  readonly #appVersion: string | null;
  #duplicateIds = retryOperationIds(randomUUID);
  readonly #relayTransport: RemoteRelayTransport | null;
  readonly #relayRefused = new Map<string, RemoteRelayRefusalCode>();
  readonly #relaySigningIn = new Set<string>();
  readonly #relayAutoSignInAt = new Map<string, number>();
  readonly relayRecords: RelayServerRecords;
  #keyChangedAt = new Map<string, number>();
  #thisComputerServers: ReadonlySet<string> = new Set();
  #appFocused = true;
  readonly #focusUse = createFocusUsePing((serverId) =>
    this.#background(this.request(serverId, FOCUS_USE_ROUTES.ping, acceptEmpty, { method: "POST", body: {} })),
  );
  readonly #computerActivity: ComputerActivityReport | null;
  readonly #headlessHost: boolean;
  #selections = Semaphore.makeUnsafe(1);
  #muteExpiryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(path: string, cipher: TokenCipher, options: RemoteServerManagerOptions = {}) {
    super();
    this.#store = new RemoteServerStore({ path, cipher });
    this.#pictures = new RemotePictureCache(join(dirname(path), REMOTE_PICTURES_DIRECTORY));
    this.#appVersion = options.appVersion ?? null;
    this.#connections = new RemoteServerConnections({
      appVersion: this.#appVersion,
      onChanged: () => this.#emitChanged(),
      onReconnectSuspended: (serverId) => this.#suspendServer(serverId),
    });
    this.#relayTransport = options.relayTransport ?? null;
    this.#localLevels = options.localNotificationLevels ?? null;
    this.#headlessHost = options.headlessHost ?? false;
    const activity = options.computerActivity;
    this.#computerActivity = activity
      ? new ComputerActivityReport({
          awayAfterMs: activity.awayAfterMs,
          idleSeconds: () => activity.idleSeconds(),
          targets: () =>
            this.list()
              .filter(
                (server) =>
                  server.id !== LOCAL_SERVER_ID &&
                  this.#connections.stateFor(server.id) === "online" &&
                  this.supportsCapability(server.id, COMPUTER_ACTIVITY_CAPABILITY) &&
                  activity.showsEvents(server),
              )
              .map((server) => server.id),
          send: (serverId, idleSeconds) =>
            this.request(serverId, COMPUTER_ACTIVITY_ROUTES.report, decodeComputerActivityReply, {
              method: "POST",
              body: { idleSeconds },
            }),
          run: (operation) => this.#background(operation),
        })
      : null;
    this.#localLevels?.subscribe(() => {
      this.#emitChanged();
      const snapshot = this.cachedNotificationLevels(LOCAL_SERVER_ID);
      this.emit("agent", LOCAL_SERVER_ID, { type: "agent-notification-levels-changed", ...snapshot });
    });
    const relayTransport = this.#relayTransport;
    const connections = this.#connections;
    this.#client = new RemoteServerClient({
      appVersion: this.#appVersion,
      servers: this.#store,
      connections: {
        compatibilityFor: (serverId) => connections.compatibilityFor(serverId),
        issueFor: (serverId) => connections.issueFor(serverId),
        setCompatibility: (serverId, compatibility) => connections.setCompatibility(serverId, compatibility),
        clearStaleIssue: (serverId, issue) => {
          if (!this.#relayRefused.has(serverId)) connections.clearStaleIssue(serverId, issue);
        },
        reportError: (serverId, error) => {
          if (!this.#relayRefused.has(serverId)) connections.reportError(serverId, error);
        },
      },
      relayFetch: (url) => relayTransport?.fetchFor(url) ?? null,
    });
    this.relayRecords = {
      servers: () => this.#store.servers,
      isRemoved: (serverId) => this.#store.isHiddenHost(serverId),
      discover: (apiUrl) => this.#owned(this.#client.discoverIdentity(apiUrl)),
      save: (host) => this.#owned(this.#saveRelayHost(host)),
      signIn: (serverId) => this.#owned(this.#relaySignIn(serverId)),
      setReachable: (serverId, reachable) => this.#owned(this.#setRelayHostReachable(serverId, reachable)),
      refuse: (serverId, code) => Effect.sync(() => this.#refuseRelayHost(serverId, code)),
      clearRefusal: (serverId) => Effect.sync(() => this.#clearRelayRefusal(serverId)),
      subscribe: (listener) => {
        this.on("changed", listener);
        return () => this.off("changed", listener);
      },
    };
    this.#platform = Layer.succeed(
      RemoteRequest,
      RemoteRequest.of({
        request: (serverId, path, decoder, init) => this.#client.request(serverId, path, decoder, init),
      }),
    );
    this.#refresh = new RemoteEventRefresh({
      request: (serverId, path, decoder, init) => this.#client.request(serverId, path, decoder, init),
      hasServer: (serverId) => this.#store.has(serverId),
      onReceivedRuntimeSnapshot: (serverId, snapshot) => this.emit("receivedRuntimeSnapshot", serverId, snapshot),
      onMemberChatColors: (serverId) => {
        if (this.#presence.has(serverId)) this.emit("presence", serverId, this.getPresence(serverId));
      },
      hasUsageLimits: (serverId) => this.supportsCapability(serverId, AGENT_USAGE_LIMIT_CAPABILITY),
      hasModelSources: (serverId) => this.supportsCapability(serverId, PROVIDER_MODEL_SOURCE_CAPABILITY),
      hasAgentWaits: (serverId) => this.supportsCapability(serverId, AGENT_WAITS_CAPABILITY),
      emit: (serverId, event, bufferedLive) => {
        if (event.type === "agent-notification-levels-changed")
          this.#rememberLevels(serverId, { server: event.server, agents: event.agents });
        if (bufferedLive) this.emit("agent", serverId, event, true);
        else this.emit("agent", serverId, event);
      },
    });
    this.#presence = new RemotePresenceCache({
      fetchSnapshot: (serverId) => this.request(serverId, TEAM_API_ROUTES.team.presence, decodeTeamPresenceSnapshot),
      onSnapshot: (serverId, snapshot) =>
        this.emit("presence", serverId, this.#withMemberChatColors(serverId, snapshot)),
    });
    this.#team = new RemoteTeamDirectory({
      request: (serverId, path, decoder, init) => this.#client.request(serverId, path, decoder, init),
    });
    this.#events = new RemoteEventStream({
      appVersion: this.#appVersion,
      servers: this.#store,
      client: this.#client,
      connections: this.#connections,
      agents: this.#refresh,
      openSocket: (url, protocols) =>
        relayTransport?.openEventSocket(url, protocols) ?? openDirectEventSocket(url, protocols),
      onServerIdentity: (serverId, identity) => this.#applyServerIdentity(serverId, identity),
      onPresence: (serverId, snapshot) => this.#presence.accept(serverId, snapshot),
      onDirectMessage: (serverId, event) => this.emit("directMessage", serverId, event),
      onDirectTyping: (serverId, event) => this.emit("directTyping", serverId, event),
      onHostRestart: (serverId, event) => this.#applyHostRestart(serverId, event),
      onHostAppearance: (serverId, event) => this.#applyHostAppearance(serverId, event),
      onMachineAlert: (serverId, event) => this.emit("machineAlert", serverId, event),
      onOffline: (serverId) => this.#presence.markOffline(serverId),
      onChanged: () => this.#emitChanged(),
    });
  }

  #suspendServer(serverId: string): void {
    this.#events.suspendReconnect(serverId);
    const { issue, connectionSequence } = this.#connections.statusFor(serverId);
    if (issue?.code === "authentication_required") this.#background(this.#owned(this.#pictures.forget(serverId)));
    const storedTransport = this.#store.find(serverId)?.transport;
    if (
      storedTransport === "relay" &&
      issue?.code === "authentication_required" &&
      issue.retryable &&
      !this.#relaySigningIn.has(serverId) &&
      this.#relayAutoSignInAt.get(serverId) !== connectionSequence
    ) {
      this.#relayAutoSignInAt.set(serverId, connectionSequence);
      this.#background(this.#owned(this.#relaySignIn(serverId)));
    }
  }

  #background(operation: Effect.Effect<unknown, RemoteWorkflowError>): void {
    Effect.runFork(
      Effect.forkIn(operation.pipe(Effect.catch(() => Effect.void)), this.#scope, { startImmediately: true }),
    );
  }

  #owned<A>(operation: Effect.Effect<A, RemoteWorkflowError, RemoteRequest>): Effect.Effect<A, RemoteWorkflowError> {
    return Effect.suspend(() => {
      if (this.#stopped)
        return Effect.fail(
          new RemoteWorkflowError({ cause: new Error(sourceText("error.remote.connectionCancelled")) }),
        );
      const done = Deferred.makeUnsafe<void>();
      this.#operations.add(done);
      return operation.pipe(
        Effect.provide(this.#platform),
        Effect.ensuring(
          Effect.sync(() => this.#operations.delete(done)).pipe(Effect.andThen(Deferred.succeed(done, undefined))),
        ),
      );
    });
  }

  readonly initialize = Effect.fn("RemoteManager.initialize")(
    function* (this: RemoteServerManager): Effect.fn.Return<void, RemoteWorkflowError, RemoteRequest> {
      yield* this.#store.load();
      this.#scheduleMuteExpiry();
      this.#initializeConnectionStates();
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  #initializeConnectionStates(): void {
    for (const server of this.#store.servers) {
      if (this.#connections.stateFor(server.id) !== null) continue;
      this.#connections.setState(server.id, "offline");
      if (server.transport === "relay") this.#events.suspendReconnect(server.id);
    }
  }

  list(): ServerSummary[] {
    return remoteServerSummaries(
      this.#store.servers,
      this.#store.activeServerId,
      (serverId) => this.#connections.statusFor(serverId),
      (serverId) => this.#thisComputerServers.has(serverId),
      (serverId) => this.#keyChangedAt.get(serverId),
    ).map((server) => {
      const mute = this.#store.muteState(server.id);
      return {
        ...server,
        notificationsMuted: mute.muted,
        notificationsMutedUntil: mute.mutedUntil,
        notificationLevel: this.cachedNotificationLevels(server.id).server ?? this.#store.notificationLevel(server.id),
      };
    });
  }

  cachedNotificationLevels(serverId: string): AgentNotificationLevelsSnapshot {
    if (serverId === LOCAL_SERVER_ID) return this.#localLevels?.snapshot() ?? EMPTY_AGENT_NOTIFICATION_LEVELS;
    return this.#syncedLevels.get(serverId) ?? EMPTY_AGENT_NOTIFICATION_LEVELS;
  }

  knownNotificationLevels(serverId: string): AgentNotificationLevelsSnapshot | null {
    if (serverId === LOCAL_SERVER_ID) return this.cachedNotificationLevels(serverId);
    return this.#syncedLevels.get(serverId) ?? null;
  }

  readonly notificationLevels = Effect.fn("RemoteManager.notificationLevels")(function* (
    this: RemoteServerManager,
    serverId: string,
  ) {
    if (serverId === LOCAL_SERVER_ID || !this.supportsCapability(serverId, AGENT_NOTIFICATION_LEVELS_CAPABILITY))
      return this.cachedNotificationLevels(serverId);
    const snapshot = yield* this.request(
      serverId,
      AGENT_NOTIFICATION_LEVELS_ROUTES.read,
      decodeAgentNotificationLevelsFromHost,
      { method: "POST", body: {} },
    );
    this.#rememberLevels(serverId, snapshot);
    return snapshot;
  }).bind(this);

  readonly setAgentNotificationLevel = Effect.fn("RemoteManager.setAgentNotificationLevel")(function* (
    this: RemoteServerManager,
    serverId: string,
    input: SetAgentNotificationLevelInput,
  ) {
    if (serverId === LOCAL_SERVER_ID) {
      const local = this.#localLevels;
      if (!local) return yield* this.#levelsUnsupported();
      return yield* local.setAgent(input).pipe(Effect.mapError((cause) => new RemoteWorkflowError({ cause })));
    }
    if (!this.supportsCapability(serverId, AGENT_NOTIFICATION_LEVELS_CAPABILITY))
      return yield* this.#levelsUnsupported();
    const snapshot = yield* this.request(
      serverId,
      AGENT_NOTIFICATION_LEVELS_ROUTES.set,
      decodeAgentNotificationLevelsFromHost,
      { method: "POST", body: { agentId: input.agentId, level: input.level } },
    );
    this.#rememberLevels(serverId, snapshot);
    return snapshot;
  }).bind(this);

  withAgentColors(serverId: string, agents: ClientAgentSummary[]): ClientAgentSummary[] {
    return this.#refresh.withAgentColors(serverId, agents);
  }

  agentWithColor(serverId: string, agent: ClientAgentSummary): ClientAgentSummary {
    return this.#refresh.agentWithColor(serverId, agent);
  }

  readonly readAgentColors = Effect.fn("RemoteManager.readAgentColors")(function* (
    this: RemoteServerManager,
    serverId: string,
  ) {
    if (!this.supportsCapability(serverId, AGENT_COLORS_CAPABILITY)) return;
    const colors = yield* this.request(serverId, AGENT_COLORS_ROUTES.read, decodeRemoteAgentColors, {
      method: "POST",
      body: {},
    });
    this.#refresh.rememberAgentColors(serverId, colors);
  }).bind(this);

  readonly setAgentColor = Effect.fn("RemoteManager.setAgentColor")(function* (
    this: RemoteServerManager,
    serverId: string,
    input: SetAgentColorInput,
  ) {
    const colors = yield* this.request(serverId, AGENT_COLORS_ROUTES.set, decodeRemoteAgentColors, {
      method: "POST",
      body: { agentId: input.agentId, color: input.color },
    });
    this.#refresh.rememberAgentColors(serverId, colors);
  }).bind(this);

  readonly readChatColors = Effect.fn("RemoteManager.readChatColors")(function* (
    this: RemoteServerManager,
    serverId: string,
  ) {
    if (!this.supportsCapability(serverId, CHAT_COLORS_CAPABILITY)) return;
    const colors = yield* this.request(serverId, CHAT_COLORS_ROUTES.read, decodeRemoteChatColors, {
      method: "POST",
      body: {},
    });
    this.#refresh.rememberChatColors(serverId, colors);
  }).bind(this);

  readonly setAgentChatColor = Effect.fn("RemoteManager.setAgentChatColor")(function* (
    this: RemoteServerManager,
    serverId: string,
    input: SetAgentChatColorInput,
  ) {
    const colors = yield* this.request(serverId, CHAT_COLORS_ROUTES.set, decodeRemoteChatColors, {
      method: "POST",
      body: { agentId: input.agentId, color: input.color },
    });
    this.#refresh.rememberChatColors(serverId, colors);
  }).bind(this);

  #levelsUnsupported() {
    return new RemoteWorkflowError({ cause: new Error(sourceText("error.team.agentNotificationLevelsUnsupported")) });
  }

  #rememberLevels(serverId: string, snapshot: AgentNotificationLevelsSnapshot): void {
    const before = this.#syncedLevels.get(serverId)?.server ?? null;
    this.#syncedLevels.set(serverId, snapshot);
    if (before !== snapshot.server) this.#emitChanged();
  }

  readonly setAppFocused = Effect.fn("RemoteManager.setAppFocused")(function* (
    this: RemoteServerManager,
    focused: boolean,
  ) {
    this.#appFocused = focused;
    this.#syncFocusUse();
    yield* this.#events.setAppFocused(focused);
  }).bind(this);

  readonly wake = Effect.fn("RemoteManager.wake")(function* (this: RemoteServerManager) {
    yield* this.#events.wake();
  }).bind(this);

  forgetCachedAttachments(serverId: string): void {
    this.#attachments.forget(serverId);
    this.#attachmentPreviews.forget(serverId);
  }

  get activeServerId(): string {
    return this.#store.activeServerId;
  }

  setChatWindowServers(serverIds: ReadonlySet<string>): void {
    this.#events.setChatWindowServers(serverIds);
  }

  supportsCapability(serverId: string, capability: TeamCurrentCapability): boolean {
    return this.#connections.compatibilityFor(serverId)?.capabilities.includes(capability) ?? false;
  }

  readonly startEventConnections = Effect.fn("RemoteManager.startEventConnections")(function* (
    this: RemoteServerManager,
  ) {
    if (this.#headlessHost) return;
    this.#computerActivity?.start();
    yield* this.#events.start();
  }).bind(this);

  readonly refreshRuntimeSnapshots = Effect.fn("RemoteManager.refreshRuntimeSnapshots")(function* (
    this: RemoteServerManager,
  ) {
    if (this.#headlessHost) return;
    yield* this.#events.refreshRuntimeSnapshots();
  }).bind(this);

  select(serverId: string): Effect.Effect<ServerSummary[], RemoteWorkflowError> {
    return this.#owned(this.#selections.withPermit(Effect.uninterruptible(this.#selectEffect(serverId))));
  }

  readonly #selectEffect = Effect.fn("RemoteManager.select")(function* (this: RemoteServerManager, serverId: string) {
    if (serverId !== LOCAL_SERVER_ID && !this.#store.has(serverId))
      return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.remote.serverNotFound")) });
    const previousSelection = this.#store.selection;
    const selectionRevision = this.#store.setActiveServerId(serverId);
    this.#events.syncScopes();
    yield* this.#store.persist().pipe(
      Effect.tapError(() =>
        Effect.sync(() => {
          if (this.#store.activeServerRevision === selectionRevision) {
            this.#store.restoreSelection(previousSelection);
            this.#events.syncScopes();
          }
        }),
      ),
    );
    this.#emitChanged();
    yield* this.startEventConnections();
    yield* this.#events.retryNow(serverId);
    return this.list();
  });

  readonly setMuted = Effect.fn("RemoteManager.setMuted")(
    function* (
      this: RemoteServerManager,
      serverId: string,
      muted: boolean,
      durationMs?: number,
    ): Effect.fn.Return<ServerSummary[], RemoteWorkflowError, RemoteRequest> {
      yield* this.#store.setMuted(serverId, muted, durationMs === undefined ? null : Date.now() + durationMs);
      this.#scheduleMuteExpiry();
      this.#emitChanged();
      return this.list();
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly setNotificationLevel = Effect.fn("RemoteManager.setNotificationLevel")(
    function* (
      this: RemoteServerManager,
      serverId: string,
      level: ServerNotificationLevel,
    ): Effect.fn.Return<ServerSummary[], RemoteWorkflowError, RemoteRequest> {
      yield* this.#store.setNotificationLevel(serverId, level);
      if (serverId === LOCAL_SERVER_ID && this.#localLevels) {
        yield* this.#localLevels.setServer(level).pipe(Effect.mapError((cause) => new RemoteWorkflowError({ cause })));
      } else if (
        serverId !== LOCAL_SERVER_ID &&
        this.supportsCapability(serverId, AGENT_NOTIFICATION_LEVELS_CAPABILITY)
      ) {
        const snapshot = yield* this.request(
          serverId,
          AGENT_NOTIFICATION_LEVELS_ROUTES.server,
          decodeAgentNotificationLevelsFromHost,
          { method: "POST", body: { level } },
        );
        this.#syncedLevels.set(serverId, snapshot);
      }
      this.#emitChanged();
      return this.list();
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  #scheduleMuteExpiry(): void {
    if (this.#muteExpiryTimer) clearTimeout(this.#muteExpiryTimer);
    this.#muteExpiryTimer = null;
    const expiry = this.#store.nextMuteExpiry();
    if (expiry === null) return;
    const delay = Math.min(Math.max(expiry - Date.now(), 0) + 1, 2_147_483_647);
    this.#muteExpiryTimer = setTimeout(() => {
      this.#scheduleMuteExpiry();
      this.#emitChanged();
    }, delay);
    this.#muteExpiryTimer.unref?.();
  }

  readonly reorder = Effect.fn("RemoteManager.reorder")(
    function* (
      this: RemoteServerManager,
      serverIds: string[],
    ): Effect.fn.Return<ServerSummary[], RemoteWorkflowError, RemoteRequest> {
      if (yield* this.#store.reorder(serverIds)) this.#emitChanged();
      return this.list();
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly connectDevelopmentServer = Effect.fn("RemoteManager.connectDevelopmentServer")(
    function* (
      this: RemoteServerManager,
      input: DevelopmentRemoteServerConnection,
    ): Effect.fn.Return<ServerSummary, RemoteWorkflowError, RemoteRequest> {
      const verifiedIdentity = yield* this.#client.verifyIdentity(input.apiUrl, input.serverId, input.fingerprint);
      if (verifiedIdentity.publicKey !== input.publicKey || verifiedIdentity.serverName !== input.serverName) {
        return yield* new RemoteWorkflowError({ cause: new Error("The local development server identity changed.") });
      }
      const stored: StoredRemoteServer = {
        id: input.serverId,
        name: input.serverName,
        apiUrl: input.apiUrl,
        fingerprint: input.fingerprint,
        publicKey: input.publicKey,
        username: input.username,
        encryptedToken: yield* remoteDecode(() => this.#store.sealToken(input.sessionToken)),
        logoVersion: verifiedIdentity.logoVersion,
        role: input.role ?? "member",
      };
      this.#connections.setCompatibility(stored.id, verifiedIdentity.compatibility);
      this.#connections.clearIssue(stored.id);
      this.#connections.setState(stored.id, "online");
      yield* this.#store.adopt(stored);
      this.#events.syncScopes();
      this.#emitChanged();
      yield* this.#events.restart(stored.id, true);
      return yield* remoteDecode(() => requiredServerSummary(this.list(), stored.id));
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  setThisComputerServers(serverIds: Iterable<string>): void {
    this.#thisComputerServers = new Set(serverIds);
    this.#emitChanged();
  }

  readonly attachLocalServer = Effect.fn("RemoteManager.attachLocalServer")(
    function* (
      this: RemoteServerManager,
      input: LocalServerAttachInput,
    ): Effect.fn.Return<ServerSummary, RemoteWorkflowError, RemoteRequest> {
      const verifiedIdentity = yield* this.#client.verifyIdentity(input.apiUrl, input.serverId, input.fingerprint);
      if (verifiedIdentity.publicKey !== input.publicKey)
        return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.remote.identityNotVerified")) });
      const result = yield* requestJson(input.apiUrl, TEAM_API_ROUTES.auth.login, decodeJoinResult, {
        method: "POST",
        body: { username: input.username, password: input.password },
        ...this.#client.requestProtocol(verifiedIdentity.compatibility),
      }).pipe(
        Effect.mapError(
          (failure) =>
            new RemoteWorkflowError({
              cause:
                failure instanceof RemoteRequestError || failure instanceof RemoteProtocolError
                  ? failure
                  : failure.cause,
            }),
        ),
      );
      const stored: StoredRemoteServer = {
        id: input.serverId,
        name: verifiedIdentity.serverName,
        apiUrl: input.apiUrl,
        fingerprint: input.fingerprint,
        publicKey: input.publicKey,
        username: input.username,
        encryptedToken: yield* remoteDecode(() => this.#store.sealToken(result.sessionToken)),
        logoVersion: verifiedIdentity.logoVersion,
        role: result.member.role,
      };
      this.#connections.setCompatibility(stored.id, verifiedIdentity.compatibility);
      this.#connections.clearIssue(stored.id);
      this.#connections.setState(stored.id, "online");
      yield* this.#store.attachLocal(stored);
      this.#events.syncScopes();
      this.#emitChanged();
      yield* this.#events.restart(stored.id, true);
      return yield* remoteDecode(() => requiredServerSummary(this.list(), stored.id));
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly detachLocalServer = Effect.fn("RemoteManager.detachLocalServer")(
    function* (
      this: RemoteServerManager,
      serverId: string,
      forget: boolean,
    ): Effect.fn.Return<void, RemoteWorkflowError> {
      const current = this.#store.find(serverId);
      if (!current) return;
      this.#clearServerConnectionState(serverId);
      if (forget) {
        this.#forgetPictures(serverId);
        yield* this.#store.remove(serverId);
      } else {
        const encryptedToken = yield* remoteDecode(() => this.#store.sealToken(""));
        yield* this.#store.attachLocal({ ...current, apiUrl: STOPPED_LOCAL_SERVER_URL, encryptedToken });
        this.#connections.setState(serverId, "offline");
        this.#events.suspendReconnect(serverId);
      }
      this.#emitChanged();
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly login = Effect.fn("RemoteManager.login")(
    function* (
      this: RemoteServerManager,
      input: LoginServerInput,
    ): Effect.fn.Return<ServerSummary, RemoteWorkflowError, RemoteRequest> {
      const server = yield* remoteDecode(() => this.#store.require(input.serverId));
      if (server.transport !== "relay")
        return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.remote.serverNotFound")) });
      this.#connections.setState(server.id, "connecting");
      this.#emitChanged();
      this.#relayRefused.delete(server.id);
      this.#relayAutoSignInAt.delete(server.id);
      yield* this.#relaySignIn(server.id);
      return yield* remoteDecode(() => requiredServerSummary(this.list(), server.id));
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly retryConnection = Effect.fn("RemoteManager.retryConnection")(
    function* (
      this: RemoteServerManager,
      serverId: string,
    ): Effect.fn.Return<ServerSummary, RemoteWorkflowError, RemoteRequest> {
      const server = yield* remoteDecode(() => this.#store.require(serverId));
      if (server.transport === "relay" && this.#relayRefused.delete(serverId)) this.#relayAutoSignInAt.delete(serverId);
      const blockedState = this.#connections.hasIssue(serverId)
        ? (this.#connections.stateFor(serverId) ?? "error")
        : "error";
      const online = this.#connections.stateFor(serverId) === "online" && !this.#connections.hasIssue(serverId);
      const attempt1 = yield* Effect.gen({ self: this }, function* () {
        if (online) return yield* remoteDecode(() => requiredServerSummary(this.list(), serverId));
        this.#connections.setState(serverId, "connecting");
        this.#emitChanged();
        yield* this.#client.ensureCompatibility(server, true);
        yield* this.#events.restart(serverId, true);
      }).pipe(Effect.result);
      if (Result.isFailure(attempt1)) {
        const error = attempt1.failure.cause;
        this.#connections.reportError(serverId, error, blockedState);
        if (!this.#events.isReconnectSuspended(serverId)) yield* this.#events.restart(serverId);
        return yield* new RemoteWorkflowError({ cause: error });
      } else if (attempt1.success !== undefined) return attempt1.success;
      return yield* remoteDecode(() => requiredServerSummary(this.list(), serverId));
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly remove = Effect.fn("RemoteManager.remove")(
    function* (
      this: RemoteServerManager,
      serverId: string,
    ): Effect.fn.Return<void, RemoteWorkflowError, RemoteRequest> {
      if (serverId === LOCAL_SERVER_ID)
        return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.remote.localServerRemove")) });
      const server = this.#store.find(serverId);
      if (server?.transport === "relay") {
        if (this.#connections.compatibilityFor(serverId)?.negotiatedProtocol)
          yield* this.request(serverId, TEAM_API_ROUTES.auth.logout, decodeVoid, { method: "POST" }).pipe(
            Effect.catch(() => Effect.void),
          );
        yield* this.#store.hideHost(serverId);
      } else if (server && this.#connections.compatibilityFor(serverId)?.negotiatedProtocol) {
        const path = this.supportsCapability(serverId, TEAM_MEMBER_LEAVE_CAPABILITY)
          ? TEAM_API_ROUTES.team.leave
          : TEAM_API_ROUTES.auth.logout;
        yield* this.request(serverId, path, decodeVoid, { method: "POST" }).pipe(Effect.catch(() => Effect.void));
      }
      this.#clearServerConnectionState(serverId);
      this.#forgetPictures(serverId);
      yield* this.#store.remove(serverId);
      this.#emitChanged();
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly unhideRelayHost = Effect.fn("RemoteManager.unhideRelayHost")(
    function* (this: RemoteServerManager, serverId: string): Effect.fn.Return<void, RemoteWorkflowError> {
      yield* this.#store.unhideHost(serverId);
      this.#emitChanged();
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  #clearServerConnectionState(serverId: string): void {
    this.#relayRefused.delete(serverId);
    this.#relayAutoSignInAt.delete(serverId);
    this.#events.forget(serverId);
    this.#refresh.forget(serverId);
    this.#connections.forget(serverId);
    this.#client.forget(serverId);
    this.#presence.forget(serverId);
    this.#attachments.forget(serverId);
    this.#attachmentPreviews.forget(serverId);
  }

  #forgetPictures(serverId: string): void {
    this.#background(this.#owned(this.#pictures.forget(serverId)));
  }

  request<T>(
    serverId: string,
    path: string,
    decoder: ResponseDecoder<T>,
    init: RemoteRequestInit = {},
  ): Effect.Effect<T, RemoteWorkflowError> {
    return this.#owned(RemoteRequest.use((service) => service.request(serverId, path, decoder, init))).pipe(
      Effect.withSpan("RemoteManager.request"),
    );
  }

  readonly duplicateAgent = Effect.fn("RemoteManager.duplicateAgent")(
    function* (
      this: RemoteServerManager,
      agentId: string,
      serverId = this.#store.activeServerId,
    ): Effect.fn.Return<DuplicateAgentResult, RemoteWorkflowError, RemoteRequest> {
      const duplicate = this.#duplicateIds([serverId, agentId]);
      return yield* this.request(
        serverId,
        TEAM_API_ROUTES.agent.duplicate(agentId),
        decodeDuplicateAgentResultFromHost,
        { method: "POST", body: { operationId: duplicate.id }, timeoutMs: REMOTE_DUPLICATION_TIMEOUT_MS },
      ).pipe(
        Effect.catch(({ cause: error }) =>
          Effect.suspend(() => {
            if (!(error instanceof RemoteRequestError && error.status >= 400 && error.status < 500)) duplicate.failed();
            return Effect.fail(new RemoteWorkflowError({ cause: error }));
          }),
        ),
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  listAgentConversationReads(
    serverId = this.#store.activeServerId,
  ): Effect.Effect<Record<string, ConversationReadState>, RemoteWorkflowError> {
    return this.request(serverId, TEAM_API_ROUTES.agents.conversationReads, decodeConversationReadStates);
  }

  readAgentConversation(
    agentId: string,
    serverId = this.#store.activeServerId,
  ): Effect.Effect<ConversationWithReadState, RemoteWorkflowError> {
    return this.request(serverId, TEAM_API_ROUTES.agent.conversation(agentId), decodeConversationWithReadState);
  }

  readAgentConversationPage(
    agentId: string,
    anchor: ConversationPageAnchor = { type: "latest" },
    limit = 50,
    serverId = this.#store.activeServerId,
  ): Effect.Effect<ConversationPage, RemoteWorkflowError> {
    return this.request(
      serverId,
      `${TEAM_API_ROUTES.agent.conversationPage(agentId)}${pageQuery(anchor, limit)}`,
      decodeConversationPageFromHost,
    );
  }

  searchAgentConversationMessages(
    query: string,
    agentId?: string,
    cursor?: string,
    limit = 100,
    serverId = this.#store.activeServerId,
    includeSideThreads = false,
  ): Effect.Effect<ConversationSearchPage, RemoteWorkflowError> {
    if (includeSideThreads && this.supportsCapability(serverId, THREAD_MESSAGE_SEARCH_CAPABILITY)) {
      const body: ThreadMessageSearchRequest = {
        query,
        agentId: agentId ?? null,
        cursor: cursor ?? null,
        limit: Math.min(Math.max(limit, 1), THREAD_MESSAGE_SEARCH_PAGE_LIMIT),
      };
      return this.request(serverId, THREAD_MESSAGE_SEARCH_ROUTES.search, decodeThreadMessageSearchResponse, {
        method: "POST",
        body,
      });
    }
    const parameters = new URLSearchParams({ q: query, limit: String(limit) });
    if (agentId) parameters.set("botId", agentId);
    if (cursor) parameters.set("cursor", cursor);
    return this.request(
      serverId,
      `${TEAM_API_ROUTES.messages.search}?${parameters.toString()}`,
      decodeConversationSearchPageFromHost,
    );
  }

  markAgentConversationRead(
    input: MarkConversationReadInput,
    serverId = this.#store.activeServerId,
  ): Effect.Effect<ConversationReadState, RemoteWorkflowError> {
    return this.request(serverId, TEAM_API_ROUTES.agent.conversationRead(input.agentId), decodeConversationReadState, {
      method: "POST",
      body: { throughMessageId: input.throughMessageId },
    });
  }

  getPresence(serverId = this.#store.activeServerId): TeamPresenceSnapshot {
    return this.#withMemberChatColors(serverId, this.#presence.get(serverId));
  }

  getPresenceFor(serverId: string): Effect.Effect<TeamPresenceSnapshot, RemoteWorkflowError> {
    return this.#owned(this.#presence.refresh(serverId)).pipe(
      Effect.map((snapshot) => this.#withMemberChatColors(serverId, snapshot)),
    );
  }

  #withMemberChatColors(serverId: string, snapshot: TeamPresenceSnapshot): TeamPresenceSnapshot {
    return { ...snapshot, members: this.#refresh.withMemberChatColors(serverId, snapshot.members) };
  }

  readonly refreshIdentity = Effect.fn("RemoteManager.refreshIdentity")(
    function* (
      this: RemoteServerManager,
      serverId: string,
    ): Effect.fn.Return<ServerSummary, RemoteWorkflowError, RemoteRequest> {
      const server = yield* remoteDecode(() => this.#store.require(serverId));
      const identity = yield* this.#client.verifyIdentity(server.apiUrl, server.id, server.fingerprint);
      this.#connections.setCompatibility(server.id, identity.compatibility);
      this.#connections.clearIssue(server.id);
      yield* this.#store.update(server.id, { name: identity.serverName, logoVersion: identity.logoVersion });
      this.#emitChanged();
      return yield* remoteDecode(() => requiredServerSummary(this.list(), server.id));
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly applyAppearance = Effect.fn("RemoteManager.applyAppearance")(
    function* (
      this: RemoteServerManager,
      serverId: string,
      appearance: ServerAppearance | null,
    ): Effect.fn.Return<ServerSummary, RemoteWorkflowError> {
      yield* this.#store.update(serverId, { appearance });
      this.#emitChanged();
      return yield* remoteDecode(() => requiredServerSummary(this.list(), serverId));
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  listMembers(serverId: string): Effect.Effect<TeamMemberSummary[], RemoteWorkflowError> {
    return this.#owned(this.#team.listMembers(serverId)).pipe(
      Effect.map((members) => this.#refresh.withMemberChatColors(serverId, members)),
    );
  }

  updateMember(serverId: string, input: UpdateTeamMemberInput): Effect.Effect<TeamMemberSummary, RemoteWorkflowError> {
    return this.#owned(this.#team.updateMember(serverId, input)).pipe(
      Effect.map((member) => this.#refresh.withMemberChatColors(serverId, [member])[0] ?? member),
    );
  }

  removeMember(serverId: string, memberId: string): Effect.Effect<void, RemoteWorkflowError> {
    return this.#owned(this.#team.removeMember(serverId, memberId));
  }

  readonly setTyping = Effect.fn("RemoteManager.setTyping")(
    (input: SetTeamTypingInput, serverId: string = this.#store.activeServerId) =>
      Effect.sync(() => this.#events.send(serverId, { type: "team-typing", ...input })),
  );

  listDirectThreads(serverId = this.#store.activeServerId): Effect.Effect<DirectThreadSummary[], RemoteWorkflowError> {
    return this.request(serverId, TEAM_API_ROUTES.direct.threads, decodeDirectThreadSummaries);
  }

  readDirectConversation(
    memberId: string,
    serverId = this.#store.activeServerId,
  ): Effect.Effect<DirectConversationSnapshot, RemoteWorkflowError> {
    return this.request(serverId, TEAM_API_ROUTES.direct.conversation(memberId), decodeDirectConversationSnapshot);
  }

  readDirectConversationPage(
    memberId: string,
    anchor: DirectConversationPageAnchor = { type: "latest" },
    limit = 50,
    serverId = this.#store.activeServerId,
  ): Effect.Effect<DirectConversationPage, RemoteWorkflowError> {
    return this.request(
      serverId,
      `${TEAM_API_ROUTES.direct.conversationPage(memberId)}${pageQuery(anchor, limit)}`,
      decodeDirectConversationPage,
    );
  }

  sendDirectMessage(
    input: SendDirectMessageInput,
    serverId = this.#store.activeServerId,
  ): Effect.Effect<DirectMessage, RemoteWorkflowError> {
    return this.request(serverId, TEAM_API_ROUTES.direct.messages, decodeDirectMessage, {
      method: "POST",
      body: input,
    });
  }

  markDirectRead(
    input: MarkDirectReadInput,
    serverId = this.#store.activeServerId,
  ): Effect.Effect<DirectConversationReadState, RemoteWorkflowError> {
    return this.request(
      serverId,
      TEAM_API_ROUTES.direct.conversationRead(input.memberId),
      decodeDirectConversationReadState,
      { method: "POST", body: { throughSequence: input.throughSequence } },
    );
  }

  readonly setDirectTyping = Effect.fn("RemoteManager.setDirectTyping")(
    (input: DirectTypingInput, serverId: string = this.#store.activeServerId) =>
      Effect.sync(() =>
        this.#events.send(serverId, {
          type: "team-direct-typing",
          recipientMemberId: input.memberId,
          typing: input.typing,
        }),
      ),
  );

  readonly openBrowserViewStream = Effect.fn("RemoteManager.openBrowserViewStream")(
    function* (
      this: RemoteServerManager,
      serverId: string,
      tabId: string,
    ): Effect.fn.Return<{ sessionId: string; url: string; protocols: string[] }, RemoteWorkflowError, RemoteRequest> {
      const server = yield* remoteDecode(() => this.#store.require(serverId));
      if (server.transport === "relay")
        return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.remote.viewerProxyUnavailable")) });
      const session = yield* this.request(
        serverId,
        TEAM_API_ROUTES.browser.viewSessions,
        decodeBrowserViewSessionResponse,
        { method: "POST", body: { tabId } },
      );
      const url = new URL(session.streamPath, server.apiUrl);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      return {
        sessionId: session.id,
        url: url.toString(),
        protocols: [`openbot-token.${this.#store.token(server)}`],
      };
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  closeBrowserViewSession(serverId: string, sessionId: string): Effect.Effect<void, RemoteWorkflowError> {
    return this.request(serverId, TEAM_API_ROUTES.browser.viewSession(sessionId), decodeVoid, { method: "DELETE" });
  }

  readonly uploadAttachment = Effect.fn("RemoteManager.uploadAttachment")(
    function* (
      this: RemoteServerManager,
      name: string,
      mimeType: string,
      bytes: Uint8Array,
      serverId = this.#store.activeServerId,
    ): Effect.fn.Return<DraftAttachment, RemoteWorkflowError, RemoteRequest> {
      const server = yield* remoteDecode(() => this.#store.require(serverId));
      const keep = this.#attachments.holdUpload(server.id);
      const url = new URL(TEAM_API_ROUTES.attachments, server.apiUrl);
      url.searchParams.set("name", name);
      url.searchParams.set("mime", mimeType || "application/octet-stream");
      const response = yield* this.#client.fetch(
        server,
        url,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
          },
          body: Buffer.from(bytes),
        },
        true,
      );
      const json = yield* remoteCall(() => response.json());
      const draft = yield* remoteDecode(() =>
        addRemotePreviewUrls(
          decodeDraftAttachment(decodeTeamProtocolV1CurrentHttpResponse("POST", url.pathname, response.status, json)),
          server.id,
        ),
      );
      if (draft.kind === "image") keep(draft.id, { bytes, name: draft.name, mimeType: draft.mimeType });
      return draft;
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly stageAgentImport = Effect.fn("RemoteManager.stageAgentImport")(
    function* (
      this: RemoteServerManager,
      serverId: string,
      bytes: Uint8Array,
    ): Effect.fn.Return<AgentImportPreview, RemoteWorkflowError, RemoteRequest> {
      const server = yield* remoteDecode(() => this.#store.require(serverId));
      const url = new URL(AGENT_IMPORT_ROUTES.stage, server.apiUrl);
      const response = yield* this.#client.fetch(
        server,
        url,
        { method: "POST", headers: { "Content-Type": "application/zip" }, body: Buffer.from(bytes) },
        true,
        AGENT_IMPORT_UPLOAD_TIMEOUT_MS,
      );
      const value = yield* remoteCall(() => response.json());
      return yield* remoteDecode(() => decodeRemoteAgentImportPreview(value));
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly stageAgentImportInParts = Effect.fn("RemoteManager.stageAgentImportInParts")(
    function* (
      this: RemoteServerManager,
      serverId: string,
      path: string,
      size: number,
    ): Effect.fn.Return<AgentImportPreview, RemoteWorkflowError, RemoteRequest> {
      const server = yield* remoteDecode(() => this.#store.require(serverId));
      const post = (route: string, contentType: string, body: string | Buffer<ArrayBuffer>) =>
        Effect.gen({ self: this }, function* () {
          const url = new URL(route, server.apiUrl);
          const response = yield* this.#client.fetch(
            server,
            url,
            { method: "POST", headers: { "Content-Type": contentType }, body },
            true,
            AGENT_IMPORT_UPLOAD_TIMEOUT_MS,
          );
          yield* this.#rejectHostError(response, url);
          return yield* remoteCall(() => response.json());
        });
      const opened = yield* post(AGENT_IMPORT_V2_ROUTES.open, "application/json", JSON.stringify({ size }));
      const uploadId = yield* remoteDecode(() => {
        if (!isDynamicRecord(opened) || typeof opened.uploadId !== "string")
          throw new Error("The server answered an invalid upload.");
        return opened.uploadId;
      });
      yield* Effect.acquireUseRelease(
        remoteCall(() => open(path, "r")),
        (file) =>
          Effect.gen(function* () {
            for (let offset = 0; offset < size; ) {
              const part = Buffer.alloc(Math.min(AGENT_IMPORT_V2_CHUNK_BYTES, size - offset));
              const { bytesRead } = yield* remoteCall(() => file.read(part, 0, part.length, offset));
              if (bytesRead === 0)
                return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.import.exportChanged")) });
              yield* post(agentImportV2ChunkPath(uploadId, offset), "application/zip", part.subarray(0, bytesRead));
              offset += bytesRead;
            }
          }),
        (file) => remoteCall(() => file.close()).pipe(Effect.ignore),
      );
      const value = yield* post(AGENT_IMPORT_V2_ROUTES.stage, "application/json", JSON.stringify({ uploadId }));
      return yield* remoteDecode(() => decodeRemoteAgentImportPreview(value));
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly stageInstanceTransfer = Effect.fn("RemoteManager.stageInstanceTransfer")(
    function* (
      this: RemoteServerManager,
      serverId: string,
      bytes: Uint8Array,
    ): Effect.fn.Return<InstanceTransferPreview, RemoteWorkflowError, RemoteRequest> {
      const server = yield* remoteDecode(() => this.#store.require(serverId));
      const url = new URL(INSTANCE_TRANSFER_ROUTES.stage, server.apiUrl);
      const response = yield* this.#client.fetch(
        server,
        url,
        { method: "POST", headers: { "Content-Type": "application/zip" }, body: Buffer.from(bytes) },
        true,
        AGENT_IMPORT_UPLOAD_TIMEOUT_MS,
      );
      yield* this.#rejectHostError(response, url);
      const value = yield* remoteCall(() => response.json());
      return yield* remoteDecode(() => decodeRemoteInstanceTransferPreview(value));
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly downloadInstanceTransfer = Effect.fn("RemoteManager.downloadInstanceTransfer")(
    function* (
      this: RemoteServerManager,
      serverId: string,
      input: ExportInstanceInput,
    ): Effect.fn.Return<Uint8Array, RemoteWorkflowError, RemoteRequest> {
      const server = yield* remoteDecode(() => this.#store.require(serverId));
      const url = new URL(INSTANCE_TRANSFER_ROUTES.export, server.apiUrl);
      const response = yield* this.#client.fetch(
        server,
        url,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) },
        true,
        AGENT_IMPORT_UPLOAD_TIMEOUT_MS,
      );
      yield* this.#rejectHostError(response, url);
      return new Uint8Array(yield* remoteCall(() => response.arrayBuffer()));
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly sendInstanceTransferPart = Effect.fn("RemoteManager.sendInstanceTransferPart")(
    function* (
      this: RemoteServerManager,
      serverId: string,
      part: { uploadId: string; index: number; sha256: string },
      bytes: Uint8Array,
    ): Effect.fn.Return<void, RemoteWorkflowError, RemoteRequest> {
      const server = yield* remoteDecode(() => this.#store.require(serverId));
      const url = new URL(INSTANCE_TRANSFER_CHUNKS_ROUTES.uploadChunk, server.apiUrl);
      url.searchParams.set("uploadId", part.uploadId);
      url.searchParams.set("index", String(part.index));
      url.searchParams.set("sha256", part.sha256);
      const response = yield* this.#client.fetch(
        server,
        url,
        { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: Buffer.from(bytes) },
        true,
        INSTANCE_TRANSFER_PART_TIMEOUT_MS,
      );
      yield* this.#rejectHostError(response, url);
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly readInstanceTransferPart = Effect.fn("RemoteManager.readInstanceTransferPart")(
    function* (
      this: RemoteServerManager,
      serverId: string,
      part: { exportId: string; index: number },
    ): Effect.fn.Return<Uint8Array, RemoteWorkflowError, RemoteRequest> {
      const server = yield* remoteDecode(() => this.#store.require(serverId));
      const url = new URL(INSTANCE_TRANSFER_CHUNKS_ROUTES.exportChunk, server.apiUrl);
      const response = yield* this.#client.fetch(
        server,
        url,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(part) },
        true,
        INSTANCE_TRANSFER_PART_TIMEOUT_MS,
      );
      yield* this.#rejectHostError(response, url);
      return new Uint8Array(yield* remoteCall(() => response.arrayBuffer()));
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  #rejectHostError(response: Response, url: URL) {
    return response.ok
      ? Effect.void
      : throwRemoteResponseError(response, "POST", url.pathname).pipe(
          Effect.mapError((cause) => new RemoteWorkflowError({ cause })),
        );
  }

  readonly setAgentAvatar = Effect.fn("RemoteManager.setAgentAvatar")(
    function* (
      this: RemoteServerManager,
      agentId: string,
      image: AvatarImageInput | null,
      serverId = this.#store.activeServerId,
    ): Effect.fn.Return<ClientAgentSummary, RemoteWorkflowError, RemoteRequest> {
      const server = yield* remoteDecode(() => this.#store.require(serverId));
      const url = new URL(TEAM_API_ROUTES.agent.avatar(agentId), server.apiUrl);
      const headers = new Headers();
      if (image) headers.set("Content-Type", image.mimeType);
      const response = yield* this.#client.fetch(server, url, {
        method: image ? "PUT" : "DELETE",
        headers,
        ...(image ? { body: Buffer.from(image.bytes) } : {}),
      });
      const json = yield* remoteCall(() => response.json());
      const value = yield* remoteDecode(() =>
        decodeTeamProtocolV1CurrentHttpResponse(image ? "PUT" : "DELETE", url.pathname, response.status, json),
      );
      const agent = addRemotePreviewUrls(yield* remoteDecode(() => decodeAgentSummary(value)), server.id);
      return this.#refresh.agentWithColor(server.id, agent);
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly downloadAgentAvatar = Effect.fn("RemoteManager.downloadAgentAvatar")(
    function* (
      this: RemoteServerManager,
      agentId: string,
      serverId = this.#store.activeServerId,
      version?: string,
    ): Effect.fn.Return<RemotePicture, RemoteWorkflowError, RemoteRequest> {
      const server = yield* remoteDecode(() => this.#store.require(serverId));
      const download = Effect.gen({ self: this }, function* () {
        const url = new URL(TEAM_API_ROUTES.agent.avatar(agentId), server.apiUrl);
        if (version) url.searchParams.set("v", version);
        const response = yield* this.#client.fetch(server, url);
        if (!response.ok)
          return yield* new RemoteWorkflowError({
            cause: new RemoteRequestError(
              response.status,
              sourceText("error.remote.requestFailedStatus", { status: response.status }),
            ),
          });
        return {
          bytes: new Uint8Array(yield* remoteCall(() => response.arrayBuffer())),
          mimeType: response.headers.get("content-type")?.split(";", 1)[0]?.trim() || "application/octet-stream",
        };
      });
      return version ? yield* this.#savedPicture(server.id, "agent", agentId, version, download) : yield* download;
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly #savedPicture = Effect.fn("RemoteManager.savedPicture")(function* (
    this: RemoteServerManager,
    serverId: string,
    kind: "agent" | "channel",
    id: string,
    version: string,
    download: Effect.Effect<RemotePicture, RemoteWorkflowError, RemoteRequest>,
  ): Effect.fn.Return<RemotePicture, RemoteWorkflowError, RemoteRequest> {
    const account = this.#store.find(serverId)?.username.trim().toLowerCase() ?? "";
    if (!account) return yield* download;
    const key = { account, serverId, kind, id, version };
    const saved = yield* this.#pictures.read(key);
    if (saved) return saved;
    const token = this.#pictures.token(serverId);
    const picture = yield* download;
    yield* this.#pictures.write(key, picture, token);
    return picture;
  });

  readonly setChannelImage = Effect.fn("RemoteManager.setChannelImage")(
    function* (
      this: RemoteServerManager,
      channelId: string,
      image: AvatarImageInput | null,
      serverId: string,
    ): Effect.fn.Return<Channel, RemoteWorkflowError, RemoteRequest> {
      if (!this.supportsCapability(serverId, CHANNEL_PICTURE_CAPABILITY))
        return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.team.channelPictureUnsupported")) });
      const server = yield* remoteDecode(() => this.#store.require(serverId));
      const url = this.#channelImageUrl(server.apiUrl, channelId);
      const method = image ? "PUT" : "DELETE";
      const headers = new Headers();
      if (image) headers.set("Content-Type", image.mimeType);
      const response = yield* this.#client.fetch(server, url, {
        method,
        headers,
        ...(image ? { body: Buffer.from(image.bytes) } : {}),
      });
      const path = `${url.pathname}${url.search}`;
      const json = yield* remoteCall(() => response.json());
      const value = yield* remoteDecode(() =>
        teamSideRouteCodec(path)?.response(path, response.status, json, {
          channelIsolation: true,
          channelPicture: true,
          channelBrowser: true,
          providerManyAccounts: true,
        }),
      );
      if (!response.ok) {
        const error = isDynamicRecord(value) && isString(value.error) ? value.error : null;
        const code = isDynamicRecord(value) && isString(value.code) ? value.code : null;
        return yield* new RemoteWorkflowError({
          cause: new RemoteRequestError(
            response.status,
            error ?? sourceText("error.remote.requestFailedStatus", { status: response.status }),
            code,
          ),
        });
      }
      return addRemotePreviewUrls(yield* remoteDecode(() => decodeChannel(value)), server.id);
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly downloadChannelImage = Effect.fn("RemoteManager.downloadChannelImage")(
    function* (
      this: RemoteServerManager,
      channelId: string,
      serverId: string,
      version: string,
    ): Effect.fn.Return<{ bytes: Uint8Array; mimeType: string }, RemoteWorkflowError, RemoteRequest> {
      if (!this.supportsCapability(serverId, CHANNEL_PICTURE_CAPABILITY))
        return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.team.channelPictureUnsupported")) });
      const server = yield* remoteDecode(() => this.#store.require(serverId));
      const download = Effect.gen({ self: this }, function* () {
        const url = this.#channelImageUrl(server.apiUrl, channelId);
        url.searchParams.set("v", version);
        const response = yield* this.#client.fetch(server, url);
        if (!response.ok)
          return yield* new RemoteWorkflowError({
            cause: new RemoteRequestError(
              response.status,
              sourceText("error.remote.requestFailedStatus", { status: response.status }),
            ),
          });
        const picture = {
          bytes: new Uint8Array(yield* remoteCall(() => response.arrayBuffer())),
          mimeType: response.headers.get("content-type")?.split(";", 1)[0]?.trim() ?? "",
        };
        if (!isValidAvatarImage(picture.mimeType, picture.bytes))
          return yield* new RemoteWorkflowError({ cause: new Error("Channel image response is invalid.") });
        return picture;
      });
      return yield* this.#savedPicture(server.id, "channel", channelId, version, download);
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  #channelImageUrl(apiUrl: string, channelId: string): URL {
    const url = new URL(CHANNEL_PICTURE_ROUTES.image, apiUrl);
    url.searchParams.set("channelId", channelId);
    return url;
  }

  readonly downloadServerLogo = Effect.fn("RemoteManager.downloadServerLogo")(
    function* (
      this: RemoteServerManager,
      serverId: string,
      version: string,
    ): Effect.fn.Return<{ bytes: Uint8Array; mimeType: string }, RemoteWorkflowError, RemoteRequest> {
      const server = yield* remoteDecode(() => this.#store.require(serverId));
      if (server.logoVersion !== version)
        return yield* new RemoteWorkflowError({ cause: new Error("Server logo version is not current.") });
      const url = new URL(TEAM_API_ROUTES.team.logo, server.apiUrl);
      url.searchParams.set("v", version);
      const response = yield* this.#client.fetch(server, url);
      const bytes = new Uint8Array(yield* remoteCall(() => response.arrayBuffer()));
      const mimeType = response.headers.get("content-type")?.split(";", 1)[0]?.trim() ?? "";
      if (!isValidAvatarImage(mimeType, bytes))
        return yield* new RemoteWorkflowError({ cause: new Error("Server logo response is invalid.") });
      return { bytes, mimeType };
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly downloadAttachment = Effect.fn("RemoteManager.downloadAttachment")(
    function* (
      this: RemoteServerManager,
      attachmentId: string,
      serverId = this.#store.activeServerId,
      preview = false,
      size?: number,
      queued = preview,
    ): Effect.fn.Return<RemoteAttachment, RemoteWorkflowError, RemoteRequest> {
      const server = yield* remoteDecode(() => this.#store.require(serverId));
      const progress = size === undefined ? undefined : this.#attachmentProgress(server.id, attachmentId, size);
      const stoppable = progress !== undefined && !preview;
      const load = this.#attachments.get(
        server.id,
        attachmentId,
        () =>
          this.#owned(
            Effect.gen({ self: this }, function* () {
              const response = yield* this.#client.fetch(
                server,
                new URL(TEAM_API_ROUTES.attachment(attachmentId), server.apiUrl),
              );
              return {
                bytes: yield* remoteCall((signal) =>
                  progress
                    ? countedResponseBytes(response, progress, signal)
                    : response.arrayBuffer().then((buffer) => new Uint8Array(buffer)),
                ),
                name: contentDispositionFileName(response.headers.get("content-disposition"), attachmentId),
                mimeType: response.headers.get("content-type") ?? "application/octet-stream",
              };
            }).pipe((download) => (stoppable ? this.#stoppable(server.id, attachmentId, download) : download)),
          ),
        preview,
        queued,
      );
      return yield* stoppable ? this.#stoppable(server.id, attachmentId, load) : load;
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly downloadAttachmentPreview = Effect.fn("RemoteManager.downloadAttachmentPreview")(
    function* (
      this: RemoteServerManager,
      attachmentId: string,
      serverId: string,
    ): Effect.fn.Return<RemoteAttachment, RemoteWorkflowError, RemoteRequest> {
      if (!this.supportsCapability(serverId, ATTACHMENT_PREVIEW_CAPABILITY))
        return yield* this.downloadAttachment(attachmentId, serverId, true);
      const server = yield* remoteDecode(() => this.#store.require(serverId));
      return yield* this.#attachmentPreviews
        .get(
          server.id,
          attachmentId,
          () =>
            this.#owned(
              Effect.gen({ self: this }, function* () {
                const response = yield* this.#client.fetch(
                  server,
                  new URL(TEAM_API_ROUTES.attachmentPreview(attachmentId), server.apiUrl),
                );
                return {
                  bytes: yield* remoteCall(() => response.arrayBuffer().then((buffer) => new Uint8Array(buffer))),
                  name: attachmentId,
                  mimeType: response.headers.get("content-type") ?? "application/octet-stream",
                };
              }),
            ),
          true,
        )
        .pipe(Effect.catch(() => this.downloadAttachment(attachmentId, serverId, true)));
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  stopAttachmentDownload(attachmentId: string, serverId: string): void {
    const stop = this.#attachmentStops.get(JSON.stringify([serverId, attachmentId]));
    if (stop)
      Deferred.doneUnsafe(stop, Effect.fail(new RemoteWorkflowError({ cause: new AttachmentDownloadStopped() })));
  }

  #stoppable<A>(
    serverId: string,
    attachmentId: string,
    download: Effect.Effect<A, RemoteWorkflowError, RemoteRequest>,
  ): Effect.Effect<A, RemoteWorkflowError, RemoteRequest> {
    return Effect.suspend(() => {
      const key = JSON.stringify([serverId, attachmentId]);
      const stop = Deferred.makeUnsafe<never, RemoteWorkflowError>();
      this.#attachmentStops.set(key, stop);
      return Effect.raceFirst(download, Deferred.await(stop)).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (this.#attachmentStops.get(key) === stop) this.#attachmentStops.delete(key);
          }),
        ),
      );
    });
  }

  #attachmentProgress(serverId: string, attachmentId: string, size: number): RemoteFileProgress {
    let reportedAt = 0;
    return {
      size,
      onProgress: (received, total) => {
        const now = Date.now();
        if (received < total && now - reportedAt < ATTACHMENT_PROGRESS_INTERVAL_MS) return;
        reportedAt = now;
        this.emit("attachmentDownload", { serverId, attachmentId, received, total });
      },
    };
  }

  readonly downloadSharedFile = Effect.fn("RemoteManager.downloadSharedFile")(
    function* (
      this: RemoteServerManager,
      sharedPath: string,
      serverId = this.#store.activeServerId,
      maxBytes?: number,
    ): Effect.fn.Return<{ bytes: Uint8Array; name: string }, RemoteWorkflowError, RemoteRequest> {
      const server = yield* remoteDecode(() => this.#store.require(serverId));
      const url = new URL(TEAM_API_ROUTES.sharedFiles, server.apiUrl);
      url.searchParams.set("path", sharedPath);
      const response = yield* this.#client.fetch(server, url);
      return {
        bytes: yield* remoteCall(() => fileResponseBytes(response, maxBytes)),
        name: contentDispositionFileName(response.headers.get("content-disposition"), basename(sharedPath)),
      };
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly downloadWorkspaceFile = Effect.fn("RemoteManager.downloadWorkspaceFile")(
    function* (
      this: RemoteServerManager,
      agentId: string,
      workspacePath: string,
      serverId = this.#store.activeServerId,
      maxBytes?: number,
      exactPath = false,
    ): Effect.fn.Return<{ bytes: Uint8Array; name: string }, RemoteWorkflowError, RemoteRequest> {
      const server = yield* remoteDecode(() => this.#store.require(serverId));
      const url = new URL(TEAM_API_ROUTES.workspaceFiles, server.apiUrl);
      url.searchParams.set("botId", agentId);
      url.searchParams.set("path", workspacePath);
      if (exactPath) url.searchParams.set(WORKSPACE_FILE_EXACT_PATH_QUERY, "1");
      const response = yield* this.#client.fetch(server, url);
      return {
        bytes: yield* remoteCall(() => fileResponseBytes(response, maxBytes)),
        name: contentDispositionFileName(response.headers.get("content-disposition"), basename(workspacePath)),
      };
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly stop = Effect.fn("RemoteManager.stop")(function* (this: RemoteServerManager) {
    if (this.#stopping) return yield* Deferred.await(this.#stopping);
    const done = Deferred.makeUnsafe<void, RemoteWorkflowError>();
    this.#stopping = done;
    return yield* Effect.gen({ self: this }, function* () {
      this.#focusUse.dispose();
      this.#computerActivity?.dispose();
      yield* this.#events.stop();
      this.#refresh.clear();
      this.#client.clear();
      this.#attachments.clear();
      this.#attachmentPreviews.clear();
      yield* Scope.close(this.#scope, Exit.void);
      while (this.#operations.size)
        yield* Effect.forEach([...this.#operations], Deferred.await, { concurrency: "unbounded" });
      yield* this.#selections.withPermit(Effect.void);
      this.#stopped = true;
    }).pipe(Effect.onExit((exit) => Deferred.done(done, exit)));
  }).bind(this);

  forgetSavedPictures(): Effect.Effect<void> {
    return this.#pictures.clear();
  }

  readonly #saveRelayHost = Effect.fn("RemoteManager.saveRelayHost")(function* (
    this: RemoteServerManager,
    host: RelayHostRecord,
  ): Effect.fn.Return<{ signInNeeded: boolean }, RemoteWorkflowError> {
    const existing = this.#store.find(host.serverId);
    const address = {
      name: host.serverName,
      apiUrl: relayOrigin(host.relayKeyId),
      fingerprint: host.fingerprint,
      publicKey: host.publicKey,
      username: host.username,
      logoVersion: host.logoVersion,
      transport: "relay" as const,
      relayKeyId: host.relayKeyId,
      relayTeamId: host.relayTeamId,
      relayUser: host.relayUser,
      relayDevice: host.relayDevice,
    };
    const converted = existing !== null && existing.transport !== "relay";
    if (existing && !converted && sameRelayAddress(existing, { ...existing, ...address }))
      return { signInNeeded: false };
    if (converted) this.#clearServerConnectionState(host.serverId);
    yield* this.#store.attachLocal(
      existing
        ? { ...existing, ...address }
        : {
            id: host.serverId,
            ...address,
            encryptedToken: yield* remoteDecode(() => this.#store.sealToken("")),
            role: "member",
          },
    );
    if (!existing || converted) {
      this.#connections.setState(host.serverId, "offline");
      this.#events.suspendReconnect(host.serverId);
    }
    this.#emitChanged();
    return { signInNeeded: existing === null || converted };
  });

  readonly #relaySignIn = Effect.fn("RemoteManager.relaySignIn")(function* (
    this: RemoteServerManager,
    serverId: string,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    const server = yield* remoteDecode(() => this.#store.require(serverId));
    if (server.transport !== "relay")
      return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.remote.serverNotFound")) });
    this.#relaySigningIn.add(serverId);
    const attempt = yield* Effect.gen({ self: this }, function* () {
      const compatibility = yield* this.#client.ensureCompatibility(server, true);
      if (!compatibility.capabilities.includes(TEAM_RELAY_AUTH_CAPABILITY))
        return yield* new RemoteWorkflowError({
          cause: new RemoteProtocolError("host_update_required", sourceText("error.team.hostUpdateRequired")),
        });
      const result = yield* requestJson(server.apiUrl, TEAM_API_ROUTES.auth.relay, decodeJoinResult, {
        method: "POST",
        fetch: this.#client.fetchFor(server.apiUrl),
        ...this.#client.requestProtocol(compatibility),
      }).pipe(
        Effect.mapError((failure) => {
          const error =
            failure instanceof RemoteRequestError || failure instanceof RemoteProtocolError ? failure : failure.cause;
          return new RemoteWorkflowError({ cause: isMemberDisabled(error) ? relayRefusal("member_disabled") : error });
        }),
      );
      yield* this.#store.update(serverId, {
        role: result.member.role,
        encryptedToken: yield* remoteDecode(() => this.#store.sealToken(result.sessionToken)),
      });
      this.#relayRefused.delete(serverId);
      this.#connections.clearIssue(serverId);
      this.#connections.setState(serverId, "connecting");
      yield* this.#events.restart(serverId, true);
    }).pipe(Effect.result);
    if (Result.isFailure(attempt)) {
      const error = attempt.failure.cause;
      if (error instanceof RemoteRelayRefusal) this.#relayRefused.set(serverId, error.code);
      this.#connections.reportError(serverId, error, "error");
      this.#relaySigningIn.delete(serverId);
      this.#emitChanged();
      return yield* new RemoteWorkflowError({ cause: error });
    }
    this.#relaySigningIn.delete(serverId);
    this.#emitChanged();
  });

  readonly #setRelayHostReachable = Effect.fn("RemoteManager.setRelayHostReachable")(function* (
    this: RemoteServerManager,
    serverId: string,
    reachable: boolean,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    if (!this.#store.has(serverId) || this.#relayRefused.has(serverId)) return;
    if (reachable) {
      this.#connections.setState(serverId, "connecting");
      this.#emitChanged();
      yield* this.#events.restart(serverId, true);
      return;
    }
    this.#events.suspendReconnect(serverId);
    this.#connections.reportRelayHostOffline(serverId);
    this.#presence.markOffline(serverId);
    this.#emitChanged();
  });

  #refuseRelayHost(serverId: string, code: RemoteRelayRefusalCode): void {
    if (!this.#store.has(serverId)) return;
    this.#relayRefused.set(serverId, code);
    this.#connections.reportError(serverId, relayRefusal(code), "error");
    this.#presence.markOffline(serverId);
    this.#emitChanged();
  }

  #clearRelayRefusal(serverId: string): void {
    if (!this.#relayRefused.delete(serverId)) return;
    this.#connections.clearIssue(serverId);
    this.#connections.setState(serverId, "offline");
    this.#emitChanged();
  }

  #applyHostRestart(serverId: string, { state, version }: HostRestartEvent): void {
    if (this.#connections.setHostRestart(serverId, state === "none" ? null : { state, version })) this.#emitChanged();
  }

  #applyServerIdentity(serverId: string, identity: { serverName: string; logoVersion: string | null }): void {
    this.#background(
      this.#owned(
        this.#store.update(serverId, { name: identity.serverName, logoVersion: identity.logoVersion }).pipe(
          Effect.tap(() => Effect.sync(() => this.#emitChanged())),
          Effect.catch(() => Effect.void),
        ),
      ),
    );
  }

  #applyHostAppearance(serverId: string, { appearance }: HostAppearanceEvent): void {
    if (sameAppearance(this.#store.find(serverId)?.appearance, appearance)) return;
    this.#background(
      this.#owned(
        this.#store.update(serverId, { appearance }).pipe(
          Effect.tap(() => Effect.sync(() => this.#emitChanged())),
          Effect.catch(() => Effect.void),
        ),
      ),
    );
  }

  #emitChanged(): void {
    this.#syncFocusUse();
    this.emit("changed", this.list());
  }

  #syncFocusUse(): void {
    const serverId = this.#store.activeServerId;
    const focused =
      !this.#stopping &&
      this.#appFocused &&
      this.#connections.stateFor(serverId) === "online" &&
      this.supportsCapability(serverId, FOCUS_USE_CAPABILITY);
    this.#focusUse.setTarget(focused ? serverId : null);
  }
}

function sameAppearance(left: ServerAppearance | null | undefined, right: ServerAppearance | null): boolean {
  if (!left || !right) return (left ?? null) === right;
  return left.shape === right.shape && left.color === right.color;
}

function sameRelayAddress(server: StoredRemoteServerView, address: StoredRemoteServerView): boolean {
  return (
    server.name === address.name &&
    server.apiUrl === address.apiUrl &&
    server.fingerprint === address.fingerprint &&
    server.publicKey === address.publicKey &&
    server.username === address.username &&
    server.logoVersion === address.logoVersion &&
    server.relayKeyId === address.relayKeyId &&
    server.relayTeamId === address.relayTeamId &&
    server.relayUser === address.relayUser &&
    server.relayDevice === address.relayDevice
  );
}

function isMemberDisabled(error: unknown): boolean {
  return (
    error instanceof RemoteRequestError &&
    error.status === 400 &&
    error.message === sourceText("error.team.memberDisabled")
  );
}

function requiredServerSummary(servers: ServerSummary[], serverId: string): ServerSummary {
  const server = servers.find((candidate) => candidate.id === serverId);
  if (!server) throw new Error(sourceText("error.remote.serverNotLoaded"));
  return server;
}

async function countedResponseBytes(
  response: Response,
  progress: RemoteFileProgress,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array(await response.arrayBuffer());
  const stop = () => void reader.cancel().catch(() => undefined);
  signal.addEventListener("abort", stop, { once: true });
  try {
    const named = Number(response.headers.get("content-length"));
    const total = Number.isSafeInteger(named) && named > 0 ? named : progress.size;
    const parts: Uint8Array[] = [];
    let received = 0;
    progress.onProgress(0, total);
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      received += value.byteLength;
      progress.onProgress(Math.min(received, total), total);
    }
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.byteLength;
    }
    return bytes;
  } finally {
    signal.removeEventListener("abort", stop);
  }
}

async function fileResponseBytes(response: Response, maxBytes: number | undefined): Promise<Uint8Array> {
  if (maxBytes !== undefined && Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel();
    throw new Error(sourceText("error.attachment.previewTooLarge"));
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (maxBytes !== undefined && bytes.byteLength > maxBytes)
    throw new Error(sourceText("error.attachment.previewTooLarge"));
  return bytes;
}
