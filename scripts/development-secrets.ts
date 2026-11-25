import { randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEVELOPMENT_STATE_VERSION = 1 as const;
const DEVELOPMENT_STATE_DIRECTORY = ".openbot";
const DEVELOPMENT_STATE_FILE = "dev-state.json";
const DEVELOPMENT_STATE_LOCK = "dev-state.json.lock";

export interface DevelopmentState {
  version: typeof DEVELOPMENT_STATE_VERSION;
  defaults: Record<string, string>;
  overrides: Record<string, string>;
}

export type DevelopmentStateOutcome = "created" | "kept";

export function ensureDevelopmentState(projectRoot: string): DevelopmentStateOutcome {
  const paths = developmentStatePaths(projectRoot);
  const existed = existsSync(paths.state);
  readDevelopmentState(projectRoot);
  return existed ? "kept" : "created";
}

export function readDevelopmentState(projectRoot: string): DevelopmentState {
  const paths = developmentStatePaths(projectRoot);
  ensurePrivateDirectory(paths.directory);

  const current = readStateIfPresent(paths.state);
  if (current) return current;

  const lock = acquireStateLock(paths.lock);
  try {
    const afterLock = readStateIfPresent(paths.state);
    if (afterLock) return afterLock;

    const state = createInitialState();
    publishInitialState(paths.state, state);
    return readStateIfPresent(paths.state) ?? state;
  } finally {
    releaseStateLock(paths.lock, lock);
  }
}

export function setDevelopmentOverrides(
  projectRoot: string,
  updates: Record<string, string | null | undefined>,
): DevelopmentState {
  const paths = developmentStatePaths(projectRoot);
  ensurePrivateDirectory(paths.directory);
  readDevelopmentState(projectRoot);
  const lock = acquireStateLock(paths.lock);
  try {
    const current = readStateIfPresent(paths.state);
    if (!current) throw new Error("The development state disappeared during update. Retry the operation.");
    const overrides = { ...current.overrides };
    for (const [name, value] of Object.entries(updates)) {
      if (value === undefined || value === null) delete overrides[name];
      else overrides[name] = value;
    }
    const next: DevelopmentState = { ...current, overrides };
    publishState(paths.state, next);
    return next;
  } finally {
    releaseStateLock(paths.lock, lock);
  }
}

interface DevelopmentStatePaths {
  directory: string;
  state: string;
  lock: string;
}

interface ParsedDevelopmentState {
  version?: unknown;
  defaults?: unknown;
  overrides?: unknown;
}

function developmentStatePaths(projectRoot: string): DevelopmentStatePaths {
  const directory = join(projectRoot, DEVELOPMENT_STATE_DIRECTORY);
  return {
    directory,
    state: join(directory, DEVELOPMENT_STATE_FILE),
    lock: join(directory, DEVELOPMENT_STATE_LOCK),
  };
}

function createInitialState(): DevelopmentState {
  return {
    version: DEVELOPMENT_STATE_VERSION,
    defaults: {},
    overrides: {},
  };
}

function readStateIfPresent(path: string): DevelopmentState | undefined {
  if (!existsSync(path)) return undefined;
  assertRegularPrivateFile(path, "development state");
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("The development state file is invalid or unreadable. Restore .openbot/dev-state.json.");
  }
  if (!isDevelopmentState(parsed)) {
    throw new Error(
      "The development state file has an invalid format. Restore .openbot/dev-state.json before continuing.",
    );
  }
  chmodSync(path, 0o600);
  return parsed;
}

function isDevelopmentState(value: unknown): value is DevelopmentState {
  if (!value || typeof value !== "object") return false;
  const state: ParsedDevelopmentState = value;
  if (state.version !== DEVELOPMENT_STATE_VERSION) return false;
  return isStringRecord(state.defaults) && isStringRecord(state.overrides);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((entry) => typeof entry === "string");
}

function publishInitialState(path: string, state: DevelopmentState): void {
  if (existsSync(path)) return;
  const temporary = writeTemporary(path, state);
  try {
    try {
      linkSync(temporary, path);
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
    }
  } finally {
    unlinkIfPresent(temporary);
  }
}

function publishState(path: string, state: DevelopmentState): void {
  assertRegularPrivateFileIfPresent(path, "development state");
  const temporary = writeTemporary(path, state);
  try {
    renameSync(temporary, path);
    chmodSync(path, 0o600);
  } finally {
    unlinkIfPresent(temporary);
  }
}

function writeTemporary(path: string, state: DevelopmentState): string {
  const temporary = `${path}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`;
  const descriptor = openSync(temporary, "wx", 0o600);
  try {
    const contents = `${JSON.stringify(state, null, 2)}\n`;
    writeFileSync(descriptor, contents, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  chmodSync(temporary, 0o600);
  return temporary;
}

function acquireStateLock(path: string): string {
  try {
    mkdirSync(path, { mode: 0o700 });
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      throw new Error(
        `Another process is updating ${path}. Retry after it finishes; do not delete the lock automatically.`,
      );
    }
    throw error;
  }
  return path;
}

function releaseStateLock(path: string, lock: string): void {
  if (lock !== path) return;
  rmSync(path, { recursive: true, force: true });
}

function ensurePrivateDirectory(path: string): void {
  if (existsSync(path)) {
    if (!lstatSync(path).isDirectory()) throw new Error("The .openbot development state path is not a directory.");
  } else {
    mkdirSync(path, { recursive: true, mode: 0o700 });
  }
  chmodSync(path, 0o700);
}

function assertRegularPrivateFile(path: string, label: string): void {
  const stat = lstatSync(path);
  if (!stat.isFile()) throw new Error(`The ${label} path is not a regular file.`);
}

function assertRegularPrivateFileIfPresent(path: string, label: string): void {
  if (existsSync(path)) assertRegularPrivateFile(path, label);
}

function unlinkIfPresent(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {}
}

function isAlreadyExistsError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "EEXIST");
}

if (import.meta.main) {
  const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const outcome = ensureDevelopmentState(projectRoot);
  process.stdout.write(
    outcome === "created"
      ? "Generated .openbot/dev-state.json for local development.\n"
      : "Kept the existing .openbot/dev-state.json.\n",
  );
}
