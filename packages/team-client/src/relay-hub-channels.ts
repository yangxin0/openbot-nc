import { RELAY_HUB_PLAINTEXT_LIMIT, type RelayHubKind } from "@openbot/contracts/relay-protocol/hub";
import { Schema } from "effect";
import { RelayHubClient, type RelayHubMessage, RelayHubSendError } from "./relay-hub";
import type {
  RemoteTeamChannel,
  RemoteTeamChannelHandlers,
  RemoteTeamChannelState,
  RemoteTeamTunnels,
  RemoteTeamTunnelTransport,
} from "./remote-peer";
import { encodeTeamV2Payload } from "./v2-framing";

export const RELAY_HUB_V2_FRAGMENT_BYTES = RELAY_HUB_PLAINTEXT_LIMIT - 1;
export const RELAY_HUB_V2_CHANNELS = ["rpc", "events", "files"] as const satisfies readonly RelayHubKind[];

const PAYLOAD_TEXT = 1;
const PAYLOAD_BINARY = 2;
const PAYLOAD_TYPE_MASK = 0x0f;
const FROM_HOST = 0x80;

export type RelayHubV2Direction = "to-host" | "to-client";
const BUFFERED_LOW_THRESHOLD = 1024 * 1024;
const textEncoder = new TextEncoder();

const RELAY_HUB_LINK_ERROR_CODES = ["host_offline", "relay_offline", "busy", "closed", "protocol_error"] as const;
export type RelayHubLinkErrorCode = (typeof RELAY_HUB_LINK_ERROR_CODES)[number];

export class RelayHubLinkError extends Schema.TaggedError<RelayHubLinkError>()("RelayHubLinkError", {
  code: Schema.Literals(RELAY_HUB_LINK_ERROR_CODES),
  message: Schema.String,
}) {}

export function encodeRelayHubV2Plaintexts(
  data: string | ArrayBuffer,
  messageId: number,
  direction: RelayHubV2Direction,
): Uint8Array<ArrayBuffer>[] {
  const flag = direction === "to-client" ? FROM_HOST : 0;
  return encodeTeamV2Payload(data, RELAY_HUB_V2_FRAGMENT_BYTES, messageId).map((fragment) => {
    const bytes = typeof fragment === "string" ? textEncoder.encode(fragment) : new Uint8Array(fragment);
    const plaintext = new Uint8Array(1 + bytes.byteLength);
    plaintext[0] = flag | (typeof fragment === "string" ? PAYLOAD_TEXT : PAYLOAD_BINARY);
    plaintext.set(bytes, 1);
    return plaintext;
  });
}

export function relayHubV2DirectionOf(plaintext: Uint8Array): RelayHubV2Direction {
  return ((plaintext[0] ?? 0) & FROM_HOST) === 0 ? "to-host" : "to-client";
}

export function decodeRelayHubV2Plaintext(
  plaintext: Uint8Array,
): { direction: RelayHubV2Direction; payload: string | ArrayBuffer } | null {
  const head = plaintext[0] ?? 0;
  const type = head & PAYLOAD_TYPE_MASK;
  if ((head & ~(PAYLOAD_TYPE_MASK | FROM_HOST)) !== 0) return null;
  const direction = (head & FROM_HOST) === 0 ? "to-host" : "to-client";
  const body = plaintext.subarray(1);
  if (type === PAYLOAD_BINARY) return { direction, payload: new Uint8Array(body).buffer };
  if (type !== PAYLOAD_TEXT) return null;
  try {
    return { direction, payload: new TextDecoder("utf-8", { fatal: true }).decode(body) };
  } catch {
    return null;
  }
}

class RelayHubChannel implements RemoteTeamChannel {
  readonly bufferedAmountLowThreshold = BUFFERED_LOW_THRESHOLD;
  readonly #link: RelayHubLink;
  readonly #kind: RelayHubKind;
  readonly #pending: Array<string | ArrayBuffer> = [];
  #handlers: RemoteTeamChannelHandlers | null = null;
  #closeReason: Error | null = null;
  #state: RemoteTeamChannelState = "open";
  bufferedAmount = 0;
  readonly #lowListeners = new Set<() => void>();

  constructor(link: RelayHubLink, kind: RelayHubKind) {
    this.#link = link;
    this.#kind = kind;
  }

  get readyState(): RemoteTeamChannelState {
    return this.#state;
  }

