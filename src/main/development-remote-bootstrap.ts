import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Effect, Result } from "effect";
import { z } from "zod";
import type { CentralAuthManager } from "./central-auth-manager";
import { developmentRemoteConnectionPath } from "./development-runtime-directory";
import { DEVELOPMENT_REMOTE_CLIENT_USERNAME, type HostService } from "./host-service";
import type { DevelopmentRemoteServerConnection, RemoteServerManager } from "./remote-server-manager";
import { RemoteWorkflowError, remoteCall, remoteDecode, toRemoteWorkflowError } from "./remote-service-effects";
import { writeSetupState } from "./setup-store";
import type { TeamStore } from "./team-store";

export type DevelopmentRemoteRole = "host" | "client";
export type DevelopmentClientTransport = "http" | "webrtc";

export function readDevelopmentClientTransport(value: string | undefined): DevelopmentClientTransport {
  return value === "webrtc" ? "webrtc" : "http";
}

const developmentRemoteServerConnectionSchema: z.ZodType<DevelopmentRemoteServerConnection> = z.object({
  serverId: z.string().min(1),
  serverName: z.string().min(1),
  apiUrl: z.string().min(1),
  fingerprint: z.string().min(1),
  publicKey: z.string().min(1),
  username: z.string().min(1),
  sessionToken: z.string().min(1),
  role: z.enum(["owner", "admin", "member"]).optional(),
});

export interface DevelopmentRemoteAccountOptions {
  role: DevelopmentRemoteRole;
  testClientEnabled: boolean;
  centralAuth: Pick<CentralAuthManager, "getSignedInUser">;
  teamStore: TeamStore;
  setupFile: string;
  setupCompleted: boolean;
}

export const applyDevelopmentRemoteAccount = Effect.fn("DevelopmentRemote.applyAccount")(function* ({
  role,
  testClientEnabled,
  centralAuth,
  teamStore,
  setupFile,
  setupCompleted,
}: DevelopmentRemoteAccountOptions) {
  const user = yield* remoteDecode(() => centralAuth.getSignedInUser());
  yield* teamStore.activateAccount(user);
  if (role === "host" && !teamStore.configured) {
    yield* teamStore.configureWithAccount("OpenBot Local Dev Host", user);
  }
  if (role === "client" && !setupCompleted) {
    yield* writeSetupState(setupFile, { preferredProvider: "codex", preferredModel: null }).pipe(toRemoteWorkflowError);
  }
  if (role === "host" && !testClientEnabled) {
    const technicalMember = teamStore
      .listMembers()
      .find((member) => member.username === DEVELOPMENT_REMOTE_CLIENT_USERNAME);
    if (technicalMember && technicalMember.role !== "owner") {
      yield* teamStore.removeMember(technicalMember.id);
    }
  }
});

export interface DevelopmentRemoteRoleOptions {
  role: DevelopmentRemoteRole;
  testClientEnabled: boolean;
  clientTransport: DevelopmentClientTransport;
  host: HostService;
  remoteServers: RemoteServerManager;
}

export const startDevelopmentRemoteRole = Effect.fn("DevelopmentRemote.startRole")(function* ({
  role,
  testClientEnabled,
  clientTransport,
  host,
  remoteServers,
}: DevelopmentRemoteRoleOptions) {
  if (role === "host") {
    yield* remoteCall(() => rm(developmentRemoteConnectionPath(), { force: true }));
    yield* host.startLoopbackOnly();
    if (testClientEnabled) yield* writeDevelopmentRemoteConnection(yield* host.createDevelopmentConnection());
    return;
  }
  if (clientTransport === "webrtc") return;
  yield* connectDevelopmentRemoteServer(remoteServers);
});

const writeDevelopmentRemoteConnection = Effect.fn("DevelopmentRemote.writeConnection")(
  (connection: DevelopmentRemoteServerConnection) =>
    remoteCall(async () => {
      const path = developmentRemoteConnectionPath();
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, `${JSON.stringify(connection)}\n`, { encoding: "utf8", mode: 0o600 });
    }),
);

const connectDevelopmentRemoteServer = Effect.fn("DevelopmentRemote.connect")(function* (manager: RemoteServerManager) {
  const deadline = Date.now() + 30_000;
  let lastError: RemoteWorkflowError = new RemoteWorkflowError({
    cause: new Error("The local development host did not start."),
  });
  while (Date.now() < deadline) {
    const attempt = yield* Effect.gen(function* () {
      const text = yield* remoteCall(() => readFile(developmentRemoteConnectionPath(), "utf8"));
      const connection = yield* remoteDecode(() => developmentRemoteServerConnectionSchema.parse(JSON.parse(text)));
      yield* manager.connectDevelopmentServer(connection);
    }).pipe(Effect.result);
    if (Result.isSuccess(attempt)) return;
    lastError = attempt.failure;
    yield* Effect.sleep(250);
  }
  return yield* lastError;
});
