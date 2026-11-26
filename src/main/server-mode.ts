import { chmod, lstat, unlink } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { dirname, isAbsolute, join } from "node:path";
import { parseHostedServerName } from "@openbot/contracts/hosted-servers";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { sourceText } from "@openbot/i18n/source";
import { Deferred, Effect, Result } from "effect";
import { runCauseEffect } from "../backend/effect-boundary";
import type { HostService } from "./host-service";
import { readBodyWithin } from "./http-body";
import type { RelayService } from "./relay-service";
import { RemoteWorkflowError, remoteCall } from "./remote-service-effects";
import type { ServerMemory } from "./server-memory";

const CONTROL_SOCKET_FILE = "control.sock";
const MAX_BODY_BYTES = 4096;
const MAX_PATH_LENGTH = 4096;
const SERVER_ENROLL_LABEL = "Linux server";

export interface ServerModeEnvironment {
  controlSocketPath: string;
  setupPagePort: number | null;
}

export type ServerSetupAction = "status";

export function takeServerModeEnvironment(
  environment: NodeJS.ProcessEnv,
  isPackaged: boolean,
  platform: NodeJS.Platform,
): ServerModeEnvironment | null {
  if (!isPackaged || platform !== "linux" || environment.OPENBOT_SERVER !== "1") return null;
  if (environment.OPENBOT_HOSTED_SERVER === "1") return null;
  const runtimeDirectory = environment.XDG_RUNTIME_DIR?.trim() ?? "";
  if (!isAbsolute(runtimeDirectory)) return null;
  return {
    controlSocketPath: join(runtimeDirectory, CONTROL_SOCKET_FILE),
    setupPagePort: parseSetupPagePort(environment.OPENBOT_SETUP_PAGE_PORT),
  };
}

function parseSetupPagePort(value: string | undefined): number | null {
  const text = value?.trim() ?? "";
  if (!/^[0-9]{4,5}$/u.test(text)) return null;
  const port = Number(text);
  return port >= 1024 && port <= 65535 ? port : null;
}

export interface ServerModeOptions {
  environment: ServerModeEnvironment;
  version: string;
  relay: Pick<RelayService, "state" | "importFile" | "joinWithCode" | "setHosting" | "resumeHosting">;
  host: Pick<HostService, "getStatus" | "configure" | "updateIdentity">;
  memory: (Pick<ServerMemory, "level" | "sample"> & { turnLimit(): number | "unlimited" }) | null;
  onError: (message: string, error: unknown) => void;
  uid?: number;
}

export interface ServerModeAnswer {
  status: number;
  lines: Record<string, string | number | null>;
}
type Answer = ServerModeAnswer;

export class ServerMode {
  readonly #options: ServerModeOptions;
  readonly #sockets = new Set<Socket>();
  #server: Server | null = null;
  #publishError: string | null = null;
  #publishing: Deferred.Deferred<void> | null = null;

  constructor(options: ServerModeOptions) {
    this.#options = options;
  }

