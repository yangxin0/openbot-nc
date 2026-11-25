import { EventEmitter } from "node:events";
import { join } from "node:path";
import type { HostKeyHandover } from "@openbot/contracts/host-key-handover";
import { createOpenBotInviteUrl, selfHostedApiOrigin } from "@openbot/contracts/invite-links";
import type {
  AgentTaskReadState,
  BranchAgentTaskInput,
  CentralAuthUser,
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
  isAvatarColor,
  type ServerAuditName,
  SIGNED_OUT_CHANNEL_MEMBER_ID,
} from "@openbot/contracts/ipc";
import type { HostRestartState } from "@openbot/contracts/team-protocol/host-update-v1";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import {
  Cause,
  Context,
  Deferred,
  Effect,
  Fiber,
  Layer,
  ManagedRuntime,
  Option,
  Result,
  Schema,
  Semaphore,
} from "effect";
import type { AgentService } from "../backend/agent-service";
import type { ChannelService } from "../backend/channel-service";
import type { TeamChatStore } from "../backend/team-chat-store";
import type { AgentAccessStore } from "./agent-access-store";
import { type AgentNotificationLevelStore, OWNER_NOTIFICATION_KEY } from "./agent-notification-level-store";
import { BrowserViewGateway } from "./browser-view-gateway";
import {
  isFinalClientError,
  type RemoteHostTicketHome,
  type VerifiedRemoteSessionTicket,
} from "./central-auth-manager";
import type { RelayControl, RelayControlState } from "./relay/control";
import { HostRelay } from "./relay/host-relay";
import type { RelayCredentialSource } from "./relay/identity-store";
import { RemoteWorkflowError, remoteDecode } from "./remote-service-effects";
import { memberAuditChanges, memberAuditName, type ServerAuditStore } from "./server-audit-store";
import { OWNER_PIN_KEY, type SidebarPinStore } from "./sidebar-pin-store";
import type { TeamApiAgentNotificationLevels, TeamApiSidebarPins } from "./team-api/dependencies";
import { TeamApiServer } from "./team-api-server";
import type { RemoteDirectoryMember, TeamIdentity, TeamStore } from "./team-store";
import type { TeamWebRtcBridge } from "./team-webrtc-bridge";
import { TeamWebRtcHostGateway } from "./team-webrtc-host-gateway";

export const DEVELOPMENT_REMOTE_CLIENT_USERNAME = "openbot-dev-client";

const UNNAMED_PERSON = "You";
const RELAY_DEFAULT_SERVER_NAME = "OpenBot";
const logger = createOpenBotLogger("host-service");

interface HostEvents {
  changed: [status: HostStatus];
  presence: [snapshot: TeamPresenceSnapshot];
  directMessage: [event: DirectMessageRealtimeEvent];
  directTyping: [event: DirectTypingRealtimeEvent];
}

interface MemberAuditActor {
  actor: ServerAuditName | null;
  memberId: string;
}

type ForwardedApiOptions = ConstructorParameters<typeof TeamApiServer>[0];

