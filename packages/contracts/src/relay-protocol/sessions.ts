import {
  RELAY_SESSION_ASSIGNED_ID_MIN,
  RELAY_SESSION_FRAME_HEADER_BYTES,
  RELAY_SESSION_FRAME_PAYLOAD_LIMIT,
  RELAY_SESSION_ID_MAX,
  RELAY_SESSION_OPENER_ID_MAX,
} from "./messages";

export const RELAY_SESSION_FRAME_VERSION = 1;
export const RELAY_SESSION_FRAME_KINDS = { data: 1, end: 2 } as const;

export interface RelaySessionFrame {
  session: number;
  kind: "data" | "end";
  payload: Uint8Array;
}

export function encodeRelaySessionFrame(session: number, payload: Uint8Array): Uint8Array<ArrayBuffer> {
  const frame = new Uint8Array(RELAY_SESSION_FRAME_HEADER_BYTES + payload.byteLength);
  frame[0] = RELAY_SESSION_FRAME_VERSION;
  frame[1] = RELAY_SESSION_FRAME_KINDS.data;
  new DataView(frame.buffer).setUint32(2, session);
  frame.set(payload, RELAY_SESSION_FRAME_HEADER_BYTES);
  return frame;
}

export function encodeRelaySessionEnd(session: number): Uint8Array<ArrayBuffer> {
  const frame = new Uint8Array(RELAY_SESSION_FRAME_HEADER_BYTES);
  frame[0] = RELAY_SESSION_FRAME_VERSION;
  frame[1] = RELAY_SESSION_FRAME_KINDS.end;
  new DataView(frame.buffer).setUint32(2, session);
  return frame;
}

export function decodeRelaySessionFrame(bytes: Uint8Array): RelaySessionFrame | null {
  if (bytes.byteLength < RELAY_SESSION_FRAME_HEADER_BYTES) return null;
  if (bytes.byteLength > RELAY_SESSION_FRAME_HEADER_BYTES + RELAY_SESSION_FRAME_PAYLOAD_LIMIT) return null;
  if (bytes[0] !== RELAY_SESSION_FRAME_VERSION) return null;
  const session = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(2);
  if (session < 1) return null;
  const payload = bytes.subarray(RELAY_SESSION_FRAME_HEADER_BYTES);
  if (bytes[1] === RELAY_SESSION_FRAME_KINDS.data && payload.byteLength > 0) return { session, kind: "data", payload };
  if (bytes[1] === RELAY_SESSION_FRAME_KINDS.end && payload.byteLength === 0) return { session, kind: "end", payload };
  return null;
}

export function rewriteRelaySessionFrame(bytes: Uint8Array, session: number): Uint8Array<ArrayBuffer> {
  const frame = new Uint8Array(bytes);
  new DataView(frame.buffer).setUint32(2, session);
  return frame;
}

export function isRelayOpenerSessionId(session: number): boolean {
  return Number.isSafeInteger(session) && session >= 1 && session <= RELAY_SESSION_OPENER_ID_MAX;
}

export function isRelayAssignedSessionId(session: number): boolean {
  return Number.isSafeInteger(session) && session >= RELAY_SESSION_ASSIGNED_ID_MIN && session <= RELAY_SESSION_ID_MAX;
}