  readonly listen = Effect.fn("ServerMode.listen")(function* (this: ServerMode) {
    const path = this.#options.environment.controlSocketPath;
    const directory = yield* remoteCall(() => lstat(dirname(path)));
    const uid = this.#options.uid ?? process.getuid?.();
    if (!directory.isDirectory() || directory.uid !== uid || (directory.mode & 0o077) !== 0) {
      return yield* new RemoteWorkflowError({
        cause: new Error("The server runtime directory must be a private directory of the service user."),
      });
    }
    const existing = yield* remoteCall(() =>
      lstat(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      }),
    );
    if (existing && !existing.isSocket()) {
      return yield* new RemoteWorkflowError({ cause: new Error("The control socket path holds another file.") });
    }
    if (existing) yield* remoteCall(() => unlink(path));

    const server = createServer((request, response) => void this.#handle(request, response));
    server.on("connection", (socket) => {
      this.#sockets.add(socket);
      socket.on("close", () => this.#sockets.delete(socket));
    });
    yield* remoteCall(
      () =>
        new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(path, () => {
            server.removeListener("error", reject);
            resolve();
          });
        }),
    );
    this.#server = server;
    yield* remoteCall(() => chmod(path, 0o600));
  }).bind(this);

  readonly close = Effect.fn("ServerMode.close")(function* (this: ServerMode) {
    const server = this.#server;
    this.#server = null;
    if (!server) return;
    for (const socket of this.#sockets) socket.destroy();
    this.#sockets.clear();
    yield* Effect.callback<void>((resume) => {
      server.close(() => resume(Effect.void));
    });
  }).bind(this);

  readonly publish = Effect.fn("ServerMode.publish")(
    function* (this: ServerMode) {
      const previous = this.#publishing;
      const completed = Deferred.makeUnsafe<void>();
      this.#publishing = completed;
      return yield* Effect.gen({ self: this }, function* () {
        if (previous) yield* Deferred.await(previous);
        this.#publishError = null;
        yield* this.#options.relay.resumeHosting();
      }).pipe(
        Effect.tapError(({ cause }) =>
          Effect.sync(() => {
            this.#publishError = cause instanceof Error ? cause.message : sourceText("error.host.publishFailed");
          }),
        ),
        Effect.mapError(({ cause }) => new RemoteWorkflowError({ cause })),
        Effect.ensuring(
          Effect.sync(() => {
            if (this.#publishing === completed) this.#publishing = null;
            Deferred.doneUnsafe(completed, Effect.void);
          }),
        ),
      );
    },
    (operation) => Effect.uninterruptible(operation),
  ).bind(this);

  readonly setupRequest = (action: ServerSetupAction): Effect.Effect<ServerModeAnswer, RemoteWorkflowError> => {
    switch (action) {
      case "status":
        return Effect.sync(() => this.#status());
    }
  };

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let answer: Answer;
    try {
      const body = await readBody(request);
      answer = body === null ? failure(413, "too_large") : await this.#route(request.method, request.url, body);
    } catch (error) {
      this.#options.onError("A server control request failed.", error);
      answer = failure(400, "failed", error instanceof Error ? error.message : null);
    }
    response
      .writeHead(answer.status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" })
      .end(formatLines(answer.lines));
  }

  async #route(method: string | undefined, url: string | undefined, body: URLSearchParams): Promise<Answer> {
    const path = url?.split("?")[0] ?? "";
    const route = `${method ?? ""} ${path}`;
    switch (route) {
      case "GET /v1/status":
        return this.#status();
      case "POST /v1/identity":
        return runCauseEffect(this.#importIdentity(body.get("path") ?? "", body.get("replace") === "1"));
      case "POST /v1/join":
        return runCauseEffect(this.#join(body.get("code") ?? "", body.get("replace") === "1"));
      case "POST /v1/hosting":
        return runCauseEffect(this.#setHosting(body.get("enabled") ?? ""));
      case "POST /v1/name":
        return runCauseEffect(this.#rename(body.get("name") ?? ""));
      default:
        return failure(404, "not_found");
    }
  }

  #status(): Answer {
    const relay = this.#options.relay.state();
    const host = this.#options.host.getStatus();
    const identity = relay.identity;
    return {
      status: 200,
      lines: {
        version: this.#options.version,
        identity: identity ? "ready" : relay.identityIssue === null ? "missing" : "unusable",
        identity_message: relay.identityIssue,
        team: identity?.team ?? null,
        user: identity?.user ?? null,
        device: identity?.device ?? null,
        relay: relay.control.status,
        relay_message: relay.control.status === "offline" ? relay.control.message : null,
        hosting: relay.hosting ? "on" : "off",
        hosting_state: relay.hostingState.status,
        server: host.phase,
        server_name: host.serverName,
        server_message: this.#publishError ?? relay.hostingState.message ?? host.message,
        ...this.#memoryLines(),
      },
    };
  }

  #memoryLines(): Answer["lines"] {
    const memory = this.#options.memory;
    const sample = memory?.sample();
    if (!memory || !sample) return {};
    return {
      memory_level: memory.level(),
      memory_limit: sample.total,
      memory_available: sample.available,
      turn_limit: memory.turnLimit(),
    };
  }

  readonly #importIdentity = Effect.fn("ServerMode.importIdentity")(function* (
    this: ServerMode,
    path: string,
    replace: boolean,
  ): Effect.fn.Return<Answer, RemoteWorkflowError> {
    const trimmed = path.trim();
    if (!isAbsolute(trimmed) || trimmed.length > MAX_PATH_LENGTH) return failure(400, "invalid_path");
    const imported = yield* this.#options.relay.importFile(trimmed, replace).pipe(Effect.result);
    if (Result.isFailure(imported)) {
      const { cause } = imported.failure;
      return failure(400, "identity_refused", cause instanceof Error ? cause.message : null);
    }
    return this.#status();
  });

  readonly #join = Effect.fn("ServerMode.join")(function* (
    this: ServerMode,
    code: string,
    replace: boolean,
  ): Effect.fn.Return<Answer, RemoteWorkflowError> {
    if (code.trim() === "") return failure(400, "invalid_code");
    const joined = yield* this.#options.relay.joinWithCode(code, replace, SERVER_ENROLL_LABEL).pipe(Effect.result);
    if (Result.isFailure(joined)) {
      const { cause } = joined.failure;
      return failure(400, "join_refused", cause instanceof Error ? cause.message : null);
    }
    return this.#status();
  });

  readonly #setHosting = Effect.fn("ServerMode.setHosting")(function* (
    this: ServerMode,
    value: string,
  ): Effect.fn.Return<Answer, RemoteWorkflowError> {
    if (value !== "on" && value !== "off") return failure(400, "invalid_request");
    const changed = yield* this.#options.relay.setHosting(value === "on").pipe(Effect.result);
    if (Result.isFailure(changed)) {
      const { cause } = changed.failure;
      return failure(502, "hosting_failed", cause instanceof Error ? cause.message : null);
    }
    return this.#status();
  });

  readonly #rename = Effect.fn("ServerMode.rename")(function* (
    this: ServerMode,
    name: string,
  ): Effect.fn.Return<Answer, RemoteWorkflowError> {
    const serverName = parseHostedServerName(name);
    if (!serverName) return nameFailure(name);
    const { host } = this.#options;
    if (host.getStatus().configured) yield* host.updateIdentity({ serverName });
    else yield* host.configure({ serverName });
    return this.#status();
  });
}

async function readBody(request: IncomingMessage): Promise<URLSearchParams | null> {
  const body = await readBodyWithin(request, MAX_BODY_BYTES);
  return body === null ? null : new URLSearchParams(body.toString("utf8"));
}

function failure(status: number, error: string, message: string | null = null): Answer {
  return { status, lines: { error, message } };
}

function nameFailure(name: string): Answer {
  const length = name.trim().length;
  const message =
    length < INPUT_LIMITS.serverNameMin || length > INPUT_LIMITS.serverName
      ? sourceText("error.team.serverNameLength", { min: INPUT_LIMITS.serverNameMin, max: INPUT_LIMITS.serverName })
      : sourceText("error.team.serverNameHostname");
  return failure(400, "invalid_name", message);
}

function formatLines(lines: Answer["lines"]): string {
  return Object.entries(lines)
    .filter((entry): entry is [string, string | number] => entry[1] !== null && entry[1] !== "")
    .map(([key, value]) => `${key}=${String(value).replace(/[\r\n]+/gu, " ")}\n`)
    .join("");
}
