import { EventEmitter } from "node:events";
import { readFile, stat } from "node:fs/promises";
import type {
  HostStatus,
  RelayConnectionState,
  RelayHostingState,
  RelayIdentitySummary,
  RelayMemberSummary,
  RelayState,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { type Logger, registerSecretValues, toLogValue } from "@openbot/logging";
import { Effect, Result, Schema, Semaphore } from "effect";
import type { HostService } from "./host-service";
import type { RelayClientCoordinator } from "./relay/client-coordinator";
import type { RelayControlState } from "./relay/control";
import type { RelayIdentity, RelayIdentityError, RelayIdentityStore } from "./relay/identity-store";
import type { RelaySocketErrorCode } from "./relay/socket";
import type { RelayHostingPreferenceStore } from "./relay-hosting-preference-store";
import type { RelayLaunchOptions } from "./relay-launch-options";
import type { RelayServerRecords } from "./remote-relay-directory";
import type { RemoteWorkflowError } from "./remote-service-effects";

export const RELAY_IDENTITY_FILE = "openbot-relay-identity-v1.json";

const IDENTITY_FILE_BYTES_LIMIT = 256 * 1024;

export class RelaySetupError extends Schema.TaggedError<RelaySetupError>()("RelaySetupError", {
  cause: Schema.Defect(),
}) {}

interface RelayServiceEvents {
  changed: [state: RelayState];
}

interface RelayServers {
  readonly relayRecords: RelayServerRecords;
  unhideRelayHost(serverId: string): Effect.Effect<void, RemoteWorkflowError>;
}

type RelayHost = Pick<
  HostService,
  "startRelayHosting" | "stopRelayHosting" | "relayHostingState" | "getStatus" | "on" | "off"
>;

interface RelayServiceOptions {
  identity: RelayIdentityStore;
  client: RelayClientCoordinator;
  hosting: RelayHostingPreferenceStore;
  host: RelayHost;
  servers: RelayServers;
  logger: Pick<Logger, "info" | "warn">;
}

export class RelayService extends EventEmitter<RelayServiceEvents> {
  readonly #options: RelayServiceOptions;
  readonly #lock = Semaphore.makeUnsafe(1);
  #identityIssue: string | null = null;
  #hostingIssue: string | null = null;
  #listening = false;

  constructor(options: RelayServiceOptions) {
    super();
    this.#options = options;
  }

  readonly initialize = Effect.fn("RelayService.initialize")(
    function* (this: RelayService, launch: RelayLaunchOptions) {
      this.#listen();
      const { identity, hosting, logger } = this.#options;
      const preference = yield* Effect.result(hosting.load());
      if (Result.isFailure(preference))
        logger.warn(
          "OpenBot could not read the relay hosting choice. Hosting stays off.",
          toLogValue(preference.failure),
        );
      if (launch.hosting !== null) {
        const saved = yield* Effect.result(hosting.set({ enabled: launch.hosting }));
        if (Result.isFailure(saved))
          logger.warn(
            "OpenBot could not save the relay hosting choice of the start switch.",
            toLogValue(saved.failure),
          );
        else logger.info(`The start switch turned relay hosting ${launch.hosting ? "on" : "off"}.`);
      }
      const loaded = yield* Effect.result(identity.load());
      if (Result.isFailure(loaded)) {
        this.#identityIssue = identityErrorText(loaded.failure);
        logger.warn(`OpenBot could not open its relay identity (${loaded.failure.reason}).`);
        if (launch.importIdentityPath !== null)
          logger.warn(
            "OpenBot did not import the identity file of the start switch: its stored identity cannot be opened.",
          );
      } else if (loaded.success !== null && launch.importIdentityPath !== null) {
        logger.info(
          "OpenBot has a relay identity already, so it did not import the identity file of the start switch.",
        );
      } else if (launch.importIdentityPath !== null) {
        const imported = yield* Effect.result(this.#saveIdentityFile(launch.importIdentityPath, false));
        if (Result.isFailure(imported))
          logger.warn(`OpenBot refused the identity file of the start switch: ${failureText(imported.failure)}`);
      }
      if (identity.current()) {
        registerIdentitySecrets(identity);
        yield* this.#connect();
      }
      this.#emit();
    },
    (operation) => this.#lock.withPermit(operation),
  ).bind(this);

  readonly importFile = Effect.fn("RelayService.importFile")(
    function* (this: RelayService, path: string, replace: boolean): Effect.fn.Return<RelayState, RelaySetupError> {
      yield* this.#saveIdentityFile(path, replace);
      yield* this.#restart();
      return this.state();
    },
    (operation) => this.#lock.withPermit(operation),
  ).bind(this);

  readonly removeIdentity = Effect.fn("RelayService.removeIdentity")(
    function* (this: RelayService): Effect.fn.Return<RelayState, RelaySetupError> {
      const { identity, client, host, logger } = this.#options;
      yield* host.stopRelayHosting().pipe(Effect.mapError(({ cause }) => new RelaySetupError({ cause })));
      yield* client.stop();
      yield* identity.remove().pipe(Effect.mapError((error) => setupError(identityErrorText(error))));
      this.#identityIssue = null;
      this.#hostingIssue = null;
      logger.info("OpenBot removed its relay identity.");
      this.#emit();
      return this.state();
    },
    (operation) => this.#lock.withPermit(operation),
  ).bind(this);

  readonly setHosting = Effect.fn("RelayService.setHosting")(
    function* (this: RelayService, enabled: boolean): Effect.fn.Return<RelayState, RelaySetupError> {
      yield* this.#setHosting(enabled);
      return this.state();
    },
    (operation) => this.#lock.withPermit(operation),
  ).bind(this);

  readonly publishHost = Effect.fn("RelayService.publishHost")(
    function* (this: RelayService): Effect.fn.Return<HostStatus, RelaySetupError> {
      if (!this.#options.identity.current()) return yield* setupError(sourceText("error.host.relayIdentityMissing"));
      yield* this.#setHosting(true);
      return this.#options.host.getStatus();
    },
    (operation) => this.#lock.withPermit(operation),
  ).bind(this);

  readonly unpublishHost = Effect.fn("RelayService.unpublishHost")(
    function* (this: RelayService): Effect.fn.Return<HostStatus, RelaySetupError> {
      yield* this.#setHosting(false);
      return this.#options.host.getStatus();
    },
    (operation) => this.#lock.withPermit(operation),
  ).bind(this);

  readonly resumeHosting = Effect.fn("RelayService.resumeHosting")(
    function* (this: RelayService): Effect.fn.Return<void, RelaySetupError> {
      const { identity, hosting, host } = this.#options;
      if (!identity.current() || !hosting.get().enabled || host.relayHostingState() !== null) return;
      yield* this.#startHosting();
    },
    (operation) => this.#lock.withPermit(operation),
  ).bind(this);

  readonly unhideHost = Effect.fn("RelayService.unhideHost")(
    function* (this: RelayService, serverId: string): Effect.fn.Return<RelayState, RelaySetupError> {
      const { servers, client } = this.#options;
      yield* servers.unhideRelayHost(serverId).pipe(Effect.mapError(({ cause }) => new RelaySetupError({ cause })));
      yield* client.retryHost(serverId);
      this.#emit();
      return this.state();
    },
    (operation) => this.#lock.withPermit(operation),
  ).bind(this);

  state(): RelayState {
    const { identity, client, hosting } = this.#options;
    const current = identity.current();
    const hosts = new Map(client.hosts().map((host) => [host.keyId, host] as const));
    const members: RelayMemberSummary[] = client.roster().map((member) => {
      const host = hosts.get(member.keyId);
      return {
        keyId: member.keyId,
        user: member.user,
        device: member.device,
        label: member.label,
        hosting: member.hosting,
        self: member.keyId === current?.keyId,
        serverId: host?.serverId ?? null,
        hidden: host?.removed ?? false,
      };
    });
    return {
      identity: current ? identitySummary(current) : null,
      identityIssue: this.#identityIssue,
      control: connectionState(client.state()),
      members,
      hosting: hosting.get().enabled,
      hostingState: this.#hostingState(current),
    };
  }

  readonly #saveIdentityFile = Effect.fn("RelayService.saveIdentityFile")(function* (
    this: RelayService,
    path: string,
    replace: boolean,
  ): Effect.fn.Return<RelayIdentity, RelaySetupError> {
    const { identity, logger } = this.#options;
    const bundle = yield* readIdentityFile(path);
    if (isDynamicRecord(bundle) && isString(bundle.privateKey)) registerSecretValues(pemSecretParts(bundle.privateKey));
    const saved = yield* (replace ? identity.replaceBundle(bundle) : identity.importBundle(bundle)).pipe(
      Effect.mapError((error) => setupError(identityErrorText(error))),
    );
    this.#identityIssue = null;
    registerIdentitySecrets(identity);
    logger.info(`OpenBot imported the relay identity of the user ${saved.user} in the team ${saved.team}.`);
    return saved;
  });

  readonly #restart = Effect.fn("RelayService.restart")(function* (this: RelayService) {
    const { client, host } = this.#options;
    yield* host.stopRelayHosting().pipe(Effect.ignore);
    yield* client.resetIdentity();
    yield* this.#connect();
    this.#emit();
  });

  readonly #connect = Effect.fn("RelayService.connect")(function* (this: RelayService) {
    const { client, servers, hosting, logger } = this.#options;
    yield* client.start(servers.relayRecords);
    if (!hosting.get().enabled) return;
    const started = yield* Effect.result(this.#startHosting());
    if (Result.isFailure(started)) logger.warn(`Relay hosting did not start: ${failureText(started.failure)}`);
  });

  readonly #setHosting = Effect.fn("RelayService.setHostingUnlocked")(function* (
    this: RelayService,
    enabled: boolean,
  ): Effect.fn.Return<void, RelaySetupError> {
    const { identity, client, hosting, host, servers, logger } = this.#options;
    yield* hosting
      .set({ enabled })
      .pipe(Effect.mapError(() => setupError(sourceText("error.remote.relayHostingNotSaved"))));
    logger.info(`Relay hosting is ${enabled ? "on" : "off"}.`);
    if (!enabled) {
      this.#hostingIssue = null;
      yield* host.stopRelayHosting().pipe(Effect.mapError(({ cause }) => new RelaySetupError({ cause })));
    } else if (identity.current()) {
      yield* client.start(servers.relayRecords);
      yield* this.#startHosting();
    }
    this.#emit();
  });

  readonly #startHosting = Effect.fn("RelayService.startHosting")(function* (
    this: RelayService,
  ): Effect.fn.Return<void, RelaySetupError> {
    const { host, identity, client } = this.#options;
    const started = yield* Effect.result(host.startRelayHosting(identity, { control: client.control }));
    if (Result.isFailure(started)) {
      const message = failureText(started.failure);
      this.#hostingIssue = message;
      this.#emit();
      return yield* setupError(message);
    }
    this.#hostingIssue = null;
    this.#emit();
  });

  #hostingState(current: RelayIdentity | null): RelayHostingState {
    if (!this.#options.hosting.get().enabled) return { status: "off", message: null };
    if (!current) return { status: "no_identity", message: sourceText("error.host.relayIdentityMissing") };
    const relay = this.#options.host.relayHostingState();
    if (relay === null)
      return this.#hostingIssue === null
        ? { status: "starting", message: null }
        : { status: "error", message: this.#hostingIssue };
    if (relay.status === "online") return { status: "online", message: sourceText("status.host.relayReady") };
    if (relay.status === "connecting") return { status: "starting", message: null };
    if (relay.code === "stopped") return { status: "offline", message: null };
    const message = connectionMessage(relay.code);
    return relay.retryInMs === null ? { status: "error", message } : { status: "offline", message };
  }

  #listen(): void {
    if (this.#listening) return;
    this.#listening = true;
    const { client, host } = this.#options;
    const changed = () => this.#emit();
    client.on("state", changed);
    client.on("roster", changed);
    client.on("hosts", changed);
    host.on("changed", changed);
  }

  #emit(): void {
    this.emit("changed", this.state());
  }
}

