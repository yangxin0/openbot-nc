import {
  decodeRelayV2TunnelControl,
  encodeRelayV2TunnelMarker,
  encodeRelayV2TunnelRecord,
  RELAY_V2_CONNECTION_DEADLINE_MS,
  RELAY_V2_REFUSAL_CODES,
  RELAY_V2_TUNNEL_CHANNELS,
  RELAY_V2_TUNNEL_VERSION,
  type RelayV2TunnelChannel,
  type RelayV2TunnelControl,
  type RelayV2TunnelMessage,
  RelayV2TunnelRecordDecoder,
} from "@openbot/contracts/relay-protocol/v2-tunnel";
import { Schema } from "effect";
import type { RelayBrowserIdentity } from "./relay-identity";
import { dialRelayPeer, type RelaySocketClose, type RelaySocketOptions, type RelayTunnel } from "./relay-socket";
import type {
  RemoteTeamChannel,
  RemoteTeamChannelHandlers,
  RemoteTeamChannelState,
  RemoteTeamTunnels,
  RemoteTeamTunnelTransport,
} from "./remote-peer";

const CONTROL_PREFIX = '{"type":"relay-v2-';
const BUFFERED_LOW_CHECK_MS = 50;
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

export interface RelayV2TunnelOptions extends RelaySocketOptions {
  readyDeadlineMs?: number;
}

type Refusal = Extract<RelayV2TunnelControl, { type: "relay-v2-refused" }>;

class RelayV2Channel implements RemoteTeamChannel {
  readonly bufferedAmountLowThreshold = BUFFERED_LOW_THRESHOLD;
  readonly #tunnel: RelayTunnel;
  readonly #records = new RelayV2TunnelRecordDecoder();
  readonly #pending: RelayV2TunnelMessage[] = [];
  readonly #lowListeners = new Set<() => void>();
  #handlers: RemoteTeamChannelHandlers | null = null;
  #state: RemoteTeamChannelState = "open";
  #closeReason: Error | null = null;
  #lowTimer: ReturnType<typeof setInterval> | null = null;
  onControl: ((control: RelayV2TunnelControl) => void) | null = null;
  onClosed: ((reason: Error) => void) | null = null;

