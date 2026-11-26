import { EventEmitter } from "node:events";
import type { RelayHubKind } from "@openbot/contracts/relay-protocol/hub";
import {
  decodeRelayHubV2Plaintext,
  encodeRelayHubV2Plaintexts,
  type RelayHubV2Direction,
  relayHubV2DirectionOf,
} from "@openbot/team-client/relay-hub-channels";
import { TeamV2PayloadDecoder } from "@openbot/team-client/v2-framing";
import { Effect } from "effect";
import { RemoteWorkflowError } from "../remote-service-effects";
import type { TeamV2Channel, TeamV2ChannelTransport, TeamV2ChannelTransportEvents } from "../team-v2-channel-transport";

interface RelayHubSender {
  send(to: string, kind: RelayHubKind, plaintext: Uint8Array<ArrayBuffer>): Promise<number>;
}

export class RelayHubPeerTransport
  extends EventEmitter<TeamV2ChannelTransportEvents>
  implements TeamV2ChannelTransport
{
  readonly peerId: string;
  readonly #sender: RelayHubSender;
  readonly #direction: RelayHubV2Direction;
  readonly #isOnline: () => boolean;
  readonly #onDisconnect: () => void;
  readonly #sent = new Set<number>();
  readonly #decoders: Record<RelayHubKind, TeamV2PayloadDecoder> = {
    rpc: new TeamV2PayloadDecoder(),
    events: new TeamV2PayloadDecoder(),
    files: new TeamV2PayloadDecoder(),
  };
  #nextFragmentId = 0;

  constructor(
    sender: RelayHubSender,
    peerId: string,
    direction: RelayHubV2Direction,
    isOnline: () => boolean,
    onDisconnect: () => void = () => undefined,
  ) {
    super();
    this.#sender = sender;
    this.peerId = peerId;
    this.#direction = direction;
    this.#isOnline = isOnline;
    this.#onDisconnect = onDisconnect;
  }

  sentMessage(id: number): boolean {
    return this.#sent.has(id);
  }

  send(peerId: string, channel: TeamV2Channel, data: string | ArrayBuffer): Effect.Effect<void, RemoteWorkflowError> {
    return Effect.suspend(() => {
      if (peerId !== this.peerId || !this.#isOnline()) {
        return Effect.fail(new RemoteWorkflowError({ cause: new Error("The relay member is offline.") }));
      }
      this.#nextFragmentId = (this.#nextFragmentId + 1) >>> 0;
      const plaintexts = encodeRelayHubV2Plaintexts(data, this.#nextFragmentId, this.#direction);
      return Effect.tryPromise({
        try: async () => {
          for (const plaintext of plaintexts) this.#remember(await this.#sender.send(this.peerId, channel, plaintext));
        },
        catch: (cause) => new RemoteWorkflowError({ cause }),
      });
    });
  }

  disconnectPeer(peerId: string): Effect.Effect<void, RemoteWorkflowError> {
    return Effect.sync(() => {
      if (peerId === this.peerId) this.#onDisconnect();
    });
  }

  receive(kind: RelayHubKind, plaintext: Uint8Array): boolean {
    const decoded = decodeRelayHubV2Plaintext(plaintext);
    if (!decoded) return false;
    const expected: RelayHubV2Direction = this.#direction === "to-host" ? "to-client" : "to-host";
    if (decoded.direction !== expected) return false;
    let payload: string | ArrayBuffer | undefined;
    try {
      payload = this.#decoders[kind].push(decoded.payload);
    } catch {
      return false;
    }
    if (payload !== undefined) this.emit("data", this.peerId, kind, payload);
    return true;
  }

  disconnected(): void {
    for (const decoder of Object.values(this.#decoders)) decoder.reset();
    this.emit("disconnected", this.peerId);
  }

  #remember(id: number): void {
    this.#sent.add(id);
    if (this.#sent.size <= 4096) return;
    const oldest = this.#sent.values().next().value;
    if (oldest !== undefined) this.#sent.delete(oldest);
  }
}

export function relayHubDirection(plaintext: Uint8Array): RelayHubV2Direction {
  return relayHubV2DirectionOf(plaintext);
}
