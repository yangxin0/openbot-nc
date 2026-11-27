import { EventEmitter } from "node:events";
import { join } from "node:path";
import { APP_NAME } from "@openbot/contracts/app-identity";
import { createOpenBotInviteUrl } from "@openbot/contracts/invite-links";
import type {
  AgentTaskReadState,
  BranchAgentTaskInput,
  ChannelSummary,
  ConfigureHostInput,
  ConversationMessageSender,
  ConversationPageAnchor,
  CreateTeamInviteInput,
  DirectConversationPage,
  DirectConversationPageAnchor,
  DirectConversationSnapshot,
  DirectMessageRealtimeEvent,
  DirectThreadSummary,
  DirectTypingInput,
  DirectTypingRealtimeEvent,
  HostStatus,
  InviteSummary,
  MarkAgentTaskReadInput,
  MarkConversationReadInput,
  MarkConversationUnreadInput,
  MarkDirectReadInput,
  SendDirectMessageInput,
  SetTeamTypingInput,
  TeamMemberSummary,
  TeamPresenceSnapshot,
  TeamRole,
  TeamSessionSummary,
  UpdateHostIdentityInput,
  UpdateTeamMemberInput,
} from "@openbot/contracts/ipc";
import {
  type AgentAccessLevel,
  canAdministerServer,
  conversationMessageSender,
  type ServerAuditName,
  SIGNED_OUT_CHANNEL_MEMBER_ID,
} from "@openbot/contracts/ipc";
import type { HostRestartState } from "@openbot/contracts/team-protocol/host-update-v1";
import type { WorkflowSpotEvent, WorkflowSpotInput } from "@openbot/contracts/team-protocol/workflow-presence-v1";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Context, Deferred, Effect, Layer, ManagedRuntime, Result, Semaphore } from "effect";
import type { AgentService } from "../backend/agent-service";
import type { ChannelService } from "../backend/channel-service";
import type { TeamChatStore } from "../backend/team-chat-store";
import type { AgentAccessStore } from "./agent-access-store";
import { type AgentNotificationLevelStore, OWNER_NOTIFICATION_KEY } from "./agent-notification-level-store";
import { BrowserViewGateway } from "./browser-view-gateway";
import type { LocalProfile } from "./local-profile-store";
import { RelayControl, type RelayControlState } from "./relay/control";
import { HostRelay } from "./relay/host-relay";
import type { RelayCredentialSource } from "./relay/identity-store";
import { RemoteWorkflowError, remoteDecode } from "./remote-service-effects";
import { memberAuditChanges, memberAuditName, type ServerAuditStore } from "./server-audit-store";
import { OWNER_PIN_KEY, type SidebarPinStore } from "./sidebar-pin-store";
import type { TeamApiAgentNotificationLevels, TeamApiSidebarPins } from "./team-api/dependencies";
import { TeamApiServer } from "./team-api-server";
import type { TeamIdentity, TeamStore } from "./team-store";

export const DEVELOPMENT_REMOTE_CLIENT_USERNAME = "openbot-dev-client";

const UNNAMED_PERSON = "You";
const RELAY_DEFAULT_SERVER_NAME = APP_NAME;
const logger = createOpenBotLogger("host-service");

interface HostEvents {
  changed: [status: HostStatus];
  presence: [snapshot: TeamPresenceSnapshot];
  directMessage: [event: DirectMessageRealtimeEvent];
  directTyping: [event: DirectTypingRealtimeEvent];
  workflowSpot: [event: WorkflowSpotEvent];
}

interface MemberAuditActor {
  actor: ServerAuditName | null;
  memberId: string;
}

type ForwardedApiOptions = ConstructorParameters<typeof TeamApiServer>[0];

interface RelayHostingOptions {
  reconnect?: { baseMs?: number; maxMs?: number };
  control?: RelayControl;
  offlineSenderMs?: number;
}

interface HostServiceOptions {
  channels?: ChannelService;
  mcpServers?: ForwardedApiOptions["mcpServers"];
  mcpServerOwners?: ForwardedApiOptions["mcpServerOwners"];
  mcpAccess?: ForwardedApiOptions["mcpAccess"];
  mcpSignIns?: ForwardedApiOptions["mcpSignIns"];
  signInRelay?: ForwardedApiOptions["signInRelay"];
  connectors?: ForwardedApiOptions["connectors"];
  onePasswordConnector?: ForwardedApiOptions["onePasswordConnector"];
  bitwardenConnector?: ForwardedApiOptions["bitwardenConnector"];
  passwordManagers?: ForwardedApiOptions["passwordManagers"];
  vault?: ForwardedApiOptions["vault"];
  providerHostSignIns?: ForwardedApiOptions["providerHostSignIns"];
  providerAccounts?: ForwardedApiOptions["providerAccounts"];
  providerUsageResets?: ForwardedApiOptions["providerUsageResets"];
  providerSignOut?: ForwardedApiOptions["providerSignOut"];
  mcpToolRuntimePreparation?: ForwardedApiOptions["mcpToolRuntimePreparation"];
  storage?: ForwardedApiOptions["storage"];
  libraryFolders?: ForwardedApiOptions["libraryFolders"];
  machine?: ForwardedApiOptions["machine"];
  backgroundProcesses?: ForwardedApiOptions["backgroundProcesses"];
  voiceTranscription?: ForwardedApiOptions["voiceTranscription"];
  clientBrowser?: ForwardedApiOptions["clientBrowser"];
  events?: ForwardedApiOptions["events"];
  agentImport?: ForwardedApiOptions["agentImport"];
  hermesImport?: ForwardedApiOptions["hermesImport"];
  instanceTransfer?: ForwardedApiOptions["instanceTransfer"];
  routineFlows?: ForwardedApiOptions["routineFlows"];
  workflows?: ForwardedApiOptions["workflows"];
  workflowFolders?: ForwardedApiOptions["workflowFolders"];
  crm?: ForwardedApiOptions["crm"];
  hiddenAgents?: ForwardedApiOptions["hiddenAgents"];
  routineRunPlaces?: ForwardedApiOptions["routineRunPlaces"];
  agentNotificationLevels?: AgentNotificationLevelStore;
  sidebarPins?: SidebarPinStore;
  agentAccess?: AgentAccessStore;
  serverAudit?: Pick<ServerAuditStore, "read" | "record">;
  agentTasks?: ForwardedApiOptions["agentTasks"];
  browserProfiles?: ForwardedApiOptions["browserProfiles"];
  admin?: ForwardedApiOptions["admin"];
  focusUse?: ForwardedApiOptions["focusUse"];
  appVersion: string;
  store: TeamStore;
  agents: ForwardedApiOptions["agents"] &
    Pick<AgentService, "adoptConversationReads" | "branchTask" | "listTaskReads" | "markTaskRead" | "readTask">;
  agentsReady: NonNullable<ForwardedApiOptions["agentsReady"]>;
  skills: NonNullable<ForwardedApiOptions["skills"]>;
  sidebarLayout: NonNullable<ForwardedApiOptions["sidebarLayout"]>;
  mailbox: ForwardedApiOptions["mailbox"];
  attachmentPreviews?: ForwardedApiOptions["attachmentPreviews"];
  browser: ForwardedApiOptions["browser"];
  chat?: TeamChatStore;
  localDevelopmentHost?: boolean;
  passwordOwner?: boolean;
  logDirectory?: string;
  removeLegacyRemoteDesktopCredential?: () => Effect.Effect<void, RemoteWorkflowError>;
  getLocalProfile?: () => LocalProfile;
}

