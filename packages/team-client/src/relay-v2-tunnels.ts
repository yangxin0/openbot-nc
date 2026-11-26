import {
  decodeRelayV2TunnelControl,
  encodeRelayV2TunnelMarker,
  encodeRelayV2TunnelRecord,
  RELAY_V2_CONNECTION_DEADLINE_MS,
  RELAY_V2_REFUSAL_CODES,
  RELAY_V2_TUNNEL_CHANNELS,
  RelayV2ChunkDecoder,
  type RelayV2TunnelChannel,
  type RelayV2TunnelControl,
  type RelayV2TunnelMessage,
} from "@openbot/contracts/relay-protocol/v2-tunnel";
import { Schema } from "effect";
import type { RelaySession, RelaySessionSource } from "./relay-sessions";
import type { RelaySocketClose } from "./relay-socket";
import { RelayV2ChannelWriter } from "./relay-v2-channels";
import type {
  RemoteTeamChannel,
  RemoteTeamChannelHandlers,
  RemoteTeamChannelState,
  RemoteTeamTunnels,
  RemoteTeamTunnelTransport,
} from "./remote-peer";

const CONTROL_PREFIX = '{"type":"relay-v2-';
const BUFFERED_LOW_THRESHOLD = 1024 * 1024;
const READY_DEADLINE_MS = RELAY_V2_CONNECTION_DEADLINE_MS + 15_000;

const RELAY_V2_TUNNEL_ERROR_CODES = [
  ...RELAY_V2_REFUSAL_CODES,
  "protocol_error",
  "deadline_exceeded",
  "closed",
] as const;
export type RelayV2TunnelErrorCode = (typeof RELAY_V2_TUNNEL_ERROR_CODES)[number];

export class RelayV2TunnelError extends Schema.TaggedError<RelayV2TunnelError>()("RelayV2TunnelError", {
  code: Schema.Literals(RELAY_V2_TUNNEL_ERROR_CODES),
  message: Schema.String,
}) {}

export interface RelayV2TunnelOptions {
  signal?: AbortSignal;
  readyDeadlineMs?: number;
}

type Refusal = Extract<RelayV2TunnelControl, { type: "relay-v2-refused" }>;

class RelayV2Channel implements RemoteTeamChannel {
  readonly bufferedAmountLowThreshold = BUFFERED_LOW_THRESHOLD;
  readonly #name: RelayV2TunnelChannel;
  readonly #session: RelaySession;
  readonly #writer: RelayV2ChannelWriter;
  readonly #pending: RelayV2TunnelMessage[] = [];
  #handlers: RemoteTeamChannelHandlers | null = null;
  #state: RemoteTeamChannelState = "open";
  #closeReason: Error | null = null;
  onControl: ((control: RelayV2TunnelControl) => void) | null = null;
  onClosed: ((reason: Error) => void) | null = null;

  constructor(name: RelayV2TunnelChannel, session: RelaySession, writer: RelayV2ChannelWriter) {
    this.#name = name;
    this.#session = session;
    this.#writer = writer;
  }

  get readyState(): RemoteTeamChannelState {
    return this.#state;
  }

  get bufferedAmount(): number {
    return this.#writer.bufferedAmount(this.#name);
  }

