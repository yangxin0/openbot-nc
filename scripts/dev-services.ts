import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { cliSpawnTarget } from "../src/backend/cli";
import {
  developmentInstanceIdForWorktree,
  developmentUserDataName,
  readDevelopmentInstanceId,
} from "../src/main/development-profile";
import { developmentRemoteConnectionPath } from "../src/main/development-runtime-directory";
import {
  type DevInstanceRecord,
  removeDevInstanceRecord,
  writeDevInstanceRecord,
} from "./dev-automation/instance-registry";
import { withDevPortAllocation } from "./dev-automation/port-allocation";
import {
  conflictingDevStacks,
  type DevStackPort,
  type DevStackRecord,
  describeDevStack,
  heldDevStackPorts,
  removeDevStackRecord,
  writeDevStackRecord,
} from "./dev-automation/stack-registry";
import { developmentChildEnvironment } from "./development-environment";
import { resolveDevelopmentAppDataRoot } from "./development-state-paths";
import { withoutElectronRuntimeFlags } from "./electron-spawn-env";
import { resolvePackageBin } from "./package-bin";
import { prepareDevelopmentEnvironment } from "./prepare-dev-environment";

const logger = createOpenBotLogger("dev-services");

export type DevelopmentService = "app" | "test-client";
type DevelopmentTarget = DevelopmentService;

export interface DevelopmentServiceSpec {
  name: DevelopmentService;
  executable: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export type OwnedProcess = Pick<ChildProcess, "pid" | "exitCode">;
type KillProcess = (pid: number, signal?: NodeJS.Signals | number) => boolean;

type SignalScope = "group" | "process";

interface StopOwnedProcessesOptions {
  platform?: NodeJS.Platform;
  killProcess?: KillProcess;
  timeoutMs?: number;
  pollIntervalMs?: number;
  scope?: SignalScope;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
}

export function developmentEnvironmentForTarget(
  target: DevelopmentTarget,
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...environment,
    OPENBOT_DEV_TEST_CLIENT_ENABLED: target === "test-client" ? "1" : "0",
  };
}

const scriptsRoot = dirname(fileURLToPath(import.meta.url));
export const projectRoot = dirname(scriptsRoot);

const DEFAULT_RENDERER_PORTS = {
  app: 5_173,
  "test-client": 5_174,
} as const;
const DEFAULT_REMOTE_DEBUGGING_PORTS = {
  app: 9_333,
  "test-client": 9_334,
} as const;

export function servicesForTarget(target: DevelopmentTarget): DevelopmentService[] {
  if (target === "test-client") return ["app", "test-client"];
  return ["app"];
}

export function createDevelopmentServiceSpec(
  name: DevelopmentService,
  environment: NodeJS.ProcessEnv = process.env,
): DevelopmentServiceSpec {
  const childEnvironment = withoutElectronRuntimeFlags(developmentChildEnvironment(environment));
  const isTestClient = name === "test-client";
  const outputDirectory = isTestClient ? "out-dev-test-client" : "out-dev-app";
  const electronVite = resolvePackageBin(projectRoot, "electron-vite");
  return {
    name,
    executable: electronVite,
    args: [
      "dev",
      "--watch",
      "--outDir",
      outputDirectory,
      "--entry",
      join(outputDirectory, "main", "start.js"),
      ...electronSwitches(ELECTRON_SWITCH_VARIABLES[name], childEnvironment),
    ],
    cwd: projectRoot,
    env: {
      ...childEnvironment,
      OPENBOT_APP_VARIANT: "dev",
      OPENBOT_DEV_PROFILE: isTestClient ? "test-client" : "app",
      OPENBOT_DEV_RENDERER_PORT:
        childEnvironment.OPENBOT_DEV_RENDERER_PORT ??
        String(isTestClient ? DEFAULT_RENDERER_PORTS["test-client"] : DEFAULT_RENDERER_PORTS.app),
      OPENBOT_DEV_REMOTE_DEBUGGING_PORT:
        childEnvironment.OPENBOT_DEV_REMOTE_DEBUGGING_PORT ??
        String(isTestClient ? DEFAULT_REMOTE_DEBUGGING_PORTS["test-client"] : DEFAULT_REMOTE_DEBUGGING_PORTS.app),
      OPENBOT_DEV_REMOTE_ROLE: childEnvironment.OPENBOT_DEV_REMOTE_ROLE ?? "none",
    },
  };
}

