import {
  RELAY_CONNECTION_CODES,
  RELAY_HOSTING_STATUSES,
  type RelayConnectionState,
  type RelayHostingState,
  type RelayIdentitySummary,
  type RelayImportResult,
  type RelayMemberSummary,
  type RelayState,
} from "@openbot/contracts/ipc";
import {
  decodeList,
  decodeRecord,
  nullableNumber,
  nullableString,
  requiredBoolean,
  requiredNumber,
  requiredString,
} from "@openbot/contracts/ipc-decoding";
import { parseRelayJoinCode } from "@openbot/contracts/relay-protocol/enrollment";
import { type DynamicRecord, isOneOf, isString } from "@openbot/contracts/runtime-values";

function identity(value: unknown): RelayIdentitySummary | null {
  if (value === null) return null;
  const record = decodeRecord(value, "Relay identity");
  return {
    team: requiredString(record, "team"),
    user: requiredString(record, "user"),
    device: nullableString(record, "device"),
    keyId: requiredString(record, "keyId"),
    relayUrl: nullableString(record, "relayUrl"),
    expiresAt: requiredNumber(record, "expiresAt"),
  };
}

function connection(value: unknown): RelayConnectionState {
  const record = decodeRecord(value, "Relay connection");
  if (record.status === "connecting" || record.status === "online") return { status: record.status };
  if (record.status !== "offline") throw new Error("Invalid relay connection status.");
  if (!isOneOf(RELAY_CONNECTION_CODES, record.code)) throw new Error("Invalid relay connection code.");
  return {
    status: "offline",
    code: record.code,
    message: nullableString(record, "message"),
    retryInMs: nullableNumber(record, "retryInMs"),
  };
}

function member(record: DynamicRecord): RelayMemberSummary {
  return {
    keyId: requiredString(record, "keyId"),
    user: requiredString(record, "user"),
    device: nullableString(record, "device"),
    label: nullableString(record, "label"),
    hosting: requiredBoolean(record, "hosting"),
    self: requiredBoolean(record, "self"),
    serverId: nullableString(record, "serverId"),
    hidden: requiredBoolean(record, "hidden"),
  };
}

function hostingState(value: unknown): RelayHostingState {
  const record = decodeRecord(value, "Relay hosting state");
  if (!isOneOf(RELAY_HOSTING_STATUSES, record.status)) throw new Error("Invalid relay hosting status.");
  return { status: record.status, message: nullableString(record, "message") };
}

export function decodeRelayState(value: unknown): RelayState {
  const record = decodeRecord(value, "Relay state");
  return {
    identity: identity(record.identity),
    identityIssue: nullableString(record, "identityIssue"),
    control: connection(record.control),
    members: decodeList(record.members, "Relay member", member),
    hosting: requiredBoolean(record, "hosting"),
    hostingState: hostingState(record.hostingState),
  };
}

export function decodeRelayImportResult(value: unknown): RelayImportResult {
  const record = decodeRecord(value, "Relay import result");
  if (record.status === "canceled") return { status: "canceled" };
  if (record.status !== "imported") throw new Error("Invalid relay import result.");
  return { status: "imported", state: decodeRelayState(record.state) };
}

export function decodeRelayJoinCodeLink(value: unknown): string | null {
  return isString(value) && parseRelayJoinCode(value) !== null ? value.trim() : null;
}
