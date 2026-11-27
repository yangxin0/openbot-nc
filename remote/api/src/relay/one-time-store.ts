import { createHash, randomBytes } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import { withFileLock } from "./file-lock";

const ENTRY_SUFFIX = ".json";
const USED_SUFFIX = ".used";
const TEMPORARY_SUFFIX = ".tmp";
const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const ORPHAN_FILE_MS = 60 * 60_000;
const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIRECTORY_MODE = 0o700;

class OneTimeStoreError extends Schema.TaggedError<OneTimeStoreError>()("OneTimeStoreError", {
  message: Schema.String,
}) {}

export interface OneTimeEntry {
  createdAt: number;
  expiresAt: number;
}

interface StoredOneTime<Entry> {
  hash: string;
  entry: Entry;
}

interface OneTimeStoreOptions<Entry> {
  directory: string;
  decode: (value: unknown) => Entry | null;
  limit: number;
  noun: string;
  now?: () => number;
}

const failure = (message: string) => new OneTimeStoreError({ message });
const hasCode = (error: unknown, code: string) => error instanceof Error && "code" in error && error.code === code;
const ignoreMissing = (error: unknown) => (hasCode(error, "ENOENT") ? null : Promise.reject(error));

function oneTimeHash(secret: Uint8Array): string {
  return createHash("sha256").update(secret).digest("hex");
}

export class OneTimeStore<Entry extends OneTimeEntry> {
  readonly #directory: string;
  readonly #decode: (value: unknown) => Entry | null;
  readonly #limit: number;
  readonly #noun: string;
  readonly #now: () => number;

  constructor(options: OneTimeStoreOptions<Entry>) {
    this.#directory = options.directory;
    this.#decode = options.decode;
    this.#limit = options.limit;
    this.#noun = options.noun;
    this.#now = options.now ?? Date.now;
  }

  readonly create = Effect.fn("OneTimeStore.create")((entry: Entry, secretBytes: number) =>
    withFileLock(
      join(this.#directory, "lock"),
      Effect.gen({ self: this }, function* () {
        const openEntries = yield* this.list();
        if (openEntries.length >= this.#limit) {
          return yield* failure(`There are ${openEntries.length} open ${this.#noun}s, the most that is permitted.`);
        }
        const secret = new Uint8Array(randomBytes(secretBytes));
        const hash = oneTimeHash(secret);
        yield* this.#call(async () => {
          const path = this.#entryPath(hash);
          const temporary = `${path}.${randomBytes(8).toString("hex")}${TEMPORARY_SUFFIX}`;
          await writeFile(temporary, `${JSON.stringify(entry)}\n`, { mode: PRIVATE_FILE_MODE, flag: "wx" });
          await rename(temporary, path);
        });
        return { secret, hash };
      }),
      failure,
    ),
  );

  readonly list = Effect.fn("OneTimeStore.list")(() =>
    Effect.gen({ self: this }, function* () {
      yield* this.cleanup();
      const names = yield* this.#names();
      const entries: StoredOneTime<Entry>[] = [];
      for (const name of names) {
        const hash = name.slice(0, -ENTRY_SUFFIX.length);
        if (!name.endsWith(ENTRY_SUFFIX) || !HASH_PATTERN.test(hash) || names.includes(`${hash}${USED_SUFFIX}`))
          continue;
        const entry = yield* this.#read(hash);
        if (entry !== null && entry.expiresAt > this.#now()) entries.push({ hash, entry });
      }
      return entries.sort((left, right) => left.entry.createdAt - right.entry.createdAt);
    }),
  );

  readonly claim = Effect.fn("OneTimeStore.claim")((secret: Uint8Array) =>
    Effect.gen({ self: this }, function* () {
      const hash = oneTimeHash(secret);
      yield* this.#call(() => mkdir(this.#directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE }));
      const marked = yield* this.#call(() =>
        open(this.#usedPath(hash), "wx", PRIVATE_FILE_MODE).then(
          (handle) => handle.close().then(() => true),
          (error: unknown) => (hasCode(error, "EEXIST") ? false : Promise.reject(error)),
        ),
      );
      if (!marked) return null;
      const entry = yield* this.#read(hash);
      if (entry === null || entry.expiresAt <= this.#now()) {
        yield* this.finish(hash);
        return null;
      }
      const claimed: StoredOneTime<Entry> = { hash, entry };
      return claimed;
    }),
  );

  readonly finish = Effect.fn("OneTimeStore.finish")((hash: string) =>
    Effect.promise(async () => {
      await rm(this.#entryPath(hash), { force: true }).catch(() => undefined);
      await rm(this.#usedPath(hash), { force: true }).catch(() => undefined);
    }),
  );

  readonly cancel = Effect.fn("OneTimeStore.cancel")((prefix: string) =>
    Effect.gen({ self: this }, function* () {
      const reference = prefix.toLowerCase();
      if (!/^[0-9a-f]{6,64}$/u.test(reference)) {
        return yield* failure(`Give at least the first 6 characters of the ${this.#noun} identifier.`);
      }
      const matches = (yield* this.list()).filter((stored) => stored.hash.startsWith(reference));
      const [match] = matches;
      if (match === undefined) return yield* failure(`No open ${this.#noun} has this identifier.`);
      if (matches.length > 1)
        return yield* failure(`More than one ${this.#noun} has this identifier. Give more of it.`);
      yield* this.finish(match.hash);
      return match;
    }),
  );

  readonly cleanup = Effect.fn("OneTimeStore.cleanup")(() =>
    Effect.gen({ self: this }, function* () {
      const names = yield* this.#names();
      const now = this.#now();
      for (const name of names) {
        if (name.endsWith(ENTRY_SUFFIX)) {
          const hash = name.slice(0, -ENTRY_SUFFIX.length);
          if (!HASH_PATTERN.test(hash)) continue;
          const entry = yield* this.#read(hash);
          if (entry === null || entry.expiresAt <= now) yield* this.finish(hash);
          continue;
        }
        if (!name.endsWith(USED_SUFFIX) && !name.endsWith(TEMPORARY_SUFFIX)) continue;
        if (name.endsWith(USED_SUFFIX) && names.includes(`${name.slice(0, -USED_SUFFIX.length)}${ENTRY_SUFFIX}`)) {
          continue;
        }
        const path = join(this.#directory, name);
        const status = yield* this.#call(() => stat(path).catch(ignoreMissing));
        if (status !== null && now - status.mtimeMs > ORPHAN_FILE_MS) {
          yield* this.#call(() => rm(path, { force: true }));
        }
      }
    }),
  );

  #entryPath(hash: string): string {
    return join(this.#directory, `${hash}${ENTRY_SUFFIX}`);
  }

  #usedPath(hash: string): string {
    return join(this.#directory, `${hash}${USED_SUFFIX}`);
  }

  readonly #names = () =>
    this.#call(
      (): Promise<string[]> =>
        readdir(this.#directory).catch((error: unknown) => (hasCode(error, "ENOENT") ? [] : Promise.reject(error))),
    );

  readonly #read = (hash: string) =>
    Effect.gen({ self: this }, function* () {
      const text = yield* this.#call(() => readFile(this.#entryPath(hash), "utf8").catch(ignoreMissing));
      if (text === null) return null;
      try {
        return this.#decode(JSON.parse(text));
      } catch {
        return null;
      }
    });

  readonly #call = <A>(operation: () => Promise<A>) =>
    Effect.tryPromise({ try: operation, catch: () => failure(`The ${this.#noun} store cannot be used.`) });
}