const ELECTRON_SWITCH_VARIABLES: Record<Extract<DevelopmentService, "app" | "test-client">, string> = {
  app: "OPENBOT_DEV_ELECTRON_ARGS",
  "test-client": "OPENBOT_DEV_TEST_CLIENT_ELECTRON_ARGS",
};

function electronSwitches(variable: string, environment: NodeJS.ProcessEnv): string[] {
  const value = environment[variable];
  if (value === undefined || value.trim() === "") return [];
  const switches = switchList(variable, JSON.parse(value));
  return switches.length === 0 ? [] : ["--", ...switches];
}

function switchList(variable: string, value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((item): item is string => typeof item === "string" && item.startsWith("--"))
  )
    throw new Error(`${variable} must be a JSON list of switches that start with --.`);
  return value;
}

export function createDevInstanceRecord(
  spec: DevelopmentServiceSpec,
  pid: number,
  startedAt: number,
): DevInstanceRecord | null {
  if (spec.name !== "app" && spec.name !== "test-client") return null;
  const rendererPort = readPort(spec.env.OPENBOT_DEV_RENDERER_PORT);
  const remoteDebuggingPort = readPort(spec.env.OPENBOT_DEV_REMOTE_DEBUGGING_PORT);
  if (!rendererPort || !remoteDebuggingPort) return null;
  const instanceId = readDevelopmentInstanceId(spec.env.OPENBOT_DEV_INSTANCE_ID);
  const profileKind = spec.name === "test-client" ? "test-client" : "app";
  return {
    service: spec.name,
    instanceId: instanceId ?? "default",
    profile: developmentUserDataName(profileKind, instanceId),
    projectRoot: spec.cwd,
    rendererPort,
    remoteDebuggingPort,
    pid,
    startedAt,
  };
}

export function developmentProfileToSeed(
  specs: readonly DevelopmentServiceSpec[],
  profileExists: (path: string) => boolean = existsSync,
): { profile: string; env: NodeJS.ProcessEnv } | null {
  const app = specs.find((spec) => spec.name === "app");
  if (!app) return null;
  const instanceId = readDevelopmentInstanceId(app.env.OPENBOT_DEV_INSTANCE_ID);
  const profile = resolve(
    resolveDevelopmentAppDataRoot(process.platform, app.env),
    developmentUserDataName("app", instanceId),
  );
  return profileExists(profile) ? null : { profile, env: app.env };
}

function seedDevelopmentProfile(profile: string, environment: NodeJS.ProcessEnv): void {
  logger.info(`Seeding the new development profile ${profile}.`);
  execFileSync(process.execPath, ["run", "dev:seed", "--if-missing"], {
    cwd: projectRoot,
    stdio: "inherit",
    env: withoutElectronRuntimeFlags(environment),
  });
}

const DEVELOPMENT_OPTIONS = ["--dry-run", "--force", "--shared", "--isolated", "--foreground"] as const;

export interface DevelopmentInvocation {
  target: DevelopmentTarget;
  dryRun: boolean;
  force: boolean;
  shared: boolean;
  foreground: boolean;
}

