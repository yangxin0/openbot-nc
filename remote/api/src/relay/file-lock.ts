import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { Effect } from "effect";

const STALE_LOCK_MS = 30_000;
const WAIT_LIMIT_MS = 10_000;
const RETRY_DELAY = "25 millis";
const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIRECTORY_MODE = 0o700;

const hasCode = (error: unknown, code: string) => error instanceof Error && "code" in error && error.code === code;

async function createLock(path: string, owner: string): Promise<boolean> {
  await mkdir(dirname(path), { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  try {
    const handle = await open(path, "wx", PRIVATE_FILE_MODE);
    try {
      await handle.writeFile(`${process.pid} ${owner}\n`);
    } finally {
      await handle.close();
    }
    return true;
  } catch (error) {
    if (hasCode(error, "EEXIST")) return false;
    throw error;
  }
}

async function removeStaleLock(path: string): Promise<void> {
  try {
    const [status, content] = await Promise.all([stat(path), readFile(path, "utf8")]);
    if (Date.now() - status.mtimeMs <= STALE_LOCK_MS) return;
    if ((await readFile(path, "utf8")) === content) await rm(path, { force: true });
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
  }
}

async function releaseLock(path: string, owner: string): Promise<void> {
  const content = await readFile(path, "utf8").catch(() => "");
  if (content.trim().endsWith(owner)) await rm(path, { force: true });
}

export function withFileLock<A, E, R, F>(
  path: string,
  operation: Effect.Effect<A, E, R>,
  failure: (message: string) => F,
): Effect.Effect<A, E | F, R> {
  const lockCall = <B>(run: () => Promise<B>) =>
    Effect.tryPromise({ try: run, catch: () => failure("The lock of the certificate store cannot be used.") });
  const acquire = Effect.fn("FileLock.acquire")(function* () {
    const owner = randomBytes(16).toString("hex");
    const deadline = Date.now() + WAIT_LIMIT_MS;
    for (;;) {
      if (yield* lockCall(() => createLock(path, owner))) return owner;
      yield* lockCall(() => removeStaleLock(path));
      if (Date.now() >= deadline) return yield* Effect.fail(failure("The certificate store is busy. Try again."));
      yield* Effect.sleep(RETRY_DELAY);
    }
  });
  return Effect.acquireUseRelease(
    acquire(),
    () => operation,
    (owner) => Effect.promise(() => releaseLock(path, owner).catch(() => undefined)),
  );
}