interface RelayHostingOptions {
  reconnect?: { baseMs?: number; maxMs?: number };
  control?: RelayControl;
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
  getSignedInUser: () => CentralAuthUser;
  redeemCentralTicket: (ticket: string, serverId: string) => Effect.Effect<CentralAuthUser | null, RemoteWorkflowError>;
  sendTeamInviteEmail: (input: {
    email: string;
    serverName: string;
    inviteUrl: string;
    role: "admin" | "member";
  }) => Effect.Effect<void, RemoteWorkflowError>;
  teamWebRtcBridge?: TeamWebRtcBridge;
  peerMemberChanged?: (peerId: string, membershipId: string | null) => void;
  privateNetwork?: () => boolean;
  preferredSignalHome?: () => string | null;
  signalHomeAnswers?: (home: string) => Effect.Effect<boolean>;
  registerRemoteHost?: (input: {
    hostId: string;
    name: string;
    ownerMembershipId: string;
    devicePublicKey?: string | null;
    automatic?: boolean;
  }) => Effect.Effect<unknown, RemoteWorkflowError>;
  handOverRemoteHostKey?: (
    hostId: string,
    handover: HostKeyHandover,
  ) => Effect.Effect<"accepted" | "refused", RemoteWorkflowError>;
  onKeyRotated?: () => void;
  issueRemoteHostTicket?: (
    hostId: string,
    home?: RemoteHostTicketHome,
  ) => Effect.Effect<{ ticket: string; signalUrl: string; expiresAt: number }, RemoteWorkflowError>;
  requestTransferredOwnerSession?: (
    hostId: string,
  ) => Effect.Effect<{ sessionToken: string; user: CentralAuthUser } | null, RemoteWorkflowError>;
  applyTransferredOwnerSession?: (
    hostId: string,
    session: { sessionToken: string; user: CentralAuthUser },
  ) => Effect.Effect<unknown, RemoteWorkflowError>;
  verifyRemoteSessionTicket?: (ticket: string) => Effect.Effect<VerifiedRemoteSessionTicket, RemoteWorkflowError>;
  endRemoteSession?: (sessionId: string) => Effect.Effect<void, RemoteWorkflowError>;
  remoteControlPlaneUrl?: string;
  createRemoteInvite?: (
    hostId: string,
    input: { role: "admin" | "member"; email?: string; permanent?: boolean },
  ) => Effect.Effect<
    { inviteId: string; token: string; expiresAt: number; permanent: boolean; useCount: number },
    RemoteWorkflowError
  >;
  listRemoteInvites?: (hostId: string) => Effect.Effect<
    Array<{
      inviteId: string;
      role: "admin" | "member";
      email: string | null;
      expiresAt: number;
      usedAt: number | null;
      revokedAt: number | null;
      permanent: boolean;
      useCount: number;
    }>,
    RemoteWorkflowError
  >;
  revokeRemoteInvite?: (inviteId: string) => Effect.Effect<void, RemoteWorkflowError>;
  listRemoteMembers?: (hostId: string) => Effect.Effect<RemoteDirectoryMember[], RemoteWorkflowError>;
  updateRemoteMember?: (
    hostId: string,
    membershipId: string,
    role: "admin" | "member",
    reactivate?: boolean,
  ) => Effect.Effect<void, RemoteWorkflowError>;
  removeRemoteMember?: (hostId: string, membershipId: string) => Effect.Effect<void, RemoteWorkflowError>;
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
  readonly #webrtcGateway: TeamWebRtcHostGateway | null;
  #status: HostStatus;
  #runtimeGeneration = 0;
  #startOperation: Fiber.Fiber<HostStatus, RemoteWorkflowError> | null = null;
  readonly #hostKeyLock = Semaphore.makeUnsafe(1);
  readonly #memberWrites = Semaphore.makeUnsafe(1);
  readonly #ownerAdoption = Semaphore.makeUnsafe(1);
  readonly #localPublish = Semaphore.makeUnsafe(1);
  readonly #relayHostingLock = Semaphore.makeUnsafe(1);
  #webRtcOnline = false;
  #unreachedSignalUrl: string | null = null;
  #boundAccountId: string | null | undefined = undefined;
  #legacyCredentialRemoved = false;
  #adoptedReaderKey: string | null = null;
  #hostRelay: HostRelay | null = null;

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
        ...(options.handOverRemoteHostKey && options.registerRemoteHost
          ? { hostKey: { rotate: () => this.#rotateIdentityKeyForOwner() } }
          : {}),
      },
      skills: options.skills,
      sidebarLayout: options.sidebarLayout,
      mailbox: options.mailbox,
      ...(options.attachmentPreviews === undefined ? {} : { attachmentPreviews: options.attachmentPreviews }),
      browser: options.browser,
      browserView: this.#browserView,
      redeemCentralTicket: options.redeemCentralTicket,
      ...(options.chat === undefined ? {} : { chat: options.chat }),
      onPresence: (snapshot) => this.emit("presence", snapshot),
      onDirectMessage: (event) => this.emit("directMessage", event),
      onDirectTyping: (event) => this.emit("directTyping", event),
      createInvite: (input) => this.createInvite(input),
      updateMember: (input, actor) => this.updateMember(input, actor),
      removeMember: (memberId, actor) => this.removeMember(memberId, actor),
      onSessionRevoked: (sessionId) => this.#revokeWebRtcSession(sessionId),
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
    this.#webrtcGateway = options.teamWebRtcBridge
      ? new TeamWebRtcHostGateway({
          bridge: options.teamWebRtcBridge,
          store: options.store,
          appVersion: options.appVersion,
          transferDirectory: join(options.logDirectory ?? ".openbot-remote", "transfers"),
          renewSignal: (hostId, failedSignalUrl) =>
            Effect.gen(function* () {
              const issueTicket = options.issueRemoteHostTicket;
              if (!issueTicket)
                return yield* new RemoteWorkflowError({
                  cause: new Error(sourceText("error.host.webRtcNotConfigured")),
                });
              return yield* issueTicket(hostId, failedSignalUrl === undefined ? {} : { failedSignalUrl });
            }).pipe(Effect.tap((bootstrap) => Effect.sync(() => this.#noticeOwnerChange(bootstrap.ticket)))),
          renewalRefused: isFinalClientError,
          onSignalRecoveryFailure: (error, reason) => {
            logger.warn(`Host phase ${this.#status.phase} -> error: Signal ${reason}.`);
            this.#setStatus({
              phase: "error",
              apiOnline: false,
              message: error.message,
            });
          },
          onSignalLost: (lost) => {
            if (this.#status.phase !== "online") return;
            const lostMessage = sourceText("status.host.signalLost");
            if (lost) this.#setStatus({ message: lostMessage });
            else if (this.#status.message === lostMessage)
              this.#setStatus({ message: sourceText("status.host.ready") });
          },
          closeSession: (sessionId) =>
            Effect.gen({ self: this }, function* () {
              yield* this.#browserView.revokeTeamSession(sessionId);
              this.#options.browser.releaseUserControlHeldBy({ kind: "session", sessionId });
            }),
          unknownMemberConnected: (membershipId) => this.#dispatch(this.#learnConnectedMember(membershipId)),
          ...(options.peerMemberChanged ? { peerMemberChanged: options.peerMemberChanged } : {}),
          ...(options.verifyRemoteSessionTicket ? { verifyClientTicket: options.verifyRemoteSessionTicket } : {}),
          ...(options.privateNetwork ? { privateNetwork: options.privateNetwork } : {}),
          ...(options.preferredSignalHome ? { preferredSignalHome: options.preferredSignalHome } : {}),
          ...(options.signalHomeAnswers ? { signalHomeAnswers: options.signalHomeAnswers } : {}),
        })
      : null;
  }

  readonly applyNetworkRoute = Effect.fn("HostService.applyNetworkRoute")(function* (this: HostService) {
    if (this.#webrtcGateway) yield* this.#webrtcGateway.applyNetworkRoute();
  }).bind(this);

  signalHome(): string | null {
    return this.#webRtcOnline ? (this.#webrtcGateway?.signalHome() ?? null) : null;
  }

  followSignalHome(): Effect.Effect<void> {
    return Effect.sync(() => {
      if (this.#webRtcOnline) this.#webrtcGateway?.scheduleSignalHomeFollow();
    });
  }

  getStatus(): HostStatus {
    return { ...this.#status };
  }

  describeRestartBlockers(): string[] {
    const reasons: string[] = [];
    if (this.#browserView.activeViewCount() > 0) reasons.push("browser-view");
    if (this.#webrtcGateway?.hasActiveTransfers()) reasons.push("file-transfer");
    return reasons;
  }

  unbindChangedAccount(user: CentralAuthUser | null): void {
    const nextAccountId = user?.id ?? null;
    if (this.#boundAccountId === undefined || this.#boundAccountId === nextAccountId) return;
    if (!this.#options.store.configured) return;
    this.#runtimeGeneration += 1;
    this.#options.store.unbindActiveHost();
    this.#status = initialHostStatus(null);
    this.emit("changed", this.getStatus());
  }

  readonly applySignedInAccount = Effect.fn("HostService.applySignedInAccount")(
    function* (this: HostService, user: CentralAuthUser | null): Effect.fn.Return<void, RemoteWorkflowError> {
      const nextAccountId = user?.id ?? null;
      const stillBound = this.#options.store.configured || nextAccountId === null;
      if (this.#boundAccountId === nextAccountId && stillBound) {
        if (user && this.#options.store.configured && (yield* this.#options.store.syncAccount(user))) {
          this.#api.refreshPresence();
        }
        return;
      }
      const previousServerId = this.#status.serverId;
      if (this.#boundAccountId !== undefined) {
        this.#runtimeGeneration += 1;
        yield* this.#attemptTeardown(this.#stopRuntime());
        yield* this.#attemptTeardown(this.#startOperation ? Fiber.join(this.#startOperation) : Effect.void);
        yield* this.#attemptTeardown(this.#stopRuntime());
      }
      let activated = false;
      return yield* Effect.gen({ self: this }, function* () {
        if (user && this.#signedInAccountId() !== user.id) {
          return;
        }
        if (user) yield* this.#options.store.activateAccount(user);
        else yield* this.#options.store.deactivate();
        activated = true;
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            this.#boundAccountId = activated ? nextAccountId : undefined;
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

  getMobileConnectHost(): { hostId: string; fingerprint: string } | null {
    const identity = this.#options.store.getIdentity();
    return identity ? { hostId: identity.serverId, fingerprint: identity.fingerprint } : null;
  }

  readonly configure = Effect.fn("HostService.configure")(
    function* (
      this: HostService,
      input: ConfigureHostInput,
      background = false,
    ): Effect.fn.Return<HostStatus, RemoteWorkflowError> {
      const optionalRegisterRemoteHost = this.#options.registerRemoteHost;
      const account = yield* remoteDecode(() => this.#options.getSignedInUser());
      const identity = yield* this.#options.store.configureWithAccount(input.serverName, account, input.logo);
      if (this.#signedInAccountId() !== account.id) {
        this.#options.store.unbindActiveHost();
        this.#status = initialHostStatus(null);
        this.emit("changed", this.getStatus());
        return yield* new RemoteWorkflowError({
          cause: new Error(sourceText("error.team.accountChangedDuringCreate")),
        });
      }
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
      const ownerMembershipId = yield* remoteDecode(() => this.#requiredOwnerMemberId());
      const attempt0 = yield* Effect.gen({ self: this }, function* () {
        if (!this.#isActiveHost(identity.serverId)) return this.getStatus();
        if (optionalRegisterRemoteHost)
          yield* this.#registerRemoteHost(optionalRegisterRemoteHost, ownerMembershipId, background);
        if (!this.#isActiveHost(identity.serverId)) return this.getStatus();
        this.#setStatus({
          apiUrl: null,
          message: sourceText("status.host.registered"),
        });
      }).pipe(Effect.result);
      if (Result.isFailure(attempt0) && background) return yield* attempt0.failure;
      if (Result.isFailure(attempt0)) {
        const error = attempt0.failure.cause;
        if (this.#isActiveHost(identity.serverId)) {
          this.#setStatus({
            phase: "error",
            message: error instanceof Error ? error.message : sourceText("error.host.reserveAddressFailed"),
          });
        }
      } else if (attempt0.success !== undefined) return attempt0.success;
      return this.getStatus();
    },
    (operation) => this.#provide(operation),
  ).bind(this);

  readonly updateIdentity = Effect.fn("HostService.updateIdentity")(
    function* (this: HostService, input: UpdateHostIdentityInput): Effect.fn.Return<HostStatus, RemoteWorkflowError> {
      const optionalRegisterRemoteHost = this.#options.registerRemoteHost;
      const passwordOwner = this.#options.passwordOwner === true;
      if (!passwordOwner)
        yield* remoteDecode(() => this.#options.store.assertOwnerAccount(this.#options.getSignedInUser()));
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
      if (passwordOwner) return this.getStatus();
      const ownerMembershipId = yield* remoteDecode(() => this.#requiredOwnerMemberId());
      if (optionalRegisterRemoteHost) yield* this.#registerRemoteHost(optionalRegisterRemoteHost, ownerMembershipId);
      return this.getStatus();
    },
    (operation) => this.#provide(operation),
  ).bind(this);

  readonly rotateIdentityKey = Effect.fn("HostService.rotateIdentityKey")(
    function* (this: HostService): Effect.fn.Return<HostStatus, RemoteWorkflowError> {
      yield* this.#rotateKey();
      return this.getStatus();
    },
    (operation) => this.#provide(operation),
  ).bind(this);

  readonly #rotateIdentityKeyForOwner = Effect.fn("HostService.rotateIdentityKeyForOwner")(
    function* (this: HostService): Effect.fn.Return<{ publicKey: string }, RemoteWorkflowError> {
      return { publicKey: yield* this.#rotateKey() };
    },
    (operation) => this.#provide(operation),
  );

  readonly #rotateKey = Effect.fn("HostService.rotateKey")(function* (
    this: HostService,
  ): Effect.fn.Return<string, RemoteWorkflowError> {
    if (!this.#options.handOverRemoteHostKey || !this.#options.registerRemoteHost)
      return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.host.keyRotationUnavailable")) });
    yield* remoteDecode(() => this.#options.store.assertOwnerAccount(this.#options.getSignedInUser()));
    const { handover, result } = yield* this.#hostKeyLock.withPermit(
      Effect.gen({ self: this }, function* () {
        const handover = yield* this.#options.store.beginKeyRotation();
        return { handover, result: yield* this.#resolvePendingKeyRotation() };
      }),
    );
    if (result !== "accepted" || this.#options.store.getIdentity()?.publicKey !== handover.publicKey)
      return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.host.keyRotationRefused")) });
    if (this.#isActiveHost(handover.hostId)) {
      this.#setStatus({ message: sourceText("status.host.keyRotated") });
      this.#api.refreshIdentity();
    }
    this.#options.onKeyRotated?.();
    return handover.publicKey;
  });

  readonly #resolvePendingKeyRotation = Effect.fn("HostService.resolvePendingKeyRotation")(function* (
    this: HostService,
  ): Effect.fn.Return<"accepted" | "refused" | "none", RemoteWorkflowError> {
    const handover = this.#options.store.getPendingKeyHandover();
    const handOver = this.#options.handOverRemoteHostKey;
    if (!handover || !handOver) return "none";
    const result = yield* handOver(handover.hostId, handover);
    if (result === "accepted") yield* this.#options.store.completeKeyRotation(handover);
    else yield* this.#options.store.discardKeyRotation(handover);
    return result;
  });

  readonly #registerRemoteHost = Effect.fn("HostService.registerRemoteHost")(
    function* (
      this: HostService,
      register: NonNullable<HostServiceOptions["registerRemoteHost"]>,
      ownerMembershipId: string,
      automatic = false,
    ): Effect.fn.Return<void, RemoteWorkflowError> {
      yield* this.#resolvePendingKeyRotation();
      const identity = this.#options.store.getIdentity();
      if (!identity) return;
      yield* register({
        hostId: identity.serverId,
        name: identity.serverName,
        ownerMembershipId,
        devicePublicKey: identity.publicKey,
        ...(automatic ? { automatic } : {}),
      });
    },
    (operation) => this.#hostKeyLock.withPermit(operation),
  );

  readonly register = Effect.fn("HostService.register")(function* (this: HostService) {
    if (this.#boundAccountId !== this.#signedInAccountId()) return;
    if (!this.#options.store.configured) {
      yield* this.configure({ serverName: "OpenBot" }, true);
      return;
    }
    const register = this.#options.registerRemoteHost;
    if (!register) return;
    yield* remoteDecode(() => this.#options.store.assertOwnerAccount(this.#options.getSignedInUser()));
    yield* this.#registerRemoteHost(register, yield* remoteDecode(() => this.#requiredOwnerMemberId()), true);
  }).bind(this);

  readonly refreshRegistration = Effect.fn("HostService.refreshRegistration")(function* (this: HostService) {
    const register = this.#options.registerRemoteHost;
    if (!register) return;
    yield* remoteDecode(() => this.#options.store.assertOwnerAccount(this.#options.getSignedInUser()));
    const publicKey = this.#options.store.getIdentity()?.publicKey;
    yield* this.#registerRemoteHost(register, yield* remoteDecode(() => this.#requiredOwnerMemberId()));
    const identity = this.#options.store.getIdentity();
    if (identity && identity.publicKey !== publicKey && this.#isActiveHost(identity.serverId))
      this.#api.refreshIdentity();
  }).bind(this);

  #signedInAccountId(): string | null {
    try {
      return this.#options.getSignedInUser().id;
    } catch {
      return null;
    }
  }

  #assertStillActiveHost(serverId: string): void {
    if (!this.#isActiveHost(serverId)) {
      throw new Error(sourceText("error.host.accountChangedDuringUpdate"));
    }
  }

  #isActiveHost(serverId: string): boolean {
    return this.#options.store.getIdentity()?.serverId === serverId;
  }

  readonly start = Effect.fn("HostService.start")(function* (this: HostService, automatic = false) {
    if (this.#hostRelay) return this.getStatus();
    if (this.#startOperation) {
      const joined = yield* Fiber.join(this.#startOperation);
      if (automatic || joined.message !== sourceText("status.host.removed")) return joined;
      if (this.#startOperation) return yield* Fiber.join(this.#startOperation);
    }
    const operation = yield* Effect.forkIn(this.#provide(this.#startRuntimeOperation(automatic)), this.#runtime.scope, {
      startImmediately: false,
    });
    this.#startOperation = operation;
    operation.addObserver(() => {
      if (this.#startOperation === operation) this.#startOperation = null;
    });
    return yield* Fiber.join(operation);
  }).bind(this);

  readonly #startRuntimeOperation = Effect.fn("HostService.startRuntimeOperation")(function* (
    this: HostService,
    automatic: boolean,
  ): Effect.fn.Return<HostStatus, RemoteWorkflowError, HostApiRuntime> {
    const gateway = this.#webrtcGateway;
    const optionalRegisterRemoteHost = this.#options.registerRemoteHost;
    const optionalIssueRemoteHostTicket = this.#options.issueRemoteHostTicket;
    const optionalListRemoteMembers = this.#options.listRemoteMembers;
    if (!this.#options.store.configured)
      return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.host.nameBeforePublish")) });
    if ((this.#status.phase === "online" && this.#webRtcOnline) || this.#status.phase === "starting") {
      return this.getStatus();
    }
    if (this.#status.phase === "stopping") return this.getStatus();
    const generation = ++this.#runtimeGeneration;
    const signedInUser = yield* remoteDecode(() => this.#options.getSignedInUser());
    yield* remoteDecode(() => this.#options.store.assertOwnerAccount(signedInUser));
    if (yield* this.#options.store.syncAccount(signedInUser)) this.#api.refreshPresence();
    this.#setStatus({ phase: "starting", message: sourceText("status.host.starting") });
    this.#removeLegacyRemoteDesktopCredential();

    const attempt1 = yield* Effect.gen({ self: this }, function* () {
      const apiPort = yield* HostApiRuntime.use((api) => api.start());
      if (yield* this.#cancelSupersededStartEffect(generation)) return this.getStatus();
      const identity = this.#options.store.getIdentity();
      if (!identity)
        return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.host.nameBeforePublish")) });
      if (!gateway || !optionalRegisterRemoteHost || !optionalIssueRemoteHostTicket) {
        return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.host.webRtcNotConfigured")) });
      }
      yield* Effect.forkChild(gateway.prepare().pipe(Effect.ignore));
      yield* this.#registerRemoteHost(
        optionalRegisterRemoteHost,
        yield* remoteDecode(() => this.#requiredOwnerMemberId()),
        automatic,
      );
      if (yield* this.#cancelSupersededStartEffect(generation)) return this.getStatus();
      const syncMembers =
        this.#usesAccountDirectory() && optionalListRemoteMembers
          ? this.#memberWrites.withPermit(
              Effect.flatMap(optionalListRemoteMembers(identity.serverId), (members) =>
                this.#syncRemoteDirectory(identity.serverId, members).pipe(Effect.uninterruptible),
              ),
            )
          : Effect.void;
      const failedSignalUrl = this.#unreachedSignalUrl;
      const [, bootstrap] = yield* Effect.all(
        [
          syncMembers,
          optionalIssueRemoteHostTicket(identity.serverId, failedSignalUrl === null ? {} : { failedSignalUrl }),
        ],
        { concurrency: 2 },
      );
      if (yield* this.#cancelSupersededStartEffect(generation)) return this.getStatus();
      yield* gateway
        .start({
          hostId: identity.serverId,
          signalUrl: bootstrap.signalUrl,
          ticket: bootstrap.ticket,
          localApiPort: apiPort,
        })
        .pipe(
          Effect.tapError(() =>
            Effect.sync(() => {
              this.#unreachedSignalUrl = bootstrap.signalUrl;
            }),
          ),
        );
      this.#unreachedSignalUrl = null;
      this.#webRtcOnline = true;
      if (yield* this.#cancelSupersededStartEffect(generation)) return this.getStatus();
      this.#setStatus({
        apiUrl: bootstrap.signalUrl,
        apiOnline: true,
        message: sourceText("status.host.ready"),
      });
      if (yield* this.#cancelSupersededStartEffect(generation)) return this.getStatus();
      yield* this.#options.store.setEnabledOnLaunch(identity.serverId, true);
      if (yield* this.#cancelSupersededStartEffect(generation)) return this.getStatus();
      this.#setStatus({ phase: "online", enabledOnLaunch: true });
    }).pipe(Effect.result);
    if (Result.isFailure(attempt1)) {
      const error = attempt1.failure.cause;
      if (generation !== this.#runtimeGeneration) {
        yield* this.#stopRuntime();
        return this.getStatus();
      }
      yield* this.#stopRuntime();
      if (isOwnerChangedRefusal(error) && (yield* this.#adoptTransferredOwnership(null))) return this.getStatus();
      if (automatic && isHostRemovedRefusal(error)) {
        if (generation !== this.#runtimeGeneration) return this.getStatus();
        const serverId = this.#options.store.getIdentity()?.serverId;
        if (serverId) yield* this.#options.store.setEnabledOnLaunch(serverId, false);
        if (generation !== this.#runtimeGeneration) return this.getStatus();
        this.#setStatus({
          phase: "idle",
          enabledOnLaunch: false,
          apiOnline: false,
          apiUrl: null,
          message: sourceText("status.host.removed"),
        });
        return this.getStatus();
      }
      this.#setStatus({
        phase: "error",
        apiOnline: false,
        apiUrl: null,
        message: error instanceof Error ? error.message : sourceText("error.host.publishFailed"),
      });
    } else if (attempt1.success !== undefined) return attempt1.success;
    return this.getStatus();
  });

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
      const relay = new HostRelay({
        identity,
        server: this.#api,
        label: hostIdentity.serverName,
        ...(options.reconnect ? { reconnect: options.reconnect } : {}),
        ...(options.control ? { control: options.control } : {}),
      });
      relay.on("state", (state) => this.#relayStateChanged(relay, state));
      this.#hostRelay = relay;
      this.#setStatus({ phase: "starting", message: null });
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
    const account = yield* remoteDecode(() => this.#options.getSignedInUser());
    yield* this.#options.store.configureWithAccount(serverName, account);
    this.#publishActiveHost(previousServerId);
  });

  readonly #stopHostRelay = Effect.fn("HostService.stopHostRelay")(function* (this: HostService) {
    const relay = this.#hostRelay;
    this.#hostRelay = null;
    if (relay) yield* relay.stop();
  });

  #relayStateChanged(relay: HostRelay, state: RelayControlState): void {
    if (this.#hostRelay !== relay || this.#status.phase !== "online") return;
    const status = relayHostStatus(state);
    if (status) this.#setStatus(status);
  }

  readonly publishLocalServer = Effect.fn("HostService.publishLocalServer")(
    function* (this: HostService): Effect.fn.Return<void, RemoteWorkflowError> {
      const gateway = this.#webrtcGateway;
      const issueTicket = this.#options.issueRemoteHostTicket;
      const identity = this.#options.store.getIdentity();
      const apiPort = this.#api.port;
      if (!gateway || !issueTicket || !identity || apiPort === null)
        return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.host.webRtcNotConfigured")) });
      if (this.#webRtcOnline) {
        if (this.#status.phase !== "error") return;
        this.#webRtcOnline = false;
        yield* gateway.stop();
      }
      const failedSignalUrl = this.#unreachedSignalUrl;
      const bootstrap = yield* issueTicket(identity.serverId, failedSignalUrl === null ? {} : { failedSignalUrl });
      yield* gateway
        .start({
          hostId: identity.serverId,
          signalUrl: bootstrap.signalUrl,
          ticket: bootstrap.ticket,
          localApiPort: apiPort,
        })
        .pipe(
          Effect.tapError(() =>
            Effect.sync(() => {
              this.#unreachedSignalUrl = bootstrap.signalUrl;
            }),
          ),
        );
      this.#unreachedSignalUrl = null;
      this.#webRtcOnline = true;
      if (this.#status.phase === "error") this.#setStatus({ phase: "online", apiOnline: true, message: null });
    },
    (operation) => this.#localPublish.withPermit(operation),
  ).bind(this);

  readonly unpublishLocalServer = Effect.fn("HostService.unpublishLocalServer")(
    function* (this: HostService): Effect.fn.Return<void, RemoteWorkflowError> {
      if (!this.#webRtcOnline) return;
      this.#webRtcOnline = false;
      yield* this.#webrtcGateway?.stop() ?? Effect.void;
    },
    (operation) => this.#localPublish.withPermit(operation),
  ).bind(this);

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
      this.#runtimeGeneration += 1;
      if (persistPreference)
        yield* remoteDecode(() => this.#options.store.assertOwnerAccount(this.#options.getSignedInUser()));
      this.#setStatus({ phase: "stopping", message: sourceText("status.host.stopping") });
      yield* this.#stopRuntime();
      if (this.#startOperation) yield* Fiber.join(this.#startOperation);
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

  readonly listMembers = Effect.fn("HostService.listMembers")(
    function* (this: HostService) {
      const hostId = this.#options.store.getIdentity()?.serverId;
      if (hostId && this.#usesAccountDirectory() && this.#options.listRemoteMembers) {
        const list = this.#options.listRemoteMembers;

        const members = yield* list(hostId);
        if (!this.#isActiveHost(hostId)) return this.#options.store.listMembers();
        yield* this.#syncRemoteDirectory(hostId, members);
        if (!this.#isActiveHost(hostId)) return this.#options.store.listMembers();
        return members.map((member) => ({
          id: member.membershipId,
          username: member.email,
          email: member.email,
          name: member.name,
          avatarUrl: member.avatarUrl,
          ...(isAvatarColor(member.chatColor) ? { chatColor: member.chatColor } : {}),
          role: member.role,
          createdAt: new Date(member.createdAt).toISOString(),
          disabled: member.status !== "active",
        }));
      }
      return this.#options.store.listMembers();
    },
    (operation) => this.#memberWrites.withPermit(operation),
    (operation) => this.#provide(operation),
  ).bind(this);

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

  readonly listInvites = Effect.fn("HostService.listInvites")(
    function* (this: HostService) {
      const hostId = this.#options.store.getIdentity()?.serverId;
      if (hostId && this.#remoteInviteApiUrl() && this.#options.listRemoteInvites) {
        const list = this.#options.listRemoteInvites;

        const invites = yield* list(hostId);
        if (!this.#isActiveHost(hostId)) return this.#options.store.listInvites();
        return invites
          .filter((invite) => invite.revokedAt === null)
          .map((invite) => ({
            id: invite.inviteId,
            role: invite.role,
            email: invite.email,
            expiresAt: new Date(invite.expiresAt).toISOString(),
            usedAt: invite.usedAt === null ? null : new Date(invite.usedAt).toISOString(),
            permanent: invite.permanent,
            useCount: invite.useCount,
          }));
      }
      return this.#options.store.listInvites();
    },
    (operation) => this.#provide(operation),
  ).bind(this);

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
      const optionalListRemoteMembers = this.#options.listRemoteMembers;
      const optionalUpdateRemoteMember = this.#options.updateRemoteMember;
      const optionalRemoveRemoteMember = this.#options.removeRemoteMember;
      const hostId = this.#options.store.getIdentity()?.serverId;
      if (
        hostId &&
        this.#usesAccountDirectory() &&
        optionalUpdateRemoteMember &&
        optionalRemoveRemoteMember &&
        optionalListRemoteMembers
      ) {
        const current = (yield* optionalListRemoteMembers(hostId)).find(
          (member) => member.membershipId === input.memberId,
        );
        if (!current || current.role === "owner")
          return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.host.memberNotFound")) });
        yield* remoteDecode(() => this.#assertStillActiveHost(hostId));
        const role = input.role ?? current.role;
        if (input.disabled) yield* optionalRemoveRemoteMember(hostId, input.memberId);
        else yield* optionalUpdateRemoteMember(hostId, input.memberId, role, input.disabled === false);
        yield* remoteDecode(() => this.#assertStillActiveHost(hostId));
        const members = yield* optionalListRemoteMembers(hostId);
        const updated = members.find((member) => member.membershipId === input.memberId);
        if (!updated)
          return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.host.memberNotFound")) });
        yield* this.#syncRemoteDirectory(hostId, members, { actor, memberId: input.memberId });
        yield* remoteDecode(() => this.#assertStillActiveHost(hostId));
        if (updated.role !== current.role || updated.status !== current.status)
          yield* this.#revokeMemberSessions(input.memberId);
        return {
          id: updated.membershipId,
          username: updated.email,
          email: updated.email,
          name: updated.name,
          avatarUrl: updated.avatarUrl,
          role: updated.role,
          createdAt: new Date(updated.createdAt).toISOString(),
          disabled: updated.status !== "active",
        };
      }
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
      const optionalListRemoteMembers = this.#options.listRemoteMembers;
      const optionalRemoveRemoteMember = this.#options.removeRemoteMember;
      const hostId = this.#options.store.getIdentity()?.serverId;
      if (hostId && this.#usesAccountDirectory() && optionalRemoveRemoteMember) {
        yield* optionalRemoveRemoteMember(hostId, memberId);
        if (optionalListRemoteMembers) {
          const members = yield* optionalListRemoteMembers(hostId);
          yield* this.#syncRemoteDirectory(hostId, members, { actor, memberId });
        }
        yield* this.#revokeMemberSessions(memberId);
        yield* this.#forgetMemberRoles(hostId, memberId);
        yield* this.#forgetNotificationLevels(memberId);
        yield* this.#forgetSidebarPins(memberId);
        return;
      }
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
      yield* this.#revokeWebRtcSession(sessionId);
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

  readonly #syncRemoteDirectory = Effect.fn("HostService.syncRemoteDirectory")(function* (
    this: HostService,
    hostId: string,
    members: RemoteDirectoryMember[],
    by?: MemberAuditActor,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    const before = this.#options.store.listStoredMembers();
    const closed = yield* this.#options.store.syncRemoteDirectory(hostId, members, {
      keepOwner: this.#options.passwordOwner === true,
    });
    yield* this.#auditMembers(hostId, before, by);
    for (const sessionId of closed) yield* this.#closeLocalSession(sessionId);
    if (closed.length > 0 || memberChatColorsChanged(before, this.#options.store.listStoredMembers())) {
      this.#api.refreshPresence();
    }
  });

  readonly applyAccountDirectory = Effect.fn("HostService.applyAccountDirectory")(
    function* (this: HostService, members: RemoteDirectoryMember[]): Effect.fn.Return<void, RemoteWorkflowError> {
      const hostId = this.#options.store.getIdentity()?.serverId;
      if (!hostId) return;
      yield* this.#syncRemoteDirectory(hostId, members);
      this.#api.refreshPresence();
    },
    (operation) => this.#memberWrites.withPermit(operation),
  ).bind(this);

  readonly #learnConnectedMember = Effect.fn("HostService.learnConnectedMember")(function* (
    this: HostService,
    membershipId: string,
  ): Effect.fn.Return<void> {
    const hostId = this.#options.store.getIdentity()?.serverId;
    const listRemoteMembers = this.#options.listRemoteMembers;
    if (!hostId || !listRemoteMembers || !this.#usesAccountDirectory()) return;
    yield* this.#memberWrites
      .withPermit(
        Effect.gen({ self: this }, function* () {
          if (this.#options.store.getMember(membershipId)) return;
          const members = yield* listRemoteMembers(hostId);
          if (!this.#isActiveHost(hostId)) return;
          yield* this.#syncRemoteDirectory(hostId, members);
          this.#api.refreshPresence();
        }),
      )
      .pipe(
        Effect.catch((error) =>
          Effect.sync(() => logger.warn("The account directory did not load for a new member.", toLogValue(error))),
        ),
      );
  });

  readonly #revokeMemberSessions = Effect.fn("HostService.revokeMemberSessions")(function* (
    this: HostService,
    memberId: string,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    for (const session of this.#options.store.listSessions()) {
      if (session.memberId !== memberId) continue;
      yield* this.#closeLocalSession(session.id);
      yield* this.#options.store.revokeSession(session.id);
    }
    this.#options.browser.releaseUserControlHeldBy({ kind: "member", memberId });
    this.#api.refreshPresence();
  });

  readonly #closeLocalSession = Effect.fn("HostService.closeLocalSession")(function* (
    this: HostService,
    sessionId: string,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    if (this.#webrtcGateway) yield* this.#webrtcGateway.revokeSession(sessionId);
    yield* this.#browserView.revokeTeamSession(sessionId);
    this.#options.browser.releaseUserControlHeldBy({ kind: "session", sessionId });
  });

  readonly #revokeWebRtcSession = Effect.fn("HostService.revokeWebRtcSession")(function* (
    this: HostService,
    sessionId: string,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    const end = this.#options.endRemoteSession;
    const gateway = this.#webrtcGateway;
    yield* Effect.all([end ? end(sessionId) : Effect.void, gateway ? gateway.revokeSession(sessionId) : Effect.void], {
      concurrency: "unbounded",
    });
  });

  #usesAccountDirectory(): boolean {
    return !this.#options.localDevelopmentHost && this.#hostRelay === null;
  }

  #remoteInviteApiUrl(): string | null {
    return this.#usesAccountDirectory() ? this.#options.remoteControlPlaneUrl || null : null;
  }

  revokeInvite(inviteId: string) {
    if (this.#remoteInviteApiUrl() && this.#options.revokeRemoteInvite)
      return this.#options.revokeRemoteInvite(inviteId);
    return this.#options.store.revokeInvite(inviteId);
  }

  readonly createInvite = Effect.fn("HostService.createInvite")(
    function* (this: HostService, input: CreateTeamInviteInput): Effect.fn.Return<InviteSummary, RemoteWorkflowError> {
      const optionalCreateRemoteInvite = this.#options.createRemoteInvite;
      const optionalRevokeRemoteInvite = this.#options.revokeRemoteInvite;
      const identity = this.#options.store.getIdentity();
      if (!identity)
        return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.host.nameBeforePublish")) });
      const remoteInviteApiUrl = this.#remoteInviteApiUrl();
      if (remoteInviteApiUrl && optionalCreateRemoteInvite) {
        if (input.email && selfHostedApiOrigin(remoteInviteApiUrl))
          return yield* new RemoteWorkflowError({
            cause: new Error(sourceText("error.remote.selfHostedInviteNoEmail")),
          });
        const invite = yield* optionalCreateRemoteInvite(identity.serverId, input);
        yield* remoteDecode(() => this.#assertStillActiveHost(identity.serverId));
        const inviteUrl = yield* remoteDecode(() =>
          createOpenBotInviteUrl(
            {
              apiUrl: remoteInviteApiUrl,
              serverId: identity.serverId,
              fingerprint: identity.fingerprint,
              token: invite.token,
            },
            { selfHostedApiOrigin: selfHostedApiOrigin(remoteInviteApiUrl) },
          ),
        );
        const result: InviteSummary = {
          id: invite.inviteId,
          role: input.role,
          expiresAt: new Date(invite.expiresAt).toISOString(),
          usedAt: null,
          inviteUrl,
          email: input.email ?? null,
          permanent: invite.permanent,
          useCount: invite.useCount,
        };
        if (input.email) {
          const email = input.email;
          const attempt4 = yield* Effect.gen({ self: this }, function* () {
            yield* this.#options.sendTeamInviteEmail({
              email,
              serverName: identity.serverName,
              inviteUrl,
              role: input.role,
            });
          }).pipe(Effect.result);
          if (Result.isFailure(attempt4)) {
            const error = attempt4.failure.cause;
            if (this.#isActiveHost(identity.serverId))
              yield* optionalRevokeRemoteInvite?.(invite.inviteId) ?? Effect.succeed(undefined);
            return yield* new RemoteWorkflowError({ cause: error });
          }
        }
        yield* remoteDecode(() => this.#assertStillActiveHost(identity.serverId));
        return result;
      }
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
      if (invite.email) {
        const email = invite.email;
        const attempt3 = yield* Effect.gen({ self: this }, function* () {
          yield* this.#options.sendTeamInviteEmail({
            email,
            serverName: identity.serverName,
            inviteUrl: result.inviteUrl,
            role: input.role,
          });
        }).pipe(Effect.result);
        if (Result.isFailure(attempt3)) {
          const error = attempt3.failure.cause;
          yield* this.#options.store.revokeInvite(invite.id);
          return yield* new RemoteWorkflowError({ cause: error });
        }
      }
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

  #noticeOwnerChange(ticket: string): void {
    const owner = ticketUserId(ticket);
    if (!owner || owner === this.#signedInAccountId() || !this.#options.requestTransferredOwnerSession) return;
    this.#dispatch(this.#adoptTransferredOwnership(owner).pipe(Effect.asVoid));
  }

  readonly #adoptTransferredOwnership = Effect.fn("HostService.adoptTransferredOwnership")(
    function* (this: HostService, expectedOwner: string | null): Effect.fn.Return<boolean> {
      if (expectedOwner !== null && expectedOwner === this.#signedInAccountId()) return false;
      const request = this.#options.requestTransferredOwnerSession;
      const apply = this.#options.applyTransferredOwnerSession;
      const identity = this.#options.store.getIdentity();
      if (!request || !apply || !identity) return false;
      return yield* Effect.gen({ self: this }, function* () {
        const session = yield* request(identity.serverId);
        if (!session) return false;
        const closed = yield* this.#options.store.transferOwnership(identity.serverId, session.user);
        for (const sessionId of closed) yield* this.#closeLocalSession(sessionId);
        yield* apply(identity.serverId, session);
        logger.info("The server now belongs to its new owner.");
        return true;
      }).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            logger.warn("The server could not apply its ownership change:", toLogValue(error.cause));
            return false;
          }),
        ),
      );
    },
    (operation) => this.#ownerAdoption.withPermit(operation),
  );

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
        Effect.acquireUseRelease(
          Effect.void,
          () => this.#webrtcGateway?.dispose() ?? Effect.void,
          () =>
            Effect.gen({ self: this }, function* () {
              while (this.#operations.size > 0) {
                yield* Effect.all([...this.#operations].map(Deferred.await), { concurrency: "unbounded" });
              }
              yield* this.#runtime.disposeEffect;
            }),
        ),
    ).pipe(Effect.onExit((exit) => Effect.sync(() => Deferred.doneUnsafe(stopped, exit))));
  }, Effect.uninterruptible).bind(this);

  #attemptTeardown<A>(step: Effect.Effect<A, RemoteWorkflowError>): Effect.Effect<void> {
    return step.pipe(
      Effect.asVoid,
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          logger.error("Unable to stop the host runtime while switching accounts:", toLogValue(Cause.squash(cause)));
        }),
      ),
    );
  }

  readonly #stopRuntime = Effect.fn("HostService.stopRuntime")(function* (this: HostService) {
    this.#webRtcOnline = false;
    return yield* Effect.acquireUseRelease(
      Effect.void,
      () => this.#stopHostRelay().pipe(Effect.andThen(() => this.#webrtcGateway?.stop() ?? Effect.void)),
      () => this.#api.stop(),
    );
  }, Effect.uninterruptible);

  readonly #cancelSupersededStartEffect = Effect.fn("HostService.cancelSupersededStart")(function* (
    this: HostService,
    generation: number,
  ): Effect.fn.Return<boolean, RemoteWorkflowError> {
    if (generation === this.#runtimeGeneration) return false;
    yield* this.#stopRuntime();
    return true;
  });

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
    let user: CentralAuthUser;
    try {
      user = this.#options.getSignedInUser();
    } catch {
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
    try {
      return personId !== `local-user:${this.#options.getSignedInUser().id}`;
    } catch {
      return true;
    }
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
    let user: CentralAuthUser;
    try {
      user = this.#options.getSignedInUser();
    } catch {
      return undefined;
    }
    return conversationMessageSender(this.#currentAgentReaderId(), user.name?.trim() || user.email || UNNAMED_PERSON);
  }

  #currentAgentReaderId(): string {
    const accountReaderId = `local-user:${this.#options.getSignedInUser().id}`;
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
    try {
      const user = this.#options.getSignedInUser();
      const accountMemberId = this.#options.store.accountMemberId(user.id);
      if (accountMemberId) return accountMemberId;
      const email = user.email.trim().toLowerCase();
      if (!email) return null;
      const member = this.#options.store
        .listMembers()
        .find(
          (candidate) =>
            candidate.email?.trim().toLowerCase() === email || candidate.username.trim().toLowerCase() === email,
        );
      return member && !member.disabled ? member.id : null;
    } catch {
      return null;
    }
  }

  #requiredOwnerMemberId(): string {
    const memberId = this.#options.store.getOwnerMemberId();
    if (!memberId) throw new Error(sourceText("error.host.ownerIdentityUnavailable"));
    return memberId;
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

function memberChatColorsChanged(before: readonly TeamMemberSummary[], after: readonly TeamMemberSummary[]): boolean {
  const previous = new Map(before.map((member) => [member.id, member.chatColor ?? null]));
  return after.some((member) => (previous.get(member.id) ?? null) !== (member.chatColor ?? null));
}

function isOwnerChangedRefusal(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "host_owner_mismatch";
}

const decodeTicketClaims = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Struct({ userId: Schema.String })));

function ticketUserId(ticket: string): string | null {
  const payload = ticket.split(".")[1];
  if (!payload) return null;
  return Option.getOrNull(decodeTicketClaims(Buffer.from(payload, "base64url").toString("utf8")))?.userId ?? null;
}

function isHostRemovedRefusal(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "host_removed";
}