class HostApiRuntime extends Context.Service<
  HostApiRuntime,
  {
    start(): Effect.Effect<number, RemoteWorkflowError>;
  }
>()("openbot/main/HostApiRuntime") {}

export class HostService extends EventEmitter<HostEvents> {
  readonly #options: Required<Pick<HostServiceOptions, "localDevelopmentHost">> &
    Omit<HostServiceOptions, "localDevelopmentHost">;
  readonly #api: TeamApiServer;
  readonly #runtime: ManagedRuntime.ManagedRuntime<HostApiRuntime, never>;
  readonly #operations = new Set<Deferred.Deferred<void>>();
  #shutdown: Deferred.Deferred<void, RemoteWorkflowError> | null = null;
  readonly #browserView: BrowserViewGateway;
  #lastBrowserViewInputAt: number | null = null;
  #status: HostStatus;
  readonly #memberWrites = Semaphore.makeUnsafe(1);
  readonly #relayHostingLock = Semaphore.makeUnsafe(1);
  #boundProfileId: string | undefined = undefined;
  #legacyCredentialRemoved = false;
  #adoptedReaderKey: string | null = null;
  #hostRelay: HostRelay | null = null;
  #ownedRelayControl: RelayControl | null = null;

  constructor(options: HostServiceOptions) {
    super();
    this.#options = {
      ...options,
      localDevelopmentHost: options.localDevelopmentHost ?? false,
    };
    this.#status = initialHostStatus(options.store.getIdentity());
    this.#browserView = new BrowserViewGateway({
      browser: options.browser,
      authenticate: (token) => options.store.authenticate(token),
      onInput: () => {
        this.#lastBrowserViewInputAt = Date.now();
      },
    });
    this.#api = new TeamApiServer({
      appVersion: options.appVersion,
      store: options.store,
      agents: options.agents,
      agentsReady: options.agentsReady,
      ...(options.channels === undefined ? {} : { channels: options.channels }),
      ...(options.mcpServers === undefined ? {} : { mcpServers: options.mcpServers }),
      ...(options.mcpServerOwners === undefined ? {} : { mcpServerOwners: options.mcpServerOwners }),
      ...(options.mcpAccess === undefined ? {} : { mcpAccess: options.mcpAccess }),
      ...(options.mcpSignIns === undefined ? {} : { mcpSignIns: options.mcpSignIns }),
      ...(options.signInRelay === undefined ? {} : { signInRelay: options.signInRelay }),
      ...(options.connectors === undefined ? {} : { connectors: options.connectors }),
      ...(options.onePasswordConnector === undefined ? {} : { onePasswordConnector: options.onePasswordConnector }),
      ...(options.bitwardenConnector === undefined ? {} : { bitwardenConnector: options.bitwardenConnector }),
      ...(options.passwordManagers === undefined ? {} : { passwordManagers: options.passwordManagers }),
      ...(options.vault === undefined ? {} : { vault: options.vault }),
      ...(options.providerHostSignIns === undefined ? {} : { providerHostSignIns: options.providerHostSignIns }),
      ...(options.providerAccounts === undefined ? {} : { providerAccounts: options.providerAccounts }),
      ...(options.providerUsageResets === undefined ? {} : { providerUsageResets: options.providerUsageResets }),
      ...(options.providerSignOut === undefined ? {} : { providerSignOut: options.providerSignOut }),
      ...(options.mcpToolRuntimePreparation === undefined
        ? {}
        : { mcpToolRuntimePreparation: options.mcpToolRuntimePreparation }),
      ...(options.storage === undefined ? {} : { storage: options.storage }),
      ...(options.libraryFolders === undefined ? {} : { libraryFolders: options.libraryFolders }),
      ...(options.machine === undefined ? {} : { machine: options.machine }),
      ...(options.backgroundProcesses === undefined ? {} : { backgroundProcesses: options.backgroundProcesses }),
      ...(options.voiceTranscription === undefined ? {} : { voiceTranscription: options.voiceTranscription }),
      ...(options.clientBrowser === undefined ? {} : { clientBrowser: options.clientBrowser }),
      ...(options.events === undefined ? {} : { events: options.events }),
      ...(options.agentImport === undefined ? {} : { agentImport: options.agentImport }),
      ...(options.hermesImport === undefined ? {} : { hermesImport: options.hermesImport }),
      ...(options.instanceTransfer === undefined ? {} : { instanceTransfer: options.instanceTransfer }),
      ...(options.routineFlows === undefined ? {} : { routineFlows: options.routineFlows }),
      ...(options.workflows === undefined ? {} : { workflows: options.workflows }),
      ...(options.workflowFolders === undefined ? {} : { workflowFolders: options.workflowFolders }),
      ...(options.crm === undefined ? {} : { crm: options.crm }),
      ...(options.hiddenAgents === undefined ? {} : { hiddenAgents: options.hiddenAgents }),
      ...(options.routineRunPlaces === undefined ? {} : { routineRunPlaces: options.routineRunPlaces }),
      ...(options.agentNotificationLevels === undefined
        ? {}
        : { agentNotificationLevels: this.#agentNotificationLevels(options.agentNotificationLevels) }),
      ...(options.sidebarPins === undefined ? {} : { sidebarPins: this.#sidebarPins(options.sidebarPins) }),
      ...(options.agentAccess === undefined ? {} : { agentAccess: options.agentAccess }),
      ...(options.serverAudit === undefined ? {} : { serverAudit: options.serverAudit }),
      ...(options.agentTasks === undefined ? {} : { agentTasks: options.agentTasks }),
      ...(options.browserProfiles === undefined ? {} : { browserProfiles: options.browserProfiles }),
      admin: {
        ...options.admin,
        identity: { updateIdentity: (input) => this.updateIdentity(input).pipe(Effect.asVoid) },
      },
      skills: options.skills,
      sidebarLayout: options.sidebarLayout,
      mailbox: options.mailbox,
      ...(options.attachmentPreviews === undefined ? {} : { attachmentPreviews: options.attachmentPreviews }),
      browser: options.browser,
      browserView: this.#browserView,
      ...(options.chat === undefined ? {} : { chat: options.chat }),
      onPresence: (snapshot) => this.emit("presence", snapshot),
      onDirectMessage: (event) => this.emit("directMessage", event),
      onDirectTyping: (event) => this.emit("directTyping", event),
      onWorkflowSpot: (event) => this.emit("workflowSpot", event),
      createInvite: (input) => this.createInvite(input),
      updateMember: (input, actor) => this.updateMember(input, actor),
      removeMember: (memberId, actor) => this.removeMember(memberId, actor),
      onSessionRevoked: (sessionId) => this.#revokeRelaySession(sessionId),
      ...(options.focusUse === undefined ? {} : { focusUse: options.focusUse }),
    });
    this.#runtime = ManagedRuntime.make(
      Layer.succeed(
        HostApiRuntime,
        HostApiRuntime.of({
          start: () => this.#api.start(),
        }),
      ),
    );
  }

  getStatus(): HostStatus {
    return { ...this.#status };
  }

  describeRestartBlockers(): string[] {
    const reasons: string[] = [];
    if (this.#browserView.activeViewCount() > 0) reasons.push("browser-view");
    if (this.#hostRelay?.hasActiveTransfers()) reasons.push("file-transfer");
    return reasons;
  }

  readonly applyLocalProfile = Effect.fn("HostService.applyLocalProfile")(
    function* (this: HostService, user: LocalProfile): Effect.fn.Return<void, RemoteWorkflowError> {
      if (this.#boundProfileId === user.id && this.#options.store.configured) {
        if (yield* this.#options.store.syncOwnerProfile(user)) this.#api.refreshPresence();
        return;
      }
      const previousServerId = this.#status.serverId;
      let activated = false;
      yield* this.#options.store.activateOwner(user).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            activated = true;
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            this.#boundProfileId = activated ? user.id : undefined;
            this.#publishActiveHost(previousServerId);
          }),
        ),
      );
    },
    (operation) => this.#provide(operation),
  ).bind(this);

  #publishActiveHost(previousServerId: string | null): void {
    const identity = this.#options.store.getIdentity();
    if (identity && identity.serverId === previousServerId) {
      this.#setStatus({
        configured: true,
        serverName: identity.serverName,
        logoUrl: identity.logoVersion ? serverLogoUrl(identity.logoVersion) : null,
        appearance: identity.appearance,
        enabledOnLaunch: identity.enabledOnLaunch,
      });
    } else {
      this.#status = initialHostStatus(identity);
      this.emit("changed", this.getStatus());
    }
    if (identity) {
      this.#api.refreshPresence();
      this.#api.refreshIdentity();
      this.#api.refreshAppearance();
    }
  }

  readonly configure = Effect.fn("HostService.configure")(
    function* (this: HostService, input: ConfigureHostInput): Effect.fn.Return<HostStatus, RemoteWorkflowError> {
      const owner = yield* remoteDecode(() => this.#requiredLocalProfile());
      const identity = yield* this.#options.store.configureForOwner(input.serverName, owner, input.logo);
      if (!this.#isActiveHost(identity.serverId)) return this.getStatus();
      this.#setStatus({
        phase: "idle",
        configured: true,
        serverId: identity.serverId,
        serverName: identity.serverName,
        logoUrl: identity.logoVersion ? serverLogoUrl(identity.logoVersion) : null,
        appearance: identity.appearance,
        enabledOnLaunch: false,
        message: null,
      });
      this.#api.refreshPresence();
      this.#api.refreshIdentity();
      return this.getStatus();
    },
    (operation) => this.#provide(operation),
  ).bind(this);

  readonly updateIdentity = Effect.fn("HostService.updateIdentity")(
    function* (this: HostService, input: UpdateHostIdentityInput): Effect.fn.Return<HostStatus, RemoteWorkflowError> {
      if (this.#options.passwordOwner !== true)
        yield* remoteDecode(() => this.#options.store.assertOwner(this.#requiredLocalProfile()));
      const identity = yield* this.#options.store.updateIdentity(input);
      if (!this.#isActiveHost(identity.serverId)) return this.getStatus();
      this.#setStatus({
        serverName: identity.serverName,
        logoUrl: identity.logoVersion ? serverLogoUrl(identity.logoVersion) : null,
        appearance: identity.appearance,
        message: sourceText("status.host.identityUpdated"),
      });
      this.#api.refreshIdentity();
      if (input.appearance !== undefined) this.#api.refreshAppearance();
      if (input.serverName !== undefined && this.#hostRelay)
        yield* this.#hostRelay
          .setLabel(identity.serverName)
          .pipe(Effect.mapError((cause) => new RemoteWorkflowError({ cause })));
      return this.getStatus();
    },
    (operation) => this.#provide(operation),
  ).bind(this);

  #isActiveHost(serverId: string): boolean {
    return this.#options.store.getIdentity()?.serverId === serverId;
  }

  readonly startLoopbackOnly = Effect.fn("HostService.startLoopbackOnly")(
    function* (this: HostService): Effect.fn.Return<HostStatus, RemoteWorkflowError, HostApiRuntime> {
      if (!this.#options.store.configured)
        return yield* new RemoteWorkflowError({
          cause: new Error("Name this OpenBot before starting local development."),
        });
      if (this.#status.phase === "online") return this.getStatus();
      const apiPort = yield* HostApiRuntime.use((api) => api.start());
      this.#setStatus({
        phase: "online",
        apiUrl: `http://localhost:${apiPort}`,
        apiOnline: true,
        message: "Local development host is ready.",
      });
      return this.getStatus();
    },
    (operation) => this.#provide(operation),
  ).bind(this);

  readonly startRelayHosting = Effect.fn("HostService.startRelayHosting")(
    function* (
      this: HostService,
      identity: RelayCredentialSource,
      options: RelayHostingOptions = {},
    ): Effect.fn.Return<HostStatus, RemoteWorkflowError, HostApiRuntime> {
      const relayIdentity = identity.current();
      if (!relayIdentity)
        return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.host.relayIdentityMissing")) });
      if (this.#hostRelay) return this.getStatus();
      if (!this.#options.store.configured) yield* this.#configureLocalOwner(RELAY_DEFAULT_SERVER_NAME);
      yield* this.#options.store.bindRelayOwner(relayIdentity.user);
      this.#api.refreshPresence();
      const hostIdentity = this.#options.store.getIdentity();
      if (!hostIdentity)
        return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.host.nameBeforePublish")) });
      const control =
        options.control ??
        new RelayControl({
          identity,
          hosting: true,
          label: hostIdentity.serverName,
          ...(options.reconnect ? { reconnect: options.reconnect } : {}),
        });
      const relay = new HostRelay({
        control,
        store: this.#options.store,
        server: this.#api,
        label: hostIdentity.serverName,
        appVersion: this.#options.appVersion,
        transferDirectory: join(this.#options.logDirectory ?? ".openbot-remote", "relay-transfers"),
        closeSession: (sessionId) => this.#releaseTeamSession(sessionId),
        ...(options.offlineSenderMs ? { offlineSenderMs: options.offlineSenderMs } : {}),
      });
      relay.on("state", (state) => this.#relayStateChanged(relay, state));
      this.#hostRelay = relay;
      this.#ownedRelayControl = options.control ? null : control;
      this.#setStatus({ phase: "starting", message: null });
      this.#removeLegacyRemoteDesktopCredential();
      const started = yield* Effect.gen(function* () {
        yield* HostApiRuntime.use((api) => api.start());
        yield* relay.start();
      }).pipe(Effect.result);
      if (Result.isFailure(started)) {
        yield* this.#stopRuntime();
        const error = started.failure.cause;
        this.#setStatus({
          phase: "error",
          apiOnline: false,
          apiUrl: null,
          message: error instanceof Error ? error.message : sourceText("error.host.publishFailed"),
        });
        return yield* started.failure;
      }
      const relayStatus = relayHostStatus(relay.state());
      this.#setStatus({
        phase: "online",
        apiUrl: relayIdentity.relayUrl,
        apiOnline: relayStatus?.apiOnline ?? false,
        message: relayStatus?.message ?? null,
      });
      return this.getStatus();
    },
    (operation) => this.#relayHostingLock.withPermit(operation),
    (operation) => this.#provide(operation),
  ).bind(this);

  readonly stopRelayHosting = Effect.fn("HostService.stopRelayHosting")(
    function* (this: HostService): Effect.fn.Return<HostStatus, RemoteWorkflowError> {
      if (!this.#hostRelay) return this.getStatus();
      this.#setStatus({ phase: "stopping", message: sourceText("status.host.stopping") });
      yield* this.#stopRuntime();
      this.#setStatus({
        phase: "idle",
        apiUrl: null,
        apiOnline: false,
        message: sourceText("status.host.private"),
      });
      return this.getStatus();
    },
    (operation) => this.#relayHostingLock.withPermit(operation),
    (operation) => this.#provide(operation),
  ).bind(this);

  relayHostingState(): RelayControlState | null {
    return this.#hostRelay?.state() ?? null;
  }

  readonly #configureLocalOwner = Effect.fn("HostService.configureLocalOwner")(function* (
    this: HostService,
    serverName: string,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    const previousServerId = this.#status.serverId;
    const owner = yield* remoteDecode(() => this.#requiredLocalProfile());
    yield* this.#options.store.configureForOwner(serverName, owner);
    this.#publishActiveHost(previousServerId);
  });

  readonly #stopHostRelay = Effect.fn("HostService.stopHostRelay")(function* (this: HostService) {
    const relay = this.#hostRelay;
    const control = this.#ownedRelayControl;
    this.#hostRelay = null;
    this.#ownedRelayControl = null;
    if (relay) yield* relay.stop();
    if (control) yield* control.stop();
  });

  #relayStateChanged(relay: HostRelay, state: RelayControlState): void {
    if (this.#hostRelay !== relay || this.#status.phase !== "online") return;
    const status = relayHostStatus(state);
    if (status) this.#setStatus(status);
  }

  #localApiUrl(): string | null {
    return this.#api.port === null ? null : `http://localhost:${this.#api.port}`;
  }

  readonly createDevelopmentConnection = Effect.fn("HostService.createDevelopmentConnection")(
    function* (this: HostService): Effect.fn.Return<
      {
        serverId: string;
        serverName: string;
        apiUrl: string;
        fingerprint: string;
        publicKey: string;
        username: string;
        sessionToken: string;
        role: TeamRole;
      },
      RemoteWorkflowError,
      HostApiRuntime
    > {
      const identity = this.#options.store.getIdentity();
      const apiUrl = this.#localApiUrl();
      if (!identity || !apiUrl)
        return yield* new RemoteWorkflowError({ cause: new Error("The local development host is not ready.") });
      const username = DEVELOPMENT_REMOTE_CLIENT_USERNAME;
      const password = "openbot-local-development-client";
      const authenticated = yield* this.#options.store.login(username, password).pipe(
        Effect.catch(() =>
          Effect.gen({ self: this }, function* () {
            const existing = this.#options.store.listMembers().find((member) => member.username === username);
            if (existing && existing.role !== "owner") yield* this.#options.store.removeMember(existing.id);
            const invite = yield* this.#options.store.createInvite("member");
            return yield* this.#options.store.acceptInvite(invite.token, username, password);
          }),
        ),
      );
      this.#api.refreshPresence();
      return {
        serverId: identity.serverId,
        serverName: identity.serverName,
        apiUrl,
        fingerprint: identity.fingerprint,
        publicKey: identity.publicKey,
        username,
        sessionToken: authenticated.sessionToken,
        role: authenticated.member.role,
      };
    },
    (operation) => this.#provide(operation),
  ).bind(this);

  readonly stop = Effect.fn("HostService.stop")(
    function* (this: HostService, persistPreference = true): Effect.fn.Return<HostStatus, RemoteWorkflowError> {
      if (this.#status.phase === "unconfigured") return this.getStatus();
      const serverId = this.#options.store.getIdentity()?.serverId;
      if (persistPreference) yield* remoteDecode(() => this.#options.store.assertOwner(this.#requiredLocalProfile()));
      this.#setStatus({ phase: "stopping", message: sourceText("status.host.stopping") });
      yield* this.#stopRuntime();
      if (this.#options.store.getIdentity()?.serverId !== serverId) return this.getStatus();
      if (persistPreference && serverId) yield* this.#options.store.setEnabledOnLaunch(serverId, false);
      this.#setStatus({
        phase: "idle",
        enabledOnLaunch: persistPreference ? false : this.#status.enabledOnLaunch,
        apiUrl: null,
        apiOnline: false,
        message: sourceText("status.host.private"),
      });
      return this.getStatus();
    },
    (operation, _persistPreference?: boolean) => this.#provide(operation),
  ).bind(this);

  listMembers(): Effect.Effect<TeamMemberSummary[], RemoteWorkflowError> {
    return this.#provide(this.#memberWrites.withPermit(Effect.sync(() => this.#options.store.listMembers())));
  }

  getPresence(): TeamPresenceSnapshot {
    return this.#api.getPresence();
  }

  connectedClientCount(): number {
    return this.#api.connectedClientCount();
  }

  lastClientUseAt(): number | null {
    const request = this.#api.lastClientUseAt();
    const view = this.#lastBrowserViewInputAt;
    if (request === null || view === null) return request ?? view;
    return Math.max(request, view);
  }

  announceRestart(state: HostRestartState, version: string | null): void {
    this.#api.announceHostRestart(state, version);
  }

  setTyping(input: SetTeamTypingInput): void {
    this.#api.setLocalTyping(input.agentId, input.typing);
  }

  readAgentConversation(agentId: string) {
    return remoteDecode(() => this.#currentAgentReaderId()).pipe(
      Effect.flatMap((readerId) => this.#options.agents.readConversationFor(agentId, readerId)),
    );
  }

  readAgentTask(agentId: string, taskId: string) {
    return this.#options.agents.readTask(agentId, taskId);
  }

  readAgentConversationPage(agentId: string, anchor: ConversationPageAnchor = { type: "latest" }, limit = 50) {
    return remoteDecode(() => this.#currentAgentReaderId()).pipe(
      Effect.flatMap((readerId) => this.#options.agents.readConversationPageFor(agentId, readerId, anchor, limit)),
    );
  }

  searchAgentConversationMessages(
    query: string,
    agentId?: string,
    cursor?: string,
    limit = 100,
    includeSideThreads = false,
  ) {
    return this.#options.agents.searchConversationMessages(query, agentId, cursor, limit, includeSideThreads);
  }

  searchAgentConversationFiles(query: string, cursor?: string, limit = 50) {
    return this.#options.agents.searchConversationFiles(query, cursor, limit);
  }

  listAgentConversationReads() {
    return this.#options.agents.listConversationReads(this.#currentAgentReaderId());
  }

  markAgentConversationRead(input: MarkConversationReadInput) {
    return remoteDecode(() => this.#currentAgentReaderId()).pipe(
      Effect.flatMap((readerId) =>
        this.#options.agents.markConversationRead(input.agentId, readerId, input.throughMessageId),
      ),
    );
  }

  markAgentConversationUnread(input: MarkConversationUnreadInput) {
    return remoteDecode(() => this.#currentAgentReaderId()).pipe(
      Effect.flatMap((readerId) =>
        this.#options.agents.markConversationUnread(input.agentId, readerId, input.fromMessageId),
      ),
    );
  }

  branchAgentTask(input: BranchAgentTaskInput) {
    return remoteDecode(() => this.#currentAgentReaderId()).pipe(
      Effect.flatMap((readerId) => this.#options.agents.branchTask(input, readerId)),
    );
  }

  listAgentTaskReads(agentId: string): AgentTaskReadState[] {
    return this.#options.agents.listTaskReads(agentId, this.#currentAgentReaderId());
  }

  markAgentTaskRead(input: MarkAgentTaskReadInput): AgentTaskReadState {
    return this.#options.agents.markTaskRead(input, this.#currentAgentReaderId());
  }

  listDirectThreads(): DirectThreadSummary[] {
    if (!this.#options.store.configured) return [];
    const memberId = this.#findCurrentMemberId();
    return memberId ? this.#api.listDirectThreads(memberId) : [];
  }

  readDirectConversation(memberId: string): DirectConversationSnapshot {
    return this.#api.readDirectConversation(this.#currentMemberId(), memberId);
  }

  readDirectConversationPage(
    memberId: string,
    anchor: DirectConversationPageAnchor = { type: "latest" },
    limit = 50,
  ): DirectConversationPage {
    return this.#api.readDirectConversationPage(this.#currentMemberId(), memberId, anchor, limit);
  }

  sendDirectMessage(input: SendDirectMessageInput) {
    return this.#api.sendDirectMessage(this.#currentMemberId(), input);
  }

  markDirectRead(input: MarkDirectReadInput) {
    return this.#api.markDirectRead(this.#currentMemberId(), input.memberId, input.throughSequence);
  }

  setDirectTyping(input: DirectTypingInput): void {
    this.#api.setLocalDirectTyping(this.#currentMemberId(), input.memberId, input.typing);
  }

  setWorkflowSpot(input: WorkflowSpotInput): void {
    const memberId = this.#findCurrentMemberId();
    if (memberId) this.#api.setLocalWorkflowSpot(memberId, input);
  }

  listSessions(): TeamSessionSummary[] {
    return this.#options.store.listSessions();
  }

  readonly updateMember = Effect.fn("HostService.updateMember")(
    function* (
      this: HostService,
      input: UpdateTeamMemberInput,
      requestedBy?: ServerAuditName,
    ): Effect.fn.Return<TeamMemberSummary, RemoteWorkflowError> {
      const actor = requestedBy ?? this.#ownerActor();
      const hostId = this.#options.store.getIdentity()?.serverId;
      const before = this.#options.store.listStoredMembers();
      const member = yield* this.#options.store.updateMember(input.memberId, {
        ...(input.role ? { role: input.role } : {}),
        ...(input.disabled === undefined ? {} : { disabled: input.disabled }),
      });
      if (hostId) yield* this.#auditMembers(hostId, before, { actor, memberId: input.memberId });
      if (member.disabled) this.#options.browser.releaseUserControlHeldBy({ kind: "member", memberId: member.id });
      if (input.role) this.#api.agentAccessChanged();
      this.#api.refreshPresence();
      return member;
    },
    (operation) => this.#memberWrites.withPermit(operation),
    (operation) => this.#provide(operation),
  ).bind(this);

  readonly removeMember = Effect.fn("HostService.removeMember")(
    function* (
      this: HostService,
      memberId: string,
      requestedBy?: ServerAuditName,
    ): Effect.fn.Return<void, RemoteWorkflowError> {
      const actor = requestedBy ?? this.#ownerActor();
      const hostId = this.#options.store.getIdentity()?.serverId;
      const before = this.#options.store.listStoredMembers();
      yield* this.#options.store.removeMember(memberId);
      if (hostId) yield* this.#auditMembers(hostId, before, { actor, memberId });
      if (hostId) yield* this.#forgetMemberRoles(hostId, memberId);
      yield* this.#forgetNotificationLevels(memberId);
      yield* this.#forgetSidebarPins(memberId);
      this.#options.browser.releaseUserControlHeldBy({ kind: "member", memberId });
      this.#api.refreshPresence();
    },
    (operation) => this.#memberWrites.withPermit(operation),
    (operation) => this.#provide(operation),
  ).bind(this);

  copyAgentAccess(sourceAgentId: string, agentId: string): Effect.Effect<void> {
    return this.#api.copyAgentAccess(sourceAgentId, agentId);
  }

  #notificationKey(memberId: string): string {
    return memberId === this.#options.store.getOwnerMemberId() ? OWNER_NOTIFICATION_KEY : memberId;
  }

  #agentNotificationLevels(store: AgentNotificationLevelStore): TeamApiAgentNotificationLevels {
    return {
      snapshot: (memberId, hidden) => store.snapshot(this.#notificationKey(memberId), hidden),
      set: (memberId, input) => store.set(this.#notificationKey(memberId), input),
      setServer: (memberId, level) => store.setServer(this.#notificationKey(memberId), level),
      subscribe: (listener) =>
        store.subscribe((key) => {
          const memberId = key === OWNER_NOTIFICATION_KEY ? this.#options.store.getOwnerMemberId() : key;
          if (memberId) listener(memberId);
        }),
    };
  }

  #sidebarPinKey(memberId: string): string {
    return memberId === this.#options.store.getOwnerMemberId() ? OWNER_PIN_KEY : memberId;
  }

  #sidebarPins(store: SidebarPinStore): TeamApiSidebarPins {
    return {
      snapshot: (memberId, hidden) => store.snapshot(this.#sidebarPinKey(memberId), hidden),
      set: (memberId, items, hidden) => store.set(this.#sidebarPinKey(memberId), items, hidden),
      seed: (memberId, items, hidden) => store.seed(this.#sidebarPinKey(memberId), items, hidden),
      subscribe: (listener) =>
        store.subscribe((key) => {
          const memberId = key === OWNER_PIN_KEY ? this.#options.store.getOwnerMemberId() : key;
          if (memberId) listener(memberId);
        }),
    };
  }

  #forgetSidebarPins(memberId: string): Effect.Effect<void> {
    const store = this.#options.sidebarPins;
    if (!store || memberId === this.#options.store.getOwnerMemberId()) return Effect.void;
    return store
      .removeMember(memberId)
      .pipe(
        Effect.catch((error) =>
          Effect.sync(() => logger.warn("The removed member's pinned chats did not save.", toLogValue(error))),
        ),
      );
  }

  #forgetNotificationLevels(memberId: string): Effect.Effect<void> {
    const store = this.#options.agentNotificationLevels;
    if (!store || memberId === this.#options.store.getOwnerMemberId()) return Effect.void;
    return store
      .removeMember(memberId)
      .pipe(
        Effect.catch((error) =>
          Effect.sync(() => logger.warn("The removed member's notification levels did not save.", toLogValue(error))),
        ),
      );
  }

  #forgetMemberRoles(hostId: string, memberId: string): Effect.Effect<void> {
    const agentAccess = this.#options.agentAccess;
    if (!agentAccess) return Effect.void;
    return agentAccess
      .removeMember(hostId, memberId)
      .pipe(
        Effect.catch((error) =>
          Effect.sync(() => logger.warn("The removed member's roles did not save.", toLogValue(error))),
        ),
      );
  }

  readonly revokeSession = Effect.fn("HostService.revokeSession")(
    function* (this: HostService, sessionId: string): Effect.fn.Return<void, RemoteWorkflowError> {
      yield* this.#revokeRelaySession(sessionId);
      yield* this.#options.store.revokeSession(sessionId);
      yield* this.#browserView.revokeTeamSession(sessionId);
      this.#options.browser.releaseUserControlHeldBy({ kind: "session", sessionId });
      this.#api.refreshPresence();
    },
    (operation) => this.#provide(operation),
  ).bind(this);

  #ownerActor(): ServerAuditName | null {
    const owner = this.#options.store.listStoredMembers().find((member) => member.role === "owner");
    return owner ? memberAuditName(owner) : null;
  }

  #auditMembers(hostId: string, before: readonly TeamMemberSummary[], by?: MemberAuditActor): Effect.Effect<void> {
    const audit = this.#options.serverAudit;
    if (!audit) return Effect.void;
    return Effect.suspend(() => {
      const changes = memberAuditChanges(before, this.#options.store.listStoredMembers());
      const isTheirs = ({ change }: (typeof changes)[number]) =>
        "member" in change && change.member.id === by?.memberId;
      const theirs = changes.filter(isTheirs);
      const others = changes.filter((change) => !isTheirs(change));
      return Effect.andThen(audit.record(hostId, null, others), audit.record(hostId, by?.actor ?? null, theirs));
    });
  }

  readonly #revokeRelaySession = Effect.fn("HostService.revokeRelaySession")(function* (
    this: HostService,
    sessionId: string,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    if (this.#hostRelay) yield* this.#hostRelay.revokeSession(sessionId);
  });

  #releaseTeamSession(sessionId: string): Effect.Effect<void, RemoteWorkflowError> {
    return Effect.gen({ self: this }, function* () {
      yield* this.#browserView.revokeTeamSession(sessionId);
      this.#options.browser.releaseUserControlHeldBy({ kind: "session", sessionId });
    });
  }

  readonly createInvite = Effect.fn("HostService.createInvite")(
    function* (this: HostService, input: CreateTeamInviteInput): Effect.fn.Return<InviteSummary, RemoteWorkflowError> {
      const identity = this.#options.store.getIdentity();
      if (!identity)
        return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.host.nameBeforePublish")) });
      if (input.email)
        return yield* new RemoteWorkflowError({
          cause: new Error(sourceText("error.remote.emailDeliveryUnavailable")),
        });
      const localApiUrl = this.#localApiUrl();
      if (!localApiUrl)
        return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.host.publishBeforeInvite")) });
      const invite = yield* this.#options.store.createInvite(
        input.role,
        input.email,
        input.permanent === undefined ? {} : { permanent: input.permanent },
      );
      const inviteUrl = createOpenBotInviteUrl(
        {
          apiUrl: localApiUrl,
          serverId: identity.serverId,
          fingerprint: identity.fingerprint,
          token: invite.token,
        },
        { allowLocalDevelopmentApiUrl: this.#options.localDevelopmentHost },
      );
      const result: InviteSummary = {
        id: invite.id,
        role: input.role,
        expiresAt: invite.expiresAt,
        usedAt: null,
        inviteUrl,
        email: invite.email,
        permanent: invite.permanent,
        useCount: invite.useCount,
      };
      return result;
    },
    (operation) => this.#provide(operation),
  ).bind(this);

  #provide<A>(operation: Effect.Effect<A, RemoteWorkflowError, HostApiRuntime>): Effect.Effect<A, RemoteWorkflowError> {
    return Effect.suspend(() => {
      const completed = Deferred.makeUnsafe<void>();
      this.#operations.add(completed);
      return Effect.flatMap(this.#runtime.contextEffect, (context) =>
        operation.pipe(Effect.provideContext(context)),
      ).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            this.#operations.delete(completed);
            Deferred.doneUnsafe(completed, Effect.void);
          }),
        ),
      );
    });
  }

  #dispatch(operation: Effect.Effect<void, RemoteWorkflowError>): void {
    this.#runtime.runFork(this.#provide(operation));
  }

  #removeLegacyRemoteDesktopCredential(): void {
    const remove = this.#options.removeLegacyRemoteDesktopCredential;
    if (this.#legacyCredentialRemoved || !remove) return;
    this.#legacyCredentialRemoved = true;
    this.#dispatch(
      remove().pipe(
        Effect.catch(() =>
          Effect.sync(() => {
            this.#legacyCredentialRemoved = false;
          }),
        ),
      ),
    );
  }

  readonly shutdown = Effect.fn("HostService.shutdown")(function* (this: HostService) {
    if (this.#shutdown) return yield* Deferred.await(this.#shutdown);
    const stopped = Deferred.makeUnsafe<void, RemoteWorkflowError>();
    this.#shutdown = stopped;
    return yield* Effect.acquireUseRelease(
      Effect.void,
      () => this.stop(false).pipe(Effect.asVoid),
      () =>
        Effect.gen({ self: this }, function* () {
          while (this.#operations.size > 0) {
            yield* Effect.all([...this.#operations].map(Deferred.await), { concurrency: "unbounded" });
          }
          yield* this.#runtime.disposeEffect;
        }),
    ).pipe(Effect.onExit((exit) => Effect.sync(() => Deferred.doneUnsafe(stopped, exit))));
  }, Effect.uninterruptible).bind(this);

  readonly #stopRuntime = Effect.fn("HostService.stopRuntime")(function* (this: HostService) {
    return yield* Effect.acquireUseRelease(
      Effect.void,
      () => this.#stopHostRelay(),
      () => this.#api.stop(),
    );
  }, Effect.uninterruptible);

  #setStatus(patch: Partial<HostStatus>): void {
    this.#status = { ...this.#status, ...patch };
    this.emit("changed", this.getStatus());
  }

  #currentMemberId(): string {
    const memberId = this.#findCurrentMemberId();
    if (!memberId) throw new Error(sourceText("error.host.teamAccessUnavailable"));
    return memberId;
  }

  channelActor(): { id: string; name: string } {
    const user = this.#localProfile();
    if (!user) {
      this.#adoptedReaderKey = null;
      return { id: SIGNED_OUT_CHANNEL_MEMBER_ID, name: UNNAMED_PERSON };
    }
    return { id: this.#currentAgentReaderId(), name: user.name ?? UNNAMED_PERSON };
  }

  channelPersonAgentLevel(personId: string, agentId: string): AgentAccessLevel {
    if (!this.channelPersonIsRemote(personId)) return "manage";
    const member = this.#options.store.getMember(personId);
    if (!member || member.disabled) return "none";
    return this.#api.agentLevel(member, agentId);
  }

  agentVisibleToMembers(agentId: string): boolean {
    if (!this.#options.store.configured) return false;
    return this.#options.store
      .listMembers()
      .some(
        (member) => member.role === "member" && !member.disabled && this.#api.agentLevel(member, agentId) !== "none",
      );
  }

  personCanAdminister(personId: string): boolean {
    if (!this.channelPersonIsRemote(personId)) return true;
    const member = this.#options.store.getMember(personId);
    return member !== null && !member.disabled && canAdministerServer(member.role);
  }

  channelPersonIsRemote(personId: string): boolean {
    if (personId === SIGNED_OUT_CHANNEL_MEMBER_ID || personId === this.#findCurrentMemberId()) return false;
    if (this.#options.passwordOwner === true && personId === this.#options.store.getOwnerMemberId()) return false;
    const user = this.#localProfile();
    return user === null || personId !== `local-user:${user.id}`;
  }

  listChannels(): ChannelSummary[] {
    return this.#options.channels?.store.list(this.channelActor().id, true) ?? [];
  }

  channelForThread(threadId: string): { id: string; name: string } | null {
    const store = this.#options.channels?.store;
    const channelId = store?.channelForThread(threadId);
    return store && channelId ? { id: channelId, name: store.get(channelId).name } : null;
  }

  conversationSender(): ConversationMessageSender | undefined {
    const user = this.#localProfile();
    if (!user) return undefined;
    return conversationMessageSender(this.#currentAgentReaderId(), user.name?.trim() || UNNAMED_PERSON);
  }

  #currentAgentReaderId(): string {
    const accountReaderId = `local-user:${this.#requiredLocalProfile().id}`;
    const memberId = this.#findCurrentMemberId();
    this.#adoptReadsOnce(accountReaderId, memberId);
    return memberId ?? accountReaderId;
  }

  #adoptReadsOnce(accountReaderId: string, memberId: string | null): void {
    const readerKey = `${accountReaderId}\n${memberId ?? ""}`;
    if (this.#adoptedReaderKey === readerKey) return;
    this.#adoptedReaderKey = null;
    if (!memberId) {
      this.#options.channels?.store.adoptReads(SIGNED_OUT_CHANNEL_MEMBER_ID, accountReaderId);
    } else {
      this.#options.agents.adoptConversationReads(accountReaderId, memberId);
      this.#options.channels?.store.adoptReads(accountReaderId, memberId);
      this.#options.channels?.store.adoptReads(SIGNED_OUT_CHANNEL_MEMBER_ID, memberId);
    }
    this.#adoptedReaderKey = readerKey;
  }

  #findCurrentMemberId(): string | null {
    const user = this.#localProfile();
    return user ? this.#options.store.accountMemberId(user.id) : null;
  }

  #localProfile(): LocalProfile | null {
    return this.#options.getLocalProfile?.() ?? null;
  }

  #requiredLocalProfile(): LocalProfile {
    const user = this.#localProfile();
    if (!user) throw new Error(sourceText("error.host.ownerIdentityUnavailable"));
    return user;
  }
}

function relayHostStatus(state: RelayControlState): Pick<HostStatus, "apiOnline" | "message"> | null {
  if (state.status === "online") return { apiOnline: true, message: sourceText("status.host.relayReady") };
  if (state.status === "connecting" || state.code === "stopped") return null;
  return {
    apiOnline: false,
    message: state.retryInMs === null ? sourceText("error.host.relayRefused") : sourceText("status.host.signalLost"),
  };
}

function initialHostStatus(identity: TeamIdentity | null): HostStatus {
  return {
    phase: identity ? "idle" : "unconfigured",
    configured: Boolean(identity),
    enabledOnLaunch: identity?.enabledOnLaunch ?? false,
    serverId: identity?.serverId ?? null,
    serverName: identity?.serverName ?? null,
    logoUrl: identity?.logoVersion ? serverLogoUrl(identity.logoVersion) : null,
    appearance: identity?.appearance ?? null,
    apiUrl: null,
    apiOnline: false,
    message: null,
  };
}

function serverLogoUrl(version: string): string {
  return `openbot-server-logo://local/logo?v=${encodeURIComponent(version)}`;
}