export function parseDevelopmentTarget(args: string[]): DevelopmentInvocation {
  const target = args.find((argument) => !argument.startsWith("--")) ?? "app";
  if (target !== "app" && target !== "test-client") {
    throw new Error(`Unknown development target: ${target}. Use app or test-client.`);
  }
  const unsupportedOption = args.find(
    (argument) => argument.startsWith("--") && !DEVELOPMENT_OPTIONS.some((option) => option === argument),
  );
  if (unsupportedOption) throw new Error(`Unknown option: ${unsupportedOption}.`);
  if (args.includes("--shared") && args.includes("--isolated")) {
    throw new Error("Use --shared or --isolated, not both.");
  }
  return {
    target,
    dryRun: args.includes("--dry-run"),
    force: args.includes("--force"),
    shared: args.includes("--shared"),
    foreground: args.includes("--foreground"),
  };
}

function prepareVoiceRuntime(): void {
  try {
    execFileSync(process.execPath, ["run", "voice:prepare-runtime"], {
      cwd: projectRoot,
      stdio: "inherit",
      timeout: 300_000,
    });
  } catch (error) {
    logger.warn(
      "Could not prepare the local voice runtime. Local voice is off until `bun run voice:prepare-runtime` completes.",
      toLogValue(error),
    );
  }
}

async function main(): Promise<void> {
  const { target, dryRun, force, shared, foreground } = parseDevelopmentTarget(process.argv.slice(2));
  const services = servicesForTarget(target);
  if (!dryRun && prepareDevelopmentEnvironment() === "created") {
    logger.info("Prepared local development state.");
  }
  if (!dryRun) prepareVoiceRuntime();
  const sharedEnvironment = developmentEnvironmentForTarget(target);
  sharedEnvironment.OPENBOT_DEV_STACK_ID = String(process.pid);
  if (foreground) sharedEnvironment.OPENBOT_DEV_WINDOW_FOCUS = "foreground";
  else sharedEnvironment.OPENBOT_DEV_WINDOW_FOCUS ??= "background";

  const { specs, stack } = await withDevPortAllocation(async (records) => {
    const conflicts = conflictingDevStacks(records, { projectRoot, services });
    if (conflicts.length > 0) {
      const detail = conflicts.map((record) => `- ${describeDevStack(record)}`).join("\n");
      if (!force && !dryRun) {
        throw new Error(
          `This worktree already runs a dev stack:\n${detail}\n` +
            "Reuse it, stop it with `bun run dev:stop`, or start beside it with --force.",
        );
      }
      logger.warn(`This worktree already runs a dev stack:\n${detail}`);
    }
    const instanceId = developmentInstanceIdForStart({
      configured: sharedEnvironment.OPENBOT_DEV_INSTANCE_ID,
      shared,
      besideOwnStack: conflicts.length > 0,
      projectRoot,
    });
    if (instanceId !== sharedEnvironment.OPENBOT_DEV_INSTANCE_ID) {
      sharedEnvironment.OPENBOT_DEV_INSTANCE_ID = instanceId;
      logger.info("This worktree opens its own dev profile. Pass --shared to open the shared OpenBot-NC Dev profile.");
    }
    const allocated = await allocateDevelopmentPorts(services, sharedEnvironment, heldDevStackPorts(records));
    validateServiceSpecs(allocated);
    if (dryRun) return { specs: allocated, stack: null };
    const record = createDevStackRecord(allocated, process.pid, Date.now());
    writeDevStackRecord(record);
    return { specs: allocated, stack: record };
  });

  if (dryRun) {
    for (const spec of specs) {
      logger.info(`[${spec.name}]`, JSON.stringify([spec.executable, ...spec.args]));
    }
    return;
  }

  const seed = developmentProfileToSeed(specs);
  if (seed) seedDevelopmentProfile(seed.profile, seed.env);

  await runDevelopmentServices(specs, stack);
}

export function developmentInstanceIdForStart(input: {
  configured: string | undefined;
  shared: boolean;
  besideOwnStack: boolean;
  projectRoot: string;
}): string | undefined {
  if (input.configured || input.shared || input.besideOwnStack) return input.configured;
  return developmentInstanceIdForWorktree(input.projectRoot);
}

