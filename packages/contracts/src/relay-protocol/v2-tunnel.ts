import { isDynamicRecord } from "../runtime-values";
import { TEAM_PROTOCOL_V2_MAX_BINARY_FRAME_BYTES } from "../team-protocol/webrtc-framing";

export const RELAY_V2_TUNNEL_VERSION = 1;
export const RELAY_V2_TUNNEL_PREFIX = "OPENBOT-V2:";
export const RELAY_V2_TUNNEL_CHANNELS = ["rpc", "events", "files"] as const;
const RELAY_V2_CONNECTION_KEY_PATTERN = /^[0-9a-f]{32}$/u;
const RELAY_V2_MARKER_MAX_BYTES = 64;
export const RELAY_V2_FIRST_BYTES_DEADLINE_MS = 10_000;
export const RELAY_V2_CONNECTION_DEADLINE_MS = 15_000;
const RELAY_V2_RECORD_HEADER_BYTES = 5;
const RELAY_V2_RECORD_MAX_BYTES = TEAM_PROTOCOL_V2_MAX_BINARY_FRAME_BYTES;
export const RELAY_V2_REFUSAL_CODES = [
  "sign_in_refused",
  "different_peer",
  "duplicate_channel",
  "connection_incomplete",
  "too_many_connections",
  "host_unavailable",
  "session_revoked",
] as const;

export type RelayV2TunnelChannel = (typeof RELAY_V2_TUNNEL_CHANNELS)[number];
export type RelayV2RefusalCode = (typeof RELAY_V2_REFUSAL_CODES)[number];
export type RelayV2TunnelMessage = string | ArrayBuffer;

export interface RelayV2TunnelMarker {
  version: typeof RELAY_V2_TUNNEL_VERSION;
  channel: RelayV2TunnelChannel;
  connectionKey: string;
}

type RelayV2TunnelScan =
  | { status: "partial" }
  | { status: "other" }
  | { status: "invalid" }
  | { status: "marker"; marker: RelayV2TunnelMarker; length: number };

export type RelayV2TunnelControl =
  | { type: "relay-v2-ready"; version: typeof RELAY_V2_TUNNEL_VERSION }
  | {
      type: "relay-v2-refused";
      version: typeof RELAY_V2_TUNNEL_VERSION;
      code: RelayV2RefusalCode;
      message: string | null;
    };

const RECORD_TEXT = 1;
const RECORD_BINARY = 2;
const LINE_END = 0x0a;
const REFUSAL_MESSAGE_LIMIT = 500;
const MARKER_PATTERN = /^OPENBOT-V2:(\d{1,3}):([a-z]{1,16}):([0-9a-f]{32})$/u;
const textEncoder = new TextEncoder();
const PREFIX_BYTES = textEncoder.encode(RELAY_V2_TUNNEL_PREFIX);

export function encodeRelayV2TunnelMarker(marker: RelayV2TunnelMarker): Uint8Array {
  if (!relayV2TunnelChannel(marker.channel) || !RELAY_V2_CONNECTION_KEY_PATTERN.test(marker.connectionKey)) {
    throw new Error("The relay V2 tunnel marker is invalid.");
  }
  return textEncoder.encode(`${RELAY_V2_TUNNEL_PREFIX}${marker.version}:${marker.channel}:${marker.connectionKey}\n`);
}

