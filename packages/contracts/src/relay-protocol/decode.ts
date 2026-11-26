import { isBoolean, isDynamicRecord, isNumber, isOneOf, isString } from "../runtime-values";
import {
  RELAY_CERTIFICATE_PEM_LIMIT,
  RELAY_CONNECTION_ID_PATTERN,
  RELAY_DATA_TICKET_PATTERN,
  RELAY_ERROR_CODES,
  RELAY_FEATURE_PATTERN,
  RELAY_FEATURES_LIMIT,
  RELAY_KEY_ID_PATTERN,
  RELAY_LABEL_LIMIT,
  RELAY_NONCE_PATTERN,
  RELAY_PING_ID_MAX,
  RELAY_PROTOCOL_VERSION,
  RELAY_SESSION_FAILURE_CODES,
  RELAY_SESSION_FIRST_PATTERN,
  RELAY_SESSION_ID_MAX,
  RELAY_SESSION_WINDOW_BYTES,
  RELAY_SIGNATURE_PATTERN,
  RELAY_SUBJECT_NAME_PATTERN,
  RELAY_TEAM_ID_PATTERN,
  RELAY_TEAM_MEMBERS_LIMIT,
  type RelayPeer,
  type RelayPeerCertificate,
  type RelayServerMessage,
  type RelayTeam,
  type RelayTeamMember,
} from "./messages";

export function decodeRelayServerMessage(value: unknown): RelayServerMessage | null {
  if (!isDynamicRecord(value) || value.version !== RELAY_PROTOCOL_VERSION) return null;
  const version = RELAY_PROTOCOL_VERSION;
  switch (value.type) {
    case "challenge":
      return isString(value.nonce) && RELAY_NONCE_PATTERN.test(value.nonce)
        ? { type: "challenge", version, nonce: value.nonce }
        : null;
    case "server-proof":
      return isCertificate(value.certificate) &&
        isString(value.signature) &&
        RELAY_SIGNATURE_PATTERN.test(value.signature)
        ? { type: "server-proof", version, certificate: value.certificate, signature: value.signature }
        : null;
    case "welcome": {
      const self = decodePeer(value.self);
      const team = decodeTeam(value.team);
      const members = decodeMembers(value.members);
      const features = decodeFeatures(value.features);
      return self && team && members && features ? { type: "welcome", version, self, team, members, features } : null;
    }
    case "members": {
      const members = decodeMembers(value.members);
      return members ? { type: "members", version, members } : null;
    }
    case "pong":
      return isRelayPingId(value.id) ? { type: "pong", version, id: value.id } : null;
    case "data-ticket":
      return isString(value.ticket) && RELAY_DATA_TICKET_PATTERN.test(value.ticket)
        ? { type: "data-ticket", version, ticket: value.ticket }
        : null;
    case "data-wanted":
      return { type: "data-wanted", version };
    case "session-incoming": {
      const from = decodePeerCertificate(value.from);
      const first = decodeFirst(value.first);
      return isRelaySessionId(value.session) && isConnectionId(value.connectionId) && from && first !== null
        ? {
            type: "session-incoming",
            version,
            session: value.session,
            connectionId: value.connectionId,
            from,
            ...(first === undefined ? {} : { first }),
          }
        : null;
    }
    case "session-opened": {
      const peer = decodePeerCertificate(value.peer);
      const first = decodeFirst(value.first);
      return isRelaySessionId(value.session) && isConnectionId(value.connectionId) && peer && first !== null
        ? {
            type: "session-opened",
            version,
            session: value.session,
            connectionId: value.connectionId,
            peer,
            ...(first === undefined ? {} : { first }),
          }
        : null;
    }
    case "session-failed":
      return isRelaySessionId(value.session) && isOneOf(RELAY_SESSION_FAILURE_CODES, value.code)
        ? { type: "session-failed", version, session: value.session, code: value.code }
        : null;
    case "session-close":
      return isRelaySessionId(value.session) ? { type: "session-close", version, session: value.session } : null;
    case "session-credit":
      return isRelaySessionId(value.session) && isCreditBytes(value.bytes)
        ? { type: "session-credit", version, session: value.session, bytes: value.bytes }
        : null;
    case "error":
      return isOneOf(RELAY_ERROR_CODES, value.code) && isString(value.message)
        ? { type: "error", version, code: value.code, message: value.message.slice(0, 512) }
        : null;
    default:
      return null;
  }
}

export function isRelaySessionId(value: unknown): value is number {
  return isNumber(value) && Number.isSafeInteger(value) && value >= 1 && value <= RELAY_SESSION_ID_MAX;
}

export function isRelayPingId(value: unknown): value is number {
  return isNumber(value) && Number.isSafeInteger(value) && value >= 1 && value <= RELAY_PING_ID_MAX;
}

function isCreditBytes(value: unknown): value is number {
  return isNumber(value) && Number.isSafeInteger(value) && value >= 1 && value <= RELAY_SESSION_WINDOW_BYTES;
}

function decodeFirst(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  return isString(value) && RELAY_SESSION_FIRST_PATTERN.test(value) ? value : null;
}

function decodeFeatures(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > RELAY_FEATURES_LIMIT) return null;
  const features: string[] = [];
  for (const entry of value) {
    if (!isString(entry) || !RELAY_FEATURE_PATTERN.test(entry)) return null;
    features.push(entry);
  }
  return features;
}

function isCertificate(value: unknown): value is string {
  return isString(value) && value.length > 0 && value.length <= RELAY_CERTIFICATE_PEM_LIMIT;
}

function isConnectionId(value: unknown): value is string {
  return isString(value) && RELAY_CONNECTION_ID_PATTERN.test(value);
}

function isSubjectName(value: unknown): value is string {
  return isString(value) && RELAY_SUBJECT_NAME_PATTERN.test(value);
}

function decodeTeam(value: unknown): RelayTeam | null {
  if (!isDynamicRecord(value)) return null;
  if (!isString(value.id) || !RELAY_TEAM_ID_PATTERN.test(value.id)) return null;
  if (!isSubjectName(value.name)) return null;
  return { id: value.id, name: value.name };
}

function decodePeer(value: unknown): RelayPeer | null {
  if (!isDynamicRecord(value)) return null;
  if (!isString(value.keyId) || !RELAY_KEY_ID_PATTERN.test(value.keyId)) return null;
  if (!isSubjectName(value.user)) return null;
  if (value.device !== null && !isSubjectName(value.device)) return null;
  return { keyId: value.keyId, user: value.user, device: value.device };
}

function decodePeerCertificate(value: unknown): RelayPeerCertificate | null {
  const peer = decodePeer(value);
  if (!peer || !isDynamicRecord(value)) return null;
  if (!isCertificate(value.certificate)) return null;
  return { ...peer, certificate: value.certificate };
}

function decodeMembers(value: unknown): RelayTeamMember[] | null {
  if (!Array.isArray(value) || value.length > RELAY_TEAM_MEMBERS_LIMIT) return null;
  const members: RelayTeamMember[] = [];
  for (const entry of value) {
    const peer = decodePeer(entry);
    if (!peer || !isDynamicRecord(entry)) return null;
    const label = entry.label;
    if (label !== null && (!isString(label) || label.length > RELAY_LABEL_LIMIT)) return null;
    if (!isBoolean(entry.hosting)) return null;
    if (!isNumber(entry.connectedAt) || !Number.isSafeInteger(entry.connectedAt) || entry.connectedAt < 0) return null;
    members.push({ ...peer, label, hosting: entry.hosting, connectedAt: entry.connectedAt });
  }
  return members;
}
