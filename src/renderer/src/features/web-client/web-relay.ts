import { RELAY_PATH } from "@openbot/contracts/relay-protocol/messages";
import { isBoolean, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import type { AppTextKey } from "@openbot/i18n";
import type { SourceMessages } from "@openbot/i18n/source";
import {
  createIndexedDbRelayIdentityKeyStore,
  createRelayIdentityFromFile,
  createRelayIdentityFromText,
  createRelayTeamPeer,
  loadRelayIdentity,
  type RelayBrowserIdentity,
  type RelayControlSnapshot,
  RelayIdentityError,
  type RelayIdentityKeyStore,
  RelaySocketError,
  type RelaySocketErrorCode,
  type RelayTeamPeerActions,
  type RelayTeamPeerOptions,
  removeRelayIdentity,
  saveRelayIdentity,
  startRelayControl,
  webRelayCrypto,
} from "@openbot/team-client/relay-client";
import { joinRelayWithCode, relayJoinErrorKey } from "@openbot/team-client/relay-join";

export type WebPeerActions = { current: RelayTeamPeerActions };
export type WebPeer = ReturnType<typeof createRelayTeamPeer>;
export type WebPeerFactory = (actions: WebPeerActions, options: RelayTeamPeerOptions) => WebPeer;

export interface WebRelayIdentity {
  keyId: string;
  team: string;
  user: string;
  device: string | null;
  relayUrl: string | null;
  startsAt: number;
  expiresAt: number;
}

export interface WebRelaySource {
  snapshot(): RelayControlSnapshot;
  subscribe(listener: (snapshot: RelayControlSnapshot) => void): () => void;
}

export interface WebRelayConnection {
  identity: WebRelayIdentity;
  source: WebRelaySource;
  createPeer: WebPeerFactory;
}

export interface WebRelayRun extends WebRelayConnection {
  stop(): void;
}

export class WebIdentityImportError extends Error {
  constructor(readonly key: AppTextKey) {
    super(key);
  }
}

const CONTROL_LOCK = "openbot.web.relay-control";
const WEB_ENROLL_LABEL = "Web client";
const CONTROL_CHANNEL = "openbot.web.relay";

const FINAL_CODES: ReadonlySet<RelaySocketErrorCode | "stopped"> = new Set([
  "replaced",
  "certificate_revoked",
  "certificate_expired",
  "authentication_failed",
  "identity_unavailable",
  "relay_url_missing",
  "insecure_relay_url",
  "server_refused",
]);

export function openWebIdentityStore(): RelayIdentityKeyStore {
  return createIndexedDbRelayIdentityKeyStore();
}

export function webRelayIdentity(identity: RelayBrowserIdentity): WebRelayIdentity {
  return {
    keyId: identity.keyId,
    team: identity.team,
    user: identity.user,
    device: identity.device,
    relayUrl: identity.relayUrl,
    startsAt: identity.startsAt,
    expiresAt: identity.expiresAt,
  };
}

export async function loadWebIdentity(store: RelayIdentityKeyStore): Promise<RelayBrowserIdentity | null> {
  try {
    const identity = await loadRelayIdentity(store);
    return identity && pageRelayIdentity(identity);
  } catch (error) {
    throw new WebIdentityImportError(identityErrorKey(error));
  }
}

export async function importWebIdentity(
  store: RelayIdentityKeyStore,
  source: { text: string } | { file: Blob },
): Promise<RelayBrowserIdentity> {
  let identity: RelayBrowserIdentity;
  try {
    const read =
      "text" in source
        ? await createRelayIdentityFromText(source.text)
        : await createRelayIdentityFromFile(source.file);
    identity = pageRelayIdentity(read);
    await saveRelayIdentity(store, identity);
  } catch (error) {
    throw new WebIdentityImportError(identityErrorKey(error));
  }
  return identity;
}

export async function joinWebIdentity(store: RelayIdentityKeyStore, code: string): Promise<RelayBrowserIdentity> {
  let identity: RelayBrowserIdentity;
  try {
    const joined = await joinRelayWithCode(code, {
      crypto: webRelayCrypto,
      label: WEB_ENROLL_LABEL,
      ...(import.meta.env.DEV ? {} : { server: window.location.host }),
    });
    identity = pageRelayIdentity(joined.identity);
    await saveRelayIdentity(store, identity);
  } catch (error) {
    throw new WebIdentityImportError(identityErrorKey(error));
  }
  return identity;
}

export async function removeWebIdentity(store: RelayIdentityKeyStore): Promise<void> {
  try {
    await removeRelayIdentity(store);
  } catch (error) {
    throw new WebIdentityImportError(identityErrorKey(error));
  }
}

function pageRelayIdentity(identity: RelayBrowserIdentity): RelayBrowserIdentity {
  const pageRelay = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}${RELAY_PATH}`;
  if (identity.relayUrl === null) return { ...identity, relayUrl: pageRelay };
  if (import.meta.env.DEV || sameServer(identity.relayUrl, pageRelay)) return identity;
  throw new WebIdentityImportError("webClient.identity.error.otherServer");
}

function sameServer(relayUrl: string, pageRelay: string): boolean {
  const relay = URL.parse(relayUrl);
  const page = URL.parse(pageRelay);
  return relay !== null && page !== null && relay.protocol === page.protocol && relay.host === page.host;
}

export function identityErrorKey(error: unknown): AppTextKey {
  if (error instanceof WebIdentityImportError) return error.key;
  const joinKey = relayJoinErrorKey(error);
  if (joinKey) return joinKey;
  if (!(error instanceof RelayIdentityError)) return "webClient.identity.error.storage";
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
      return "webClient.identity.error.storage";
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
  target_unavailable: "error.remote.relayUnreachable",
  peer_refused: "error.remote.relayUnreachable",
  tunnel_handshake_failed: "error.remote.relayUnreachable",
  tunnel_peer_unverified: "error.remote.relayUnreachable",
  tunnel_integrity_failed: "error.remote.relayUnreachable",
  tunnel_counter_exhausted: "error.remote.relayUnreachable",
  tunnel_identity_unusable: "error.remote.relayIdentityUnusable",
} as const satisfies Record<RelaySocketErrorCode, keyof SourceMessages & AppTextKey>;

export function relayStateKey(code: RelaySocketErrorCode): (typeof RELAY_STATE_KEYS)[RelaySocketErrorCode] {
  return RELAY_STATE_KEYS[code];
}

export function relayFinalCode(snapshot: RelayControlSnapshot): RelaySocketErrorCode | null {
  const { state } = snapshot;
  return state.status === "offline" && state.code !== "stopped" && FINAL_CODES.has(state.code) ? state.code : null;
}

export function startWebRelay(identity: RelayBrowserIdentity): WebRelayRun {
  const listeners = new Set<(snapshot: RelayControlSnapshot) => void>();
  const stopping = new AbortController();
  const channel = new BroadcastChannel(`${CONTROL_CHANNEL}:${identity.keyId}`);
  let snapshot: RelayControlSnapshot = { state: { status: "connecting" }, roster: [], self: null, team: null };
  let leading: ReturnType<typeof startRelayControl> | null = null;
  function publish(next: RelayControlSnapshot): void {
    snapshot = next;
    for (const listener of listeners) listener(next);
  }
  channel.onmessage = (event: MessageEvent<unknown>) => {
    const message = event.data;
    if (!isDynamicRecord(message) || !isString(message.type)) return;
    if (message.type === "ask" && leading) channel.postMessage({ type: "snapshot", snapshot: leading.snapshot() });
    else if (message.type === "snapshot" && !leading && isRelaySnapshot(message.snapshot)) publish(message.snapshot);
  };
  function lead(): Promise<void> {
    const control = startRelayControl(identity);
    leading = control;
    const unsubscribe = control.subscribe((next) => {
      publish(next);
      channel.postMessage({ type: "snapshot", snapshot: next });
    });
    return new Promise<void>((resolve) => {
      stopping.signal.addEventListener(
        "abort",
        () => {
          unsubscribe();
          control.stop();
          leading = null;
          resolve();
        },
        { once: true },
      );
    });
  }
  if (navigator.locks)
    void navigator.locks
      .request(`${CONTROL_LOCK}:${identity.keyId}`, { signal: stopping.signal }, lead)
      .catch(() => undefined);
  else void lead();
  channel.postMessage({ type: "ask" });
  return {
    identity: webRelayIdentity(identity),
    source: {
      snapshot: () => snapshot,
      subscribe(listener) {
        listeners.add(listener);
        listener(snapshot);
        return () => listeners.delete(listener);
      },
    },
    createPeer: (actions, options) =>
      createRelayTeamPeer(
        {
          openSession: (target, sessionOptions) =>
            leading
              ? leading.openSession(target, sessionOptions)
              : Promise.reject(
                  new RelaySocketError({
                    code: "connect_failed",
                    message: "Another tab of this browser holds the relay connection.",
                  }),
                ),
        },
        actions,
        options,
      ),
    stop() {
      stopping.abort();
      channel.close();
      listeners.clear();
    },
  };
}

function isRelaySnapshot(value: unknown): value is RelayControlSnapshot {
  return (
    isDynamicRecord(value) &&
    isDynamicRecord(value.state) &&
    isString(value.state.status) &&
    Array.isArray(value.roster) &&
    value.roster.every(
      (member) =>
        isDynamicRecord(member) && isString(member.keyId) && isString(member.user) && isBoolean(member.hosting),
    )
  );
}
