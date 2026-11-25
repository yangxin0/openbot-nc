import type { Effect } from "effect";
import type { RemoteWorkflowError } from "./remote-service-effects";

export type TeamV2Channel = "rpc" | "events" | "files";

export interface TeamV2ChannelTransportEvents {
  disconnected: [peerId: string];
  data: [peerId: string, channel: TeamV2Channel, data: string | ArrayBuffer];
}

type Listener<Event extends keyof TeamV2ChannelTransportEvents> = (
  ...args: TeamV2ChannelTransportEvents[Event]
) => void;

export interface TeamV2ChannelTransport {
  on(event: "disconnected", listener: Listener<"disconnected">): unknown;
  on(event: "data", listener: Listener<"data">): unknown;
  off(event: "disconnected", listener: Listener<"disconnected">): unknown;
  off(event: "data", listener: Listener<"data">): unknown;
  send(peerId: string, channel: TeamV2Channel, data: string | ArrayBuffer): Effect.Effect<void, RemoteWorkflowError>;
  disconnectPeer(peerId: string): Effect.Effect<void, RemoteWorkflowError>;
}
