import type { AgentEvent, TeamRealtimeEvent } from "@openbot/contracts/ipc";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  decodeTeamProtocolSupportExpanded,
  decodeTeamProtocolV2EventFrame,
  decodeTeamProtocolV2Json,
  decodeTeamProtocolV2RpcFrame,
  decodeTeamProtocolV8CurrentEvent,
  decodeTeamProtocolV10WebRtcHttpResponse,
  encodeTeamProtocolV2Frame,
  encodeTeamProtocolV9WebRtcHttpRequest,
  TEAM_BOOTSTRAP_CAPABILITIES,
  TEAM_PROTOCOL_V2_MAX_FILE_BYTES,
  TEAM_PROTOCOL_V10,
  TEAM_WEBRTC_CLIENT_PROTOCOL,
  type TeamProtocolSupportV1,
  type TeamProtocolV2Json,
  teamCapabilitiesForProtocol,
  teamCapabilityLists,
  teamWebRtcClientProtocol,
} from "@openbot/contracts/team-protocol";
import { optionalTeamEvent, optionalTeamEventToCurrent } from "@openbot/contracts/team-protocol/optional-events";
import { addPromptQuestionDetails } from "@openbot/contracts/team-protocol/prompt-detail-v1";
import { teamSideRouteCodec } from "@openbot/contracts/team-protocol/side-routes";
import { addSkillSuggestionNames } from "@openbot/contracts/team-protocol/skill-learning-v1";
import { addUiBlockAutoAnswers } from "@openbot/contracts/team-protocol/ui-block-auto-answer-v1";
import { addUiBlockLocationRequests } from "@openbot/contracts/team-protocol/ui-block-location-v1";
import { addUiBlockVaultRequests } from "@openbot/contracts/team-protocol/ui-block-vault-v1";
import {
  type TeamProtocolV1CurrentEventControl,
  toWireTeamProtocolV1ClientEvent,
} from "@openbot/contracts/team-protocol/v1-adapter";
import { TEAM_PROTOCOL_V9 } from "@openbot/contracts/team-protocol/v9";
import { sourceText } from "@openbot/i18n/source";
import { errorReference, referenceFrom } from "@openbot/user-errors/reference";
import { Context, Deferred, Effect, Exit, Layer, ManagedRuntime, Result, Schema, Scope } from "effect";
import { base64ToBytes } from "./base64";

class RemotePeerError extends Schema.TaggedError<RemotePeerError>()("RemotePeerError", {
  message: Schema.String,
  reference: Schema.optional(Schema.NullOr(Schema.String)),
}) {}
const failureReference = (error: unknown): string | null =>
  error instanceof RemotePeerError ? (error.reference ?? null) : errorReference(error);
const peerError = (error: unknown) =>
  error instanceof RemotePeerError
    ? error
    : new RemotePeerError({
        message: error instanceof Error ? error.message : sourceText("error.remote.operationFailed"),
        reference: failureReference(error),
      });
const referenced = (message: string, reference: string | null) => new RemotePeerError({ message, reference });

const peerCall = <A>(operation: () => Promise<A> | A) =>
  Effect.tryPromise({ try: async () => operation(), catch: peerError });
const peerDecode = <A>(operation: () => A) => Effect.try({ try: operation, catch: peerError });
const deviceFileError = () => new FileTransferError({ message: sourceText("error.remote.attachmentChanged") });

import { createRemoteFileReceiver } from "./file-download";
import { createRemoteFileSender, FileTransferError, fileTransferError, type RemoteFileUpload } from "./file-upload";
import { markRemoteSync, type RemoteRequestProfile, startRemoteRequest } from "./sync-profile";

export type { RemoteFileUpload } from "./file-upload";
export { MOBILE_ATTACHMENT_BYTES } from "./file-upload";

import { startRemoteRequestDeadline } from "./remote-recovery";
import { createTeamRequestId } from "./request-id";
import { encodeTeamV2Payload, TeamV2PayloadDecoder } from "./v2-framing";

export type RemoteTeamEvent = AgentEvent | TeamRealtimeEvent;

export type RemoteLargeDownload = {
  maxBytes: number;
  mimeType?: string | undefined;
  file?: string | undefined;
};

export type RemoteTeamCommand =
  | { id: string; type: "connect"; hostId: string; hostPublicKey: string }
  | { id: string; type: "disconnect" }
  | {
      id: string;
      type: "request";
      method: string;
      path: string;
      body: TeamProtocolV2Json;
      upload?: RemoteFileUpload | undefined;
      timeoutMs?: number | undefined;
      largeDownload?: RemoteLargeDownload | undefined;
      downloadSize?: number | undefined;
    };

export interface RemoteTeamCommandResult {
  commandId: string;
  ok: boolean;
  status?: number;
  body?: TeamProtocolV2Json;
  error?: string;
  reference?: string;
  kept?: boolean;
}

export function createRemoteCommandMailbox(deliver: (command: RemoteTeamCommand) => void) {
  const pending = new Map<string, { command: RemoteTeamCommand; resolve: (result: RemoteTeamCommandResult) => void }>();
  let target: { hostId: string; hostPublicKey: string } | null = null;
  const cancel = () => {
    for (const [commandId, entry] of pending) {
      entry.resolve({ commandId, ok: false, error: sourceText("error.remote.serverConnectionReplaced") });
    }
    pending.clear();
  };
  return {
    send(command: RemoteTeamCommand): Promise<RemoteTeamCommandResult> {
      if (command.type === "disconnect") {
        cancel();
        target = null;
      } else if (command.type === "connect") {
        if (target?.hostId !== command.hostId || target.hostPublicKey !== command.hostPublicKey) cancel();
        target = { hostId: command.hostId, hostPublicKey: command.hostPublicKey };
      }
      return new Promise((resolve) => {
        pending.set(command.id, { command, resolve });
        deliver(command);
      });
    },
    receive(result: RemoteTeamCommandResult) {
      const entry = pending.get(result.commandId);
      if (!entry) return;
      pending.delete(result.commandId);
      entry.resolve(result);
    },
    outstanding: (): RemoteTeamCommand[] => [...pending.values()].map((entry) => entry.command),
    dispose: cancel,
  };
}