export function scanRelayV2TunnelMarker(bytes: Uint8Array): RelayV2TunnelScan {
  const compared = Math.min(bytes.byteLength, PREFIX_BYTES.byteLength);
  for (let index = 0; index < compared; index += 1) {
    if (bytes[index] !== PREFIX_BYTES[index]) return { status: "other" };
  }
  if (bytes.byteLength < PREFIX_BYTES.byteLength) return { status: "partial" };
  const end = bytes.subarray(0, RELAY_V2_MARKER_MAX_BYTES).indexOf(LINE_END);
  if (end < 0) return bytes.byteLength >= RELAY_V2_MARKER_MAX_BYTES ? { status: "invalid" } : { status: "partial" };
  const match = MARKER_PATTERN.exec(String.fromCharCode(...bytes.subarray(0, end)));
  const channel = relayV2TunnelChannel(match?.[2]);
  const connectionKey = match?.[3];
  if (!match || Number(match[1]) !== RELAY_V2_TUNNEL_VERSION || !channel || connectionKey === undefined) {
    return { status: "invalid" };
  }
  return { status: "marker", marker: { version: RELAY_V2_TUNNEL_VERSION, channel, connectionKey }, length: end + 1 };
}

export function encodeRelayV2TunnelRecord(message: RelayV2TunnelMessage): Uint8Array {
  const text = typeof message === "string";
  const payload = text ? textEncoder.encode(message) : new Uint8Array(message);
  if (payload.byteLength > RELAY_V2_RECORD_MAX_BYTES) throw new Error("The relay V2 tunnel record is too large.");
  const record = new Uint8Array(RELAY_V2_RECORD_HEADER_BYTES + payload.byteLength);
  record[0] = text ? RECORD_TEXT : RECORD_BINARY;
  new DataView(record.buffer).setUint32(1, payload.byteLength);
  record.set(payload, RELAY_V2_RECORD_HEADER_BYTES);
  return record;
}

export class RelayV2TunnelRecordDecoder {
  #pending: Uint8Array = new Uint8Array(0);

  push(bytes: Uint8Array): RelayV2TunnelMessage[] {
    let buffer = this.#pending.byteLength === 0 ? bytes : concatenated(this.#pending, bytes);
    const messages: RelayV2TunnelMessage[] = [];
    while (buffer.byteLength >= RELAY_V2_RECORD_HEADER_BYTES) {
      const type = buffer[0];
      const length = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).getUint32(1);
      if ((type !== RECORD_TEXT && type !== RECORD_BINARY) || length > RELAY_V2_RECORD_MAX_BYTES) {
        throw new Error("The relay V2 tunnel record is invalid.");
      }
      const end = RELAY_V2_RECORD_HEADER_BYTES + length;
      if (buffer.byteLength < end) break;
      const payload = new Uint8Array(buffer.subarray(RELAY_V2_RECORD_HEADER_BYTES, end));
      messages.push(type === RECORD_TEXT ? new TextDecoder("utf-8", { fatal: true }).decode(payload) : payload.buffer);
      buffer = buffer.subarray(end);
    }
    this.#pending = new Uint8Array(buffer);
    return messages;
  }
}

export function encodeRelayV2TunnelControl(control: RelayV2TunnelControl): string {
  return JSON.stringify(control);
}

export function decodeRelayV2TunnelControl(text: string): RelayV2TunnelControl | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isDynamicRecord(value) || value.version !== RELAY_V2_TUNNEL_VERSION) return null;
  if (value.type === "relay-v2-ready") return { type: "relay-v2-ready", version: RELAY_V2_TUNNEL_VERSION };
  if (value.type !== "relay-v2-refused") return null;
  const code = RELAY_V2_REFUSAL_CODES.find((candidate) => candidate === value.code);
  const message = value.message;
  if (!code || (message !== null && (typeof message !== "string" || message.length > REFUSAL_MESSAGE_LIMIT))) {
    return null;
  }
  return { type: "relay-v2-refused", version: RELAY_V2_TUNNEL_VERSION, code, message };
}

function relayV2TunnelChannel(value: unknown): RelayV2TunnelChannel | undefined {
  return RELAY_V2_TUNNEL_CHANNELS.find((channel) => channel === value);
}

function concatenated(first: Uint8Array, second: Uint8Array): Uint8Array {
  const joined = new Uint8Array(first.byteLength + second.byteLength);
  joined.set(first);
  joined.set(second, first.byteLength);
  return joined;
}
