import { randomUUID } from "node:crypto";
import { type AvatarColor, isAvatarColor } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { Effect, Result, Semaphore } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

export const LOCAL_PROFILE_FILE = "openbot-local-profile-v1.json";

export interface LocalProfile {
  id: string;
  name: string | null;
  chatColor: AvatarColor | null;
}

function decodeLocalProfile(parsed: unknown): LocalProfile | null {
  if (!isDynamicRecord(parsed) || parsed.version !== 1 || !isString(parsed.id) || parsed.id.length === 0) return null;
  const { name, chatColor } = parsed;
  return {
    id: parsed.id,
    name: isString(name) && name.trim() ? name : null,
    chatColor: isAvatarColor(chatColor) ? chatColor : null,
  };
}

export class LocalProfileStore {
  readonly #path: string;
  readonly #writes = Semaphore.makeUnsafe(1);
  #profile: LocalProfile;

  constructor(path: string, profile: LocalProfile) {
    this.#path = path;
    this.#profile = { ...profile };
  }

  get(): LocalProfile {
    return { ...this.#profile };
  }

  update(
    change: Partial<Pick<LocalProfile, "name" | "chatColor">>,
  ): Effect.Effect<LocalProfile, PreferenceFileFailure> {
    return this.#writes.withPermit(
      Effect.uninterruptible(
        Effect.suspend(() => {
          const next = { ...this.#profile, ...change };
          return writePreferenceFile(this.#path, { version: 1, ...next }).pipe(
            Effect.map(() => {
              this.#profile = next;
              return { ...next };
            }),
          );
        }),
      ),
    );
  }
}

export const openLocalProfileStore = Effect.fn("LocalProfile.open")(function* (
  path: string,
  firstProfile: () => LocalProfile | null,
) {
  const stored = yield* Effect.result(readPreferenceFile(path, decodeLocalProfile));
  if (Result.isSuccess(stored) && stored.success) return new LocalProfileStore(path, stored.success);
  if (
    Result.isFailure(stored) &&
    !isMissingFileError(stored.failure.cause) &&
    !(stored.failure.cause instanceof SyntaxError)
  )
    return yield* stored.failure;
  const profile = firstProfile() ?? { id: randomUUID(), name: null, chatColor: null };
  yield* writePreferenceFile(path, { version: 1, ...profile }, { createDirectory: true });
  return new LocalProfileStore(path, profile);
});