function decodeRemoteFileUpload(value: unknown): RemoteFileUpload | null {
  if (!isDynamicRecord(value) || !isString(value.name) || !isString(value.mimeType) || !isString(value.base64))
    return null;
  const maxBytes = value.maxBytes;
  if (!(maxBytes === undefined || isNumber(maxBytes))) return null;
  const file = value.file;
  let source: RemoteFileUpload["file"];
  if (file !== undefined) {
    if (!isDynamicRecord(file)) return null;
    const { ref, size } = file;
    if (!isString(ref) || !isNumber(size)) return null;
    source = { ref, size };
  }
  return {
    name: value.name,
    mimeType: value.mimeType,
    base64: value.base64,
    ...(maxBytes === undefined ? {} : { maxBytes }),
    ...(source === undefined ? {} : { file: source }),
  };
}

function decodeRemoteLargeDownload(value: unknown): RemoteLargeDownload | null {
  if (!isDynamicRecord(value) || !isNumber(value.maxBytes)) return null;
  if (!(value.mimeType === undefined || isString(value.mimeType))) return null;
  if (!(value.file === undefined || (isString(value.file) && value.file.length > 0))) return null;
  return {
    maxBytes: value.maxBytes,
    ...(value.mimeType === undefined ? {} : { mimeType: value.mimeType }),
    ...(value.file === undefined ? {} : { file: value.file }),
  };
}

export function decodeRemoteTeamCommand(value: unknown): {
  command: RemoteTeamCommand | null;
  commandId: string | null;
} {
  if (!isDynamicRecord(value) || !isString(value.id)) return { command: null, commandId: null };
  const id = value.id;
  const invalid = { command: null, commandId: id };
  if (value.type === "disconnect") return { command: { id, type: "disconnect" }, commandId: id };
  if (value.type === "connect")
    return isString(value.hostId) && isString(value.hostPublicKey)
      ? { command: { id, type: "connect", hostId: value.hostId, hostPublicKey: value.hostPublicKey }, commandId: id }
      : invalid;
  if (value.type !== "request" || !isString(value.method) || !isString(value.path)) return invalid;
  const timeoutMs = value.timeoutMs;
  if (!(timeoutMs === undefined || isNumber(timeoutMs))) return invalid;
  const largeDownload = value.largeDownload === undefined ? undefined : decodeRemoteLargeDownload(value.largeDownload);
  if (largeDownload === null) return invalid;
  const upload = value.upload === undefined ? undefined : decodeRemoteFileUpload(value.upload);
  if (upload === null) return invalid;
  const downloadSize = value.downloadSize;
  if (!(downloadSize === undefined || (isNumber(downloadSize) && downloadSize > 0))) return invalid;
  let body: TeamProtocolV2Json;
  try {
    body = decodeTeamProtocolV2Json(value.body);
  } catch {
    return invalid;
  }
  return {
    command: {
      id,
      type: "request",
      method: value.method,
      path: value.path,
      body,
      ...(upload ? { upload } : {}),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      ...(largeDownload ? { largeDownload } : {}),
      ...(downloadSize === undefined ? {} : { downloadSize }),
    },
    commandId: id,
  };
}

export interface RemoteTeamConnectionUpdate {
  hostId: string;
  state: "connecting" | "online" | "offline";
  message: string | null;
  code?: "protocol_error" | "session_revoked";
  reference?: string;
  resync?: boolean;
  hostOffline?: true;
  lostAfterMs?: number;
}

export interface RemoteTeamDiagnostic {
  hostId: string;
  step: "path-check" | "event-reset" | "event-gap" | "resume" | "authenticated" | "failed";
  detail?: string;
}

export interface RemoteUploadProgress {
  commandId: string;
  sent: number;
  total: number;
}

export interface RemoteDownloadWatch {
  size: number;
  onProgress: (received: number, total: number) => void;
}

export interface RemoteDownloadProgress {
  commandId: string;
  received: number;
  total: number;
}

export interface RemoteTeamPeerActions {
  onUploadProgress?: (progress: RemoteUploadProgress) => Promise<void>;
  onDownloadProgress?: (progress: RemoteDownloadProgress) => Promise<void>;
  onConnectionUpdate: (update: RemoteTeamConnectionUpdate) => Promise<void>;
  onDiagnostic?: (diagnostic: RemoteTeamDiagnostic) => Promise<void>;
  onNetworkRestored?: () => Promise<void>;
  onTeamEvent: (hostId: string, event: RemoteTeamEvent) => Promise<void>;
  digestUploadFile?: (ref: string) => Promise<string>;
  readUploadFile?: (part: { ref: string; offset: number; length: number }) => Promise<string>;
  writeDownloadFile?: (part: { ref: string; base64: string; append: boolean }) => Promise<void>;
}
interface ActionsRef {
  current: RemoteTeamPeerActions;
}
type ChannelKind = "rpc" | "events" | "files";

export type RemoteTeamChannelState = "connecting" | "open" | "closing" | "closed";

export interface RemoteTeamChannelHandlers {
  open: () => void;
  message: (data: unknown) => void;
  error: () => void;
  close: (reason: Error | null) => void;
}

export interface RemoteTeamChannel {
  readonly readyState: RemoteTeamChannelState;
  readonly bufferedAmount: number;
  readonly bufferedAmountLowThreshold: number;
  send(data: string | ArrayBuffer): void;
  listen(handlers: RemoteTeamChannelHandlers): void;
  onBufferedAmountLow(listener: () => void): () => void;
}

export interface RemoteTeamTunnels {
  readonly rpc: RemoteTeamChannel;
  readonly events: RemoteTeamChannel;
  readonly files: RemoteTeamChannel;
  close(): void;
}

export interface RemoteTeamTunnelTransport {
  open(hostId: string, hostKey: string, signal: AbortSignal): Promise<RemoteTeamTunnels>;
}

interface PendingRequest {
  method: string;
  path: string;
  resolve: (value: { status: number; body: TeamProtocolV2Json }) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  profile: RemoteRequestProfile | null;
}

