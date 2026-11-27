import { createHash } from "node:crypto";
import { openAsBlob } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { BROWSER_SECRET_RESPONSE_PATH } from "@openbot/contracts/ipc";
import type { RelayPeer } from "@openbot/contracts/relay-protocol/messages";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { AGENT_BACKGROUND_WORK_CAPABILITY } from "@openbot/contracts/team-protocol/agent-background-work-v1";
import { AGENT_PENDING_RUNTIME_CAPABILITY } from "@openbot/contracts/team-protocol/agent-pending-runtime-v1";
import { AGENT_TASK_UI_BLOCKS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-task-ui-blocks-v1";
import { TEAM_PROTOCOL_CAPABILITY_LIMITS } from "@openbot/contracts/team-protocol/capability-limits";
import {
  AGENT_ERROR_LINK_CAPABILITY,
  BROWSER_SIGN_IN_CAPABILITY,
  BROWSER_VAULT_SKIP_CAPABILITY,
  CHANNEL_BROWSER_CAPABILITY,
  CHANNEL_ISOLATION_CAPABILITY,
  CHANNEL_PICTURE_CAPABILITY,
  CHANNEL_SEEN_SUBTASKS_CAPABILITY,
  CHANNEL_TASK_WAITS_CAPABILITY,
  encodeTeamCapabilitiesV10,
  expandTeamCapabilitiesV10,
  isAgentProfileRoute,
  supportsTeamSemanticTags,
  TEAM_AGENT_CREATE_MODEL_CAPABILITY,
  TEAM_CHANNEL_ATTENTION_CAPABILITY,
  TEAM_CONTEXT_USAGE_CAPABILITY,
  TEAM_CURRENT_CAPABILITIES,
  TEAM_HISTORY_EXTENT_CAPABILITY,
  TEAM_MEMORY_CHANGES_CAPABILITY,
  TEAM_PROMPT_MULTI_SELECT_CAPABILITY,
  TEAM_SUBAGENTS_CAPABILITY,
  TEAM_UI_BLOCKS_CAPABILITY,
  TEAM_USAGE_GROUPS_CAPABILITY,
  TEAM_USAGE_READ_FAILED_CAPABILITY,
  TEAM_USAGE_TERTIARY_CAPABILITY,
  TEAM_VIDEO_GENERATION_CAPABILITY,
} from "@openbot/contracts/team-protocol/current";
import { toWireAgentKeysObjectForPath } from "@openbot/contracts/team-protocol/current-agent-keys";
import { MCP_MANY_SERVERS_CAPABILITY } from "@openbot/contracts/team-protocol/mcp-many-servers-v1";
import { optionalTeamEvent } from "@openbot/contracts/team-protocol/optional-events";
import {
  addPromptQuestionDetails,
  TEAM_PROMPT_DETAIL_CAPABILITY,
  withPromptQuestionDetails,
} from "@openbot/contracts/team-protocol/prompt-detail-v1";
import { PROVIDER_MANY_ACCOUNTS_CAPABILITY } from "@openbot/contracts/team-protocol/provider-many-accounts-v1";
import { QUEUE_HOLD_CAPABILITY, QUEUE_HOLD_SIGN_IN_CAPABILITY } from "@openbot/contracts/team-protocol/queue-hold-v1";
import { ROUTINE_RESULTS_WHATSAPP_CAPABILITY } from "@openbot/contracts/team-protocol/routine-results-whatsapp-v1";
import { teamSideRouteCodec } from "@openbot/contracts/team-protocol/side-routes";
import {
  addSkillSuggestionNames,
  SKILL_LEARNING_CAPABILITY,
  withSkillSuggestionNames,
} from "@openbot/contracts/team-protocol/skill-learning-v1";
import { STORAGE_WORKFLOW_FILES_CAPABILITY } from "@openbot/contracts/team-protocol/storage-workflow-files-v1";
import {
  addUiBlockAutoAnswers,
  TEAM_UI_BLOCK_AUTO_ANSWER_CAPABILITY,
  withUiBlockAutoAnswers,
} from "@openbot/contracts/team-protocol/ui-block-auto-answer-v1";
import {
  addUiBlockLocationRequests,
  TEAM_UI_BLOCK_LOCATION_CAPABILITY,
  withUiBlockLocationRequests,
} from "@openbot/contracts/team-protocol/ui-block-location-v1";
import {
  addUiBlockVaultRequests,
  TEAM_UI_BLOCK_VAULT_CAPABILITY,
  withUiBlockVaultRequests,
} from "@openbot/contracts/team-protocol/ui-block-vault-v1";
import { encodeTeamProtocolV1ClientEvent } from "@openbot/contracts/team-protocol/v1";
import {
  decodeTeamProtocolV2EventFrame,
  decodeTeamProtocolV2Json,
  decodeTeamProtocolV2RpcFrame,
  encodeTeamProtocolV2Frame,
  type TeamProtocolV2Json,
  type TeamProtocolV2RpcFrame,
} from "@openbot/contracts/team-protocol/v2";
import { createTeamProtocolV2Event } from "@openbot/contracts/team-protocol/v2-adapter";
import {
  createTeamProtocolV4Event,
  decodeTeamProtocolV4WebRtcHttpRequest,
  encodeTeamProtocolV4WebRtcHttpResponse,
} from "@openbot/contracts/team-protocol/v4-webrtc-adapter";
import { TEAM_LOCAL_PROVIDERS_CAPABILITY } from "@openbot/contracts/team-protocol/v5";
import {
  createTeamProtocolV5Event,
  decodeTeamProtocolV5WebRtcHttpRequest,
  encodeTeamProtocolV5WebRtcHttpResponse,
} from "@openbot/contracts/team-protocol/v5-webrtc-adapter";
import { TEAM_CURSOR_CLINE_CAPABILITY } from "@openbot/contracts/team-protocol/v6";
import {
  createTeamProtocolV6Event,
  decodeTeamProtocolV6WebRtcHttpRequest,
  encodeTeamProtocolV6WebRtcHttpResponse,
} from "@openbot/contracts/team-protocol/v6-webrtc-adapter";
import { TEAM_PI_MUSE_CAPABILITY } from "@openbot/contracts/team-protocol/v7";
import {
  createTeamProtocolV7Event,
  decodeTeamProtocolV7WebRtcHttpRequest,
  encodeTeamProtocolV7WebRtcHttpResponse,
} from "@openbot/contracts/team-protocol/v7-webrtc-adapter";
import { TEAM_OPEN_PROVIDERS_CAPABILITY } from "@openbot/contracts/team-protocol/v8";
import {
  createTeamProtocolV8Event,
  decodeTeamProtocolV8WebRtcHttpRequest,
  encodeTeamProtocolV8WebRtcHttpResponse,
} from "@openbot/contracts/team-protocol/v8-webrtc-adapter";
import {
  decodeTeamProtocolSupportV9,
  TEAM_LONG_CAPABILITY_LISTS_CAPABILITY,
} from "@openbot/contracts/team-protocol/v9";
import { decodeTeamProtocolV9WebRtcHttpRequest } from "@openbot/contracts/team-protocol/v9-webrtc-adapter";
import {
  decodeTeamProtocolSupportV10,
  readTeamCapabilitiesV10,
  TEAM_ABSENT_CAPABILITIES_HEADER,
  TEAM_CAPABILITY_BASELINE_CAPABILITY,
  TEAM_PROTOCOL_V10,
  TEAM_PROTOCOL_V10_ABSENT_LIMIT,
} from "@openbot/contracts/team-protocol/v10";
import { WORKFLOW_SPOT_CONTROL } from "@openbot/contracts/team-protocol/workflow-presence-v1";
import { sourceText } from "@openbot/i18n/source";
import { Context, Effect, Exit, Fiber, Layer, ManagedRuntime, Result } from "effect";
import type * as Ws from "ws";
import { contentDispositionFileName } from "./content-disposition";
import { RemoteWorkflowError, remoteCall, remoteDecode } from "./remote-service-effects";
import { type TeamStore, TeamStoreError } from "./team-store";
import type { TeamV2Channel, TeamV2ChannelTransport } from "./team-v2-channel-transport";
import { type ReceivedV2File, TeamFileTooLargeError, TeamV2FileTransfer } from "./team-v2-file-transfer";

const requireModule = createRequire(import.meta.url);
const webSockets: typeof Ws = requireModule(join(dirname(requireModule.resolve("ws/package.json")), "index.js"));
const MAXIMUM_BUFFERED_EVENTS = 2_000;
const MAXIMUM_BUFFERED_EVENT_CHARACTERS = 32 * 1024 * 1024;
const MAXIMUM_KEPT_RESPONSES = 1_000;
const MAXIMUM_KEPT_RESPONSE_CHARACTERS = 4 * 1024 * 1024;
const KEPT_RESPONSE_MILLISECONDS = 10 * 60_000;
const RAW_HTTP_OPERATION = "http.raw";
const RAW_TEXT_BODY_BYTES = 1024 * 1024;
const RAW_REQUEST_HEADERS_LIMIT = 64;
const RAW_DROPPED_REQUEST_HEADERS = new Set(["authorization", "host", "content-length", "cookie", "connection"]);
const RAW_DROPPED_RESPONSE_HEADERS = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-length",
  "set-cookie",
]);