export function createDevStackRecord(
  specs: DevelopmentServiceSpec[],
  supervisorPid: number,
  startedAt: number,
): DevStackRecord {
  const ports: DevStackPort[] = [];
  const addPort = (name: string, value: string | undefined): void => {
    const port = readPort(value);
    if (port !== undefined) ports.push({ name, port });
  };
  for (const spec of specs) {
    addPort(`${spec.name}-renderer`, spec.env.OPENBOT_DEV_RENDERER_PORT);
    addPort(`${spec.name}-debug`, spec.env.OPENBOT_DEV_REMOTE_DEBUGGING_PORT);
  }
  return {
    services: specs.map((spec) => spec.name),
    projectRoot,
    supervisorPid,
    startedAt,
    ports,
    processes: [],
  };
}

async function allocateDevelopmentPorts(
  services: DevelopmentService[],
  sharedEnvironment: NodeJS.ProcessEnv,
  heldPorts: Set<number>,
): Promise<DevelopmentServiceSpec[]> {
  const reservedPorts = new Set<number>();
  const specs: DevelopmentServiceSpec[] = [];
  for (const service of services) {
    const environment = { ...sharedEnvironment };
    const defaultPort = DEFAULT_RENDERER_PORTS[service];
    const rendererPort = await findAvailablePort(
      readPort(environment.OPENBOT_DEV_RENDERER_PORT) ?? defaultPort,
      reservedPorts,
      heldPorts,
    );
    reservedPorts.add(rendererPort);
    environment.OPENBOT_DEV_RENDERER_PORT = String(rendererPort);
    if (rendererPort !== defaultPort) {
      environment.OPENBOT_DEV_INSTANCE_ID ??= String(rendererPort);
      logger.info(`Renderer port ${defaultPort} is busy. Using ${rendererPort} for ${service}.`);
    }

    const defaultRemoteDebuggingPort = DEFAULT_REMOTE_DEBUGGING_PORTS[service];
    const remoteDebuggingPort = await findAvailablePort(
      readPort(environment.OPENBOT_DEV_REMOTE_DEBUGGING_PORT) ?? defaultRemoteDebuggingPort,
      reservedPorts,
      heldPorts,
    );
    reservedPorts.add(remoteDebuggingPort);
    environment.OPENBOT_DEV_REMOTE_DEBUGGING_PORT = String(remoteDebuggingPort);
    if (remoteDebuggingPort !== defaultRemoteDebuggingPort) {
      logger.info(
        `Electron debug port ${defaultRemoteDebuggingPort} is busy. Using ${remoteDebuggingPort} for ${service}.`,
      );
    }
    specs.push(createDevelopmentServiceSpec(service, environment));
  }
  return specs;
}