interface PeerState {
  generation: number;
  hostId: string;
  hostPublicKey: string;
  channels: Partial<Record<ChannelKind, RemoteTeamChannel>>;
  decoders: Partial<Record<ChannelKind, TeamV2PayloadDecoder>>;
  tunnels: RemoteTeamTunnels | null;
  authenticated: boolean;
  closed: boolean;
  lastEventSequence: number;
  eventAckTimer: ReturnType<typeof setTimeout> | null;
  needsResync: boolean;
  connected: Deferred.Deferred<void, RemotePeerError> | null;
  readonly abort: AbortController;
  answeredRequest: boolean;
  probingPath: boolean;
  fullSnapshotRequested: boolean;
  lastAnswerAt: number;
  hostProtocol: number | undefined;
  hostProtocolRead?: Deferred.Deferred<void>;
}

const TUNNEL_CHANNELS = ["rpc", "events", "files"] as const satisfies readonly ChannelKind[];
const CHANNEL_DRAIN_IDLE_MS = 60_000;
const TYPING_REFRESH_MILLISECONDS = 2_000;
const REQUEST_TIMEOUT_MS = 10 * 60_000 + 30_000;
const FRESH_PEER_ANSWER_MS = 10_000;
const KNOWN_PEER_ANSWER_MS = 4_000;
const PEER_IDLE_CLOSE_MS = 120_000;
const PEER_RECONNECT_GRACE_MS = 30_000;
const SUSPEND_MARGIN_MS = 10_000;
export const REMOTE_PEER_LOST_AFTER_MS = PEER_IDLE_CLOSE_MS + PEER_RECONNECT_GRACE_MS + SUSPEND_MARGIN_MS;

class RemotePeerIO extends Context.Service<
  RemotePeerIO,
  {
    connectionUpdate(update: RemoteTeamConnectionUpdate): Effect.Effect<void, RemotePeerError>;
    teamEvent(hostId: string, event: RemoteTeamEvent): Effect.Effect<void, RemotePeerError>;
  }
>()("@openbot/team-client/RemotePeerIO") {
  static layer(actions: ActionsRef) {
    return Layer.succeed(
      RemotePeerIO,
      RemotePeerIO.of({
        connectionUpdate: Effect.fn("RemotePeerIO.connectionUpdate")((update: RemoteTeamConnectionUpdate) =>
          peerCall(() => actions.current.onConnectionUpdate(update)),
        ),
        teamEvent: Effect.fn("RemotePeerIO.teamEvent")((hostId: string, event: RemoteTeamEvent) =>
          peerCall(() => actions.current.onTeamEvent(hostId, event)),
        ),
      }),
    );
  }
}

export interface RemoteHostProtocols {
  get(hostId: string): number | undefined;
  set(hostId: string, protocol: number): void;
}