export interface TeamV2HostPeerOptions {
  store: TeamStore;
  appVersion: string;
  transferDirectory: string;
  closeSession?: (sessionId: string) => Effect.Effect<void, RemoteWorkflowError>;
  peerMemberChanged?: (peerId: string, membershipId: string | null) => void;
  bindSession?: (sessionId: string) => void;
}

class HostPeerTransport extends Context.Service<
  HostPeerTransport,
  {
    send(...args: Parameters<TeamV2ChannelTransport["send"]>): Effect.Effect<void, RemoteWorkflowError>;
    fetch(input: URL, init: RequestInit): Effect.Effect<Response, RemoteWorkflowError>;
  }
>()("openbot/main/HostPeerTransport") {}

export class TeamV2HostPeer {
  readonly #transport: TeamV2ChannelTransport;
  readonly #runtime: ManagedRuntime.ManagedRuntime<HostPeerTransport, never>;
  readonly #operations = new Set<Fiber.Fiber<void, RemoteWorkflowError>>();
  readonly #closingSessions = new Set<Fiber.Fiber<void>>();
  #disposal: Fiber.Fiber<void> | null = null;
  readonly #store: TeamStore;
  readonly #appVersion: string;
  readonly #files: TeamV2FileTransfer;
  readonly #closeSession: (sessionId: string) => Effect.Effect<void, RemoteWorkflowError>;
  readonly #peerMemberChanged: (peerId: string, membershipId: string | null) => void;
  #sessionMembershipId: string | null = null;
  readonly #responses = new Map<string, string>();
  readonly #responseTimes = new Map<string, number>();
  #responseCharacters = 0;
  readonly #responsesInFlight = new Map<string, Fiber.Fiber<string, RemoteWorkflowError>>();
  readonly #events = new Map<number, string>();
  #eventCharacters = 0;
  #peerCapabilities = new Set<string>();
  #peerId: string | null = null;
  #localApiPort: number | null = null;
  #localSessionToken: string | null = null;
  #localSessionId: string | null = null;
  #eventsSocket: Ws.WebSocket | null = null;
  #eventsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #eventsReconnectAttempts = 0;
  #nextEventSequence = 1;
  #eventsSentThrough = 0;
  #eventResetPending = false;
  #eventSender: string | null = null;
  #eventsSubscribed = false;
  #eventsNeedRewind = false;
  #peerOnline = true;
  readonly #rawHttp: boolean;
  readonly #relayPeer: RelayPeer | null;
  readonly #bindSession: (sessionId: string) => void;
  #sessionExpirationTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    options: TeamV2HostPeerOptions,
    input: {
      peerId: string;
      localApiPort: number;
      transport: TeamV2ChannelTransport;
      rawHttp?: boolean;
      relayPeer?: RelayPeer;
    },
  ) {
    this.#rawHttp = input.rawHttp ?? false;
    this.#relayPeer = input.relayPeer ?? null;
    this.#bindSession = options.bindSession ?? (() => undefined);
    this.#peerId = input.peerId;
    this.#localApiPort = input.localApiPort;
    this.#transport = input.transport;
    this.#runtime = ManagedRuntime.make(
      Layer.succeed(
        HostPeerTransport,
        HostPeerTransport.of({
          send: (...args) => input.transport.send(...args),
          fetch: (input, init) =>
            Effect.tryPromise({
              try: (signal) => fetch(input, { ...init, signal }),
              catch: (cause) => new RemoteWorkflowError({ cause }),
            }),
        }),
      ),
    );
    this.#store = options.store;
    this.#appVersion = options.appVersion;
    this.#files = new TeamV2FileTransfer(
      input.transport,
      join(options.transferDirectory, createHash("sha256").update(input.peerId).digest("hex")),
      undefined,
      (peerId) => peerId === this.#peerId && this.#localSessionToken !== null,
    );
    this.#closeSession = options.closeSession ?? (() => Effect.void);
    this.#peerMemberChanged = options.peerMemberChanged ?? (() => undefined);
    this.#transport.on("data", this.#onData);
    this.#transport.on("disconnected", this.#onDisconnected);
  }

  readonly revokeSession = Effect.fn("TeamHostPeer.revokeSession")(function* (this: TeamV2HostPeer, sessionId: string) {
    if (sessionId !== this.#localSessionId) return;
    const peerId = this.#peerId;
    yield* this.#beginDisposal();
    if (peerId) yield* this.#transport.disconnectPeer(peerId).pipe(Effect.catch(() => Effect.void));
  }).bind(this);

  #setPeerAuthenticated(peerId: string, authenticated: boolean): void {
    this.#files.setPeerAuthenticated(peerId, authenticated);
    this.#peerMemberChanged(peerId, authenticated ? this.#sessionMembershipId : null);
  }

  hasActiveTransfers(): boolean {
    return this.#files.hasActiveTransfers();
  }

  get sessionId(): string | null {
    return this.#localSessionId;
  }

  setPeerOnline(online: boolean): void {
    if (this.#peerOnline === online) return;
    this.#peerOnline = online;
    if (!online) this.#eventsNeedRewind = true;
  }

  #dispatch(operation: Effect.Effect<void, RemoteWorkflowError, HostPeerTransport>): void {
    const fiber = this.#runtime.runFork(operation);
    this.#operations.add(fiber);
    fiber.addObserver(() => this.#operations.delete(fiber));
  }

  readonly dispose = Effect.fn("TeamHostPeer.dispose")(function* (this: TeamV2HostPeer) {
    const fiber = yield* this.#beginDisposal();
    yield* Fiber.join(fiber);
  }, Effect.uninterruptible).bind(this);

  readonly #beginDisposal = Effect.fn("TeamHostPeer.beginDisposal")(function* (this: TeamV2HostPeer) {
    if (this.#disposal) return this.#disposal;
    this.#transport.off("data", this.#onData);
    this.#transport.off("disconnected", this.#onDisconnected);
    yield* this.#closeLocalSession(false);
    this.#forgetResponses();
    this.#peerId = null;
    const disposal = yield* Effect.forkDetach(
      Effect.gen({ self: this }, function* () {
        yield* this.#files.stop().pipe(Effect.catch(() => Effect.void));
        yield* Fiber.awaitAll([...this.#operations, ...this.#closingSessions]);
        yield* this.#runtime.disposeEffect;
      }),
      { startImmediately: false },
    );
    this.#disposal = disposal;
    return disposal;
  }, Effect.uninterruptible);

  readonly adoptSession = Effect.fn("TeamHostPeer.adoptSession")(function* (
    this: TeamV2HostPeer,
    session: { sessionId: string; sessionToken: string; membershipId: string; expiresAt: number },
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    const peerId = this.#peerId;
    if (!peerId || this.#localSessionToken || session.expiresAt <= Date.now()) {
      return yield* new RemoteWorkflowError({ cause: new Error("The relay session cannot start.") });
    }
    this.#resetSessionStreams();
    this.#localSessionToken = session.sessionToken;
    this.#localSessionId = session.sessionId;
    this.#sessionMembershipId = session.membershipId;
    this.#scheduleSessionExpiration(session.expiresAt);
    this.#setPeerAuthenticated(peerId, true);
  }).bind(this);

  #resetSessionStreams(): void {
    this.#events.clear();
    this.#eventCharacters = 0;
    this.#forgetResponses();
    this.#nextEventSequence = 1;
    this.#eventsSentThrough = 0;
    this.#eventResetPending = false;
    this.#eventsSubscribed = false;
    this.#eventsNeedRewind = false;
  }

  #scheduleSessionExpiration(expiresAt: number): void {
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) {
      this.#dispatch(this.#closeLocalSession());
      return;
    }
    this.#sessionExpirationTimer = setTimeout(
      () => this.#scheduleSessionExpiration(expiresAt),
      Math.min(remaining, 2_147_483_647),
    );
    this.#sessionExpirationTimer.unref?.();
  }

  readonly #onData = (peerId: string, channel: TeamV2Channel, data: string | ArrayBuffer): void => {
    if (peerId !== this.#peerId) return;
    if (!this.#localSessionToken && !(this.#rawHttp && channel === "rpc")) {
      this.#dispatch(this.#failProtocol(peerId));
      return;
    }
    if (!isString(data)) {
      if (channel === "rpc" || channel === "events") this.#dispatch(this.#failProtocol(peerId));
      return;
    }
    if (channel === "rpc")
      this.#dispatch(this.#handleRpc(data).pipe(Effect.catchCause(() => this.#failProtocol(peerId))));
    else if (channel === "events")
      this.#dispatch(this.#handleEventControl(data).pipe(Effect.catchCause(() => this.#failProtocol(peerId))));
  };

  readonly #onDisconnected = (peerId: string): void => {
    if (peerId === this.#peerId) {
      this.#setPeerAuthenticated(peerId, false);
      this.#peerCapabilities.clear();
      this.#dispatch(this.#closeLocalSession(false));
    }
  };

  readonly #handleRpc = Effect.fn("TeamHostPeer.handleRpc")(function* (
    this: TeamV2HostPeer,
    data: string,
  ): Effect.fn.Return<void, RemoteWorkflowError, HostPeerTransport> {
    const peerId = this.#peerId;
    if (!peerId) return;
    const request = yield* remoteDecode(() => {
      try {
        const decoded = decodeTeamProtocolV2RpcFrame(data);
        if (decoded.type !== "request") throw new Error("The RPC frame is not a request.");
        return decoded;
      } catch (cause) {
        throw new Error("The client sent an invalid RPC frame.", { cause });
      }
    });
    const cached = this.#keptResponse(request.requestId);
    if (cached) {
      yield* HostPeerTransport.use((transport) => transport.send(peerId, "rpc", cached));
      return;
    }
    const sessionId = this.#localSessionId;
    const inFlightKey = `${sessionId}\0${request.requestId}`;
    let responseOperation = this.#responsesInFlight.get(inFlightKey);
    if (!responseOperation) {
      responseOperation = yield* Effect.forkIn(
        this.#createRpcResponse(request).pipe(
          Effect.map(encodeRpcResponse),
          Effect.tap((response) =>
            Effect.sync(() => {
              if (this.#localSessionId === sessionId && !isReadRequest(request))
                this.#keepResponse(request.requestId, response);
            }),
          ),
        ),
        this.#runtime.scope,
        { startImmediately: false },
      );
      this.#responsesInFlight.set(inFlightKey, responseOperation);
      const pending = responseOperation;
      pending.addObserver(() => {
        if (this.#responsesInFlight.get(inFlightKey) === pending) this.#responsesInFlight.delete(inFlightKey);
      });
    }
    const response = yield* Fiber.join(responseOperation);
    if (this.#peerId !== peerId) return;
    if (this.#localSessionId !== sessionId && sessionId !== null && !isRelaySignIn(request)) return;
    yield* HostPeerTransport.use((transport) => transport.send(peerId, "rpc", response));
  });

  #keptResponse(requestId: string): string | undefined {
    const keptAt = this.#responseTimes.get(requestId);
    if (keptAt === undefined) return undefined;
    if (Date.now() - keptAt <= KEPT_RESPONSE_MILLISECONDS) return this.#responses.get(requestId);
    this.#forgetResponse(requestId);
    return undefined;
  }

  #keepResponse(requestId: string, response: string): void {
    this.#forgetResponse(requestId);
    this.#responses.set(requestId, response);
    this.#responseTimes.set(requestId, Date.now());
    this.#responseCharacters += response.length;
    for (const oldest of this.#responses.keys()) {
      if (
        oldest === requestId ||
        (this.#responses.size <= MAXIMUM_KEPT_RESPONSES && this.#responseCharacters <= MAXIMUM_KEPT_RESPONSE_CHARACTERS)
      )
        return;
      this.#forgetResponse(oldest);
    }
  }

  #forgetResponse(requestId: string): void {
    const response = this.#responses.get(requestId);
    this.#responseTimes.delete(requestId);
    if (response === undefined) return;
    this.#responses.delete(requestId);
    this.#responseCharacters -= response.length;
  }

  #forgetResponses(): void {
    this.#responses.clear();
    this.#responseTimes.clear();
    this.#responseCharacters = 0;
  }

  readonly #createRpcResponse = Effect.fn("TeamHostPeer.createRpcResponse")(function* (
    this: TeamV2HostPeer,
    request: Extract<TeamProtocolV2RpcFrame, { type: "request" }>,
  ): Effect.fn.Return<TeamProtocolV2RpcFrame, RemoteWorkflowError, HostPeerTransport> {
    return yield* Effect.gen({ self: this }, function* () {
      if (request.operation === RAW_HTTP_OPERATION && this.#rawHttp && isRawHttpRequest(request.payload)) {
        const result = yield* this.#dispatchRawHttp(request.payload);
        return yield* remoteDecode(() =>
          decodeTeamProtocolV2RpcFrame({ version: 2, type: "response", requestId: request.requestId, result }),
        );
      }
      if (request.operation !== "http.request" || !isHttpRequest(request.payload)) {
        return yield* new RemoteWorkflowError({
          cause: new GatewayError(400, "unsupported_operation", "The Team API operation is not supported."),
        });
      }
      const result = yield* this.#dispatchHttpEffect(request.payload);
      return yield* remoteDecode(() =>
        decodeTeamProtocolV2RpcFrame({ version: 2, type: "response", requestId: request.requestId, result }),
      );
    }).pipe(
      Effect.catch(({ cause: error }) =>
        Effect.gen({ self: this }, function* () {
          const status =
            error instanceof GatewayError ? error.status : error instanceof TeamFileTooLargeError ? 413 : 500;
          return yield* remoteDecode(() =>
            decodeTeamProtocolV2RpcFrame({
              version: 2,
              type: "response",
              requestId: request.requestId,
              error: {
                code:
                  error instanceof GatewayError
                    ? error.code
                    : error instanceof TeamFileTooLargeError
                      ? "file_too_large"
                      : "host_error",
                message: error instanceof Error ? error.message : sourceText("error.remote.hostRequestFailed"),
                retryable: status >= 500,
                status,
              },
            }),
          );
        }),
      ),
    );
  });

  readonly #dispatchRawHttp = Effect.fn("TeamHostPeer.dispatchRawHttp")(function* (
    this: TeamV2HostPeer,
    input: RawHttpRequestPayload,
  ): Effect.fn.Return<TeamProtocolV2Json, RemoteWorkflowError, HostPeerTransport> {
    const port = this.#localApiPort;
    const peerId = this.#peerId;
    if (!port || !peerId)
      return yield* new RemoteWorkflowError({
        cause: new GatewayError(401, "remote_session_missing", sourceText("error.remote.sessionNotReady")),
      });
    const url = yield* remoteDecode(() => new URL(input.path, `http://127.0.0.1:${port}`));
    if (url.origin !== `http://127.0.0.1:${port}` || !url.pathname.startsWith("/v1/")) {
      return yield* new RemoteWorkflowError({
        cause: new GatewayError(400, "invalid_operation_path", "The Team API path is invalid."),
      });
    }
    if (input.method === "POST" && url.pathname === TEAM_API_ROUTES.auth.relay) return yield* this.#relaySignIn();
    if (input.method === "POST" && url.pathname === TEAM_API_ROUTES.auth.logout) {
      return { status: 204, headers: {}, body: null };
    }
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(input.headers)) {
      if (!RAW_DROPPED_REQUEST_HEADERS.has(name.toLowerCase())) headers[name] = value;
    }
    const token = this.#localSessionToken;
    if (token) headers.Authorization = `Bearer ${token}`;
    const forward = (body: BodyInit | undefined) =>
      Effect.acquireUseRelease(
        HostPeerTransport.use((transport) =>
          transport.fetch(url, { method: input.method, headers, ...(body === undefined ? {} : { body }) }),
        ),
        (response) => this.#rawResponse(peerId, response),
        (response) =>
          remoteCall(() => (response.body ? response.body.cancel() : Promise.resolve())).pipe(
            Effect.catch(() => Effect.void),
          ),
      );
    if (input.bodyTransferId) {
      return yield* this.#files.useReceived(peerId, input.bodyTransferId, (uploaded) =>
        remoteCall(() => openAsBlob(uploaded.path)).pipe(Effect.flatMap((blob) => forward(blob))),
      );
    }
    return yield* forward(input.body === null ? undefined : input.body);
  });

  readonly #relaySignIn = Effect.fn("TeamHostPeer.relaySignIn")(function* (
    this: TeamV2HostPeer,
  ): Effect.fn.Return<TeamProtocolV2Json, RemoteWorkflowError> {
    const json = { "content-type": "application/json" };
    const peer = this.#relayPeer;
    if (!peer)
      return {
        status: 401,
        headers: json,
        body: JSON.stringify({ error: sourceText("error.team.authenticationRequired") }),
      };
    const login = yield* Effect.result(this.#store.loginWithRelayPeer(peer));
    if (Result.isFailure(login)) {
      const cause = login.failure.cause;
      const message = cause instanceof TeamStoreError ? cause.message : sourceText("error.remote.hostRequestFailed");
      return { status: 400, headers: json, body: JSON.stringify({ error: message }) };
    }
    const own = this.#localSessionToken;
    const current = own ? this.#store.authenticateSession(own) : null;
    if (own && current) {
      yield* this.#store.logout(login.success.sessionToken).pipe(Effect.ignore);
      return {
        status: 200,
        headers: json,
        body: JSON.stringify({ ...login.success, sessionToken: own, sessionExpiresAt: current.sessionExpiresAt }),
      };
    }
    const adopted = this.#store.authenticateSession(login.success.sessionToken);
    if (adopted) {
      const previous = this.#localSessionId;
      this.#localSessionToken = null;
      this.#localSessionId = null;
      yield* this.adoptSession({
        sessionId: adopted.sessionId,
        sessionToken: login.success.sessionToken,
        membershipId: adopted.member.id,
        expiresAt: Date.parse(adopted.sessionExpiresAt),
      });
      this.#bindSession(adopted.sessionId);
      if (previous) yield* this.#closeSession(previous).pipe(Effect.ignore);
    }
    return { status: 200, headers: json, body: JSON.stringify(login.success) };
  });

  readonly #rawResponse = Effect.fn("TeamHostPeer.rawResponse")(function* (
    this: TeamV2HostPeer,
    peerId: string,
    response: Response,
  ): Effect.fn.Return<TeamProtocolV2Json, RemoteWorkflowError, HostPeerTransport> {
    const headers: Record<string, string> = {};
    response.headers.forEach((value, name) => {
      if (!RAW_DROPPED_RESPONSE_HEADERS.has(name)) headers[name] = value;
    });
    const contentType = response.headers.get("content-type") ?? "";
    const disposition = response.headers.get("content-disposition") ?? "";
    const length = Number(response.headers.get("content-length") ?? "0");
    const textual =
      !disposition.startsWith("attachment") &&
      (contentType.includes("json") || contentType.startsWith("text/") || contentType === "") &&
      length <= RAW_TEXT_BODY_BYTES;
    if (response.status === 204 || response.status === 304 || !response.body) {
      return { status: response.status, headers, body: null };
    }
    if (textual) {
      const text = yield* remoteCall(() => response.text());
      if (text.length <= RAW_TEXT_BODY_BYTES) return { status: response.status, headers, body: text };
      const name = contentDispositionFileName(disposition, "remote-file");
      const transferId = yield* this.#files.send(peerId, {
        name,
        mimeType: contentType || "application/octet-stream",
        bytes: new TextEncoder().encode(text),
      });
      return { status: response.status, headers, body: null, file: { transferId } };
    }
    const name = contentDispositionFileName(disposition, "remote-file");
    const { transferId, size } = yield* this.#files.sendStream(peerId, {
      name,
      mimeType: contentType || "application/octet-stream",
      body: response.body,
    });
    return { status: response.status, headers, body: null, file: { transferId, size } };
  });

  readonly #dispatchHttpEffect = Effect.fn("TeamHostPeer.dispatchHttp")(function* (
    this: TeamV2HostPeer,
    input: HttpRequestPayload,
  ): Effect.fn.Return<TeamProtocolV2Json, RemoteWorkflowError, HostPeerTransport> {
    if (!this.#localApiPort || !this.#localSessionToken)
      return yield* new RemoteWorkflowError({
        cause: new GatewayError(401, "remote_session_missing", sourceText("error.remote.sessionNotReady")),
      });
    const url = yield* remoteDecode(() => new URL(input.path, `http://127.0.0.1:${this.#localApiPort}`));
    if (url.origin !== `http://127.0.0.1:${this.#localApiPort}` || !url.pathname.startsWith("/v1/")) {
      return yield* new RemoteWorkflowError({
        cause: new GatewayError(400, "invalid_operation_path", "The Team API path is invalid."),
      });
    }
    const peerId = this.#peerId;
    if (!peerId)
      return yield* new RemoteWorkflowError({
        cause: new GatewayError(503, "remote_disconnected", sourceText("error.remote.peerDisconnected")),
      });
    const baseline = input.capabilities?.includes(TEAM_CAPABILITY_BASELINE_CAPABILITY) ?? false;
    const lists = baseline ? readTeamCapabilitiesV10(input.capabilities, input.absent ?? []) : null;
    if (baseline && !lists)
      return yield* new RemoteWorkflowError({
        cause: new GatewayError(400, "protocol_error", "Invalid Team API protocol headers."),
      });
    const peerCapabilities = new Set(lists ? expandTeamCapabilitiesV10(lists) : (input.capabilities ?? []));
    const protocol = v2PeerProtocol(peerCapabilities);
    if (protocol === null)
      return yield* new RemoteWorkflowError({
        cause: new GatewayError(426, "client_update_required", sourceText("error.team.clientUpdateRequired")),
      });
    const capabilitiesChanged =
      peerCapabilities.size !== this.#peerCapabilities.size ||
      [...peerCapabilities].some((capability) => !this.#peerCapabilities.has(capability));
    this.#peerCapabilities = peerCapabilities;
    if (capabilitiesChanged) this.#sendAgentEventScope();
    const request = {
      url,
      peerId,
      peerCapabilities,
      protocol,
      preserveSemanticTags: supportsTeamSemanticTags(peerCapabilities),
    };
    if (input.bodyTransferId) {
      return yield* this.#files.useReceived(peerId, input.bodyTransferId, (uploaded) =>
        this.#forwardHttpEffect(input, request, uploaded),
      );
    }
    return yield* this.#forwardHttpEffect(input, request, null);
  });

  readonly #forwardHttpEffect = Effect.fn("TeamHostPeer.forwardHttp")(function* (
    this: TeamV2HostPeer,
    input: HttpRequestPayload,
    {
      url,
      peerId,
      peerCapabilities,
      protocol,
      preserveSemanticTags,
    }: { url: URL; peerId: string; peerCapabilities: Set<string>; protocol: number; preserveSemanticTags: boolean },
    uploaded: ReceivedV2File | null,
  ): Effect.fn.Return<TeamProtocolV2Json, RemoteWorkflowError, HostPeerTransport> {
    const sideRoute = teamSideRouteCodec(input.path);
    const decodeRequest =
      protocol >= 9
        ? decodeTeamProtocolV9WebRtcHttpRequest
        : protocol === 8
          ? decodeTeamProtocolV8WebRtcHttpRequest
          : protocol === 7
            ? decodeTeamProtocolV7WebRtcHttpRequest
            : protocol === 6
              ? decodeTeamProtocolV6WebRtcHttpRequest
              : protocol === 5
                ? decodeTeamProtocolV5WebRtcHttpRequest
                : decodeTeamProtocolV4WebRtcHttpRequest;
    const requestBody =
      input.method === "GET"
        ? undefined
        : uploaded
          ? yield* remoteCall(() => openAsBlob(uploaded.path))
          : input.body === null
            ? undefined
            : yield* remoteDecode(() => {
                if (sideRoute)
                  return JSON.stringify(
                    sideRoute.request(input.path, input.body, {
                      channelIsolation: peerCapabilities.has(CHANNEL_ISOLATION_CAPABILITY),
                      channelPicture: peerCapabilities.has(CHANNEL_PICTURE_CAPABILITY),
                      channelBrowser: peerCapabilities.has(CHANNEL_BROWSER_CAPABILITY),
                      providerManyAccounts: peerCapabilities.has(PROVIDER_MANY_ACCOUNTS_CAPABILITY),
                    }),
                  );
                const decoded = decodeRequest(input.method, input.path, input.body, {
                  preserveSemanticTags,
                  agentCreateModel: peerCapabilities.has(TEAM_AGENT_CREATE_MODEL_CAPABILITY),
                });
                const currentKeysOnWire =
                  (input.method === "POST" && input.path === BROWSER_SECRET_RESPONSE_PATH) ||
                  isAgentProfileRoute(input.method, input.path);
                return JSON.stringify(
                  decoded !== null && typeof decoded === "object" && !Array.isArray(decoded) && !currentKeysOnWire
                    ? toWireAgentKeysObjectForPath(input.path, decoded)
                    : decoded,
                );
              });
    const forwarded =
      protocol >= TEAM_PROTOCOL_V10
        ? encodeTeamCapabilitiesV10([...this.#peerCapabilities])
        : { capabilities: [...this.#peerCapabilities], absent: [] };
    return yield* Effect.acquireUseRelease(
      HostPeerTransport.use((transport) =>
        transport.fetch(url, {
          method: input.method,
          headers: {
            Authorization: `Bearer ${this.#localSessionToken}`,
            "Content-Type": uploaded?.mimeType ?? input.contentType ?? "application/json",
            "OpenBot-Protocol-Version": String(protocol),
            "OpenBot-App-Version": this.#appVersion,
            "OpenBot-Capabilities": forwarded.capabilities.join(","),
            ...(forwarded.absent.length ? { [TEAM_ABSENT_CAPABILITIES_HEADER]: forwarded.absent.join(",") } : {}),
          },
          ...(requestBody === undefined ? {} : { body: requestBody }),
        }),
      ),
      (response) =>
        Effect.gen({ self: this }, function* () {
          const contentType = response.headers.get("content-type") ?? "";
          const isFile = response.headers.get("content-disposition")?.startsWith("attachment;") ?? false;
          const body =
            response.status === 204
              ? {}
              : contentType.includes("json") && !isFile
                ? yield* remoteCall(() => response.json())
                : null;
          if (!response.ok) {
            const record = isDynamicRecord(body) ? body : null;
            return yield* new RemoteWorkflowError({
              cause: new GatewayError(
                response.status,
                isString(record?.code) ? record.code : "team_api_error",
                isString(record?.error) ? record.error : `The host returned ${response.status}.`,
              ),
            });
          }
          if (response.status !== 204 && (isFile || !contentType.includes("json"))) {
            const name = contentDispositionFileName(response.headers.get("content-disposition"), "remote-file");
            const { transferId, size } = yield* this.#files.sendStream(peerId, {
              name,
              mimeType: contentType || "application/octet-stream",
              body: response.body ?? [],
            });
            return {
              status: response.status,
              body: null,
              file: { transferId, name, mimeType: contentType || "application/octet-stream", size },
            };
          }
          const responseOptions = {
            preserveSemanticTags,
            historyExtent: peerCapabilities.has(TEAM_HISTORY_EXTENT_CAPABILITY),
            channelAttention: peerCapabilities.has(TEAM_CHANNEL_ATTENTION_CAPABILITY),
            channelIsolation: peerCapabilities.has(CHANNEL_ISOLATION_CAPABILITY),
            channelPicture: peerCapabilities.has(CHANNEL_PICTURE_CAPABILITY),
            channelBrowser: peerCapabilities.has(CHANNEL_BROWSER_CAPABILITY),
            channelSeenSubtasks: peerCapabilities.has(CHANNEL_SEEN_SUBTASKS_CAPABILITY),
            channelTaskWaits: peerCapabilities.has(CHANNEL_TASK_WAITS_CAPABILITY),
            mcpManyServers: peerCapabilities.has(MCP_MANY_SERVERS_CAPABILITY),
            providerManyAccounts: peerCapabilities.has(PROVIDER_MANY_ACCOUNTS_CAPABILITY),
            routineResultsWhatsApp: peerCapabilities.has(ROUTINE_RESULTS_WHATSAPP_CAPABILITY),
            storageWorkflowFiles: peerCapabilities.has(STORAGE_WORKFLOW_FILES_CAPABILITY),
            agentTaskUiBlocks: peerCapabilities.has(AGENT_TASK_UI_BLOCKS_CAPABILITY),
            uiBlocks: peerCapabilities.has(TEAM_UI_BLOCKS_CAPABILITY),
            subagents: peerCapabilities.has(TEAM_SUBAGENTS_CAPABILITY),
            promptMultiSelect: peerCapabilities.has(TEAM_PROMPT_MULTI_SELECT_CAPABILITY),
            videoGeneration: peerCapabilities.has(TEAM_VIDEO_GENERATION_CAPABILITY),
            memoryChanges: peerCapabilities.has(TEAM_MEMORY_CHANGES_CAPABILITY),
            usageTertiary: peerCapabilities.has(TEAM_USAGE_TERTIARY_CAPABILITY),
            usageGroups: peerCapabilities.has(TEAM_USAGE_GROUPS_CAPABILITY),
            usageReadFailed: peerCapabilities.has(TEAM_USAGE_READ_FAILED_CAPABILITY),
            agentPendingRuntime: peerCapabilities.has(AGENT_PENDING_RUNTIME_CAPABILITY),
            queueHold: peerCapabilities.has(QUEUE_HOLD_CAPABILITY),
            queueHoldSignIn: peerCapabilities.has(QUEUE_HOLD_SIGN_IN_CAPABILITY),
          };
          return yield* remoteDecode(() => ({
            status: response.status,
            body: withBlockExtensions(
              peerCapabilities,
              body,
              sideRoute
                ? sideRoute.response(input.path, response.status, body, responseOptions)
                : // A protocol 9 peer reads more capabilities than the protocol 7 and 8 encoders allow.
                  protocol >= TEAM_PROTOCOL_V10 && isCompatibilityRead(input.method, input.path, response.status)
                  ? { ...decodeTeamProtocolSupportV10(body) }
                  : peerCapabilities.has(TEAM_LONG_CAPABILITY_LISTS_CAPABILITY) &&
                      isCompatibilityRead(input.method, input.path, response.status)
                    ? { ...decodeTeamProtocolSupportV9(body) }
                    : v2ResponseEncoder(protocol)(input.method, input.path, response.status, body, responseOptions),
            ),
          }));
        }),
      (response) =>
        remoteCall(() => (response.body ? response.body.cancel() : Promise.resolve())).pipe(
          Effect.catch(() => Effect.void),
        ),
    );
  });

  #connectLocalEvents(token: string): void {
    if (!this.#localApiPort) return;
    this.#eventsSocket?.close();
    const socket = new webSockets.WebSocket(`ws://127.0.0.1:${this.#localApiPort}${TEAM_API_ROUTES.events}`, [
      "openbot-team-v1",
      `openbot-token.${token}`,
    ]);
    this.#eventsSocket = socket;
    socket.once("open", () => {
      this.#eventsReconnectAttempts = 0;
      this.#sendAgentEventScope();
    });
    socket.on("message", (data, binary) => {
      if (binary || !this.#peerId) return;
      let frame: string;
      try {
        const event = JSON.parse(data.toString());
        if (this.#rawHttp) {
          frame = encodeTeamProtocolV2Frame({
            version: 2,
            type: "event",
            sequence: this.#nextEventSequence,
            payload: decodeTeamProtocolV2Json(event),
          });
          this.#bufferEvent(frame);
          return;
        }
        const channel = optionalTeamEvent(event, {
          agentTaskUiBlocks: this.#peerCapabilities.has(AGENT_TASK_UI_BLOCKS_CAPABILITY),
        });
        frame = encodeTeamProtocolV2Frame(
          channel
            ? decodeTeamProtocolV2EventFrame({
                version: 2,
                type: "event",
                sequence: this.#nextEventSequence,
                payload: channel,
              })
            : (this.#peerCapabilities.has(TEAM_OPEN_PROVIDERS_CAPABILITY)
                ? createTeamProtocolV8Event
                : this.#peerCapabilities.has(TEAM_PI_MUSE_CAPABILITY)
                  ? createTeamProtocolV7Event
                  : this.#peerCapabilities.has(TEAM_CURSOR_CLINE_CAPABILITY)
                    ? createTeamProtocolV6Event
                    : this.#peerCapabilities.has(TEAM_LOCAL_PROVIDERS_CAPABILITY)
                      ? createTeamProtocolV5Event
                      : this.#peerCapabilities.has("opencode")
                        ? createTeamProtocolV4Event
                        : createTeamProtocolV2Event)(this.#nextEventSequence, event, {
                preserveSemanticTags: supportsTeamSemanticTags(this.#peerCapabilities),
                preserveBrowserSecrets: this.#peerCapabilities.has("browser-secret-handoff"),
                browserSignIn: this.#peerCapabilities.has(BROWSER_SIGN_IN_CAPABILITY),
                browserVaultSkip: this.#peerCapabilities.has(BROWSER_VAULT_SKIP_CAPABILITY),
                contextUsage: this.#peerCapabilities.has(TEAM_CONTEXT_USAGE_CAPABILITY),
                backgroundWork: this.#peerCapabilities.has(AGENT_BACKGROUND_WORK_CAPABILITY),
                usageTertiary: this.#peerCapabilities.has(TEAM_USAGE_TERTIARY_CAPABILITY),
                usageGroups: this.#peerCapabilities.has(TEAM_USAGE_GROUPS_CAPABILITY),
                usageReadFailed: this.#peerCapabilities.has(TEAM_USAGE_READ_FAILED_CAPABILITY),
                agentPendingRuntime: this.#peerCapabilities.has(AGENT_PENDING_RUNTIME_CAPABILITY),
                queueHold: this.#peerCapabilities.has(QUEUE_HOLD_CAPABILITY),
                queueHoldSignIn: this.#peerCapabilities.has(QUEUE_HOLD_SIGN_IN_CAPABILITY),
                errorLink: this.#peerCapabilities.has(AGENT_ERROR_LINK_CAPABILITY),
                uiBlocks: this.#peerCapabilities.has(TEAM_UI_BLOCKS_CAPABILITY),
                subagents: this.#peerCapabilities.has(TEAM_SUBAGENTS_CAPABILITY),
                promptMultiSelect: this.#peerCapabilities.has(TEAM_PROMPT_MULTI_SELECT_CAPABILITY),
                videoGeneration: this.#peerCapabilities.has(TEAM_VIDEO_GENERATION_CAPABILITY),
                memoryChanges: this.#peerCapabilities.has(TEAM_MEMORY_CHANGES_CAPABILITY),
              }),
        );
        if (this.#peerCapabilities.has(TEAM_UI_BLOCK_AUTO_ANSWER_CAPABILITY))
          frame = withUiBlockAutoAnswers(frame, event);
        if (this.#peerCapabilities.has(TEAM_UI_BLOCK_VAULT_CAPABILITY)) frame = withUiBlockVaultRequests(frame, event);
        if (this.#peerCapabilities.has(TEAM_UI_BLOCK_LOCATION_CAPABILITY))
          frame = withUiBlockLocationRequests(frame, event);
        if (this.#peerCapabilities.has(SKILL_LEARNING_CAPABILITY)) frame = withSkillSuggestionNames(frame, event);
        if (this.#peerCapabilities.has(TEAM_PROMPT_DETAIL_CAPABILITY)) frame = withPromptQuestionDetails(frame, event);
      } catch {
        return;
      }
      this.#bufferEvent(frame);
    });
    socket.once("error", () => socket.close());
    socket.once("close", () => {
      if (this.#eventsSocket !== socket) return;
      this.#eventsSocket = null;
      this.#scheduleLocalEventsReconnect();
    });
  }

  #bufferEvent(frame: string): void {
    const sequence = this.#nextEventSequence++;
    this.#events.set(sequence, frame);
    this.#eventCharacters += frame.length;
    for (const [oldest, kept] of this.#events) {
      if (
        oldest === sequence ||
        (this.#events.size <= MAXIMUM_BUFFERED_EVENTS && this.#eventCharacters <= MAXIMUM_BUFFERED_EVENT_CHARACTERS)
      )
        break;
      this.#events.delete(oldest);
      this.#eventCharacters -= kept.length;
    }
    this.#kickEvents();
  }

  #kickEvents(): void {
    const sessionId = this.#localSessionId;
    if (!sessionId || !this.#eventsSubscribed || !this.#peerOnline || this.#eventsNeedRewind) return;
    if (this.#eventSender === sessionId) return;
    this.#eventSender = sessionId;
    this.#dispatch(this.#sendEvents(sessionId));
  }

  #trimEvents(throughSequence: number): void {
    for (const [sequence, frame] of this.#events) {
      if (sequence > throughSequence) break;
      this.#events.delete(sequence);
      this.#eventCharacters -= frame.length;
    }
  }

  readonly #acknowledgeEvents = Effect.fn("TeamHostPeer.acknowledgeEvents")(function* (
    this: TeamV2HostPeer,
    throughSequence: number,
  ): Effect.fn.Return<void, RemoteWorkflowError, HostPeerTransport> {
    const peerId = this.#peerId;
    if (!peerId) return;
    const resuming = !this.#eventsSubscribed || this.#eventsNeedRewind;
    this.#eventsSubscribed = true;
    this.#eventsNeedRewind = false;
    const next = this.#nextEventSequence;
    const firstKept = this.#events.keys().next().value ?? next;
    if (!resuming && throughSequence > 0 && throughSequence < next) {
      this.#trimEvents(throughSequence);
      this.#kickEvents();
      return;
    }
    const continuous = throughSequence > 0 && throughSequence < next && throughSequence + 1 >= firstKept;
    if (continuous) {
      this.#trimEvents(throughSequence);
      this.#eventsSentThrough = throughSequence;
      this.#eventResetPending = false;
      this.#kickEvents();
      return;
    }
    this.#trimEvents(next - 1);
    this.#eventsSentThrough = next - 1;
    this.#eventResetPending = false;
    if (throughSequence !== next - 1) {
      const reset = encodeTeamProtocolV2Frame({ version: 2, type: "event-reset", nextSequence: next });
      yield* HostPeerTransport.use((transport) => transport.send(peerId, "events", reset)).pipe(
        Effect.catch(() => Effect.sync(() => (this.#eventsNeedRewind = true))),
      );
    }
    this.#kickEvents();
  });

  #sendAgentEventScope(): void {
    if (this.#eventsSocket?.readyState !== webSockets.WebSocket.OPEN) return;
    this.#eventsSocket.send(
      encodeTeamProtocolV1ClientEvent({
        type: "agent-event-scope",
        includeConversations: true,
        capabilities: this.#rawHttp
          ? [...TEAM_CURRENT_CAPABILITIES]
          : TEAM_CURRENT_CAPABILITIES.filter((capability) => this.#peerCapabilities.has(capability)),
      }),
    );
  }

  #scheduleLocalEventsReconnect(): void {
    if (this.#eventsReconnectTimer || !this.#localSessionToken || !this.#localSessionId || !this.#peerId) return;
    const delay = Math.min(10_000, 250 * 2 ** this.#eventsReconnectAttempts++);
    this.#eventsReconnectTimer = setTimeout(() => {
      this.#eventsReconnectTimer = null;
      const token = this.#localSessionToken;
      if (token) this.#connectLocalEvents(token);
    }, delay);
  }

  readonly #handleEventControl = Effect.fn("TeamHostPeer.handleEventControl")(function* (
    this: TeamV2HostPeer,
    data: string,
  ): Effect.fn.Return<void, RemoteWorkflowError, HostPeerTransport> {
    const frame = yield* remoteDecode(() => decodeTeamProtocolV2EventFrame(data));
    if (!this.#eventsSocket && this.#localSessionToken) this.#connectLocalEvents(this.#localSessionToken);
    if (frame.type === "event-control") {
      if (this.#eventsSocket?.readyState === webSockets.WebSocket.OPEN) {
        this.#eventsSocket.send(
          frame.control.type === WORKFLOW_SPOT_CONTROL
            ? JSON.stringify(frame.control)
            : encodeTeamProtocolV1ClientEvent(frame.control),
        );
      }
      return;
    }
    if (frame.type !== "event-ack")
      return yield* new RemoteWorkflowError({ cause: new Error("The event frame is not client control data.") });
    yield* this.#acknowledgeEvents(frame.throughSequence);
  });

  readonly #sendEvents = Effect.fn("TeamHostPeer.sendEvents")(function* (
    this: TeamV2HostPeer,
    sessionId: string,
  ): Effect.fn.Return<void, never, HostPeerTransport> {
    const send = (peerId: string, data: string) =>
      Effect.exit(HostPeerTransport.use((transport) => transport.send(peerId, "events", data))).pipe(
        Effect.map(Exit.isSuccess),
      );
    while (
      this.#localSessionId === sessionId &&
      this.#peerId &&
      this.#peerOnline &&
      this.#eventsSubscribed &&
      !this.#eventsNeedRewind
    ) {
      const peerId = this.#peerId;
      const sequence = this.#eventsSentThrough + 1;
      if (sequence >= this.#nextEventSequence) break;
      const frame = this.#events.get(sequence);
      if (frame === undefined) {
        this.#eventsSentThrough = sequence;
        this.#eventResetPending = true;
        continue;
      }
      if (this.#eventResetPending) {
        const reset = encodeTeamProtocolV2Frame({ version: 2, type: "event-reset", nextSequence: sequence });
        if (!(yield* send(peerId, reset))) {
          this.#eventsNeedRewind = true;
          break;
        }
        if (this.#localSessionId !== sessionId) break;
        this.#eventResetPending = false;
      }
      if (!(yield* send(peerId, frame))) {
        this.#eventsNeedRewind = true;
        break;
      }
      if (this.#localSessionId !== sessionId) break;
      this.#eventsSentThrough = sequence;
    }
    if (this.#eventSender === sessionId) this.#eventSender = null;
  });

  readonly #failProtocol = Effect.fn("TeamHostPeer.failProtocol")(function* (this: TeamV2HostPeer, peerId: string) {
    if (peerId !== this.#peerId) return;
    this.#setPeerAuthenticated(peerId, false);
    yield* this.#closeLocalSession();
    yield* this.#transport.disconnectPeer(peerId).pipe(Effect.catch(() => Effect.void));
  });

  readonly #closeLocalSession = Effect.fn("TeamHostPeer.closeLocalSession")(function* (
    this: TeamV2HostPeer,
    endLogicalSession = true,
  ) {
    const closingSessionId = this.#localSessionId;
    if (this.#peerId) this.#setPeerAuthenticated(this.#peerId, false);
    if (this.#sessionExpirationTimer) clearTimeout(this.#sessionExpirationTimer);
    this.#sessionExpirationTimer = null;
    if (this.#eventsReconnectTimer) clearTimeout(this.#eventsReconnectTimer);
    this.#eventsReconnectTimer = null;
    this.#eventsReconnectAttempts = 0;
    this.#eventsSocket?.close();
    this.#eventsSocket = null;
    if (this.#localSessionId) {
      this.#store.closeRemoteSession(this.#localSessionId);
    }
    this.#localSessionId = null;
    this.#localSessionToken = null;
    this.#sessionMembershipId = null;
    if (endLogicalSession && closingSessionId) {
      const closing = yield* Effect.forkIn(
        this.#closeSession(closingSessionId).pipe(Effect.catch(() => Effect.void)),
        this.#runtime.scope,
        { startImmediately: false },
      );
      this.#closingSessions.add(closing);
      closing.addObserver(() => this.#closingSessions.delete(closing));
    }
  });
}

interface HttpRequestPayload {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body: TeamProtocolV2Json;
  bodyTransferId?: string;
  contentType?: string;
  capabilities?: string[];
  absent?: string[];
}

interface RawHttpRequestPayload {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  headers: Record<string, string>;
  body: string | null;
  bodyTransferId?: string;
}

function isRawHttpRequest(value: TeamProtocolV2Json): value is TeamProtocolV2Json & RawHttpRequestPayload {
  if (!isDynamicRecord(value)) return false;
  const { method, headers } = value;
  return (
    (method === "GET" || method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE") &&
    isString(value.path) &&
    value.path.length <= 2_048 &&
    isDynamicRecord(headers) &&
    Object.keys(headers).length <= RAW_REQUEST_HEADERS_LIMIT &&
    Object.values(headers).every(isString) &&
    (value.body === null || isString(value.body)) &&
    (value.bodyTransferId === undefined || isString(value.bodyTransferId))
  );
}

function v2PeerProtocol(capabilities: ReadonlySet<string>): number | null {
  if (capabilities.has(TEAM_CAPABILITY_BASELINE_CAPABILITY)) return TEAM_PROTOCOL_V10;
  if (capabilities.has(TEAM_LONG_CAPABILITY_LISTS_CAPABILITY)) return 9;
  if (capabilities.has(TEAM_OPEN_PROVIDERS_CAPABILITY)) return 8;
  if (capabilities.has(TEAM_PI_MUSE_CAPABILITY)) return 7;
  if (capabilities.has(TEAM_CURSOR_CLINE_CAPABILITY)) return 6;
  if (capabilities.has(TEAM_LOCAL_PROVIDERS_CAPABILITY)) return 5;
  return capabilities.has("opencode") ? 4 : null;
}

function v2ResponseEncoder(protocol: number) {
  if (protocol >= 8) return encodeTeamProtocolV8WebRtcHttpResponse;
  if (protocol === 7) return encodeTeamProtocolV7WebRtcHttpResponse;
  if (protocol === 6) return encodeTeamProtocolV6WebRtcHttpResponse;
  if (protocol === 5) return encodeTeamProtocolV5WebRtcHttpResponse;
  return encodeTeamProtocolV4WebRtcHttpResponse;
}

function isRelaySignIn(request: Extract<TeamProtocolV2RpcFrame, { type: "request" }>): boolean {
  return (
    request.operation === RAW_HTTP_OPERATION &&
    isRawHttpRequest(request.payload) &&
    request.payload.method === "POST" &&
    request.payload.path === TEAM_API_ROUTES.auth.relay
  );
}

function isReadRequest(request: Extract<TeamProtocolV2RpcFrame, { type: "request" }>): boolean {
  if (request.operation === RAW_HTTP_OPERATION)
    return isRawHttpRequest(request.payload) && request.payload.method === "GET";
  return request.operation === "http.request" && isHttpRequest(request.payload) && request.payload.method === "GET";
}

function isCompatibilityRead(method: string, path: string, status: number): boolean {
  return method === "GET" && path === TEAM_API_ROUTES.compatibility && status === 200;
}

function isHttpRequest(value: TeamProtocolV2Json): value is TeamProtocolV2Json & HttpRequestPayload {
  if (!isDynamicRecord(value)) return false;
  const method = value.method;
  return (
    (method === "GET" || method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE") &&
    isString(value.path) &&
    value.path.length <= 2_048 &&
    Object.hasOwn(value, "body") &&
    (value.capabilities === undefined ||
      (Array.isArray(value.capabilities) &&
        value.capabilities.length <=
          TEAM_PROTOCOL_CAPABILITY_LIMITS[
            value.capabilities.includes(TEAM_CAPABILITY_BASELINE_CAPABILITY)
              ? TEAM_PROTOCOL_V10
              : value.capabilities.includes(TEAM_LONG_CAPABILITY_LISTS_CAPABILITY)
                ? 9
                : value.capabilities.includes(TEAM_PI_MUSE_CAPABILITY) ||
                    value.capabilities.includes(TEAM_OPEN_PROVIDERS_CAPABILITY)
                  ? 7
                  : 1
          ] &&
        value.capabilities.every(isString))) &&
    (value.absent === undefined ||
      (Array.isArray(value.absent) &&
        value.absent.length <= TEAM_PROTOCOL_V10_ABSENT_LIMIT &&
        value.absent.every(isString))) &&
    (value.bodyTransferId === undefined || isString(value.bodyTransferId)) &&
    (value.contentType === undefined || isString(value.contentType))
  );
}

function encodeRpcResponse(response: TeamProtocolV2RpcFrame): string {
  try {
    return encodeTeamProtocolV2Frame(response);
  } catch {
    return encodeTeamProtocolV2Frame({
      version: 2,
      type: "response",
      requestId: response.requestId,
      error: {
        code: "response_too_large",
        message: sourceText("error.remote.responseTooLarge"),
        retryable: false,
        status: 413,
      },
    });
  }
}

class GatewayError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function withBlockExtensions(
  capabilities: ReadonlySet<string>,
  source: unknown,
  encoded: TeamProtocolV2Json,
): TeamProtocolV2Json {
  if (capabilities.has(TEAM_UI_BLOCK_AUTO_ANSWER_CAPABILITY)) addUiBlockAutoAnswers(encoded, source);
  if (capabilities.has(TEAM_UI_BLOCK_VAULT_CAPABILITY)) addUiBlockVaultRequests(encoded, source);
  if (capabilities.has(TEAM_UI_BLOCK_LOCATION_CAPABILITY)) addUiBlockLocationRequests(encoded, source);
  if (capabilities.has(SKILL_LEARNING_CAPABILITY)) addSkillSuggestionNames(encoded, source);
  if (capabilities.has(TEAM_PROMPT_DETAIL_CAPABILITY)) addPromptQuestionDetails(encoded, source);
  return encoded;
}