async function runDevelopmentServices(specs: DevelopmentServiceSpec[], stack: DevStackRecord | null): Promise<void> {
  logger.info(`Starting: ${specs.map((spec) => spec.name).join(", ")}`);
  const processes = new Map<DevelopmentService, ChildProcess>();
  const publishedInstances: DevInstanceRecord[] = [];
  let stopping = false;

  const unpublishInstances = (): void => {
    while (publishedInstances.length > 0) {
      const record = publishedInstances.pop();
      if (record) removeDevInstanceRecord(record);
    }
  };

  const stopAll = async (signal: NodeJS.Signals): Promise<void> => {
    if (stopping) return;
    stopping = true;
    unpublishInstances();
    await stopOwnedProcesses([...processes.values()], signal);
    if (stack) removeDevStackRecord(stack);
    const app = specs.find((spec) => spec.name === "app");
    if (app) rmSync(developmentRemoteConnectionPath(app.env), { force: true });
  };

  process.once("SIGINT", () => void stopAll("SIGTERM").then(() => process.exit(130)));
  process.once("SIGTERM", () => void stopAll("SIGTERM").then(() => process.exit(143)));
  process.once("SIGHUP", () => void stopAll("SIGTERM").then(() => process.exit(129)));

  const restarting = new Set<DevelopmentService>();

  const startService = async (spec: DevelopmentServiceSpec): Promise<void> => {
    const target = cliSpawnTarget(spec.executable, spec.args);
    const child = spawn(target.command, target.args, {
      cwd: spec.cwd,
      env: spec.env,
      stdio: "inherit",
      shell: false,
      detached: process.platform !== "win32",
      windowsVerbatimArguments: target.windowsVerbatimArguments,
    });
    processes.set(spec.name, child);
    if (stack && child.pid) {
      stack.processes.push({ name: spec.name, pid: child.pid, startedAt: Date.now() });
      writeDevStackRecord(stack);
    }
    const instance = child.pid ? createDevInstanceRecord(spec, child.pid, Date.now()) : null;
    if (instance) {
      writeDevInstanceRecord(instance);
      publishedInstances.push(instance);
      logger.info(
        `[${spec.name}] dev:automation can reach this instance with --instance=${instance.instanceId} (:${instance.remoteDebuggingPort}).`,
      );
    }
    child.once("error", (error) => {
      logger.error(`[${spec.name}] Could not start:`, error.message);
      void stopAll("SIGTERM").then(() => {
        process.exitCode = 1;
      });
    });
    child.once("exit", (code, signal) => {
      if (stopping || processes.get(spec.name) !== child) return;
      const result = signal ? `signal ${signal}` : `code ${code ?? 1}`;
      logger.info(`[${spec.name}] stopped with ${result}. Stopping the other services.`);
      void stopAll("SIGTERM").then(() => {
        process.exitCode = code ?? 1;
      });
    });
  };

  const testClient = specs.find((spec) => spec.name === "test-client");
  if (testClient && process.platform !== "win32") {
    process.on("SIGUSR2", () => {
      const child = processes.get("test-client");
      if (stopping || restarting.has("test-client") || !child) return;
      restarting.add("test-client");
      processes.delete("test-client");
      logger.info("[test-client] Restarting the test client. The other services keep running.");
      void (async () => {
        await stopOwnedProcesses([child], "SIGTERM");
        if (stack) {
          stack.processes = stack.processes.filter((entry) => entry.pid !== child.pid);
          writeDevStackRecord(stack);
        }
        const index = publishedInstances.findIndex((record) => record.pid === child.pid);
        const [instance] = index >= 0 ? publishedInstances.splice(index, 1) : [];
        if (instance) removeDevInstanceRecord(instance);
        if (!stopping) await startService(testClient);
      })()
        .catch((error: unknown) => {
          logger.error("[test-client] Could not restart:", error instanceof Error ? error.message : String(error));
          void stopAll("SIGTERM").then(() => {
            process.exitCode = 1;
          });
        })
        .finally(() => restarting.delete("test-client"));
    });
  }

  try {
    for (const spec of specs) await startService(spec);
  } catch (error) {
    await stopAll("SIGTERM");
    throw error;
  }
}

export async function findAvailablePort(
  preferredPort: number,
  reservedPorts: Set<number>,
  heldPorts: Set<number> = new Set(),
  isAvailable: (port: number) => Promise<boolean> = isPortAvailable,
): Promise<number> {
  for (let port = preferredPort; port <= 65_535; port += 1) {
    if (reservedPorts.has(port) || heldPorts.has(port)) continue;
    if (await isAvailable(port)) return port;
  }
  throw new Error("No available development port was found.");
}

function isPortAvailable(port: number): Promise<boolean> {
  return Promise.all([isAddressPortAvailable(port, "127.0.0.1"), isAddressPortAvailable(port, "::1")]).then((results) =>
    results.every(Boolean),
  );
}

function isAddressPortAvailable(port: number, host: "127.0.0.1" | "::1"): Promise<boolean> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    const finish = (available: boolean) => {
      server.removeAllListeners();
      resolvePort(available);
    };
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        finish(false);
        return;
      }
      if (host === "::1" && (error.code === "EADDRNOTAVAIL" || error.code === "EAFNOSUPPORT")) {
        finish(true);
        return;
      }
      reject(error);
    });
    server.listen(port, host, () => {
      server.close(() => finish(true));
    });
  });
}

