import type { RelayErrorCode, RelayPeer, RelayProtocolVersion, RelayTeam } from "./messages";

export const RELAY_HUB_KINDS = { rpc: 1, events: 2, files: 3 } as const;
export type RelayHubKind = keyof typeof RELAY_HUB_KINDS;
export const RELAY_HUB_BULK_KIND: RelayHubKind = "files";

export const RELAY_HUB_FRAME_TYPES = { send: 1, deliver: 2 } as const;
export const RELAY_HUB_KEY_ID_BYTES = 32;
export const RELAY_HUB_FRAME_HEADER_BYTES = 6 + RELAY_HUB_KEY_ID_BYTES;
export const RELAY_HUB_PLAINTEXT_LIMIT = 1 + 64 * 1024;
export const RELAY_HUB_SEAL_OVERHEAD_BYTES = 8 + 16;
export const RELAY_HUB_PAYLOAD_LIMIT = RELAY_HUB_PLAINTEXT_LIMIT + RELAY_HUB_SEAL_OVERHEAD_BYTES;
export const RELAY_SOCKET_MESSAGE_BYTES_LIMIT = RELAY_HUB_FRAME_HEADER_BYTES + RELAY_HUB_PAYLOAD_LIMIT;
export const RELAY_HUB_MESSAGE_ID_MAX = 0xffff_ffff;

export const RELAY_HUB_IDLE_PING_MS = 10_000;
export const RELAY_HUB_PING_ANSWER_MS = 3_000;

export const RELAY_HUB_UNDELIVERABLE_CODES = ["offline", "not_member", "busy"] as const;
export type RelayHubUndeliverableCode = (typeof RELAY_HUB_UNDELIVERABLE_CODES)[number];

const HELLO_CONTEXT = "openbot-relay-hello-v2";
const SERVER_PROOF_CONTEXT = "openbot-relay-server-proof-v2";
export const RELAY_MESSAGE_KEY_CONTEXT = "openbot-relay-message-key-v1";

const textEncoder = new TextEncoder();

export interface RelayHubRecord {
  label: string | null;
  hosting: boolean;
  capabilities: string[];
  suspendable: boolean;
}

export interface RelayHubMember extends RelayPeer, RelayHubRecord {
  certificate: string;
  messageKey: string;
  messageKeySignature: string;
  keyTimestamp: number;
  connectedAt: number;
  lastHeardAt: number;
}

export interface RelayHubHello extends RelayHubRecord {
  type: "hello";
  version: RelayProtocolVersion;
  audience: string;
  timestamp: number;
  clientNonce: string;
  messageKey: string;
  messageKeySignature: string;
  certificate: string;
  chain: string[];
  signature: string;
}

export type RelayHubClientMessage =
  | RelayHubHello
  | { type: "presence"; version: RelayProtocolVersion; hosting: boolean; label: string | null }
  | { type: "info"; version: RelayProtocolVersion; id: number; about: string }
  | { type: "ping"; version: RelayProtocolVersion; id: number };

export type RelayHubServerMessage =
  | { type: "server-proof"; version: RelayProtocolVersion; certificate: string; signature: string }
  | { type: "welcome"; version: RelayProtocolVersion; self: RelayHubMember; team: RelayTeam; roster: RelayHubMember[] }
  | { type: "online"; version: RelayProtocolVersion; member: RelayHubMember }
  | { type: "offline"; version: RelayProtocolVersion; keyId: string }
  | { type: "info"; version: RelayProtocolVersion; id: number; member: RelayHubMember | null }
  | { type: "undeliverable"; version: RelayProtocolVersion; id: number; to: string; code: RelayHubUndeliverableCode }
  | { type: "pong"; version: RelayProtocolVersion; id: number }
  | { type: "error"; version: RelayProtocolVersion; code: RelayErrorCode; message: string };

export interface RelayHubFrame {
  type: "send" | "deliver";
  kind: RelayHubKind;
  id: number;
  peer: string;
  payload: Uint8Array<ArrayBuffer>;
}

export function relayHelloTranscript(hello: Omit<RelayHubHello, "type" | "certificate" | "chain" | "signature">) {
  return textEncoder.encode(
    JSON.stringify([
      HELLO_CONTEXT,
      hello.version,
      hello.audience,
      hello.timestamp,
      hello.clientNonce,
      hello.label ?? "",
      hello.hosting,
      hello.capabilities,
      hello.suspendable,
      hello.messageKey,
      hello.messageKeySignature,
    ]),
  );
}

