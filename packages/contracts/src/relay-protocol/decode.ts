import { isBoolean, isDynamicRecord, isNumber, isOneOf, isString } from "../runtime-values";
import {
  RELAY_HUB_MESSAGE_ID_MAX,
  RELAY_HUB_UNDELIVERABLE_CODES,
  type RelayHubClientMessage,
  type RelayHubMember,
  type RelayHubServerMessage,
} from "./hub";
import {
  RELAY_AUDIENCE_LIMIT,
  RELAY_CAPABILITIES_LIMIT,
  RELAY_CAPABILITY_PATTERN,
  RELAY_CERTIFICATE_PEM_LIMIT,
  RELAY_CHAIN_LIMIT,
  RELAY_CONTROL_MESSAGE_BYTES_LIMIT,
  RELAY_ERROR_CODES,
  RELAY_KEY_ID_PATTERN,
  RELAY_LABEL_LIMIT,
  RELAY_MESSAGE_KEY_PATTERN,
  RELAY_NONCE_PATTERN,
  RELAY_PING_ID_MAX,
  RELAY_PROTOCOL_VERSION,
  RELAY_SIGNATURE_PATTERN,
  RELAY_SUBJECT_NAME_PATTERN,
  RELAY_TEAM_ID_PATTERN,
  RELAY_TEAM_MEMBERS_LIMIT,
  type RelayPeer,
  type RelayTeam,
} from "./messages";

const version = RELAY_PROTOCOL_VERSION;
const LABEL_PATTERN = /^[^\p{Cc}]*$/u;

export function decodeRelayHubServerMessage(value: unknown): RelayHubServerMessage | null {
  if (!isDynamicRecord(value) || value.version !== RELAY_PROTOCOL_VERSION) return null;
  switch (value.type) {
    case "server-proof":
      return isCertificate(value.certificate) && isSignature(value.signature)
        ? { type: "server-proof", version, certificate: value.certificate, signature: value.signature }
        : null;
    case "welcome": {
      const self = decodeMember(value.self);
      const team = decodeTeam(value.team);
      const roster = decodeRoster(value.roster);
      return self && team && roster ? { type: "welcome", version, self, team, roster } : null;
    }
    case "online": {
      const member = decodeMember(value.member);
      return member ? { type: "online", version, member } : null;
    }
    case "offline":
      return isKeyId(value.keyId) ? { type: "offline", version, keyId: value.keyId } : null;
    case "info": {
      if (!isMessageId(value.id)) return null;
      if (value.member === null) return { type: "info", version, id: value.id, member: null };
      const member = decodeMember(value.member);
      return member ? { type: "info", version, id: value.id, member } : null;
    }
    case "undeliverable":
      return isMessageId(value.id) && isKeyId(value.to) && isOneOf(RELAY_HUB_UNDELIVERABLE_CODES, value.code)
        ? { type: "undeliverable", version, id: value.id, to: value.to, code: value.code }
        : null;
    case "pong":
      return isPingId(value.id) ? { type: "pong", version, id: value.id } : null;
    case "error":
      return isOneOf(RELAY_ERROR_CODES, value.code) && isString(value.message)
        ? { type: "error", version, code: value.code, message: value.message.slice(0, 512) }
        : null;
    default:
      return null;
  }
}

export function decodeRelayHubClientMessage(text: string): RelayHubClientMessage | null {
  if (text.length > RELAY_CONTROL_MESSAGE_BYTES_LIMIT) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isDynamicRecord(value) || value.version !== RELAY_PROTOCOL_VERSION) return null;
  switch (value.type) {
    case "hello": {
      const label = decodeLabel(value.label);
      const capabilities = decodeCapabilities(value.capabilities);
      const chain = decodeChain(value.chain);
      if (
        !isString(value.audience) ||
        value.audience.length === 0 ||
        value.audience.length > RELAY_AUDIENCE_LIMIT ||
        !isTimestamp(value.timestamp) ||
        !isString(value.clientNonce) ||
        !RELAY_NONCE_PATTERN.test(value.clientNonce) ||
        label === undefined ||
        !isBoolean(value.hosting) ||
        capabilities === null ||
        !isBoolean(value.suspendable) ||
        !isMessageKey(value.messageKey) ||
        !isSignature(value.messageKeySignature) ||
        !isCertificate(value.certificate) ||
        chain === null ||
        !isSignature(value.signature)
      )
        return null;
      return {
        type: "hello",
        version,
        audience: value.audience,
        timestamp: value.timestamp,
        clientNonce: value.clientNonce,
        label,
        hosting: value.hosting,
        capabilities,
        suspendable: value.suspendable,
        messageKey: value.messageKey,
        messageKeySignature: value.messageKeySignature,
        certificate: value.certificate,
        chain,
        signature: value.signature,
      };
    }
    case "presence": {
      const label = decodeLabel(value.label);
      return isBoolean(value.hosting) && label !== undefined
        ? { type: "presence", version, hosting: value.hosting, label }
        : null;
    }
    case "info":
      return isMessageId(value.id) && isKeyId(value.about)
        ? { type: "info", version, id: value.id, about: value.about }
        : null;
    case "ping":
      return isPingId(value.id) ? { type: "ping", version, id: value.id } : null;
    default:
      return null;
  }
}

