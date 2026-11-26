import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { readTeamHostCompatibility, TEAM_WEB_CLIENT_PROTOCOL } from "@openbot/contracts/team-protocol/current";
import { TEAM_PROTOCOL_V2_MAX_FILE_BYTES, type TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import {
  decodeVoiceTranscription,
  VOICE_TRANSCRIPTION_ROUTES,
} from "@openbot/contracts/team-protocol/voice-transcription-v1";
import { bytesToBase64 } from "@openbot/team-client/base64";
import {
  createRelayTeamPeer,
  type RelayBrowserIdentity,
  type RelayHubClient,
  type RelayHubProvider,
  type RelayTeamPeerActions,
} from "@openbot/team-client/relay-client";
import type { RemoteTeamHost } from "@openbot/team-client/remote-directory";
import type {
  RemoteFileUpload,
  RemoteLargeDownload,
  RemoteTeamCommandResult,
  RemoteTeamConnectionUpdate,
  RemoteTeamEvent,
} from "@openbot/team-client/remote-peer";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import { currentText } from "@openbot/ui/text";
import type { HostFile } from "./attachment-media";
import { readHostProtocols, saveHostProtocol } from "./extension-storage";

const FILE_DOWNLOAD: RemoteLargeDownload = { maxBytes: TEAM_PROTOCOL_V2_MAX_FILE_BYTES };
const TRANSCRIPTION_TIMEOUT_MS = 125_000;

type HostProblem = "update_required" | "unavailable";

class HostConnectionError extends Error {
  constructor(
    readonly problem: HostProblem,
    message: string,
  ) {
    super(message);
  }
}

export interface HostConnectionEvents {
  event: (event: RemoteTeamEvent) => void;
  state: (update: RemoteTeamConnectionUpdate) => void;
}

export type HostTarget = Pick<RemoteTeamHost, "hostId" | "name" | "devicePublicKey">;

export interface HostConnection {
  connect: (host: HostTarget) => Promise<string[]>;
  request: TeamApiRequest;
  download: (attachmentId: string) => Promise<HostFile>;
  transcribe: (wav: Uint8Array) => Promise<string>;
  dispose: () => Promise<void>;
}

export async function createHostConnection(
  identity: RelayBrowserIdentity,
  sessions: RelayHubClient | RelayHubProvider,
  events: HostConnectionEvents,
): Promise<HostConnection> {
  const protocols = await readHostProtocols(identity.keyId);
  const actions: { current: RelayTeamPeerActions } = {
    current: {
      onConnectionUpdate: async (update) => events.state(update),
      onTeamEvent: async (_hostId, event) => events.event(event),
    },
  };
  const peer = createRelayTeamPeer(sessions, actions, {
    hostProtocols: {
      get: (hostId) => protocols.get(hostId),
      set: (hostId, protocol) => {
        protocols.set(hostId, protocol);
        void saveHostProtocol(identity.keyId, hostId, protocol);
      },
    },
    clientProtocol: TEAM_WEB_CLIENT_PROTOCOL,
  });
  let connectedHostId: string | null = null;
  let generation = 0;

  async function send(
    method: string,
    path: string,
    body: TeamProtocolV2Json = {},
    options: { largeDownload?: RemoteLargeDownload; upload?: RemoteFileUpload; timeoutMs?: number } = {},
  ): Promise<TeamProtocolV2Json> {
    const current = generation;
    const result = await peer.execute({ id: crypto.randomUUID(), type: "request", method, path, body, ...options });
    if (current !== generation) throw new Error(currentText().t("extension.connection.changed"));
    if (!result.ok || (result.status ?? 500) >= 400)
      throw new Error(hostRefusal(result) ?? currentText().t("extension.connection.requestFailed"));
    return result.body ?? null;
  }

  return {
    async connect(host) {
      generation += 1;
      if (connectedHostId !== null && connectedHostId !== host.hostId)
        await peer.execute({ id: crypto.randomUUID(), type: "disconnect" });
      connectedHostId = host.hostId;
      const result = await peer.execute({
        id: crypto.randomUUID(),
        type: "connect",
        hostId: host.hostId,
        hostPublicKey: host.devicePublicKey,
      });
      if (!result.ok)
        throw new HostConnectionError(
          "unavailable",
          result.error ?? currentText().t("extension.connection.offline", { server: host.name }),
        );
      const { support, negotiated } = await readTeamHostCompatibility(
        () => send("GET", TEAM_API_ROUTES.compatibility),
        TEAM_WEB_CLIENT_PROTOCOL,
      );
      if (negotiated.update)
        throw new HostConnectionError(
          "update_required",
          currentText().t(
            negotiated.update === "client_update_required"
              ? "extension.connection.updateExtension"
              : "extension.connection.updateServer",
            { server: host.name },
          ),
        );
      return support.capabilities;
    },
    request: async (method, path, decode, body, upload) =>
      decode(await send(method, path, body, upload ? { upload } : {})),
    async download(attachmentId) {
      const value = await send("GET", TEAM_API_ROUTES.attachment(attachmentId), {}, { largeDownload: FILE_DOWNLOAD });
      if (!isDynamicRecord(value) || !isString(value.name) || !isString(value.mimeType) || !isString(value.base64))
        throw new Error(currentText().t("extension.connection.requestFailed"));
      return { name: value.name, mimeType: value.mimeType, base64: value.base64 };
    },
    async transcribe(wav) {
      const upload: RemoteFileUpload = { name: "dictation.wav", mimeType: "audio/wav", base64: bytesToBase64(wav) };
      const answer = await send(
        "POST",
        VOICE_TRANSCRIPTION_ROUTES.transcribe,
        {},
        {
          upload,
          timeoutMs: TRANSCRIPTION_TIMEOUT_MS,
        },
      );
      return decodeVoiceTranscription(answer).text;
    },
    async dispose() {
      generation += 1;
      await peer.dispose().catch(() => undefined);
    },
  };
}

function hostRefusal(result: RemoteTeamCommandResult): string | null {
  const reason = result.ok ? (isDynamicRecord(result.body) ? result.body.error : undefined) : result.error;
  if (!isString(reason) || !reason.trim()) return null;
  const text = reason.trim();
  return text.length > 300 ? `${text.slice(0, 299)}…` : text;
}
