import type { Effect } from "effect";
import type { RemoteWorkflowError } from "./remote-service-effects";

export type TeamV2Channel = "rpc" | "events" | "files" | "desktop";

export interface TeamV2ChannelBinding {
  localFingerprint: string;
  remoteFingerprint: string;
}

export interface TeamV2ChannelTransportEvents {
  connected: [peerId: string, binding?: TeamV2ChannelBinding];
  disconnected: [peerId: string];
  pathLost: [peerId: string];
  pathRestored: [peerId: string];
  data: [peerId: string, channel: TeamV2Channel, data: string | ArrayBuffer];
}

type Listener<Event extends keyof TeamV2ChannelTransportEvents> = (
  ...args: TeamV2ChannelTransportEvents[Event]
) => void;

export interface TeamV2ChannelTransport {
  on(event: "connected", listener: Listener<"connected">): unknown;
  on(event: "disconnected", listener: Listener<"disconnected">): unknown;
  on(event: "pathLost", listener: Listener<"pathLost">): unknown;
  on(event: "pathRestored", listener: Listener<"pathRestored">): unknown;
  on(event: "data", listener: Listener<"data">): unknown;
  off(event: "connected", listener: Listener<"connected">): unknown;
  off(event: "disconnected", listener: Listener<"disconnected">): unknown;
  off(event: "pathLost", listener: Listener<"pathLost">): unknown;
  off(event: "pathRestored", listener: Listener<"pathRestored">): unknown;
  off(event: "data", listener: Listener<"data">): unknown;
  send(peerId: string, channel: TeamV2Channel, data: string | ArrayBuffer): Effect.Effect<void, RemoteWorkflowError>;
  disconnectPeer(peerId: string): Effect.Effect<void, RemoteWorkflowError>;
}