const readIdentityFile = Effect.fn("RelayService.readIdentityFile")(function* (
  path: string,
): Effect.fn.Return<unknown, RelaySetupError> {
  const unreadable = () => setupError(sourceText("error.remote.relayIdentityFileUnreadable"));
  const info = yield* Effect.tryPromise({ try: () => stat(path), catch: unreadable });
  if (!info.isFile()) return yield* unreadable();
  if (info.size > IDENTITY_FILE_BYTES_LIMIT)
    return yield* setupError(sourceText("error.remote.relayIdentityFileTooLarge"));
  const text = yield* Effect.tryPromise({ try: () => readFile(path, "utf8"), catch: unreadable });
  return yield* Effect.try({
    try: (): unknown => JSON.parse(text),
    catch: () => setupError(sourceText("error.remote.relayIdentityInvalid")),
  });
});

function setupError(message: string): RelaySetupError {
  return new RelaySetupError({ cause: new Error(message) });
}

function failureText(error: { readonly cause: unknown }): string {
  return error.cause instanceof Error ? error.cause.message : sourceText("error.host.publishFailed");
}

function identitySummary(identity: RelayIdentity): RelayIdentitySummary {
  return {
    team: identity.team,
    user: identity.user,
    device: identity.device,
    keyId: identity.keyId,
    relayUrl: identity.relayUrl,
    expiresAt: identity.expiresAt,
  };
}

