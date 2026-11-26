import type { AppTextKey } from "@openbot/i18n";
import {
  createIndexedDbRelayIdentityKeyStore,
  createRelayIdentityFromFile,
  createRelayIdentityFromText,
  loadRelayIdentity,
  type RelayBrowserIdentity,
  type RelayControlSnapshot,
  RelayIdentityError,
  type RelayIdentityKeyStore,
  type RelaySocketErrorCode,
  removeRelayIdentity,
  saveRelayIdentity,
  webRelayCrypto,
} from "@openbot/team-client/relay-client";
import { joinRelayWithCode, relayJoinErrorKey } from "@openbot/team-client/relay-join";

const EXTENSION_ENROLL_LABEL = "Browser extension";

export type IdentitySource = { text: string } | { file: Blob };

export class IdentityImportError extends Error {
  constructor(readonly key: AppTextKey) {
    super(key);
  }
}

export function openIdentityStore(): RelayIdentityKeyStore {
  return createIndexedDbRelayIdentityKeyStore();
}

export async function loadIdentity(store: RelayIdentityKeyStore): Promise<RelayBrowserIdentity | null> {
  try {
    return await loadRelayIdentity(store);
  } catch (error) {
    throw new IdentityImportError(identityErrorKey(error));
  }
}

export async function importIdentity(
  store: RelayIdentityKeyStore,
  source: IdentitySource,
): Promise<RelayBrowserIdentity> {
  try {
    const identity =
      "text" in source
        ? await createRelayIdentityFromText(source.text)
        : await createRelayIdentityFromFile(source.file);
    if (identity.relayUrl === null) throw new IdentityImportError("error.remote.relayUrlMissing");
    await saveRelayIdentity(store, identity);
    return identity;
  } catch (error) {
    throw new IdentityImportError(identityErrorKey(error));
  }
}

export async function joinIdentity(store: RelayIdentityKeyStore, code: string): Promise<RelayBrowserIdentity> {
  try {
    const { identity } = await joinRelayWithCode(code, { crypto: webRelayCrypto, label: EXTENSION_ENROLL_LABEL });
    await saveRelayIdentity(store, identity);
    return identity;
  } catch (error) {
    throw new IdentityImportError(identityErrorKey(error));
  }
}

export async function removeIdentity(store: RelayIdentityKeyStore): Promise<void> {
  try {
    await removeRelayIdentity(store);
  } catch (error) {
    throw new IdentityImportError(identityErrorKey(error));
  }
}

export function identityErrorKey(error: unknown): AppTextKey {
  if (error instanceof IdentityImportError) return error.key;
  const joinKey = relayJoinErrorKey(error);
  if (joinKey) return joinKey;
  if (!(error instanceof RelayIdentityError)) return "extension.identity.error.storage";
  switch (error.code) {
    case "invalid_bundle":
      return "error.remote.relayIdentityInvalid";
    case "unsupported_key":
      return "error.remote.relayIdentityKeyUnsupported";
    case "key_mismatch":
      return "error.remote.relayIdentityKeyMismatch";
    case "untrusted_chain":
      return "error.remote.relayIdentityUntrusted";
    case "expired":
      return "error.remote.relayCertificateExpired";
    case "not_yet_valid":
      return "webClient.identity.error.notYetValid";
    case "storage":
      return "extension.identity.error.storage";
  }
}

const RELAY_STATE_KEYS = {
  certificate_revoked: "error.remote.relayCertificateRevoked",
  certificate_expired: "error.remote.relayCertificateExpired",
  authentication_failed: "error.remote.relayCertificateRefused",
  identity_unavailable: "error.remote.relayIdentityUnusable",
  relay_url_missing: "error.remote.relayUrlMissing",
  insecure_relay_url: "error.remote.relayUrlInsecure",
  server_refused: "error.remote.relayServerRefused",
  replaced: "error.remote.relayReplaced",
  rate_limited: "error.remote.relayRateLimited",
  team_full: "error.remote.relayTeamFull",
  protocol_error: "error.remote.relayProtocol",
  invalid_message: "error.remote.relayProtocol",
  connect_failed: "error.remote.relayUnreachable",
  closed: "error.remote.relayUnreachable",
  deadline_exceeded: "error.remote.relayUnreachable",
  heartbeat_timeout: "error.remote.relayUnreachable",
  target_unavailable: "error.remote.relayUnreachable",
  peer_refused: "error.remote.relayUnreachable",
} as const satisfies Record<RelaySocketErrorCode, AppTextKey>;

export function relayStateKey(code: RelaySocketErrorCode): AppTextKey {
  return RELAY_STATE_KEYS[code];
}

export function relayFinalCode(snapshot: RelayControlSnapshot): RelaySocketErrorCode | null {
  const { state } = snapshot;
  return state.status === "offline" && state.code !== "stopped" && state.retryInMs === null ? state.code : null;
}