export function isRelayPingId(value: unknown): value is number {
  return isPingId(value);
}

function isPingId(value: unknown): value is number {
  return isNumber(value) && Number.isSafeInteger(value) && value >= 1 && value <= RELAY_PING_ID_MAX;
}

function isMessageId(value: unknown): value is number {
  return isNumber(value) && Number.isSafeInteger(value) && value >= 1 && value <= RELAY_HUB_MESSAGE_ID_MAX;
}

function isTimestamp(value: unknown): value is number {
  return isNumber(value) && Number.isSafeInteger(value) && value >= 0;
}

function isKeyId(value: unknown): value is string {
  return isString(value) && RELAY_KEY_ID_PATTERN.test(value);
}

function isMessageKey(value: unknown): value is string {
  return isString(value) && RELAY_MESSAGE_KEY_PATTERN.test(value);
}

function isSignature(value: unknown): value is string {
  return isString(value) && RELAY_SIGNATURE_PATTERN.test(value);
}

function isCertificate(value: unknown): value is string {
  return isString(value) && value.length > 0 && value.length <= RELAY_CERTIFICATE_PEM_LIMIT;
}

function isSubjectName(value: unknown): value is string {
  return isString(value) && RELAY_SUBJECT_NAME_PATTERN.test(value);
}

function decodeLabel(value: unknown): string | null | undefined {
  if (value === null) return null;
  return isString(value) && value.length <= RELAY_LABEL_LIMIT && LABEL_PATTERN.test(value) ? value : undefined;
}

function decodeCapabilities(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > RELAY_CAPABILITIES_LIMIT) return null;
  const capabilities: string[] = [];
  for (const entry of value) {
    if (!isString(entry) || !RELAY_CAPABILITY_PATTERN.test(entry)) return null;
    capabilities.push(entry);
  }
  return capabilities;
}

function decodeChain(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > RELAY_CHAIN_LIMIT) return null;
  const chain: string[] = [];
  for (const entry of value) {
    if (!isCertificate(entry)) return null;
    chain.push(entry);
  }
  return chain;
}

function decodeTeam(value: unknown): RelayTeam | null {
  if (!isDynamicRecord(value)) return null;
  if (!isString(value.id) || !RELAY_TEAM_ID_PATTERN.test(value.id)) return null;
  if (!isSubjectName(value.name)) return null;
  return { id: value.id, name: value.name };
}

function decodePeer(value: unknown): RelayPeer | null {
  if (!isDynamicRecord(value)) return null;
  if (!isKeyId(value.keyId)) return null;
  if (!isSubjectName(value.user)) return null;
  if (value.device !== null && !isSubjectName(value.device)) return null;
  return { keyId: value.keyId, user: value.user, device: value.device };
}

function decodeMember(value: unknown): RelayHubMember | null {
  const peer = decodePeer(value);
  if (!peer || !isDynamicRecord(value)) return null;
  const label = decodeLabel(value.label);
  const capabilities = decodeCapabilities(value.capabilities);
  if (
    label === undefined ||
    !isBoolean(value.hosting) ||
    capabilities === null ||
    !isBoolean(value.suspendable) ||
    !isCertificate(value.certificate) ||
    !isMessageKey(value.messageKey) ||
    !isSignature(value.messageKeySignature) ||
    !isTimestamp(value.keyTimestamp) ||
    !isTimestamp(value.connectedAt) ||
    !isTimestamp(value.lastHeardAt)
  )
    return null;
  return {
    ...peer,
    label,
    hosting: value.hosting,
    capabilities,
    suspendable: value.suspendable,
    certificate: value.certificate,
    messageKey: value.messageKey,
    messageKeySignature: value.messageKeySignature,
    keyTimestamp: value.keyTimestamp,
    connectedAt: value.connectedAt,
    lastHeardAt: value.lastHeardAt,
  };
}

function decodeRoster(value: unknown): RelayHubMember[] | null {
  if (!Array.isArray(value) || value.length > RELAY_TEAM_MEMBERS_LIMIT) return null;
  const roster: RelayHubMember[] = [];
  for (const entry of value) {
    const member = decodeMember(entry);
    if (!member) return null;
    roster.push(member);
  }
  return roster;
}
