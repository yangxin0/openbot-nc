import { RELAY_SESSION_WINDOW_BYTES } from "@openbot/contracts/relay-protocol/messages";
import {
  encodeRelayV2Chunks,
  RELAY_V2_TUNNEL_CHANNELS,
  type RelayV2TunnelChannel,
} from "@openbot/contracts/relay-protocol/v2-tunnel";

const FILES_WINDOW_BYTES = RELAY_SESSION_WINDOW_BYTES / 2;
const FILES_QUEUED_BYTES = 32 * 1024;
const CONTROL_QUEUED_BYTES = 128 * 1024;

export interface RelayV2Sink {
  write(bytes: Uint8Array<ArrayBuffer>): void;
  queuedBytes(): number;
  unacknowledgedBytes(): number;
  onProgress(listener: () => void): () => void;
}

export class RelayV2ChannelWriter {
  readonly #sink: RelayV2Sink;
  readonly #queues = new Map<RelayV2TunnelChannel, Uint8Array<ArrayBuffer>[]>(
    RELAY_V2_TUNNEL_CHANNELS.map((channel) => [channel, []]),
  );
  readonly #bytes = new Map<RelayV2TunnelChannel, number>(RELAY_V2_TUNNEL_CHANNELS.map((channel) => [channel, 0]));
  readonly #progress = new Set<() => void>();
  readonly #stopSink: () => void;
  #turn = 0;
  #closed = false;

  constructor(sink: RelayV2Sink) {
    this.#sink = sink;
    this.#stopSink = sink.onProgress(() => this.#pump());
  }

  enqueue(channel: RelayV2TunnelChannel, record: Uint8Array): void {
    if (this.#closed) return;
    const queue = this.#queues.get(channel);
    if (!queue) return;
    for (const chunk of encodeRelayV2Chunks(channel, record)) {
      queue.push(chunk);
      this.#bytes.set(channel, (this.#bytes.get(channel) ?? 0) + chunk.byteLength);
    }
    this.#pump();
  }

  bufferedAmount(channel: RelayV2TunnelChannel): number {
    return this.#bytes.get(channel) ?? 0;
  }

  onProgress(listener: () => void): () => void {
    this.#progress.add(listener);
    return () => this.#progress.delete(listener);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#stopSink();
    for (const channel of RELAY_V2_TUNNEL_CHANNELS) {
      this.#queues.set(channel, []);
      this.#bytes.set(channel, 0);
    }
    this.#notify();
  }

  #pump(): void {
    let wrote = false;
    while (!this.#closed) {
      const channel = this.#nextChannel();
      if (!channel) break;
      const queue = this.#queues.get(channel);
      const chunk = queue?.shift();
      if (!queue || !chunk) break;
      this.#bytes.set(channel, (this.#bytes.get(channel) ?? 0) - chunk.byteLength);
      this.#sink.write(chunk);
      wrote = true;
    }
    if (wrote) this.#notify();
  }

  #nextChannel(): RelayV2TunnelChannel | null {
    const count = RELAY_V2_TUNNEL_CHANNELS.length;
    for (let step = 0; step < count; step += 1) {
      const index = (this.#turn + step) % count;
      const channel = RELAY_V2_TUNNEL_CHANNELS[index];
      const chunk = channel ? this.#queues.get(channel)?.[0] : undefined;
      if (!channel || !chunk || !this.#allowed(channel, chunk.byteLength)) continue;
      this.#turn = (index + 1) % count;
      return channel;
    }
    return null;
  }

  #allowed(channel: RelayV2TunnelChannel, size: number): boolean {
    const queued = this.#sink.queuedBytes();
    const unacknowledged = this.#sink.unacknowledgedBytes();
    if (channel === "files") return queued <= FILES_QUEUED_BYTES && unacknowledged + size <= FILES_WINDOW_BYTES;
    return queued <= CONTROL_QUEUED_BYTES && unacknowledged + size <= RELAY_SESSION_WINDOW_BYTES;
  }

  #notify(): void {
    for (const listener of [...this.#progress]) listener();
  }
}