function readPort(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1_024 || port > 65_535) {
    throw new Error("Development ports must be integers from 1024 to 65535.");
  }
  return port;
}

function validateServiceSpecs(specs: DevelopmentServiceSpec[]): void {
  for (const spec of specs) {
    if (!existsSync(spec.executable)) {
      throw new Error(`electron-vite is missing at ${spec.executable}. Run bun install.`);
    }
  }
}

export function signalOwnedProcess(
  child: OwnedProcess,
  signal: NodeJS.Signals,
  platform: NodeJS.Platform = process.platform,
  killProcess: KillProcess = process.kill,
  scope: SignalScope = "group",
): void {
  if (!child.pid) return;
  try {
    if (platform === "win32") {
      if (child.exitCode !== null) return;
      if (scope === "group" && stopWindowsProcessTree(child.pid, killProcess)) return;
      killProcess(child.pid, signal);
    } else {
      killProcess(scope === "group" ? -child.pid : child.pid, signal);
    }
  } catch (error) {
    if (!isUnavailableProcess(error, platform)) throw error;
  }
}

export async function stopOwnedProcesses(
  owned: OwnedProcess[],
  signal: NodeJS.Signals,
  options: StopOwnedProcessesOptions = {},
): Promise<void> {
  const {
    platform = process.platform,
    killProcess = process.kill,
    timeoutMs = 3_000,
    pollIntervalMs = 50,
    scope = "group",
    now = Date.now,
    wait = (milliseconds) => new Promise<void>((resolveDelay) => setTimeout(resolveDelay, milliseconds)),
  } = options;
  for (const child of owned) signalOwnedProcess(child, signal, platform, killProcess, scope);

  const deadline = now() + timeoutMs;
  while (owned.some((child) => ownedProcessIsRunning(child, platform, killProcess, scope))) {
    const remaining = deadline - now();
    if (remaining <= 0) break;
    await wait(Math.min(pollIntervalMs, remaining));
  }

  for (const child of owned) {
    if (ownedProcessIsRunning(child, platform, killProcess, scope)) {
      signalOwnedProcess(child, "SIGKILL", platform, killProcess, scope);
    }
  }
}

function ownedProcessIsRunning(
  child: OwnedProcess,
  platform: NodeJS.Platform,
  killProcess: KillProcess,
  scope: SignalScope = "group",
): boolean {
  if (!child.pid) return false;
  if (platform === "win32" && child.exitCode !== null) return false;
  try {
    killProcess(scope === "group" && platform !== "win32" ? -child.pid : child.pid, 0);
    return true;
  } catch (error) {
    if (isUnavailableProcess(error, platform)) return false;
    if (platform === "win32" && error instanceof Error && "code" in error && error.code === "EPERM") return true;
    throw error;
  }
}

function stopWindowsProcessTree(pid: number, killProcess: KillProcess): boolean {
  const taskkill = (): boolean => {
    try {
      execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
        stdio: "ignore",
        timeout: 10_000,
        windowsHide: true,
      });
      return true;
    } catch {
      return false;
    }
  };
  const rootRunning = (): boolean => {
    try {
      killProcess(pid, 0);
      return true;
    } catch (error) {
      return error instanceof Error && "code" in error && error.code === "EPERM";
    }
  };
  if (taskkill() || !rootRunning()) return true;
  return taskkill() || !rootRunning();
}

function isUnavailableProcess(error: unknown, platform: NodeJS.Platform): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ESRCH" || (platform === "darwin" && error.code === "EPERM"))
  );
}

const invokedFile = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedFile === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    logger.error(error instanceof Error ? error.message : toLogValue(error));
    process.exitCode = 1;
  });
}