  constructor(tunnel: RelayTunnel) {
    this.#tunnel = tunnel;
    tunnel.listen({ data: (data) => this.#receive(data), closed: (close) => this.#closed(close) });
  }

  get readyState(): RemoteTeamChannelState {
    return this.#state;
  }

  get bufferedAmount(): number {
    return this.#tunnel.bufferedAmount;
  }

  send(data: string | ArrayBuffer): void {
    if (this.#state !== "open")
      throw new RelayV2TunnelError({ code: "closed", message: "The relay tunnel is closed." });
    this.#tunnel.write(new Uint8Array(encodeRelayV2TunnelRecord(data)));
  }

  writeMarker(channel: RelayV2TunnelChannel, connectionKey: string): void {
    this.#tunnel.write(
      new Uint8Array(encodeRelayV2TunnelMarker({ version: RELAY_V2_TUNNEL_VERSION, channel, connectionKey })),
    );
  }

  listen(handlers: RemoteTeamChannelHandlers): void {
    this.#handlers = handlers;
    for (const message of this.#pending.splice(0)) handlers.message(message);
    if (this.#state === "closed") handlers.close(this.#closeReason);
  }

  onBufferedAmountLow(listener: () => void): () => void {
    this.#lowListeners.add(listener);
    this.#lowTimer ??= setInterval(() => this.#checkLow(), BUFFERED_LOW_CHECK_MS);
    return () => {
      this.#lowListeners.delete(listener);
      if (this.#lowListeners.size === 0) this.#stopLowTimer();
    };
  }

  close(): void {
    this.#tunnel.close();
  }

  #receive(data: Uint8Array): void {
    let messages: RelayV2TunnelMessage[];
    try {
      messages = this.#records.push(data);
    } catch {
      this.#tunnel.fail("protocol_error", "The host sent a relay record that is not valid.");
      return;
    }
    for (const message of messages) {
      const control =
        typeof message === "string" && message.startsWith(CONTROL_PREFIX) ? decodeRelayV2TunnelControl(message) : null;
      if (control?.type === "relay-v2-refused") this.#closeReason = refusalError(control);
      if (control) this.onControl?.(control);
      else if (this.#handlers) this.#handlers.message(message);
      else this.#pending.push(message);
    }
  }

  #closed(close: RelaySocketClose): void {
    if (this.#state === "closed") return;
    this.#state = "closed";
    this.#stopLowTimer();
    const reason =
      this.#closeReason ??
      (close.clean
        ? new RelayV2TunnelError({ code: "closed", message: "The host closed the relay tunnel." })
        : close.error);
    this.#closeReason = reason;
    this.onClosed?.(reason);
    this.#handlers?.close(reason);
  }

  #checkLow(): void {
    if (this.bufferedAmount > this.bufferedAmountLowThreshold) return;
    for (const listener of [...this.#lowListeners]) listener();
  }

  #stopLowTimer(): void {
    if (this.#lowTimer !== null) clearInterval(this.#lowTimer);
    this.#lowTimer = null;
  }
}

export async function openRelayV2Tunnels(
  identity: RelayBrowserIdentity,
  hostKeyId: string,
  options: RelayV2TunnelOptions = {},
): Promise<RemoteTeamTunnels> {
  const abort = new AbortController();
  const stop = () => abort.abort();
  options.signal?.addEventListener("abort", stop, { once: true });
  if (options.signal?.aborted) stop();
  const dialed = await Promise.allSettled(
    RELAY_V2_TUNNEL_CHANNELS.map(() => dialRelayPeer(identity, hostKeyId, { ...options, signal: abort.signal })),
  );
  const tunnels = dialed.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  const failure = dialed.find((result) => result.status === "rejected");
  const [rpcTunnel, eventsTunnel, filesTunnel] = tunnels;
  if (failure || !rpcTunnel || !eventsTunnel || !filesTunnel) {
    options.signal?.removeEventListener("abort", stop);
    for (const tunnel of tunnels) tunnel.close();
    throw failure?.reason ?? new RelayV2TunnelError({ code: "closed", message: "The relay tunnels did not open." });
  }
  const channels = {
    rpc: new RelayV2Channel(rpcTunnel),
    events: new RelayV2Channel(eventsTunnel),
    files: new RelayV2Channel(filesTunnel),
  };
  const closeAll = () => {
    for (const channel of Object.values(channels)) channel.close();
  };
  abort.signal.addEventListener("abort", closeAll, { once: true });
  try {
    await waitForReady(channels, options.readyDeadlineMs ?? READY_DEADLINE_MS, abort.signal);
  } catch (error) {
    closeAll();
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", stop);
    abort.signal.removeEventListener("abort", closeAll);
  }
  return { ...channels, close: closeAll };
}

export function relayTeamTunnelTransport(
  identity: RelayBrowserIdentity,
  options: Omit<RelayV2TunnelOptions, "signal"> = {},
): RemoteTeamTunnelTransport {
  return {
    open: (_hostId, hostKey, signal) => openRelayV2Tunnels(identity, hostKey, { ...options, signal }),
  };
}

function waitForReady(
  channels: Record<RelayV2TunnelChannel, RelayV2Channel>,
  deadlineMs: number,
  signal: AbortSignal,
): Promise<void> {
  const connectionKey = randomConnectionKey();
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
    signal.addEventListener("abort", onAbort, { once: true });
    function finish(error: Error | null) {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
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
    try {
      for (const name of RELAY_V2_TUNNEL_CHANNELS) channels[name].writeMarker(name, connectionKey);
    } catch (error) {
      finish(
        error instanceof Error
          ? error
          : new RelayV2TunnelError({ code: "closed", message: "The relay tunnel is closed." }),
      );
    }
  });
}

function refusalError(refusal: Refusal): RelayV2TunnelError {
  return new RelayV2TunnelError({
    code: refusal.code,
    message: refusal.message ?? `The host refused the relay connection (${refusal.code}).`,
  });
}

function randomConnectionKey(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
