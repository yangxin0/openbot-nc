import { decodeRelayHubClientMessage } from "@openbot/contracts/relay-protocol/decode";
import type { RelayHubClientMessage, RelayHubServerMessage } from "@openbot/contracts/relay-protocol/hub";

export type DecodedRelayClientMessage = RelayHubClientMessage;

export function decodeRelayClientMessage(text: string): DecodedRelayClientMessage | null {
  return decodeRelayHubClientMessage(text);
}

export function encodeRelayServerMessage(message: RelayHubServerMessage): string {
  return JSON.stringify(message);
}