function connectionState(state: RelayControlState): RelayConnectionState {
  if (state.status !== "offline") return state;
  return {
    status: "offline",
    code: state.code,
    message: state.code === "stopped" ? null : connectionMessage(state.code),
    retryInMs: state.retryInMs,
  };
}

function connectionMessage(code: RelaySocketErrorCode): string {
  switch (code) {
    case "certificate_revoked":
      return sourceText("error.remote.relayCertificateRevoked");
    case "certificate_expired":
      return sourceText("error.remote.relayCertificateExpired");
    case "authentication_failed":
      return sourceText("error.remote.relayCertificateRefused");
    case "identity_unavailable":
      return sourceText("error.remote.relayIdentityUnusable");
    case "relay_url_missing":
      return sourceText("error.remote.relayUrlMissing");
    case "insecure_relay_url":
      return sourceText("error.remote.relayUrlInsecure");
    case "replaced":
      return sourceText("error.remote.relayReplaced");
    case "rate_limited":
      return sourceText("error.remote.relayRateLimited");
    case "team_full":
      return sourceText("error.remote.relayTeamFull");
    case "protocol_error":
    case "invalid_message":
      return sourceText("error.remote.relayProtocol");
    case "connect_failed":
    case "closed":
    case "deadline_exceeded":
    case "target_unavailable":
    case "peer_refused":
      return sourceText("error.remote.relayUnreachable");
  }
}

function identityErrorText(error: RelayIdentityError): string {
  switch (error.reason) {
    case "invalid_bundle":
      return sourceText("error.remote.relayIdentityInvalid");
    case "unsupported_key":
      return sourceText("error.remote.relayIdentityKeyUnsupported");
    case "key_mismatch":
      return sourceText("error.remote.relayIdentityKeyMismatch");
    case "untrusted_chain":
      return sourceText("error.remote.relayIdentityUntrusted");
    case "expired":
      return sourceText("error.remote.relayCertificateExpired");
    case "already_imported":
      return sourceText("error.remote.relayIdentityExists");
    case "locked":
      return sourceText("error.remote.relayIdentityLocked");
    case "storage":
      return sourceText("error.remote.relayIdentityStorage");
  }
}

function registerIdentitySecrets(identity: RelayIdentityStore): void {
  const key = identity.tlsCredentials()?.key;
  if (key) registerSecretValues(pemSecretParts(key));
}

function pemSecretParts(pem: string): string[] {
  const lines = pem
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("-----"));
  return [pem, lines.join(""), ...lines];
}