export function createRemoteTeamPeer(
  actions: ActionsRef,
  options: {
    hostProtocols?: RemoteHostProtocols;
    clientProtocol?: TeamProtocolSupportV1["protocol"];
    tunnels: RemoteTeamTunnelTransport;
    randomBytes?: (size: number) => Uint8Array<ArrayBuffer>;
  },
) {
  const randomBytes = options.randomBytes ?? ((size: number) => crypto.getRandomValues(new Uint8Array(size)));
  const runtime = ManagedRuntime.make(RemotePeerIO.layer(actions));
  const workScope = Scope.makeUnsafe();
  const running = new Set<Promise<unknown>>();

  function runPeerEffect<A, E>(operation: Effect.Effect<A, E, RemotePeerIO>): Promise<A> {
    const pending = runtime.runPromise(Effect.result(operation)).then((result) => {
      if (Result.isFailure(result)) throw result.failure;
      return result.success;
    });
    running.add(pending);
    return pending.finally(() => running.delete(pending));
  }

  let active = true;
  let inactiveSince: number | null = null;
  let peer: PeerState | null = null;
  let generation = 0;
  const pendingRequests = new Map<string, PendingRequest>();
  const files = createRemoteFileSender(
    (data) =>
      Effect.suspend(() => {
        const state = peer;
        if (!state || !isPeerOnline(state))
          return Effect.fail(new RemotePeerError({ message: sourceText("error.remote.selectedServerOffline") }));
        return sendPayload(state, "files", data);
      }),
    () => createTeamRequestId(randomBytes),
    {
      digest: (ref) =>
        peerCall(() => {
          const digest = actions.current.digestUploadFile;
          if (!digest) throw new Error("This client cannot read device files.");
          return digest(ref);
        }).pipe(Effect.mapError(deviceFileError)),
      read: (ref, offset, length) =>
        peerCall(() => {
          const read = actions.current.readUploadFile;
          if (!read) throw new Error("This client cannot read device files.");
          return read({ ref, offset, length });
        }).pipe(
          Effect.flatMap((base64) => peerDecode(() => base64ToBytes(base64))),
          Effect.mapError(deviceFileError),
        ),
    },
  );
  const downloadTarget = (ref: string | undefined) => {
    const write = actions.current.writeDownloadFile;
    if (ref === undefined || !write) return undefined;
    return {
      ref,
      write: (base64: string, append: boolean) =>
        peerCall(() => write({ ref, base64, append })).pipe(Effect.mapError(fileTransferError)),
    };
  };
  const downloads = createRemoteFileReceiver((data) =>
    Effect.suspend(() => {
      const state = peer;
      if (!state || !isPeerOnline(state))
        return Effect.fail(new RemotePeerError({ message: sourceText("error.remote.selectedServerOffline") }));
      return sendPayload(state, "files", data);
    }),
  );
  const hostProtocols: RemoteHostProtocols = options.hostProtocols ?? new Map<string, number>();
  const clientProtocol = options.clientProtocol ?? TEAM_WEBRTC_CLIENT_PROTOCOL;
  const tunnelTransport = options.tunnels;
  let lastTyping: { agentId: string | null; typing: boolean; sentAt: number } | null = null;
  let typingInFlight: {
    state: { agentId: string | null; typing: boolean };
  } | null = null;
  const typingSentRecently = (sent: { agentId: string | null; typing: boolean; sentAt: number } | null) =>
    sent !== null && (!sent.typing || Date.now() - sent.sentAt < TYPING_REFRESH_MILLISECONDS);

  return {
    cancelUpload: () => runPeerEffect(files.cancelUpload()),
    setTyping(agentId: string | null, typing: boolean) {
      const state = peer;
      if (!state || !isPeerOnline(state)) return;
      const nextTyping = { agentId, typing };
      const pending = typingInFlight?.state ?? null;
      const duplicate = pending
        ? pending.agentId === agentId && pending.typing === typing
        : lastTyping?.agentId === agentId && lastTyping.typing === typing && typingSentRecently(lastTyping);
      if (duplicate) return;
      const send = runPeerEffect(sendEventControl(state, { type: "team-typing", agentId, typing }));
      const inFlight = { state: nextTyping };
      typingInFlight = inFlight;
      void send.then(
        () => {
          if (typingInFlight !== inFlight) return;
          lastTyping = { ...nextTyping, sentAt: Date.now() };
          typingInFlight = null;
        },
        () => {
          if (typingInFlight !== inFlight) return;
          typingInFlight = null;
          lastTyping = null;
        },
      );
    },
    execute: (command: RemoteTeamCommand) => runPeerEffect(executeCommand(command, actions)),
    dispose: async () => {
      active = false;
      await runPeerEffect(closePeer());
      await Promise.allSettled([...running]);
      await runPeerEffect(Scope.close(workScope, Exit.void));
      await runtime.dispose();
    },
    setActive(value: boolean) {
      const now = Date.now();
      const away = value && !active && inactiveSince !== null ? now - inactiveSince : 0;
      if (!value && active) inactiveSince = now;
      if (value) inactiveSince = null;
      active = value;
      const state = peer;
      if (!state) return;
      if (!active) {
        state.needsResync ||= [...pendingRequests.values()].some(
          (request) => request.method === "GET" || request.method === "HEAD",
        );
        rejectRequests(new Error(sourceText("error.remote.appInBackground")), true);
        if (!state.authenticated) failPeer(state, new Error(sourceText("error.remote.appInBackground")), actions);
      } else {
        const resumed = (decision: string) =>
          diagnose(state, "resume", `away ${Math.round(away / 1000)} s, ${decision}`);
        if (away >= REMOTE_PEER_LOST_AFTER_MS && state.authenticated) {
          resumed("replace connection");
          void runPeerEffect(closePeer());
        } else if (!isPeerOnline(state)) {
          resumed(state.authenticated ? "connect again" : "attempt not finished");
          failPeer(state, new Error(sourceText("error.remote.desktopRestoreNeeded")), actions);
        } else {
          resumed("keep relay tunnels");
        }
      }
    },
    networkRestored() {
      void runPeerEffect(peerCall(() => actions.current.onNetworkRestored?.())).catch(() => undefined);
    },
    eventsFailed() {
      const state = peer;
      if (state && !state.closed)
        failPeer(state, referenced(sourceText("error.remote.connectionDropped"), "events/failed"), actions);
    },
    networkMoved() {
      const state = peer;
      if (active && state && !state.closed)
        failPeer(state, referenced(sourceText("error.remote.connectionDropped"), "network/moved"), actions);
      void runPeerEffect(peerCall(() => actions.current.onNetworkRestored?.())).catch(() => undefined);
    },
  };
  function diagnosticCall(state: PeerState, step: RemoteTeamDiagnostic["step"], detail?: string) {
    markRemoteSync(`peer:${step}`);
    const diagnostic: RemoteTeamDiagnostic = { hostId: state.hostId, step, ...(detail ? { detail } : {}) };
    return peerCall(() => actions.current.onDiagnostic?.(diagnostic));
  }

  function diagnose(state: PeerState, step: RemoteTeamDiagnostic["step"], detail?: string): void {
    void runPeerEffect(diagnosticCall(state, step, detail)).catch(() => undefined);
  }

  function notify<A, E>(operation: Effect.Effect<A, E, RemotePeerIO>) {
    return Effect.forkIn(operation.pipe(Effect.ignore), workScope, { startImmediately: true });
  }

  function isPeerOnline(state: PeerState): boolean {
    return (
      state.tunnels !== null &&
      state.authenticated &&
      TUNNEL_CHANNELS.every((kind) => state.channels[kind]?.readyState === "open")
    );
  }

  function keepsReads(state: PeerState): boolean {
    const keeps = !state.needsResync;
    state.needsResync = false;
    return keeps;
  }

  function executeCommand(
    command: RemoteTeamCommand,
    actions: ActionsRef,
  ): Effect.Effect<RemoteTeamCommandResult, RemotePeerError, RemotePeerIO> {
    return Effect.fn("RemotePeer.executeCommand")(function* () {
      let commandGeneration = generation;
      const result = yield* Effect.gen(function* () {
        if (command.type === "connect") {
          if (!active) return yield* new RemotePeerError({ message: sourceText("error.remote.appInBackground") });
          if (peer && peer.hostId === command.hostId && peer.hostPublicKey === command.hostPublicKey) {
            if (peer.connected) {
              const connected = peer.connected;
              const waiting = peer;
              const authenticated = waiting.authenticated;
              yield* Deferred.await(connected);
              return { commandId: command.id, ok: true, kept: authenticated && keepsReads(waiting) };
            }
          }
          if (
            peer &&
            isPeerOnline(peer) &&
            peer.hostId === command.hostId &&
            peer.hostPublicKey === command.hostPublicKey
          ) {
            return { commandId: command.id, ok: true, kept: keepsReads(peer) };
          }
          yield* Effect.forkIn(closePeer(), workScope, {
            startImmediately: true,
            uninterruptible: true,
          });
          commandGeneration = generation + 1;
          yield* connectPeerEffect(command.hostId, command.hostPublicKey, actions);
          return { commandId: command.id, ok: true };
        }
        if (command.type === "disconnect") {
          yield* closePeer();
          return { commandId: command.id, ok: true };
        }
        let reported = -1;
        let downloaded = -1;
        const response = yield* requestEffect(
          command.method,
          command.path,
          command.body,
          command.upload,
          (sent, total) => {
            const percent = total > 0 ? Math.floor((sent / total) * 100) : 100;
            if (percent === reported) return;
            reported = percent;
            void runPeerEffect(
              peerCall(() => actions.current.onUploadProgress?.({ commandId: command.id, sent, total })),
            ).catch(() => undefined);
          },
          command.timeoutMs,
          command.largeDownload,
          command.downloadSize === undefined
            ? undefined
            : {
                size: command.downloadSize,
                onProgress: (received, total) => {
                  const percent = total > 0 ? Math.floor((received / total) * 100) : 100;
                  if (percent === downloaded) return;
                  downloaded = percent;
                  void runPeerEffect(
                    peerCall(() => actions.current.onDownloadProgress?.({ commandId: command.id, received, total })),
                  ).catch(() => undefined);
                },
              },
        );
        return { commandId: command.id, ok: true, status: response.status, body: response.body };
      }).pipe(Effect.result);
      if (Result.isSuccess(result)) return result.success;
      const error = result.failure;
      {
        const message = error.message;
        const reference = failureReference(error);
        const referenceField = reference ? { reference } : {};
        if (command.type === "connect" && commandGeneration === generation) {
          yield* RemotePeerIO.use((io) =>
            io.connectionUpdate({ hostId: command.hostId, state: "offline", message, ...referenceField }),
          );
        }
        return {
          commandId: command.id,
          ok: false,
          error: message,
          ...referenceField,
        };
      }
    })();
  }

  function connectPeerEffect(hostId: string, hostPublicKey: string, actions: ActionsRef) {
    return Effect.fn("RemotePeer.connectPeer")(function* () {
      if (!active) return yield* new RemotePeerError({ message: sourceText("error.remote.appInBackground") });
      const currentGeneration = ++generation;
      yield* RemotePeerIO.use((io) => io.connectionUpdate({ hostId, state: "connecting", message: null }));
      return yield* connectTunnelPeer(hostId, hostPublicKey, tunnelTransport, currentGeneration, actions);
    })();
  }

  function newPeerState(generation: number, hostId: string, hostPublicKey: string): PeerState {
    return {
      generation,
      hostId,
      hostPublicKey,
      channels: {},
      decoders: {},
      tunnels: null,
      authenticated: false,
      closed: false,
      lastEventSequence: 0,
      eventAckTimer: null,
      needsResync: false,
      connected: null,
      abort: new AbortController(),
      answeredRequest: false,
      probingPath: false,
      fullSnapshotRequested: false,
      lastAnswerAt: 0,
      hostProtocol: hostProtocols.get(hostId),
    };
  }

  function connectTunnelPeer(
    hostId: string,
    hostKey: string,
    transport: RemoteTeamTunnelTransport,
    currentGeneration: number,
    actions: ActionsRef,
  ) {
    return Effect.fn("RemotePeer.connectTunnelPeer")(function* () {
      const state = newPeerState(currentGeneration, hostId, hostKey);
      peer = state;
      state.connected = Deferred.makeUnsafe<void, RemotePeerError>();
      const opened = yield* Effect.result(peerCall(() => transport.open(hostId, hostKey, state.abort.signal)));
      if (Result.isFailure(opened)) {
        yield* failPeerEffect(state, opened.failure, actions);
        return yield* opened.failure;
      }
      const tunnels = opened.success;
      if (state.closed || peer !== state) {
        tunnels.close();
        return yield* new RemotePeerError({ message: sourceText("error.remote.connectionReplaced") });
      }
      state.tunnels = tunnels;
      state.authenticated = true;
      for (const kind of TUNNEL_CHANNELS) bindChannel(state, kind, tunnels[kind], actions);
      yield* Effect.gen(function* () {
        yield* notify(diagnosticCall(state, "authenticated"));
        settleConnected(state);
        yield* sendEventAckEffect(state);
        yield* RemotePeerIO.use((io) =>
          io.connectionUpdate({ hostId, state: "online", message: null, lostAfterMs: REMOTE_PEER_LOST_AFTER_MS }),
        );
      }).pipe(Effect.tapError((error) => failPeerEffect(state, error, actions)));
    })();
  }

  function bindChannel(state: PeerState, kind: ChannelKind, channel: RemoteTeamChannel, actions: ActionsRef): void {
    state.channels[kind] = channel;
    state.decoders[kind] = new TeamV2PayloadDecoder();
    let handled = Promise.resolve();
    channel.listen({
      open: () => undefined,
      message: (data) => {
        handled = handled
          .then(() =>
            runPeerEffect(
              Effect.gen(function* () {
                const decoded = yield* Effect.try({
                  try: () => {
                    if (!isString(data) && !(data instanceof ArrayBuffer)) {
                      throw new Error("The host sent unsupported binary data.");
                    }
                    return state.decoders[kind]?.push(data);
                  },
                  catch: peerError,
                });
                if (decoded !== undefined) yield* handleChannelData(state, kind, decoded);
              }),
            ),
          )
          .catch((error) => failPeer(state, error, actions));
      },
      error: () => {
        if (state.channels[kind] !== channel) return;
        failPeer(
          state,
          referenced(sourceText("error.remote.dataChannelFailed", { kind }), referenceFrom("relay", "channel", kind)),
          actions,
        );
      },
      close: (reason) => {
        if (state.authenticated && state.channels[kind] === channel)
          failPeer(
            state,
            reason ?? referenced(sourceText("error.remote.desktopOffline"), "relay/channel/closed"),
            actions,
          );
      },
    });
  }

  function handleChannelData(state: PeerState, kind: ChannelKind, data: string | ArrayBuffer) {
    return Effect.fn("RemotePeer.handleChannelData")(function* () {
      if (state.closed || peer !== state) return;
      if (kind === "files") {
        if (!state.authenticated)
          return yield* new RemotePeerError({ message: sourceText("error.remote.dataBeforeAuth") });
        if (!(yield* downloads.receive(data)) && isString(data)) yield* peerDecode(() => files.receive(data));
        return;
      }
      if (!isString(data)) return;
      if (!state.authenticated)
        return yield* new RemotePeerError({ message: sourceText("error.remote.dataBeforeAuth") });
      if (kind === "rpc") {
        const frame = yield* peerDecode(() => decodeTeamProtocolV2RpcFrame(data));
        if (frame.type !== "response")
          return yield* new RemotePeerError({ message: "The host returned an invalid RPC frame." });
        state.answeredRequest = true;
        state.lastAnswerAt = performance.now();
        const pending = pendingRequests.get(frame.requestId);
        if (!pending) return;
        pending.profile?.responded(data);
        if ("error" in frame)
          pending.reject(referenced(frame.error.message, referenceFrom("host", frame.error.status, frame.error.code)));
        else if (!isDynamicRecord(frame.result) || !isNumber(frame.result.status) || !("body" in frame.result)) {
          pending.reject(new Error("The host returned an invalid response."));
        } else if (isDynamicRecord(frame.result.file) && isString(frame.result.file.transferId)) {
          clearTimeout(pending.timer);
          const status = frame.result.status;
          void runPeerEffect(downloads.take(frame.result.file.transferId)).then(
            (file) => pending.resolve({ status, body: { ...file } }),
            (error: unknown) => pending.reject(error instanceof Error ? error : peerError(error)),
          );
        } else {
          const sideRoute = teamSideRouteCodec(pending.path);
          const status = frame.result.status;
          const body = frame.result.body;
          if (pending.method === "GET" && pending.path === TEAM_API_ROUTES.compatibility && status === 200) {
            const host = (yield* peerDecode(() => decodeTeamProtocolSupportExpanded(body))).protocol;
            state.hostProtocol = teamWebRtcClientProtocol(host, clientProtocol).protocol ?? host.maximum;
            hostProtocols.set(state.hostId, state.hostProtocol);
          }
          pending.resolve({
            status: frame.result.status,
            body: sideRoute
              ? yield* peerDecode(() =>
                  sideRoute.response(pending.path, status, body, {
                    historyExtent: true,
                    channelAttention: true,
                    agentTaskUiBlocks: true,
                    channelIsolation: true,
                    channelPicture: true,
                    channelBrowser: true,
                    channelSeenSubtasks: true,
                    channelTaskWaits: true,
                    mcpManyServers: true,
                    providerManyAccounts: true,
                    routineResultsWhatsApp: true,
                    storageWorkflowFiles: true,
                  }),
                )
              : yield* peerDecode(() =>
                  withWireBlockExtensions(
                    state,
                    decodeTeamProtocolV10WebRtcHttpResponse(pending.method, pending.path, status, body),
                    body,
                  ),
                ),
          });
        }
        clearTimeout(pending.timer);
        pendingRequests.delete(frame.requestId);
        return;
      }
      if (kind !== "events") return;
      const frame = yield* peerDecode(() => decodeTeamProtocolV2EventFrame(data));
      if (frame.type === "event-reset") {
        diagnose(state, "event-reset", `after ${state.lastEventSequence}, next ${frame.nextSequence}`);
        state.lastEventSequence = frame.nextSequence - 1;
        yield* RemotePeerIO.use((io) =>
          io.connectionUpdate({
            hostId: state.hostId,
            state: "online",
            message: null,
            resync: true,
          }),
        );
        scheduleEventAck(state);
        return;
      }
      if (frame.type !== "event")
        return yield* new RemotePeerError({ message: "The host returned an invalid event frame." });
      if (frame.sequence <= state.lastEventSequence) {
        scheduleEventAck(state);
        return;
      }
      if (frame.sequence !== state.lastEventSequence + 1) {
        diagnose(state, "event-gap", `expected ${state.lastEventSequence + 1}, got ${frame.sequence}`);
        return yield* new RemotePeerError({ message: sourceText("error.remote.eventStreamGap") });
      }
      const channel = yield* peerDecode(() => optionalTeamEvent(frame.payload, { agentTaskUiBlocks: true }));
      const decoded = channel
        ? { status: "known" as const, event: optionalTeamEventToCurrent(channel) }
        : yield* peerDecode(() => decodeTeamProtocolV8CurrentEvent(frame));
      if (decoded.status === "invalid")
        return yield* new RemotePeerError({ message: sourceText("error.remote.malformedEvent") });
      state.lastEventSequence = frame.sequence;
      if (decoded.status === "known") {
        if (sendsBlockExtensions(state)) {
          addUiBlockAutoAnswers(decoded.event, frame.payload);
          addUiBlockVaultRequests(decoded.event, frame.payload);
          addUiBlockLocationRequests(decoded.event, frame.payload);
          addSkillSuggestionNames(decoded.event, frame.payload);
          addPromptQuestionDetails(decoded.event, frame.payload);
        }
        yield* RemotePeerIO.use((io) => io.teamEvent(state.hostId, decoded.event));
      }
      scheduleEventAck(state);
    })();
  }

  function requestEffect(
    method: string,
    path: string,
    body: TeamProtocolV2Json,
    upload?: RemoteFileUpload,
    onUploadProgress?: (sent: number, total: number) => void,
    timeoutMs = REQUEST_TIMEOUT_MS,
    largeDownload?: RemoteLargeDownload,
    download?: RemoteDownloadWatch,
  ) {
    return Effect.fn("RemotePeer.request")(function* () {
      const state = peer;
      if (!state || !isPeerOnline(state)) {
        if (state && (method === "GET" || method === "HEAD")) state.needsResync = true;
        return yield* new RemotePeerError({ message: sourceText("error.remote.selectedServerOffline") });
      }
      const checksConnection = method === "GET" && path === TEAM_API_ROUTES.compatibility;
      const protocolRead = checksConnection ? Deferred.makeUnsafe<void>() : null;
      if (protocolRead) state.hostProtocolRead = protocolRead;
      else if (state.hostProtocol === undefined && state.hostProtocolRead)
        yield* Deferred.await(state.hostProtocolRead);
      const delivery = upload && onUploadProgress ? trackUploadDelivery(state, onUploadProgress) : null;
      const releaseDownload =
        largeDownload === undefined
          ? null
          : downloads.allow(
              Math.min(largeDownload.maxBytes, TEAM_PROTOCOL_V2_MAX_FILE_BYTES),
              largeDownload.mimeType,
              downloadTarget(largeDownload.file),
            );
      const stopDownloadWatch = download ? downloads.watch(download.size, download.onProgress) : null;
      return yield* Effect.gen(function* () {
        const bodyTransferId = upload ? yield* files.upload(upload, delivery?.queued) : null;
        if (peer !== state || !isPeerOnline(state))
          return yield* new RemotePeerError({ message: sourceText("error.remote.attachmentConnectionChanged") });
        const sideRoute = teamSideRouteCodec(path);
        const payloadBody = upload
          ? null
          : sideRoute
            ? yield* peerDecode(() =>
                sideRoute.request(path, body, {
                  channelIsolation: true,
                  channelPicture: true,
                  channelBrowser: true,
                  providerManyAccounts: true,
                }),
              )
            : // A caller names a provider and model on agent creation only when the host advertises
              yield* peerDecode(() =>
                encodeTeamProtocolV9WebRtcHttpRequest(method, path, body, {
                  preserveSemanticTags: true,
                  agentCreateModel: true,
                }),
              );
        const requestId = createTeamRequestId(randomBytes);
        const capabilityProtocol =
          !checksConnection || (state.hostProtocol !== undefined && state.hostProtocol >= TEAM_PROTOCOL_V10)
            ? state.hostProtocol
            : undefined;
        const sentCapabilities = teamCapabilitiesForProtocol(capabilityProtocol);
        const payload = yield* peerDecode(() =>
          encodeTeamProtocolV2Frame({
            version: 2,
            type: "request",
            requestId,
            operation: "http.request",
            payload: {
              method,
              path,
              body: payloadBody,
              ...(bodyTransferId && upload ? { bodyTransferId, contentType: upload.mimeType } : {}),
              ...teamCapabilityLists(capabilityProtocol, sentCapabilities),
            },
          }),
        );
        const answer = Deferred.makeUnsafe<{ status: number; body: TeamProtocolV2Json }, RemotePeerError>();
        const response = yield* Effect.acquireUseRelease(
          Effect.sync(() => {
            const reject = (error: Error) => Deferred.doneUnsafe(answer, Effect.fail(peerError(error)));
            const expire = () => {
              if (pendingRequests.get(requestId) !== pending) return;
              pendingRequests.delete(requestId);
              const error = new Error(sourceText("error.remote.desktopRequestTimeout"));
              reject(error);
              if (checksConnection) failPeer(state, error, actions);
              else probePathAfterTimeout(state);
            };
            const resolve = (value: { status: number; body: TeamProtocolV2Json }) =>
              Deferred.doneUnsafe(answer, Effect.succeed(value));
            const pending: PendingRequest = {
              method,
              path,
              resolve,
              reject,
              profile: startRemoteRequest(method, path, payload),
              timer: checksConnection
                ? setTimeout(
                    expire,
                    Math.min(state.answeredRequest ? KNOWN_PEER_ANSWER_MS : FRESH_PEER_ANSWER_MS, timeoutMs),
                  )
                : startRemoteRequestDeadline(
                    timeoutMs,
                    () => state.lastAnswerAt,
                    expire,
                    (timer) => {
                      pending.timer = timer;
                    },
                  ),
            };
            pendingRequests.set(requestId, pending);
            return pending;
          }),
          () =>
            Effect.forkIn(
              sendPayload(state, "rpc", payload).pipe(
                Effect.catch((error) =>
                  Effect.sync(() => {
                    const pending = pendingRequests.get(requestId);
                    if (pending) pending.reject(peerError(error));
                  }),
                ),
              ),
              workScope,
              { startImmediately: true },
            ).pipe(Effect.andThen(Deferred.await(answer))),
          (pending, exit) =>
            Effect.sync(() => {
              clearTimeout(pending.timer);
              pendingRequests.delete(requestId);
              pending.profile?.end(exit);
            }),
        );
        delivery?.complete();
        if (!state.fullSnapshotRequested && sentCapabilities !== TEAM_BOOTSTRAP_CAPABILITIES) {
          state.fullSnapshotRequested = true;
          void runPeerEffect(sendEventControl(state, { type: "runtime-snapshot-request" })).catch(() => {
            state.fullSnapshotRequested = false;
          });
        }
        return response;
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            delivery?.stop();
            releaseDownload?.();
            stopDownloadWatch?.();
            if (protocolRead) Deferred.doneUnsafe(protocolRead, Effect.void);
          }),
        ),
      );
    })();
  }

  function probePathAfterTimeout(state: PeerState): void {
    if (state.probingPath || state.closed || peer !== state || !isPeerOnline(state)) return;
    state.probingPath = true;
    diagnose(state, "path-check", "request timeout");
    void runPeerEffect(requestEffect("GET", TEAM_API_ROUTES.compatibility, null))
      .catch(() => undefined)
      .finally(() => {
        state.probingPath = false;
      });
  }

  function trackUploadDelivery(state: PeerState, onProgress: (sent: number, total: number) => void) {
    let queued = 0;
    let total = 0;
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const report = () => {
      const buffered = state.channels.files?.bufferedAmount ?? 0;
      onProgress(Math.max(0, Math.min(total, queued - buffered)), total);
      if (buffered === 0 && queued >= total) stop();
    };
    return {
      queued(sent: number, size: number) {
        queued = sent;
        total = size;
        report();
        timer ??= setInterval(report, 100);
      },
      complete() {
        stop();
        if (total > 0) onProgress(total, total);
      },
      stop,
    };
  }

  function sendEventAckEffect(state: PeerState) {
    return Effect.fn("RemotePeer.sendEventAck")(function* () {
      yield* sendPayload(
        state,
        "events",
        yield* peerDecode(() =>
          encodeTeamProtocolV2Frame({ version: 2, type: "event-ack", throughSequence: state.lastEventSequence }),
        ),
      );
    })();
  }

  function scheduleEventAck(state: PeerState): void {
    if (state.closed || state.eventAckTimer !== null) return;
    state.eventAckTimer = setTimeout(() => {
      state.eventAckTimer = null;
      if (state.closed || peer !== state) return;
      void runPeerEffect(sendEventAckEffect(state)).catch(() => undefined);
    }, 16);
  }

  function sendEventControl(state: PeerState, control: TeamProtocolV1CurrentEventControl) {
    return Effect.fn("RemotePeer.sendEventControl")(function* () {
      yield* sendPayload(
        state,
        "events",
        yield* peerDecode(() =>
          encodeTeamProtocolV2Frame({
            version: 2,
            type: "event-control",
            control: toWireTeamProtocolV1ClientEvent(control),
          }),
        ),
      );
    })();
  }

  function sendPayload(state: PeerState, kind: ChannelKind, data: string | ArrayBuffer) {
    return Effect.fn("RemotePeer.sendPayload")(function* () {
      const channel = state.channels[kind];
      if (channel?.readyState !== "open")
        return yield* new RemotePeerError({ message: sourceText("error.remote.channelNotOpen") });
      for (const frame of yield* peerDecode(() => encodeTeamV2Payload(data, Number.POSITIVE_INFINITY))) {
        yield* waitForWritable(state, channel);
        yield* Effect.try({
          try: () => channel.send(frame),
          catch: (error) =>
            new RemotePeerError({
              message: error instanceof Error ? error.message : sourceText("error.remote.requestNotSent"),
            }),
        });
      }
    })();
  }

  function waitForWritable(state: PeerState, channel: RemoteTeamChannel) {
    return Effect.fn("RemotePeer.waitForWritable")(function* () {
      if (state.closed) return yield* new RemotePeerError({ message: sourceText("error.remote.serverDisconnected") });
      if (channel.bufferedAmount <= 4 * 1024 * 1024) return;
      return yield* Effect.callback<void, RemotePeerError>((resume) => {
        let lowestBuffered = channel.bufferedAmount;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let stopLow = () => {};
        const release = () => {
          clearTimeout(timer);
          stopLow();
          state.abort.signal.removeEventListener("abort", onAbort);
        };
        const finish = (result: Effect.Effect<void, RemotePeerError>) => {
          release();
          resume(result);
        };
        const onLow = () => finish(Effect.void);
        const onAbort = () =>
          finish(Effect.fail(new RemotePeerError({ message: sourceText("error.remote.serverDisconnected") })));
        const checkDrain = () => {
          if (channel.bufferedAmount >= lowestBuffered) {
            finish(Effect.fail(new RemotePeerError({ message: sourceText("error.remote.channelBackpressure") })));
            return;
          }
          lowestBuffered = channel.bufferedAmount;
          timer = setTimeout(checkDrain, CHANNEL_DRAIN_IDLE_MS);
        };
        state.abort.signal.addEventListener("abort", onAbort, { once: true });
        timer = setTimeout(checkDrain, CHANNEL_DRAIN_IDLE_MS);
        stopLow = channel.onBufferedAmountLow(onLow);
        if (channel.bufferedAmount <= channel.bufferedAmountLowThreshold) onLow();
        return Effect.sync(release);
      });
    })();
  }

  function failPeer(
    state: PeerState,
    error: unknown,
    actions: ActionsRef,
    code?: RemoteTeamConnectionUpdate["code"],
  ): void {
    if (state.closed || peer !== state) return;
    const failure = referenced(failureMessage(error), failureReference(error));
    diagnose(state, "failed", failureDetail(failure, code));
    rejectConnection(state, failure);
    void runPeerEffect(connectionOffline(state, failure, actions, code));
    void runPeerEffect(closePeer());
  }

  function failPeerEffect(
    state: PeerState,
    error: unknown,
    actions: ActionsRef,
    code?: RemoteTeamConnectionUpdate["code"],
  ) {
    return Effect.gen(function* () {
      if (state.closed || peer !== state) return;
      const failure = referenced(failureMessage(error), failureReference(error));
      yield* notify(diagnosticCall(state, "failed", failureDetail(failure, code)));
      rejectConnection(state, failure);
      yield* notify(connectionOffline(state, failure, actions, code));
      yield* Effect.forkIn(closePeer().pipe(Effect.ignore), workScope, {
        startImmediately: true,
        uninterruptible: true,
      });
    });
  }

  function failureDetail(failure: RemotePeerError, code?: RemoteTeamConnectionUpdate["code"]): string {
    const text = code ? `${code}: ${failure.message}` : failure.message;
    return failure.reference ? `${text} [${failure.reference}]` : text;
  }

  function failureMessage(error: unknown): string {
    return error instanceof Error ? error.message : sourceText("error.remote.operationFailed");
  }

  function connectionOffline(
    state: PeerState,
    failure: RemotePeerError,
    actions: ActionsRef,
    code?: RemoteTeamConnectionUpdate["code"],
  ) {
    const reference = failure.reference;
    return peerCall(() =>
      actions.current.onConnectionUpdate({
        hostId: state.hostId,
        state: "offline",
        message: failure.message,
        ...(code ? { code } : {}),
        ...(reference ? { reference } : {}),
      }),
    );
  }

  function rejectRequests(error: Error, readsOnly = false): void {
    for (const [id, pending] of pendingRequests) {
      if (readsOnly && pending.method !== "GET" && pending.method !== "HEAD") continue;
      pendingRequests.delete(id);
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }

  function closePeer() {
    return Effect.sync(() => {
      files.cancel();
      downloads.clear();
      const state = peer;
      peer = null;
      generation += 1;
      if (!state) return;
      state.closed = true;
      lastTyping = null;
      typingInFlight = null;
      state.abort.abort();
      if (state.eventAckTimer !== null) clearTimeout(state.eventAckTimer);
      state.tunnels?.close();
      for (const decoder of Object.values(state.decoders)) decoder?.reset();
      rejectRequests(new Error(sourceText("error.remote.serverDisconnected")));
      rejectConnection(state, new Error(sourceText("error.remote.serverDisconnected")));
    });
  }

  function settleConnected(state: PeerState): void {
    if (state.connected) Deferred.doneUnsafe(state.connected, Effect.void);
    state.connected = null;
  }

  function rejectConnection(state: PeerState, error: Error): void {
    if (state.connected) Deferred.doneUnsafe(state.connected, Effect.fail(peerError(error)));
    state.connected = null;
  }
}

function sendsBlockExtensions(state: PeerState): boolean {
  return (state.hostProtocol ?? 0) >= TEAM_PROTOCOL_V9;
}

function withWireBlockExtensions<T>(state: PeerState, decoded: T, wire: unknown): T {
  if (sendsBlockExtensions(state)) {
    addUiBlockAutoAnswers(decoded, wire);
    addUiBlockVaultRequests(decoded, wire);
    addUiBlockLocationRequests(decoded, wire);
    addSkillSuggestionNames(decoded, wire);
    addPromptQuestionDetails(decoded, wire);
  }
  return decoded;
}