export interface RelayServerProofTranscriptInput {
  clientNonce: string;
  audience: string;
  clientKeyId: string;
}

export function relayServerProofTranscript(input: RelayServerProofTranscriptInput): string {
  return JSON.stringify([SERVER_PROOF_CONTEXT, input.clientNonce, input.audience, input.clientKeyId]);
}

export function relayMessageKeyTranscript(input: {
  keyId: string;
  messageKey: Uint8Array;
  timestamp: number;
}): Uint8Array<ArrayBuffer> {
  return relayLengthPrefixed([
    textEncoder.encode(RELAY_MESSAGE_KEY_CONTEXT),
    textEncoder.encode(input.keyId),
    input.messageKey,
    relayUint64(input.timestamp),
  ]);
}

export function relayLengthPrefixed(items: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const sequence = new Uint8Array(items.reduce((total, item) => total + 4 + item.byteLength, 0));
  const view = new DataView(sequence.buffer);
  let offset = 0;
  for (const item of items) {
    view.setUint32(offset, item.byteLength);
    sequence.set(item, offset + 4);
    offset += 4 + item.byteLength;
  }
  return sequence;
}

export function relayUint64(value: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, Math.floor(value / 2 ** 32));
  view.setUint32(4, value >>> 0);
  return bytes;
}

export function relayHubKindCode(kind: RelayHubKind): number {
  return RELAY_HUB_KINDS[kind];
}

export function relayHubKindOf(code: number): RelayHubKind | null {
  if (code === RELAY_HUB_KINDS.rpc) return "rpc";
  if (code === RELAY_HUB_KINDS.events) return "events";
  if (code === RELAY_HUB_KINDS.files) return "files";
  return null;
}

export function encodeRelayHubFrame(frame: RelayHubFrame): Uint8Array<ArrayBuffer> | null {
  const key = relayKeyIdBytes(frame.peer);
  if (!key || frame.payload.byteLength > RELAY_HUB_PAYLOAD_LIMIT || !isMessageId(frame.id)) return null;
  const bytes = new Uint8Array(RELAY_HUB_FRAME_HEADER_BYTES + frame.payload.byteLength);
  bytes[0] = RELAY_HUB_FRAME_TYPES[frame.type];
  bytes[1] = RELAY_HUB_KINDS[frame.kind];
  new DataView(bytes.buffer).setUint32(2, frame.id);
  bytes.set(key, 6);
  bytes.set(frame.payload, RELAY_HUB_FRAME_HEADER_BYTES);
  return bytes;
}

export function decodeRelayHubFrame(bytes: Uint8Array): RelayHubFrame | null {
  if (bytes.byteLength < RELAY_HUB_FRAME_HEADER_BYTES || bytes.byteLength > RELAY_SOCKET_MESSAGE_BYTES_LIMIT)
    return null;
  const type =
    bytes[0] === RELAY_HUB_FRAME_TYPES.send ? "send" : bytes[0] === RELAY_HUB_FRAME_TYPES.deliver ? "deliver" : null;
  const kind = relayHubKindOf(bytes[1] ?? 0);
  if (type === null || kind === null) return null;
  const id = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(2);
  return {
    type,
    kind,
    id,
    peer: relayKeyIdText(bytes.subarray(6, RELAY_HUB_FRAME_HEADER_BYTES)),
    payload: new Uint8Array(bytes.subarray(RELAY_HUB_FRAME_HEADER_BYTES)),
  };
}

export function relayKeyIdBytes(keyId: string): Uint8Array<ArrayBuffer> | null {
  const bytes = relayBase64UrlBytes(keyId);
  return bytes && bytes.byteLength === RELAY_HUB_KEY_ID_BYTES ? bytes : null;
}

export function relayKeyIdText(bytes: Uint8Array): string {
  return relayBase64UrlText(bytes);
}

export function relayBase64UrlText(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function relayBase64UrlBytes(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/u.test(text) || text.length % 4 === 1) return null;
  const padding = "=".repeat((4 - (text.length % 4)) % 4);
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/") + padding);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return relayBase64UrlText(bytes) === text ? bytes : null;
}

function isMessageId(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1 && value <= RELAY_HUB_MESSAGE_ID_MAX;
}