  send(data: string | ArrayBuffer): void {
    if (this.#state !== "open")
      throw new RelayV2TunnelError({ code: "closed", message: "The relay tunnel is closed." });
    this.#writer.enqueue(this.#name, encodeRelayV2TunnelRecord(data));
  }

  listen(handlers: RemoteTeamChannelHandlers): void {
    this.#handlers = handlers;
    for (const message of this.#pending.splice(0)) handlers.message(message);
    if (this.#state === "closed") handlers.close(this.#closeReason);
  }

  onBufferedAmountLow(listener: () => void): () => void {
    return this.#writer.onProgress(() => {
      if (this.bufferedAmount <= this.bufferedAmountLowThreshold) listener();
    });
  }

  close(): void {
    this.#session.close();
  }

  receive(message: RelayV2TunnelMessage): void {
    const control =
      typeof message === "string" && message.startsWith(CONTROL_PREFIX) ? decodeRelayV2TunnelControl(message) : null;
    if (control?.type === "relay-v2-refused") this.#closeReason = refusalError(control);
    if (control) this.onControl?.(control);
    else if (this.#handlers) this.#handlers.message(message);
    else this.#pending.push(message);
  }

  closed(close: RelaySocketClose): void {
    if (this.#state === "closed") return;
    this.#state = "closed";
    const reason =
      this.#closeReason ??
      (close.clean
        ? new RelayV2TunnelError({ code: "closed", message: "The host closed the relay tunnel." })
        : close.error);
    this.#closeReason = reason;
    this.onClosed?.(reason);
    this.#handlers?.close(reason);
  }
}

export async function openRelayV2Tunnels(
  sessions: RelaySessionSource,
  hostKeyId: string,
  options: RelayV2TunnelOptions = {},
): Promise<RemoteTeamTunnels> {
  const session = await sessions.openSession(hostKeyId, { signal: options.signal });
  const writer = new RelayV2ChannelWriter({
    write: (bytes) => session.write(bytes),
    queuedBytes: () => session.queuedBytes(),
    unacknowledgedBytes: () => session.unacknowledgedBytes(),
    onProgress: (listener) => session.onProgress(listener),
  });
  const channels = {
    rpc: new RelayV2Channel("rpc", session, writer),
    events: new RelayV2Channel("events", session, writer),
    files: new RelayV2Channel("files", session, writer),
  };
  const decoder = new RelayV2ChunkDecoder();
  session.listen({
    data: (bytes) => {
      let messages: ReturnType<RelayV2ChunkDecoder["push"]>;
      try {
        messages = decoder.push(bytes);
      } catch {
        session.fail("protocol_error", "The host sent a relay record that is not valid.");
        return;
      }
      for (const { channel, message } of messages) channels[channel].receive(message);
    },
    closed: (close) => {
      writer.close();
      for (const channel of Object.values(channels)) channel.closed(close);
    },
  });
  const closeAll = () => session.close();
  const abort = options.signal;
  abort?.addEventListener("abort", closeAll, { once: true });
  try {
    session.write(encodeRelayV2TunnelMarker());
    await waitForReady(channels, options.readyDeadlineMs ?? READY_DEADLINE_MS, abort);
  } catch (error) {
    closeAll();
    throw error;
  } finally {
    abort?.removeEventListener("abort", closeAll);
  }
  return { ...channels, close: closeAll };
}

export function relayTeamTunnelTransport(
  sessions: RelaySessionSource,
  options: Omit<RelayV2TunnelOptions, "signal"> = {},
): RemoteTeamTunnelTransport {
  return {
    open: (_hostId, hostKey, signal) => openRelayV2Tunnels(sessions, hostKey, { ...options, signal }),
  };
}

function waitForReady(
  channels: Record<RelayV2TunnelChannel, RelayV2Channel>,
  deadlineMs: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        finish(
          new RelayV2TunnelError({
            code: "deadline_exceeded",
            message: "The host did not open the relay connection in time.",
          }),
        ),
      deadlineMs,
    );
    const onAbort = () =>
      finish(new RelayV2TunnelError({ code: "closed", message: "The relay connection was stopped." }));
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    if (channels.rpc.readyState === "closed") {
      finish(new RelayV2TunnelError({ code: "closed", message: "The host closed the relay tunnel." }));
      return;
    }
    function finish(error: Error | null) {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      for (const channel of Object.values(channels)) {
        channel.onControl = null;
        channel.onClosed = null;
      }
      if (error) reject(error);
      else resolve();
    }
    for (const name of RELAY_V2_TUNNEL_CHANNELS) {
      const channel = channels[name];
      channel.onClosed = (reason) => finish(reason);
      channel.onControl = (control) => {
        if (control.type === "relay-v2-refused") finish(refusalError(control));
        else if (name === "rpc") finish(null);
        else
          finish(
            new RelayV2TunnelError({
              code: "protocol_error",
              message: "The host sent a control record on the wrong tunnel.",
            }),
          );
      };
    }
  });
}

function refusalError(refusal: Refusal): RelayV2TunnelError {
  return new RelayV2TunnelError({
    code: refusal.code,
    message: refusal.message ?? `The host refused the relay connection (${refusal.code}).`,
  });
}
