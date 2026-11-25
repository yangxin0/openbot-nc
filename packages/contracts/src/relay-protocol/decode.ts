import { isBoolean, isDynamicRecord, isNumber, isOneOf, isString } from "../runtime-values";
import {
  RELAY_CERTIFICATE_PEM_LIMIT,
  RELAY_CONNECTION_ID_PATTERN,
  RELAY_ERROR_CODES,
  RELAY_KEY_ID_PATTERN,
  RELAY_LABEL_LIMIT,
  RELAY_NONCE_PATTERN,
  RELAY_PROTOCOL_VERSION,
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
      return self && team && members ? { type: "welcome", version, self, team, members } : null;
    }
    case "members": {
      const members = decodeMembers(value.members);
      return members ? { type: "members", version, members } : null;
    }
    case "incoming": {
      const from = decodePeerCertificate(value.from);
      return isConnectionId(value.connectionId) && from
        ? { type: "incoming", version, connectionId: value.connectionId, from }
        : null;
    }
    case "open": {
      const peer = decodePeerCertificate(value.peer);
      return isConnectionId(value.connectionId) && peer
        ? { type: "open", version, connectionId: value.connectionId, peer }
        : null;
    }
    case "waiting":
    case "pause":
    case "resume":
      return { type: value.type, version };
    case "error":
      return isOneOf(RELAY_ERROR_CODES, value.code) && isString(value.message)
        ? { type: "error", version, code: value.code, message: value.message.slice(0, 512) }
        : null;
    default:
      return null;
  }
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
