import { Socket } from "node:net";
import { isAbsolute } from "node:path";
import type { Readable } from "node:stream";
import type { AgentSummary } from "@openbot/contracts/ipc";
import { Deferred, Effect, Exit, Schema, Semaphore } from "effect";
import { decodeRemoteMembers, type RemoteMemberRecord } from "./central-auth-records";
import type { HostService } from "./host-service";
import { RemoteWorkflowError } from "./remote-service-effects";
import type { TeamStore } from "./team-store";

export const LOCAL_SERVER_OWNER_USERNAME = "owner";
export const LOCAL_SERVER_READY_PREFIX = "OPENBOT_LOCAL_SERVER_READY ";
export const LOCAL_SERVER_MEMBERS_REQUEST = "OPENBOT_LOCAL_SERVER_REQUEST members";
export const LOCAL_SERVER_WORKING_PREFIX = "OPENBOT_LOCAL_SERVER_WORKING ";
const LOCAL_SERVER_WORKING_DELAY_MS = 100;
const LOCAL_SERVER_MEMBERS_TIMEOUT_MS = 30_000;

export const LOCAL_SERVER_CONTROL_FD = 3;

export function openLocalServerControl(
  platform: NodeJS.Platform,
  onFailure: (cause: unknown) => void,
): Readable | null {
  if (platform !== "win32") return process.stdin;
  try {
    return new Socket({ fd: LOCAL_SERVER_CONTROL_FD, readable: true, writable: false });
  } catch (error) {
    onFailure(error);
    return null;
  }
}

export const LOCAL_SERVER_ENVIRONMENT = {
  child: "OPENBOT_LOCAL_SERVER_CHILD",
  agentRoot: "OPENBOT_LOCAL_SERVER_ROOT",
  name: "OPENBOT_LOCAL_SERVER_NAME",
  secret: "OPENBOT_LOCAL_SERVER_SECRET",
  runtimeRoot: "OPENBOT_LOCAL_SERVER_RUNTIMES",
} as const;

export interface LocalServerChildEnvironment {
  agentRoot: string;
  serverName: string;
  ownerSecret: string;
  runtimeRoot: string | null;
}

export interface LocalServerReady {
  serverId: string;
  serverName: string;
  apiUrl: string;
  fingerprint: string;
  publicKey: string;
  ownerMemberId: string;
}

const localServerCommandSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal("publish"), machineToken: Schema.String }),
  Schema.Struct({ type: Schema.Literal("unpublish") }),
  Schema.Struct({ type: Schema.Literal("members"), members: Schema.Unknown }),
  Schema.Struct({ type: Schema.Literal("members-unavailable") }),
]);
export type LocalServerCommand = typeof localServerCommandSchema.Type;
type ParsedLocalServerCommand =
  | Exclude<LocalServerCommand, { type: "members" }>
  | { type: "members"; members: RemoteMemberRecord[] };
const decodeLocalServerCommand = Schema.decodeUnknownSync(localServerCommandSchema);

export function formatLocalServerCommand(command: LocalServerCommand): string {
  return `${JSON.stringify(command)}\n`;
}

export function formatLocalServerMembersRequest(): string {
  return `${LOCAL_SERVER_MEMBERS_REQUEST}\n`;
}

function parseLocalServerCommand(line: string): ParsedLocalServerCommand | null {
  try {
    const command = decodeLocalServerCommand(JSON.parse(line));
    return command.type === "members" ? { type: "members", members: decodeRemoteMembers(command) } : command;
  } catch {
    return null;
  }
}

function membersUnavailable(): RemoteWorkflowError {
  return new RemoteWorkflowError({ cause: new Error("The desktop app did not read the account directory.") });
}

export class LocalServerMembers {
  readonly #request: () => void;
  #pending: Deferred.Deferred<RemoteMemberRecord[], RemoteWorkflowError> | null = null;

  constructor(request: () => void) {
    this.#request = request;
  }

