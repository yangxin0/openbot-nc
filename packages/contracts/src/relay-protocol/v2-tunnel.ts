import { isDynamicRecord } from "../runtime-values";
import { TEAM_PROTOCOL_V2_MAX_BINARY_FRAME_BYTES } from "../team-protocol/webrtc-framing";

export const RELAY_V2_TUNNEL_VERSION = 2;
export const RELAY_V2_TUNNEL_PREFIX = "OPENBOT-V2:";
export const RELAY_V2_TUNNEL_CHANNELS = ["rpc", "events", "files"] as const;
const RELAY_V2_MARKER = `${RELAY_V2_TUNNEL_PREFIX}${RELAY_V2_TUNNEL_VERSION}\n`;
export const RELAY_V2_FIRST_BYTES_DEADLINE_MS = 10_000;
export const RELAY_V2_CONNECTION_DEADLINE_MS = 15_000;
const RELAY_V2_RECORD_HEADER_BYTES = 5;
const RELAY_V2_RECORD_MAX_BYTES = TEAM_PROTOCOL_V2_MAX_BINARY_FRAME_BYTES;
export const RELAY_V2_CHUNK_HEADER_BYTES = 3;
export const RELAY_V2_CHUNK_MAX_BYTES = 16 * 1024 - RELAY_V2_CHUNK_HEADER_BYTES;
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

type RelayV2TunnelScan =
  | { status: "partial" }
  | { status: "other" }
  | { status: "invalid" }
  | { status: "marker"; length: number };

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
const REFUSAL_MESSAGE_LIMIT = 500;
const textEncoder = new TextEncoder();
const MARKER_BYTES = textEncoder.encode(RELAY_V2_MARKER);

export function encodeRelayV2TunnelMarker(): Uint8Array<ArrayBuffer> {
  return new Uint8Array(MARKER_BYTES);
}

export function scanRelayV2TunnelMarker(bytes: Uint8Array): RelayV2TunnelScan {
  const prefix = Math.min(bytes.byteLength, RELAY_V2_TUNNEL_PREFIX.length);
  for (let index = 0; index < prefix; index += 1) {
    if (bytes[index] !== MARKER_BYTES[index]) return { status: "other" };
  }
  const compared = Math.min(bytes.byteLength, MARKER_BYTES.byteLength);
  for (let index = prefix; index < compared; index += 1) {
    if (bytes[index] !== MARKER_BYTES[index]) return { status: "invalid" };
  }
  return bytes.byteLength < MARKER_BYTES.byteLength
    ? { status: "partial" }
    : { status: "marker", length: MARKER_BYTES.byteLength };
}

export function encodeRelayV2Chunks(channel: RelayV2TunnelChannel, bytes: Uint8Array): Uint8Array<ArrayBuffer>[] {
  const tag = RELAY_V2_TUNNEL_CHANNELS.indexOf(channel);
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += RELAY_V2_CHUNK_MAX_BYTES) {
    const piece = bytes.subarray(offset, Math.min(bytes.byteLength, offset + RELAY_V2_CHUNK_MAX_BYTES));
    const chunk = new Uint8Array(RELAY_V2_CHUNK_HEADER_BYTES + piece.byteLength);
    chunk[0] = tag;
    new DataView(chunk.buffer).setUint16(1, piece.byteLength);
    chunk.set(piece, RELAY_V2_CHUNK_HEADER_BYTES);
    chunks.push(chunk);
  }
  return chunks;
}

export class RelayV2ChunkDecoder {
  #pending: Uint8Array = new Uint8Array(0);
  readonly #records = RELAY_V2_TUNNEL_CHANNELS.map(() => new RelayV2TunnelRecordDecoder());

  push(bytes: Uint8Array): Array<{ channel: RelayV2TunnelChannel; message: RelayV2TunnelMessage }> {
    let buffer = this.#pending.byteLength === 0 ? bytes : concatenated(this.#pending, bytes);
    const messages: Array<{ channel: RelayV2TunnelChannel; message: RelayV2TunnelMessage }> = [];
    while (buffer.byteLength >= RELAY_V2_CHUNK_HEADER_BYTES) {
      const tag = buffer[0] ?? -1;
      const channel = RELAY_V2_TUNNEL_CHANNELS[tag];
      const records = this.#records[tag];
      const length = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).getUint16(1);
      if (!channel || !records || length === 0 || length > RELAY_V2_CHUNK_MAX_BYTES) {
        throw new Error("The relay V2 chunk is invalid.");
      }
      const end = RELAY_V2_CHUNK_HEADER_BYTES + length;
      if (buffer.byteLength < end) break;
      for (const message of records.push(buffer.subarray(RELAY_V2_CHUNK_HEADER_BYTES, end))) {
        messages.push({ channel, message });
      }
      buffer = buffer.subarray(end);
    }
    this.#pending = new Uint8Array(buffer);
    return messages;
  }
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

function concatenated(first: Uint8Array, second: Uint8Array): Uint8Array {
  const joined = new Uint8Array(first.byteLength + second.byteLength);
  joined.set(first);
  joined.set(second, first.byteLength);
  return joined;
}
