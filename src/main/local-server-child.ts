import { Socket } from "node:net";
import { isAbsolute } from "node:path";
import type { Readable } from "node:stream";
import type { AgentSummary } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { HostService } from "./host-service";
import { RemoteWorkflowError } from "./remote-service-effects";
import type { TeamStore } from "./team-store";

export const LOCAL_SERVER_OWNER_USERNAME = "owner";
export const LOCAL_SERVER_READY_PREFIX = "OPENBOT_LOCAL_SERVER_READY ";
export const LOCAL_SERVER_WORKING_PREFIX = "OPENBOT_LOCAL_SERVER_WORKING ";
const LOCAL_SERVER_WORKING_DELAY_MS = 100;

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
  host: Pick<HostService, "startLoopbackOnly">;
  writeReady: (line: string) => void;
}

export const startLocalServerChild = Effect.fn("LocalServerChild.start")(function* ({
  environment,
  teamStore,
  host,
  writeReady,
}: StartLocalServerChildOptions) {
  if (!teamStore.configured)
    yield* teamStore.configure(environment.serverName, LOCAL_SERVER_OWNER_USERNAME, environment.ownerSecret);
  const status = yield* host.startLoopbackOnly();
  const identity = teamStore.getIdentity();
  const ownerMemberId = teamStore.getOwnerMemberId();
  if (!identity || !status.apiUrl || !ownerMemberId)
    return yield* new RemoteWorkflowError({ cause: new Error("The local server has no identity or API address.") });
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
