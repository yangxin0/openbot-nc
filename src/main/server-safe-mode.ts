import { existsSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import type { ServerSafeModeReason } from "@openbot/contracts/team-protocol/server-safe-mode-v1";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Effect, Exit, Schema, Scope } from "effect";
import { HOSTED_RUNTIME_DIRECTORY, HOSTED_UPDATE_TRIGGER } from "./hosted-update-adapter";
import { listenLoopback } from "./listen-loopback";
import { handleServerSafeModeRequest, refuseServerSafeModeUpgrade } from "./team-api/server-safe-mode-api";
import { TEAM_STORE_FILE, TeamStore } from "./team-store";

const logger = createOpenBotLogger("server-safe-mode");

const SERVER_SAFE_MODE_MARKER = "server-safe-mode";

class ServerSafeModeUnavailable extends Schema.TaggedError<ServerSafeModeUnavailable>()("ServerSafeModeUnavailable", {
  cause: Schema.Defect(),
}) {}

export interface ServerSafeModeOptions {
  userDataPath: string;
  reason: ServerSafeModeReason;
  markerDirectory: string | null;
}

export interface ServerSafeMode {
  readonly stop: Effect.Effect<void>;
}

export function safeModeMarkerDirectory(environment: NodeJS.ProcessEnv, platform: NodeJS.Platform): string | null {
  if (platform !== "linux" || environment.XDG_RUNTIME_DIR?.trim() !== HOSTED_RUNTIME_DIRECTORY) return null;
  return existsSync(HOSTED_UPDATE_TRIGGER) ? HOSTED_RUNTIME_DIRECTORY : null;
}

const unavailable = (cause: unknown) => new ServerSafeModeUnavailable({ cause });

export const startServerSafeMode = Effect.fn("ServerSafeMode.start")(function* (options: ServerSafeModeOptions) {
  const scope = yield* Scope.make();
  return yield* open(options).pipe(
    Scope.provide(scope),
    Effect.map((): ServerSafeMode => ({ stop: Scope.close(scope, Exit.void) })),
    Effect.onError(() => Scope.close(scope, Exit.void)),
  );
});

const open = Effect.fn("ServerSafeMode.open")(function* (options: ServerSafeModeOptions) {
  const store = new TeamStore(join(options.userDataPath, TEAM_STORE_FILE));
  yield* store.loadReadOnly();
  const identity = store.getIdentity();
  if (!identity) return yield* unavailable(new Error(sourceText("error.team.hostNotConfigured")));

  const server = createServer((request, response) =>
    handleServerSafeModeRequest(request, response, {
      reason: options.reason,
      authenticate: (token) => store.authenticate(token),
    }),
  );
  server.on("upgrade", (_request, socket) => refuseServerSafeModeUpgrade(socket));
  yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: () => listenLoopback(server, () => new Error("The safe mode API has no port.")),
      catch: unavailable,
    }),
    () =>
      Effect.callback<void>((resume) => {
        server.close(() => resume(Effect.void));
        server.closeAllConnections();
      }),
  );

  const markerDirectory = options.markerDirectory;
  if (markerDirectory !== null) {
    const marker = join(markerDirectory, SERVER_SAFE_MODE_MARKER);
    yield* Effect.acquireRelease(
      Effect.tryPromise({ try: () => writeFile(marker, "", { mode: 0o600 }), catch: unavailable }),
      () =>
        Effect.tryPromise(() => rm(marker, { force: true })).pipe(
          Effect.catch((error) => Effect.sync(() => logger.warn("The safe mode marker stays.", toLogValue(error)))),
        ),
    );
  }
  logger.info(`Safe mode is on (${options.reason.reason}).`);
});