  readonly list = Effect.fn("LocalServerMembers.list")(function* (
    this: LocalServerMembers,
  ): Effect.fn.Return<RemoteMemberRecord[], RemoteWorkflowError> {
    let pending = this.#pending;
    if (!pending) {
      pending = Deferred.makeUnsafe<RemoteMemberRecord[], RemoteWorkflowError>();
      this.#pending = pending;
      this.#request();
    }
    const current = pending;
    return yield* Deferred.await(current).pipe(
      Effect.timeoutOrElse({
        duration: LOCAL_SERVER_MEMBERS_TIMEOUT_MS,
        orElse: () => Effect.fail(membersUnavailable()),
      }),
      Effect.ensuring(
        Effect.sync(() => {
          if (this.#pending === current) this.#pending = null;
        }),
      ),
    );
  }).bind(this);

  answer(members: RemoteMemberRecord[] | null): boolean {
    const pending = this.#pending;
    if (!pending) return false;
    this.#pending = null;
    Deferred.doneUnsafe(pending, members ? Exit.succeed(members) : Exit.fail(membersUnavailable()));
    return true;
  }
}

interface LocalServerPublisher {
  publish(machineToken: string): Effect.Effect<void, RemoteWorkflowError>;
  unpublish(): Effect.Effect<void, RemoteWorkflowError>;
}

export function takeLocalServerChildEnvironment(
  environment: NodeJS.ProcessEnv,
  userDataDirectory: string,
): LocalServerChildEnvironment | null {
  const flag = environment[LOCAL_SERVER_ENVIRONMENT.child];
  const agentRoot = environment[LOCAL_SERVER_ENVIRONMENT.agentRoot]?.trim() ?? "";
  const serverName = environment[LOCAL_SERVER_ENVIRONMENT.name]?.trim() ?? "";
  const ownerSecret = environment[LOCAL_SERVER_ENVIRONMENT.secret] ?? "";
  const runtimeRoot = environment[LOCAL_SERVER_ENVIRONMENT.runtimeRoot]?.trim() ?? "";
  for (const name of Object.values(LOCAL_SERVER_ENVIRONMENT)) delete environment[name];
  if (flag !== "1" || !userDataDirectory || !isAbsolute(agentRoot) || !serverName || !ownerSecret) return null;
  return { agentRoot, serverName, ownerSecret, runtimeRoot: isAbsolute(runtimeRoot) ? runtimeRoot : null };
}

export function reportLocalServerWorkingAgents({
  read,
  subscribe,
  write,
}: {
  read: () => AgentSummary[];
  subscribe: (listener: () => void) => void;
  write: (line: string) => void;
}): void {
  let last = "[]";
  let timer: ReturnType<typeof setTimeout> | null = null;
  subscribe(() => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      const agents = JSON.stringify(read());
      if (agents === last) return;
      last = agents;
      write(`${LOCAL_SERVER_WORKING_PREFIX}${agents}\n`);
    }, LOCAL_SERVER_WORKING_DELAY_MS);
  });
}

export function formatLocalServerReady(ready: LocalServerReady): string {
  return `${LOCAL_SERVER_READY_PREFIX}${JSON.stringify(ready)}\n`;
}

export interface StartLocalServerChildOptions {
  environment: LocalServerChildEnvironment;
  teamStore: Pick<TeamStore, "configured" | "configure" | "getIdentity" | "getOwnerMemberId">;
  host: Pick<HostService, "startLoopbackOnly" | "applyAccountDirectory">;
  members: Pick<LocalServerMembers, "answer">;
  writeReady: (line: string) => void;
  readCommands: (onLine: (line: string) => void) => void;
  publisher: LocalServerPublisher;
  warn: (message: string, cause: unknown) => void;
}

export const startLocalServerChild = Effect.fn("LocalServerChild.start")(function* ({
  environment,
  teamStore,
  host,
  writeReady,
  readCommands,
  publisher,
  members,
  warn,
}: StartLocalServerChildOptions) {
  if (!teamStore.configured)
    yield* teamStore.configure(environment.serverName, LOCAL_SERVER_OWNER_USERNAME, environment.ownerSecret);
  const status = yield* host.startLoopbackOnly();
  const identity = teamStore.getIdentity();
  const ownerMemberId = teamStore.getOwnerMemberId();
  if (!identity || !status.apiUrl || !ownerMemberId)
    return yield* new RemoteWorkflowError({ cause: new Error("The local server has no identity or API address.") });
  const commands = Semaphore.makeUnsafe(1);
  readCommands((line) => {
    const command = parseLocalServerCommand(line);
    if (!command) return;
    if (command.type === "members-unavailable") {
      members.answer(null);
      return;
    }
    if (command.type === "members") {
      if (members.answer(command.members)) return;
      Effect.runFork(
        host
          .applyAccountDirectory(command.members)
          .pipe(
            Effect.catch((error) =>
              Effect.sync(() => warn("The server on this computer did not apply the account directory.", error.cause)),
            ),
          ),
      );
      return;
    }
    const run = command.type === "publish" ? publisher.publish(command.machineToken) : publisher.unpublish();
    Effect.runFork(
      commands.withPermit(
        run.pipe(
          Effect.catch((error) =>
            Effect.sync(() => warn(`The server on this computer did not ${command.type}.`, error.cause)),
          ),
        ),
      ),
    );
  });
  writeReady(
    formatLocalServerReady({
      serverId: identity.serverId,
      serverName: identity.serverName,
      apiUrl: status.apiUrl,
      fingerprint: identity.fingerprint,
      publicKey: identity.publicKey,
      ownerMemberId,
    }),
  );
});
