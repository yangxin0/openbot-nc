import { BROWSER_SECRET_RESPONSE_PATH } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { BROWSER_SECRET_VAULT_ROUTES } from "@openbot/contracts/team-protocol/browser-secret-vault-v1";
import {
  INSTANCE_TRANSFER_REMOTE_BYTES,
  INSTANCE_TRANSFER_ROUTES,
} from "@openbot/contracts/team-protocol/instance-transfer-v1";
import { PENDING_APPROVAL_ROUTES } from "@openbot/contracts/team-protocol/pending-approval-v1";
import { PHONE_FEEDBACK_ROUTES } from "@openbot/contracts/team-protocol/phone-feedback-v1";
import { isQueueEditRoute, QueueEditRejectedError } from "@openbot/contracts/team-protocol/queue-edit-v1";
import type { TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import { sourceText } from "@openbot/i18n/source";
import { bytesToBase64 } from "@openbot/team-client/base64";
import type { RelayTeamPeerActions } from "@openbot/team-client/relay-client";
import type {
  RemoteDownloadProgress,
  RemoteDownloadWatch,
  RemoteFileUpload,
  RemoteLargeDownload,
  RemoteTeamCommand,
  RemoteTeamCommandResult,
  RemoteTeamConnectionUpdate,
  RemoteTeamDiagnostic,
  RemoteTeamEvent,
  RemoteUploadProgress,
} from "@openbot/team-client/remote-peer";
import { remoteWorkspaceReadTimeout } from "@openbot/team-client/remote-recovery";
import { referenceFrom } from "@openbot/user-errors";
import * as Crypto from "expo-crypto";
import { File, FileMode } from "expo-file-system";
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import {
  type BrowserViewBridgeEvent,
  type BrowserViewBridgeOpen,
  createBrowserViewBridge,
  type RemoteBrowserViewSession,
} from "@/features/browser/model/browser-view-bridge";
import { createPhoneRelayPeer, type PhoneRelay, type PhoneRelayPeer } from "@/features/identity/model/phone-relay";
import { supportLog, supportLogUrl } from "@/features/support/model/support-log";
import { InactiveRequestError } from "@/features/workspace/model/pending-approvals";
import { referencedError } from "@/features/workspace/model/referenced-error";
import {
  BACKGROUND_READS_IN_FLIGHT,
  createRequestLimiter,
  isBackgroundRead,
} from "@/features/workspace/model/request-lanes";
import { uploadCancelled } from "@/features/workspace/model/upload-cancels";
import { currentText } from "@/shared/lib/text";

export interface RemoteTeamTransportRef {
  connect(hostId: string, hostPublicKey: string): Promise<{ kept: boolean }>;
  disconnect(): Promise<void>;
  networkChanged(): void;
  request<T>(
    method: string,
    path: string,
    decode: (value: unknown) => T,
    body?: TeamProtocolV2Json,
    upload?: RemoteFileUpload,
    onUploadProgress?: (fraction: number) => void,
    largeDownload?: RemoteLargeDownload,
    download?: RemoteDownloadWatch,
  ): Promise<T>;
  openBrowserView(
    options: Omit<BrowserViewBridgeOpen, "viewId">,
    listener: (event: BrowserViewBridgeEvent) => void,
  ): RemoteBrowserViewSession | null;
}

interface RemoteTeamTransportProps {
  hostId: string;
  active: boolean;
  relay: PhoneRelay;
  onConnectionUpdate: (update: RemoteTeamConnectionUpdate) => void;
  onNetworkRestored?: () => void;
  onTeamEvent: (hostId: string, event: RemoteTeamEvent) => void;
}

type RemoteTeamCommandInput =
  | { type: "connect"; hostId: string; hostPublicKey: string }
  | { type: "disconnect" }
  | {
      type: "request";
      method: string;
      path: string;
      body: TeamProtocolV2Json;
      upload?: RemoteFileUpload;
      largeDownload?: RemoteLargeDownload;
      downloadSize?: number;
    };

const partialFile = (uri: string) => new File(`${uri}.part`);

function removePartialFile(uri: string) {
  try {
    const part = partialFile(uri);
    if (part.exists) part.delete();
  } catch {}
}

async function keepDownloadedFile(uri: string, size: number) {
  const file = new File(uri);
  if (file.exists && file.size === size) return removePartialFile(uri);
  try {
    const part = partialFile(uri);
    if (part.size !== size) throw new Error(sourceText("error.remote.downloadIncompleteRetry"));
    await part.move(file, { overwrite: true });
  } catch (error) {
    removePartialFile(uri);
    throw error;
  }
}

function requestError(body: unknown): string {
  return isDynamicRecord(body) && isString(body.error) && body.error
    ? body.error
    : sourceText("error.remote.serverRequestFailed");
}

function savedTo(result: RemoteTeamCommandResult, uri: string) {
  const file = isDynamicRecord(result.body) ? result.body.file : undefined;
  return result.ok && isDynamicRecord(file) && file.ref === uri;
}

export const RemoteTeamTransport = memo(
  forwardRef<RemoteTeamTransportRef, RemoteTeamTransportProps>(function RemoteTeamTransport(props, ref) {
    const latest = useRef(props);
    latest.current = props;
    const backgroundReads = useRef<ReturnType<typeof createRequestLimiter> | null>(null);
    backgroundReads.current ??= createRequestLimiter(BACKGROUND_READS_IN_FLIGHT);
    const backgroundLane = backgroundReads.current;
    const hostIdRef = useRef<string | null>(null);
    const viewListeners = useRef(new Map<string, (event: BrowserViewBridgeEvent) => void>());
    const uploadListeners = useRef(new Map<string, (fraction: number) => void>());
    const downloadListeners = useRef(new Map<string, (received: number, total: number) => void>());
    const uploadFiles = useRef(new Map<string, number>());
    const downloadFiles = useRef(new Set<string>());
    const peerRef = useRef<PhoneRelayPeer | null>(null);
    const browserViewRef = useRef<ReturnType<typeof createBrowserViewBridge> | null>(null);

    const uploadFile = (fileRef: string) => {
      if (!uploadFiles.current.has(fileRef)) throw new Error("The file is not part of an upload.");
      if (uploadCancelled(fileRef)) {
        void peerRef.current?.cancelUpload().catch(() => undefined);
        throw new Error("The upload was cancelled.");
      }
      return new File(fileRef);
    };
    const actions = useRef<RelayTeamPeerActions>({
      onConnectionUpdate: async (update) => {
        if (update.state !== "online") browserViewRef.current?.disconnect(update.message);
        latest.current.onConnectionUpdate(update);
      },
      onTeamEvent: async (hostId, event) => {
        try {
          latest.current.onTeamEvent(hostId, event);
        } catch {
          peerRef.current?.eventsFailed();
        }
      },
      onHostStreamData: (data) => browserViewRef.current?.receive(data),
      digestUploadFile: async (fileRef) => uploadFile(fileRef).digest("SHA-256"),
      writeDownloadFile: async ({ ref: fileRef, base64, append }) => {
        if (!downloadFiles.current.has(fileRef)) throw new Error("The file is not part of a download.");
        await partialFile(fileRef).write(base64, { encoding: "base64", append });
      },
      readUploadFile: async ({ ref: fileRef, offset, length }) => {
        const handle = uploadFile(fileRef).open(FileMode.ReadOnly);
        try {
          handle.offset = offset;
          return bytesToBase64(await handle.readBytes(length));
        } finally {
          handle.close();
        }
      },
      onUploadProgress: async ({ commandId, sent, total }: RemoteUploadProgress) =>
        uploadListeners.current.get(commandId)?.(total > 0 ? sent / total : 1),
      onDownloadProgress: async ({ commandId, received, total }: RemoteDownloadProgress) =>
        downloadListeners.current.get(commandId)?.(received, total),
      onDiagnostic: async ({ hostId, step, detail }: RemoteTeamDiagnostic) => {
        supportLog.add(
          step === "failed" || step === "stalled" ? "warn" : "info",
          "connection",
          `${hostId} peer ${step}${detail ? `: ${detail}` : ""}`,
        );
      },
      onNetworkRestored: async () => latest.current.onNetworkRestored?.(),
    });
    peerRef.current ??= createPhoneRelayPeer(props.relay, actions);
    const peer = peerRef.current;
    browserViewRef.current ??= createBrowserViewBridge(
      (data) => peer.sendHostStreamData(data),
      async (method, path, body) => {
        const result = await peer.execute({ id: Crypto.randomUUID(), type: "request", method, path, body: body ?? {} });
        if (!result.ok) throw new Error(result.error ?? sourceText("error.remote.serverRequestFailed"));
        if (result.status !== undefined && result.status >= 400) throw new Error(requestError(result.body));
        return result.body;
      },
      (event) => {
        const listener = viewListeners.current.get(event.viewId);
        if (event.type === "ended") viewListeners.current.delete(event.viewId);
        listener?.(event);
      },
    );
    const browserView = browserViewRef.current;

    useEffect(() => {
      peer.setActive(props.active);
    }, [peer, props.active]);
    useEffect(
      () => () => {
        browserView.disconnect(null);
        void peer.dispose();
      },
      [peer, browserView],
    );

    const enqueue = useCallback(
      (
        next: RemoteTeamCommandInput,
        onUploadProgress?: (fraction: number) => void,
        onDownloadProgress?: (received: number, total: number) => void,
      ): Promise<RemoteTeamCommandResult> => {
        const id = Crypto.randomUUID();
        const command: RemoteTeamCommand =
          next.type === "connect"
            ? { id, type: "connect", hostId: next.hostId, hostPublicKey: next.hostPublicKey }
            : next.type === "request"
              ? {
                  id,
                  type: "request",
                  method: next.method,
                  path: next.path,
                  body: next.body,
                  upload: next.upload,
                  timeoutMs: remoteWorkspaceReadTimeout(next.method, next.path),
                  ...(next.path === INSTANCE_TRANSFER_ROUTES.export
                    ? { largeDownload: { maxBytes: INSTANCE_TRANSFER_REMOTE_BYTES, mimeType: "application/zip" } }
                    : next.largeDownload
                      ? { largeDownload: next.largeDownload }
                      : {}),
                  ...(next.downloadSize === undefined ? {} : { downloadSize: next.downloadSize }),
                }
              : { id, type: "disconnect" };
        const fileRef = command.type === "request" ? command.upload?.file?.ref : undefined;
        const saved = command.type === "request" ? command.largeDownload : undefined;
        const savedFile = saved?.file;
        if (!onUploadProgress && !onDownloadProgress && !fileRef && !savedFile) return peer.execute(command);
        if (onUploadProgress) uploadListeners.current.set(id, onUploadProgress);
        if (onDownloadProgress) downloadListeners.current.set(id, onDownloadProgress);
        if (fileRef) uploadFiles.current.set(fileRef, (uploadFiles.current.get(fileRef) ?? 0) + 1);
        if (savedFile) downloadFiles.current.add(savedFile);
        const sent =
          saved && savedFile
            ? peer.execute(command).then(
                async (result) => {
                  downloadFiles.current.delete(savedFile);
                  if (savedTo(result, savedFile)) await keepDownloadedFile(savedFile, saved.maxBytes);
                  else removePartialFile(savedFile);
                  return result;
                },
                (error: unknown) => {
                  downloadFiles.current.delete(savedFile);
                  removePartialFile(savedFile);
                  throw error;
                },
              )
            : peer.execute(command);
        return sent.finally(() => {
          uploadListeners.current.delete(id);
          downloadListeners.current.delete(id);
          if (savedFile) downloadFiles.current.delete(savedFile);
          if (!fileRef) return;
          const count = (uploadFiles.current.get(fileRef) ?? 1) - 1;
          if (count > 0) uploadFiles.current.set(fileRef, count);
          else uploadFiles.current.delete(fileRef);
        });
      },
      [peer],
    );

    useImperativeHandle(
      ref,
      () => ({
        connect: async (hostId, hostPublicKey) => {
          hostIdRef.current = hostId;
          const result = await enqueue({ type: "connect", hostId, hostPublicKey });
          if (!result.ok)
            throw referencedError(
              result.error ?? currentText().t("mobile.workspace.error.connectFailed"),
              result.reference,
            );
          return { kept: result.kept === true };
        },
        networkChanged: () => peer.networkMoved(),
        disconnect: async () => {
          const result = await enqueue({ type: "disconnect" });
          if (!result.ok)
            throw referencedError(
              result.error ?? currentText().t("mobile.workspace.error.disconnectFailed"),
              result.reference,
            );
        },
        request: async <T,>(
          method: string,
          path: string,
          decode: (value: unknown) => T,
          body: TeamProtocolV2Json = {},
          upload?: RemoteFileUpload,
          onUploadProgress?: (fraction: number) => void,
          largeDownload?: RemoteLargeDownload,
          download?: RemoteDownloadWatch,
        ): Promise<T> => {
          const started = Date.now();
          const send = () =>
            enqueue(
              { type: "request", method, path, body, upload, largeDownload, downloadSize: download?.size },
              onUploadProgress,
              download?.onProgress,
            );
          const result = await (isBackgroundRead(method, path) ? backgroundLane(send) : send());
          const request = `${hostIdRef.current ?? "unknown server"} ${method} ${supportLogUrl(path)}`;
          const time = `(${Date.now() - started} ms)`;
          if (!result.ok)
            supportLog.add(
              "warn",
              "connection",
              `${request} -> failed: ${result.error ?? "no error"}${result.reference ? ` [${result.reference}]` : ""} ${time}`,
            );
          else
            supportLog.add(
              result.status !== undefined && result.status >= 400 ? "warn" : "info",
              "connection",
              `${request} -> ${result.status ?? "no status"} ${time}`,
            );
          if (!result.ok)
            throw referencedError(result.error ?? sourceText("error.remote.serverRequestFailed"), result.reference);
          if (result.status === 409 && isQueueEditRoute(method, path))
            throw new QueueEditRejectedError(currentText().t("mobile.workspace.error.queueEditRejected"));
          if (
            result.status === 409 &&
            method === "POST" &&
            (path === TEAM_API_ROUTES.respond.approval ||
              path === PENDING_APPROVAL_ROUTES.read ||
              path === PHONE_FEEDBACK_ROUTES.send)
          )
            throw new InactiveRequestError(currentText().t("mobile.workspace.error.approvalInactive"));
          if (result.status === 409 && method === "POST" && path === TEAM_API_ROUTES.respond.prompt)
            throw new InactiveRequestError(currentText().t("mobile.workspace.error.formUnavailable"));
          if (
            result.status === 409 &&
            method === "POST" &&
            (path === BROWSER_SECRET_RESPONSE_PATH || path === BROWSER_SECRET_VAULT_ROUTES.respond)
          )
            throw new InactiveRequestError(currentText().t("mobile.chat.browserSecret.ended"));
          if (result.status !== undefined && result.status >= 400)
            throw referencedError(sourceText("error.remote.serverRequestFailed"), referenceFrom("http", result.status));
          return decode(result.body);
        },
        openBrowserView: (options, listener) => {
          const viewId = Crypto.randomUUID();
          viewListeners.current.set(viewId, listener);
          browserView.command({ type: "open", viewId, ...options });
          return {
            input: (inputs) => {
              if (inputs.length > 0) browserView.command({ type: "input", viewId, inputs });
            },
            frameDone: (sequence, drawn) => browserView.command({ type: "frame-done", viewId, sequence, drawn }),
            close: () => {
              if (!viewListeners.current.delete(viewId)) return;
              browserView.command({ type: "close", viewId });
            },
          };
        },
      }),
      [enqueue, backgroundLane, peer, browserView],
    );

    return null;
  }),
);