  send(data: string | ArrayBuffer): void {
    if (this.#state !== "open") throw new RelayHubLinkError({ code: "closed", message: "The connection is closed." });
    this.#link.send(this, this.#kind, data);
  }

  listen(handlers: RemoteTeamChannelHandlers): void {
    this.#handlers = handlers;
    for (const message of this.#pending.splice(0)) handlers.message(message);
    if (this.#state === "closed") handlers.close(this.#closeReason);
  }

  onBufferedAmountLow(listener: () => void): () => void {
    this.#lowListeners.add(listener);
    return () => this.#lowListeners.delete(listener);
  }

  sent(bytes: number): void {
    this.bufferedAmount = Math.max(0, this.bufferedAmount - bytes);
    if (this.bufferedAmount <= this.bufferedAmountLowThreshold) for (const listener of this.#lowListeners) listener();
  }

  receive(message: string | ArrayBuffer): void {
    if (this.#state === "closed") return;
    if (this.#handlers) this.#handlers.message(message);
    else this.#pending.push(message);
  }

  closed(reason: Error): void {
    if (this.#state === "closed") return;
    this.#state = "closed";
    this.#closeReason = reason;
    this.#handlers?.close(reason);
  }
}

export class RelayHubLink {
  readonly hostKey: string;
  readonly #hub: RelayHubClient;
  readonly #channels: Record<RelayHubKind, RelayHubChannel>;
  readonly #ids = new Set<number>();
  readonly #stop: Array<() => void> = [];
  #nextFragmentId = 0;
  #closed = false;

  constructor(hub: RelayHubClient, hostKey: string) {
    this.#hub = hub;
    this.hostKey = hostKey;
    this.#channels = {
      rpc: new RelayHubChannel(this, "rpc"),
      events: new RelayHubChannel(this, "events"),
      files: new RelayHubChannel(this, "files"),
    };
    this.#stop.push(
      hub.onMessage((message) => this.#receive(message)),
      hub.onUndeliverable((undeliverable) => {
        if (undeliverable.to !== hostKey || !this.#ids.has(undeliverable.id)) return;
        this.close(
          undeliverable.code === "busy"
            ? new RelayHubLinkError({ code: "busy", message: "The relay is busy. Try again soon." })
            : new RelayHubLinkError({ code: "host_offline", message: "The host is offline." }),
        );
      }),
      hub.subscribe((snapshot) => {
        if (snapshot.state.status !== "online")
          this.close(new RelayHubLinkError({ code: "relay_offline", message: "The relay connection dropped." }));
        else if (!snapshot.roster.some((member) => member.keyId === hostKey))
          this.close(new RelayHubLinkError({ code: "host_offline", message: "The host is offline." }));
      }),
    );
  }

  tunnels(): RemoteTeamTunnels {
    return {
      ...this.#channels,
      close: () => this.close(new RelayHubLinkError({ code: "closed", message: "Closed." })),
    };
  }

  send(channel: RelayHubChannel, kind: RelayHubKind, data: string | ArrayBuffer): void {
    this.#nextFragmentId = (this.#nextFragmentId + 1) >>> 0;
    const plaintexts = encodeRelayHubV2Plaintexts(data, this.#nextFragmentId, "to-host");
    for (const plaintext of plaintexts) {
      channel.bufferedAmount += plaintext.byteLength;
      this.#hub.send(this.hostKey, kind, plaintext).then(
        (id) => {
          this.#remember(id);
          channel.sent(plaintext.byteLength);
        },
        (error: unknown) => {
          channel.sent(plaintext.byteLength);
          this.close(
            error instanceof RelayHubSendError && error.code === "offline"
              ? new RelayHubLinkError({ code: "host_offline", message: "The host is offline." })
              : new RelayHubLinkError({ code: "closed", message: "The message could not be sent." }),
          );
        },
      );
    }
  }

  close(reason: Error): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const stop of this.#stop.splice(0)) stop();
    for (const channel of Object.values(this.#channels)) channel.closed(reason);
  }

  #remember(id: number): void {
    this.#ids.add(id);
    if (this.#ids.size > 4096) {
      const oldest = this.#ids.values().next().value;
      if (oldest !== undefined) this.#ids.delete(oldest);
    }
  }

  #receive(message: RelayHubMessage): void {
    if (message.from !== this.hostKey || this.#closed) return;
    const decoded = decodeRelayHubV2Plaintext(message.plaintext);
    if (decoded === null) {
      this.close(new RelayHubLinkError({ code: "protocol_error", message: "The host sent an invalid message." }));
      return;
    }
    if (decoded.direction === "to-client") this.#channels[message.kind].receive(decoded.payload);
  }
}

export interface RelayHubProvider {
  hub(signal: AbortSignal): Promise<RelayHubClient>;
}

export function relayHubTunnelTransport(source: RelayHubClient | RelayHubProvider): RemoteTeamTunnelTransport {
  return {
    async open(_hostId, hostKey, signal) {
      if (signal.aborted) throw new RelayHubLinkError({ code: "closed", message: "The connection was stopped." });
      const hub = source instanceof RelayHubClient ? source : await source.hub(signal);
      if (hub.snapshot().state.status !== "online")
        throw new RelayHubLinkError({ code: "relay_offline", message: "The relay is not connected." });
      if (!hub.member(hostKey)) throw new RelayHubLinkError({ code: "host_offline", message: "The host is offline." });
      const link = new RelayHubLink(hub, hostKey);
      signal.addEventListener(
        "abort",
        () => link.close(new RelayHubLinkError({ code: "closed", message: "Stopped." })),
        {
          once: true,
        },
      );
      return link.tunnels();
    },
  };
}
