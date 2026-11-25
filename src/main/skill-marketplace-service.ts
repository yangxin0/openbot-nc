import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { MANAGED_SKILL_FOLDERS } from "@openbot/contracts/agent-providers";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AgentSummary,
  GithubSkillSource,
  InstalledSkill,
  InstallSkillInput,
  MarketplaceSkillDetail,
  SetEnabledSkillInput,
  UninstallSkillInput,
} from "@openbot/contracts/ipc";
import { isOtherGithubCommit, parseGithubSkillId, SKILL_DESCRIPTION_MAX_LENGTH } from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result, Schema, Semaphore } from "effect";
import { parse as parseYaml } from "yaml";
import type { AgentLifecycleFailed } from "../backend/agent-service";
import { isHeldTargetError, writeFileAtomically } from "../backend/atomic-json-file";
import { causeHelpers } from "../backend/effect-boundary";
import type { GithubSkillSourceReader } from "./github-skill-source";
import { type LocalSkillLibrary, quotedSkillMarkdown } from "./local-skill-library";
import { listManagedSkillsForChat, MANAGED_SKILL_SLUGS } from "./managed-skill-service";
import { listFolderSkills, listHomeFolderSkills } from "./skill-folder-discovery";
import {
  FINDER_METADATA_FILE,
  inspectArchive,
  isRuntimeCacheFile,
  isRuntimeCacheFolder,
  normalizedFiles,
  readSkillArchive,
} from "./skill-package";

const SKILL_FOLDER_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;

interface LockEntry {
  skillId: string;
  versionId?: string;
  slug: string;
  name: string;
  version: number;
  bundleSha256: string;
  receiptId: string;
  files: Record<string, string>;
  enabled?: boolean;
  description?: string;
  folders?: string[];
}
interface SkillsLock {
  version: 1;
  skills: Record<string, LockEntry>;
}

export class SkillMarketplaceService {
  readonly #writes = new Map<string, { gate: Semaphore.Semaphore; users: number }>();

  constructor(
    private readonly listAgents: () => AgentSummary[],
    private readonly refreshAgentRuntime: (agentId: string) => Effect.Effect<void, AgentLifecycleFailed> = () =>
      Effect.void,
    readonly localLibrary?: LocalSkillLibrary,
    private readonly github?: GithubSkillSourceReader,
  ) {}

  readGithub(link: string): Effect.Effect<GithubSkillSource, SkillMarketplaceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<GithubSkillSource, SkillMarketplaceFailure> {
      const github = yield* skillSync(() => this.requireGithub());
      return yield* github.read(link).pipe(toSkillMarketplaceFailure);
    });
  }

  listInstalled(agentId: string): Effect.Effect<InstalledSkill[], SkillMarketplaceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<InstalledSkill[], SkillMarketplaceFailure> {
      const agent = yield* skillSync(() => this.requireAgent(agentId));
      const lock = yield* readLock(agent.workspacePath);
      const installed: InstalledSkill[] = [];
      for (const entry of Object.values(lock.skills)) {
        let availableVersion = entry.version;
        const newest = entry.skillId.startsWith("local-skill-")
          ? yield* Effect.result(this.#localDetail(entry.skillId))
          : undefined;
        if (newest && Result.isSuccess(newest)) availableVersion = newest.success.version;
        const state = yield* installedState(agent.workspacePath, entry);
        installed.push(
          toInstalledSkill(
            entry,
            availableVersion,
            state,
            yield* installedSkillDescription(agent.workspacePath, entry),
          ),
        );
      }
      installed.push(...(yield* listFolderSkills(agent, lockedSlugs(lock)).pipe(toSkillMarketplaceFailure)));
      return installed.sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  lockedSkillIds(agentId: string): Effect.Effect<string[], SkillMarketplaceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<string[], SkillMarketplaceFailure> {
      const agent = yield* skillSync(() => this.requireAgent(agentId));
      return Object.keys((yield* readLock(agent.workspacePath)).skills);
    });
  }

  installedRevision(agentId: string, skillId: string): Effect.Effect<number | null, SkillMarketplaceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<number | null, SkillMarketplaceFailure> {
      const agent = yield* skillSync(() => this.requireAgent(agentId));
      return (yield* readLock(agent.workspacePath)).skills[skillId]?.version ?? null;
    });
  }

  #localDetail(skillId: string): Effect.Effect<MarketplaceSkillDetail, SkillMarketplaceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<MarketplaceSkillDetail, SkillMarketplaceFailure> {
      return yield* (yield* skillSync(() => this.requireLocalLibrary())).get(skillId).pipe(toSkillMarketplaceFailure);
    });
  }

  listInstalledForChatTags(
    agentId: string,
    options: { problems?: boolean } = {},
  ): Effect.Effect<InstalledSkill[], SkillMarketplaceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<InstalledSkill[], SkillMarketplaceFailure> {
      const agent = yield* skillSync(() => this.requireAgent(agentId));
      const lock = yield* readLock(agent.workspacePath);
      const installed: InstalledSkill[] = yield* listManagedSkillsForChat(agent).pipe(toSkillMarketplaceFailure);
      const parents = new Set(Object.values(lock.skills).map((entry) => entry.slug));
      for (const skill of yield* listFolderSkills(agent, parents).pipe(toSkillMarketplaceFailure))
        if (!skill.problem || options.problems) installed.push(skill);
      for (const entry of Object.values(lock.skills)) {
        if (entry.enabled === false) continue;
        installed.push(
          toInstalledSkill(
            entry,
            entry.version,
            yield* installedState(agent.workspacePath, entry),
            yield* installedSkillDescription(agent.workspacePath, entry),
          ),
        );
      }
      const usableSlugs = new Set(installed.flatMap((skill) => (skill.problem ? [] : [skill.slug])));
      const home = yield* listHomeFolderSkills(usableSlugs);
      const homeSlugs = new Set(home.map((skill) => skill.slug));
      return [...installed.filter((skill) => !(skill.problem && homeSlugs.has(skill.slug))), ...home].sort((a, b) =>
        a.name.localeCompare(b.name),
      );
    });
  }

  install(input: InstallSkillInput): Effect.Effect<InstalledSkill, SkillMarketplaceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<InstalledSkill, SkillMarketplaceFailure> {
      const address = parseGithubSkillId(input.skillId);
      if (address) {
        const agent = yield* skillSync(() => this.requireAgent(input.agentId));
        const github = yield* skillSync(() => this.requireGithub());
        const { detail, bundle } = yield* github.download(address).pipe(toSkillMarketplaceFailure);
        return yield* this.installResolved(agent, detail, bundle, input.replaceModified);
      }
      if (!input.skillId.startsWith("local-skill-"))
        return yield* new SkillMarketplaceFailure({ cause: new Error(sourceText("error.skill.notFound")) });
      if (input.versionId)
        return yield* new SkillMarketplaceFailure({ cause: new Error(sourceText("error.skill.localHasNoVersion")) });
      const agent = yield* skillSync(() => this.requireAgent(input.agentId));
      const detail = yield* this.#localDetail(input.skillId);
      const bundle = yield* this.requireLocalLibrary()
        .bundle(input.skillId, detail.version)
        .pipe(toSkillMarketplaceFailure);
      return yield* this.installResolved(agent, detail, bundle, input.replaceModified);
    });
  }

  private serialize<A>(
    agentId: string,
    operation: Effect.Effect<A, SkillMarketplaceFailure>,
  ): Effect.Effect<A, SkillMarketplaceFailure> {
    return Effect.suspend(() => {
      const entry = this.#writes.get(agentId) ?? { gate: Semaphore.makeUnsafe(1), users: 0 };
      entry.users += 1;
      this.#writes.set(agentId, entry);
      return entry.gate.withPermit(Effect.uninterruptible(operation)).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            entry.users -= 1;
            if (entry.users === 0) this.#writes.delete(agentId);
          }),
        ),
      );
    });
  }

  private installResolved(
    agent: AgentSummary,
    detail: MarketplaceSkillDetail,
    bundle: Uint8Array,
    replaceModified = false,
  ) {
    return this.serialize(agent.id, this.writeResolvedEffect(agent, detail, bundle, replaceModified));
  }

  private savedRevisionFolders(
    detail: MarketplaceSkillDetail,
  ): Effect.Effect<Map<string, Record<string, Uint8Array>>[]> {
    return Effect.gen({ self: this }, function* () {
      const library = this.localLibrary;
      if (!library || !detail.id.startsWith("local-skill-")) return [];
      const revisions = yield* Effect.result(library.revisions(detail.id));
      if (Result.isFailure(revisions)) return [];
      const result: Map<string, Record<string, Uint8Array>>[] = [];
      for (const revision of revisions.success) {
        if (revision === detail.version) continue;
        const files = yield* Effect.result(
          library.bundle(detail.id, revision).pipe(
            toSkillMarketplaceFailure,
            Effect.flatMap((bundle) => skillSync(() => normalizedFiles(bundle))),
          ),
        );
        if (Result.isSuccess(files))
          result.push(skillFolders(detail.slug, files.success, packChildren(detail.slug, files.success)));
      }
      return result;
    });
  }

  private writeResolvedEffect(
    agent: AgentSummary,
    detail: MarketplaceSkillDetail,
    bundle: Uint8Array,
    replaceModified = false,
  ): Effect.Effect<InstalledSkill, SkillMarketplaceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<InstalledSkill, SkillMarketplaceFailure> {
      if (sha256(bundle) !== detail.bundleSha256)
        return yield* new SkillMarketplaceFailure({ cause: new Error(sourceText("error.skill.bundleMismatch")) });
      const archive = yield* skillSync(() => inspectArchive(bundle));
      if (archive.slug !== detail.slug)
        return yield* new SkillMarketplaceFailure({ cause: new Error(sourceText("error.skill.metadataMismatch")) });
      const { files, executable } = yield* skillSync(() => readSkillArchive(bundle));
      const children = packChildren(detail.slug, files);
      const folders = skillFolders(detail.slug, files, children);
      const executableFolders = skillFolders(
        detail.slug,
        Object.fromEntries([...executable].map((name) => [name, true])),
        children,
      );
      for (const folder of folders.keys()) yield* assertSkillPaths(agent.workspacePath, folder);
      const lock = yield* readLock(agent.workspacePath);
      const replacedId = githubPredecessor(lock, detail.id);
      const existing = lock.skills[detail.id] ?? (replacedId ? lock.skills[replacedId] : undefined);
      if (
        Object.values(lock.skills).some(
          (entry) =>
            entry.skillId !== detail.id &&
            entry.skillId !== replacedId &&
            entryFolders(entry).some((folder) => folders.has(folder)),
        )
      )
        return yield* new SkillMarketplaceFailure({ cause: new Error(sourceText("error.skill.folderTaken")) });
      if (!existing && Object.keys(lock.skills).length >= INPUT_LIMITS.agentSkills) {
        return yield* new SkillMarketplaceFailure({
          cause: new Error(sourceText("error.skill.tooManySkills", { limit: INPUT_LIMITS.agentSkills })),
        });
      }
      if (existing) {
        const state = yield* installedState(agent.workspacePath, existing);
        if (
          state === "modified" &&
          !replaceModified &&
          !(yield* onlyNewFiles(agent.workspacePath, existing, [folders])) &&
          !(yield* onlyNewFiles(agent.workspacePath, existing, [
            folders,
            ...(yield* this.savedRevisionFolders(detail)),
          ]))
        )
          return yield* new SkillMarketplaceFailure({ cause: new Error(sourceText("error.skill.replaceModified")) });
      }
      const owned = new Set(Object.values(lock.skills).flatMap(entryFolders));
      for (const folder of folders.keys()) {
        if (owned.has(folder)) continue;
        if (MANAGED_SKILL_SLUGS.has(folder))
          return yield* new SkillMarketplaceFailure({
            cause: new Error(sourceText("error.skill.managedSlug", { slug: folder })),
          });
        for (const target of [
          ...targetDirectories(agent.workspacePath, folder),
          disabledDirectory(agent.workspacePath, folder),
        ]) {
          if (yield* pathExists(target))
            return yield* new SkillMarketplaceFailure({
              cause: new Error(sourceText("error.skill.unmanagedExists", { path: target })),
            });
        }
      }
      const receiptId = existing?.receiptId ?? randomUUID();
      const stayDisabled = existing?.enabled === false;
      yield* replaceTargets(
        [...folders].flatMap(([folder, folderFiles]) =>
          (stayDisabled
            ? [disabledDirectory(agent.workspacePath, folder)]
            : targetDirectories(agent.workspacePath, folder)
          ).map((target) => ({
            target,
            files: folderFiles,
            executable: new Set(Object.keys(executableFolders.get(folder) ?? {})),
          })),
        ),
      );
      for (const folder of existing ? entryFolders(existing) : [])
        if (!folders.has(folder)) yield* removeFolder(agent.workspacePath, folder, !stayDisabled);
      const entry: LockEntry = {
        skillId: detail.id,
        versionId: detail.versionId,
        slug: detail.slug,
        name: detail.name,
        version: detail.version,
        bundleSha256: detail.bundleSha256,
        receiptId,
        files: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, sha256(bytes)])),
        description: detail.description,
        ...(stayDisabled ? { enabled: false } : {}),
        ...(children.length > 0 ? { folders: children } : {}),
      };
      if (replacedId) delete lock.skills[replacedId];
      lock.skills[detail.id] = entry;
      yield* writeLock(agent.workspacePath, lock);
      yield* this.refreshAgentRuntime(agent.id).pipe(toSkillMarketplaceFailure);
      return toInstalledSkill(entry, detail.version, "installed", entry.description);
    });
  }

  uninstall(input: UninstallSkillInput): Effect.Effect<void, SkillMarketplaceFailure> {
    return this.serialize(input.agentId, this.removeInstalledEffect(input));
  }
  private removeInstalledEffect(input: UninstallSkillInput): Effect.Effect<void, SkillMarketplaceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<void, SkillMarketplaceFailure> {
      const agent = yield* skillSync(() => this.requireAgent(input.agentId));
      const lock = yield* readLock(agent.workspacePath);
      const entry = lock.skills[input.skillId];
      if (!entry) return;
      for (const folder of entryFolders(entry)) yield* assertSkillPaths(agent.workspacePath, folder);
      if ((yield* installedState(agent.workspacePath, entry)) === "modified" && !input.removeModified) {
        return yield* new SkillMarketplaceFailure({ cause: new Error(sourceText("error.skill.removeModified")) });
      }
      for (const folder of entryFolders(entry))
        yield* removeFolder(agent.workspacePath, folder, entry.enabled !== false);
      delete lock.skills[input.skillId];
      yield* writeLock(agent.workspacePath, lock);
      yield* this.refreshAgentRuntime(input.agentId).pipe(toSkillMarketplaceFailure);
    });
  }

  setEnabled(input: SetEnabledSkillInput): Effect.Effect<InstalledSkill, SkillMarketplaceFailure> {
    return this.serialize(input.agentId, this.changeEnabledEffect(input));
  }
  private changeEnabledEffect(input: SetEnabledSkillInput): Effect.Effect<InstalledSkill, SkillMarketplaceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<InstalledSkill, SkillMarketplaceFailure> {
      const agent = yield* skillSync(() => this.requireAgent(input.agentId));
      const lock = yield* readLock(agent.workspacePath);
      const entry = lock.skills[input.skillId];
      if (!entry) return yield* new SkillMarketplaceFailure({ cause: new Error(sourceText("error.skill.notFound")) });
      const folders = entryFolders(entry);
      for (const folder of folders) yield* assertSkillPaths(agent.workspacePath, folder);
      const currentlyEnabled = entry.enabled !== false;
      if (currentlyEnabled === input.enabled) {
        return toInstalledSkill(
          entry,
          entry.version,
          yield* installedState(agent.workspacePath, entry),
          yield* installedSkillDescription(agent.workspacePath, entry),
        );
      }
      if (!input.enabled) {
        const state = yield* installedState(agent.workspacePath, entry);
        if (state === "modified")
          return yield* new SkillMarketplaceFailure({ cause: new Error(sourceText("error.skill.disableModified")) });
        if (state === "needs-repair")
          return yield* new SkillMarketplaceFailure({ cause: new Error(sourceText("error.skill.disableNeedsRepair")) });
      }
      if (input.enabled) {
        for (const folder of folders) {
          if (!(yield* pathExists(disabledDirectory(agent.workspacePath, folder))))
            return yield* new SkillMarketplaceFailure({
              cause: new Error(sourceText("error.skill.enableNeedsRepair")),
            });
          for (const target of targetDirectories(agent.workspacePath, folder)) {
            if (yield* pathExists(target))
              return yield* new SkillMarketplaceFailure({
                cause: new Error(sourceText("error.skill.providerFolderOccupied")),
              });
          }
        }
        const writes: SkillFolderWrite[] = [];
        for (const folder of folders) {
          const { files, executable } = yield* readSkillFiles(disabledDirectory(agent.workspacePath, folder));
          for (const target of targetDirectories(agent.workspacePath, folder))
            writes.push({ target, files, executable });
        }
        yield* replaceTargets(writes);
        for (const folder of folders)
          yield* skillIO(() => rm(disabledDirectory(agent.workspacePath, folder), { recursive: true, force: true }));
        delete entry.enabled;
      } else {
        const moves: Array<{ source: string; stash: string }> = [];
        for (const folder of folders) {
          const [primary, fallback] = targetDirectories(agent.workspacePath, folder);
          const source = (yield* pathExists(primary)) ? primary : (yield* pathExists(fallback)) ? fallback : null;
          const stash = disabledDirectory(agent.workspacePath, folder);
          if (source) moves.push({ source, stash });
          else if (!(yield* pathExists(stash)))
            return yield* new SkillMarketplaceFailure({
              cause: new Error(sourceText("error.skill.disableNeedsRepair")),
            });
        }
        const moved: typeof moves = [];
        const outcome = yield* Effect.result(
          Effect.forEach(
            moves,
            (move) =>
              Effect.gen(function* () {
                yield* skillIO(() => mkdir(dirname(move.stash), { recursive: true, mode: 0o700 }));
                if (yield* pathExists(move.stash))
                  yield* skillIO(() => rm(move.stash, { recursive: true, force: true }));
                yield* skillIO(() => rename(move.source, move.stash));
                moved.push(move);
              }),
            { discard: true },
          ),
        );
        if (Result.isFailure(outcome)) {
          for (const move of moved.reverse())
            yield* skillIO(() => rename(move.stash, move.source)).pipe(Effect.catch(() => Effect.void));
          return yield* outcome.failure;
        }
        for (const folder of folders)
          for (const target of targetDirectories(agent.workspacePath, folder))
            yield* skillIO(() => rm(target, { recursive: true, force: true }));
        entry.enabled = false;
      }
      lock.skills[input.skillId] = entry;
      yield* writeLock(agent.workspacePath, lock);
      yield* this.refreshAgentRuntime(input.agentId).pipe(toSkillMarketplaceFailure);
      return toInstalledSkill(
        entry,
        entry.version,
        yield* installedState(agent.workspacePath, entry),
        yield* installedSkillDescription(agent.workspacePath, entry),
      );
    });
  }

  private requireAgent(agentId: string): AgentSummary {
    const agent = this.listAgents().find((candidate) => candidate.id === agentId);
    if (!agent) throw new Error(sourceText("error.skill.chooseLocalAgent"));
    return agent;
  }

  private requireGithub(): GithubSkillSourceReader {
    if (!this.github) throw new Error(sourceText("error.skill.githubUnavailable"));
    return this.github;
  }

  requireLocalLibrary(): LocalSkillLibrary {
    if (!this.localLibrary) throw new Error(sourceText("error.skill.localLibraryUnavailable"));
    return this.localLibrary;
  }

  installLocal(input: {
    agentId: string;
    skillId: string;
    revision: number;
  }): Effect.Effect<InstalledSkill, SkillMarketplaceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<InstalledSkill, SkillMarketplaceFailure> {
      const detail = yield* this.requireLocalLibrary()
        .get(input.skillId, input.revision)
        .pipe(toSkillMarketplaceFailure);
      const bundle = yield* this.requireLocalLibrary()
        .bundle(input.skillId, input.revision)
        .pipe(toSkillMarketplaceFailure);
      return yield* this.installResolved(yield* skillSync(() => this.requireAgent(input.agentId)), detail, bundle);
    });
  }
}

function targetDirectories(workspace: string, slug: string): [string, string] {
  const [agents, claude] = MANAGED_SKILL_FOLDERS;
  return [join(workspace, agents, slug), join(workspace, claude, slug)];
}

function disabledDirectory(workspace: string, slug: string): string {
  return join(workspace, ".openbot", "skills-disabled", slug);
}

function packChildren(slug: string, files: Record<string, Uint8Array>): string[] {
  return Object.keys(files)
    .flatMap((path) => {
      const child = /^skills\/([^/]+)\/SKILL\.md$/u.exec(path)?.[1];
      return child?.startsWith(`${slug}-`) && SKILL_FOLDER_PATTERN.test(child) ? [child] : [];
    })
    .sort();
}

function skillFolders<T>(slug: string, files: Record<string, T>, children: readonly string[]) {
  const folders = new Map<string, Record<string, T>>([[slug, {}]]);
  for (const [path, value] of Object.entries(files)) {
    const [root, child = "", ...rest] = path.split("/");
    const nested = root === "skills" && children.includes(child);
    const folder = nested ? child : slug;
    const bucket = folders.get(folder) ?? {};
    bucket[nested ? rest.join("/") : path] = value;
    folders.set(folder, bucket);
  }
  return folders;
}

function entryFolders(entry: LockEntry): string[] {
  return [entry.slug, ...(entry.folders ?? [])];
}

const removeFolder = Effect.fn("SkillMarketplace.removeFolder")(function* (
  workspace: string,
  folder: string,
  enabled: boolean,
) {
  for (const target of [...(enabled ? targetDirectories(workspace, folder) : []), disabledDirectory(workspace, folder)])
    yield* skillIO(() => rm(target, { recursive: true, force: true }));
});

function githubPredecessor(lock: SkillsLock, skillId: string): string | undefined {
  return Object.keys(lock.skills).find((key) => isOtherGithubCommit(skillId, key));
}

function toInstalledSkill(
  entry: LockEntry,
  availableVersion: number,
  state: "installed" | "modified" | "needs-repair" | "update-available",
  description?: string,
): InstalledSkill {
  const resolved = state === "installed" && availableVersion > entry.version ? "update-available" : state;
  const resolvedDescription = trimmedSkillDescription(description ?? entry.description);
  return {
    skillId: entry.skillId,
    slug: entry.slug,
    name: entry.name,
    installedVersion: entry.version,
    availableVersion,
    state: resolved,
    enabled: entry.enabled !== false,
    origin: entry.skillId.startsWith("local-skill-") ? "local" : "marketplace",
    ...(resolvedDescription ? { description: resolvedDescription } : {}),
  };
}

const installedSkillDescription = Effect.fn("SkillMarketplace.description")(function* (
  workspace: string,
  entry: LockEntry,
) {
  const stored = trimmedSkillDescription(entry.description);
  if (stored) return stored;
  const roots =
    entry.enabled === false ? [disabledDirectory(workspace, entry.slug)] : targetDirectories(workspace, entry.slug);
  for (const root of roots) {
    const result = yield* Effect.result(
      skillIO(() => readFile(join(root, "SKILL.md"), "utf8")).pipe(
        Effect.flatMap((text) => skillSync(() => parseSkillMarkdownDescription(text))),
      ),
    );
    if (Result.isSuccess(result) && result.success) return result.success;
  }
});

function trimmedSkillDescription(value: unknown): string | undefined {
  if (!isString(value)) return undefined;
  const description = value.trim();
  return description && description.length <= SKILL_DESCRIPTION_MAX_LENGTH ? description : undefined;
}

function parseSkillMarkdownDescription(text: string): string | undefined {
  const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
  if (!match) return undefined;
  const metadata = parseYaml(match[1] ?? "");
  if (!isDynamicRecord(metadata)) return undefined;
  return trimmedSkillDescription(metadata.description);
}

const readSkillFiles = Effect.fn("SkillMarketplace.readFiles")(function* (root: string) {
  const files: Record<string, Uint8Array> = {};
  const executable = new Set<string>();
  const visit = (directory: string): Effect.Effect<void, SkillMarketplaceFailure> =>
    Effect.gen(function* () {
      for (const entry of yield* skillIO(() => readdir(directory, { withFileTypes: true }))) {
        const path = join(directory, entry.name);
        if (entry.isSymbolicLink())
          return yield* new SkillMarketplaceFailure({ cause: new Error(sourceText("error.skill.symlinks")) });
        if (entry.isDirectory()) {
          if (!isRuntimeCacheFolder(entry.name)) yield* visit(path);
        } else if (entry.isFile()) {
          const name = relative(root, path).replaceAll("\\", "/");
          files[name] = new Uint8Array(yield* skillIO(() => readFile(path)));
          if ((yield* skillIO(() => lstat(path))).mode & 0o111) executable.add(name);
        }
      }
    });
  yield* visit(root);
  return { files, executable };
});

const HELD_SKILL_FOLDER_WAITS_MS: readonly number[] = [10, 50, 100, 250, 500, 1000, 1000];

const renameSkillFolder = Effect.fn("SkillMarketplace.renameFolder")(function* (from: string, to: string) {
  for (let attempt = 0; ; attempt += 1) {
    const renamed = yield* Effect.result(skillIO(() => rename(from, to)));
    if (Result.isSuccess(renamed)) return;
    const wait = HELD_SKILL_FOLDER_WAITS_MS[attempt];
    if (wait === undefined || !isHeldTargetError(renamed.failure.cause)) return yield* renamed.failure;
    yield* Effect.sleep(wait);
  }
});

interface SkillFolderContent {
  files: Record<string, Uint8Array>;
  executable: ReadonlySet<string>;
}

interface SkillFolderWrite extends SkillFolderContent {
  target: string;
}

const overwriteSkillFolder = Effect.fn("SkillMarketplace.overwriteFolder")(function* (
  root: string,
  { files, executable }: SkillFolderContent,
) {
  const paths = Object.keys(files);
  const prune = (directory: string): Effect.Effect<void, SkillMarketplaceFailure> =>
    Effect.gen(function* () {
      for (const entry of yield* skillIO(() => readdir(directory, { withFileTypes: true }))) {
        const path = join(directory, entry.name);
        const name = relative(root, path).replaceAll("\\", "/");
        if (entry.isDirectory()) {
          if (isRuntimeCacheFolder(entry.name)) continue;
          if (paths.some((expectedPath) => expectedPath.startsWith(`${name}/`))) yield* prune(path);
          else yield* skillIO(() => rm(path, { recursive: true, force: true, maxRetries: 5 }));
        } else if (!Object.hasOwn(files, name)) yield* skillIO(() => rm(path, { force: true, maxRetries: 5 }));
      }
    });
  yield* prune(root);
  yield* writeFiles(root, files, executable);
});

const overwriteHeldSkillFolder = Effect.fn("SkillMarketplace.overwriteHeldFolder")(function* (
  target: string,
  next: SkillFolderContent,
  previous: SkillFolderContent,
) {
  const written = yield* Effect.result(overwriteSkillFolder(target, next));
  if (Result.isSuccess(written)) return;
  yield* overwriteSkillFolder(target, previous).pipe(Effect.ignore);
  return yield* written.failure;
});

const replaceTargets = Effect.fn("SkillMarketplace.replaceTargets")(function* (
  writes: ReadonlyArray<SkillFolderWrite>,
) {
  const completed: Array<{ target: string; backup: string | null; previous?: SkillFolderContent }> = [];
  const outcome = yield* Effect.result(
    Effect.gen(function* () {
      for (const write of writes) {
        const { target, files, executable } = write;
        yield* skillIO(() => mkdir(dirname(target), { recursive: true, mode: 0o700 }));
        const stage = `${target}.openbot-stage-${randomUUID()}`;
        const backup = (yield* pathExists(target)) ? `${target}.openbot-backup-${randomUUID()}` : null;
        const previous = yield* Effect.gen(function* () {
          yield* writeFiles(stage, files, executable);
          if (backup) {
            const setAside = yield* Effect.result(renameSkillFolder(target, backup));
            if (Result.isFailure(setAside)) {
              if (!isHeldTargetError(setAside.failure.cause)) return yield* setAside.failure;
              const held = yield* readSkillFiles(target).pipe(Effect.mapError(() => setAside.failure));
              yield* overwriteHeldSkillFolder(target, write, held);
              yield* skillIO(() => rm(stage, { recursive: true, force: true, maxRetries: 5 })).pipe(Effect.ignore);
              return held;
            }
          }
          const moved = yield* Effect.result(renameSkillFolder(stage, target));
          if (Result.isSuccess(moved)) return;
          if (isHeldTargetError(moved.failure.cause) && !(yield* pathExists(target))) {
            const written = yield* Effect.result(writeFiles(target, files, executable));
            if (Result.isSuccess(written)) {
              yield* skillIO(() => rm(stage, { recursive: true, force: true, maxRetries: 5 })).pipe(Effect.ignore);
              return;
            }
            yield* skillIO(() => rm(target, { recursive: true, force: true, maxRetries: 5 })).pipe(Effect.ignore);
          }
          if (backup) yield* renameSkillFolder(backup, target);
          return yield* moved.failure;
        }).pipe(
          Effect.onError(() =>
            skillIO(() => rm(stage, { recursive: true, force: true, maxRetries: 5 })).pipe(Effect.ignore),
          ),
        );
        completed.push(previous ? { target, backup: null, previous } : { target, backup });
      }
    }),
  );
  if (Result.isFailure(outcome)) {
    for (const item of completed.reverse()) {
      if (item.previous) {
        yield* overwriteSkillFolder(item.target, item.previous).pipe(Effect.ignore);
        continue;
      }
      yield* skillIO(() => rm(item.target, { recursive: true, force: true }));
      const backup = item.backup;
      if (backup) yield* renameSkillFolder(backup, item.target).pipe(Effect.catch(() => Effect.void));
    }
    return yield* outcome.failure;
  }
  yield* Effect.forEach(
    completed,
    (item) => {
      const backup = item.backup;
      return backup ? skillIO(() => rm(backup, { recursive: true, force: true })) : Effect.void;
    },
    { concurrency: "unbounded", discard: true },
  );
}, Effect.uninterruptible);

const writeFiles = Effect.fn("SkillMarketplace.writeFiles")(function* (
  root: string,
  files: Record<string, Uint8Array>,
  executable: ReadonlySet<string>,
) {
  for (const [name, bytes] of Object.entries(files)) {
    const path = resolve(root, name);
    if (!path.startsWith(`${resolve(root)}/`) && !path.startsWith(`${resolve(root)}\\`))
      return yield* new SkillMarketplaceFailure({ cause: new Error("Unsafe skill path.") });
    yield* skillIO(() => mkdir(dirname(path), { recursive: true, mode: 0o700 }));
    yield* skillIO(() => writeFile(path, bytes, { mode: executable.has(name) ? 0o700 : 0o600 }));
  }
});

const hasUnexpectedSkillFiles = Effect.fn("SkillMarketplace.checkFiles")(function* (
  root: string,
  expected: Record<string, string>,
) {
  const paths = Object.keys(expected);
  const visit = (directory: string): Effect.Effect<boolean, SkillMarketplaceFailure> =>
    Effect.gen(function* () {
      for (const entry of yield* skillIO(() => readdir(directory, { withFileTypes: true }))) {
        const path = join(directory, entry.name);
        const name = relative(root, path).replaceAll("\\", "/");
        if (entry.isSymbolicLink()) return true;
        if (entry.isDirectory()) {
          if (isRuntimeCacheFolder(entry.name)) continue;
          if (!paths.some((expectedPath) => expectedPath.startsWith(`${name}/`)) || (yield* visit(path))) return true;
        } else if (!entry.isFile() || (!(name in expected) && entry.name !== FINDER_METADATA_FILE)) return true;
      }
      return false;
    });
  return yield* visit(root);
});

const installedState = Effect.fn("SkillMarketplace.installedState")(function* (
  workspace: string,
  entry: LockEntry,
): Effect.fn.Return<"installed" | "modified" | "needs-repair", SkillMarketplaceFailure> {
  let state: "installed" | "needs-repair" = "installed";
  for (const [folder, files] of skillFolders(entry.slug, entry.files, entry.folders ?? [])) {
    const folderState = yield* installedFolderState(workspace, folder, files, entry.enabled !== false);
    if (folderState === "modified") return folderState;
    if (folderState === "needs-repair") state = folderState;
  }
  return state;
});

const onlyNewFiles = Effect.fn("SkillMarketplace.onlyNewFiles")(function* (
  workspace: string,
  entry: LockEntry,
  accepted: ReadonlyArray<ReadonlyMap<string, Record<string, Uint8Array>>>,
): Effect.fn.Return<boolean, SkillMarketplaceFailure> {
  const enabled = entry.enabled !== false;
  for (const [folder, files] of skillFolders(entry.slug, entry.files, entry.folders ?? [])) {
    const acceptedHashes = accepted.flatMap((folders) => {
      const acceptedFiles = folders.get(folder);
      return acceptedFiles
        ? [Object.fromEntries(Object.entries(acceptedFiles).map(([name, bytes]) => [name, sha256(bytes)]))]
        : [];
    });
    target: for (const target of enabled
      ? targetDirectories(workspace, folder)
      : [disabledDirectory(workspace, folder)]) {
      if (!(yield* pathExists(target))) continue;
      for (const hashes of [files, ...acceptedHashes]) if (yield* copyHas(target, hashes)) continue target;
      return false;
    }
  }
  return true;
});

const copyHas = Effect.fn("SkillMarketplace.copyHas")(function* (
  target: string,
  files: Record<string, string>,
): Effect.fn.Return<boolean, SkillMarketplaceFailure> {
  const unexpected = yield* Effect.result(hasUnexpectedSkillFiles(target, files));
  if (Result.isFailure(unexpected) || unexpected.success) return false;
  for (const [name, hash] of Object.entries(files)) {
    if (isRuntimeCacheFile(name)) continue;
    const content = yield* Effect.result(skillIO(() => readFile(join(target, name))));
    if (Result.isFailure(content)) return false;
    const bytes = new Uint8Array(content.success);
    if (sha256(bytes) === hash) continue;
    if (name !== "SKILL.md") return false;
    const quoted = yield* Effect.result(skillSync(() => quotedSkillMarkdown(bytes)));
    if (Result.isFailure(quoted) || !quoted.success || sha256(quoted.success) !== hash) return false;
  }
  return true;
});

const installedFolderState = Effect.fn("SkillMarketplace.installedFolderState")(function* (
  workspace: string,
  folder: string,
  files: Record<string, string>,
  enabled: boolean,
): Effect.fn.Return<"installed" | "modified" | "needs-repair", SkillMarketplaceFailure> {
  const roots = enabled ? targetDirectories(workspace, folder) : [disabledDirectory(workspace, folder)];
  let complete = 0;
  let missing = false;
  for (const target of roots) {
    if (!(yield* pathExists(target))) continue;
    complete += 1;
    const unexpected = yield* Effect.result(hasUnexpectedSkillFiles(target, files));
    if (Result.isFailure(unexpected) || unexpected.success) return "modified";
    for (const [name, hash] of Object.entries(files)) {
      if (isRuntimeCacheFile(name)) continue;
      const content = yield* Effect.result(skillIO(() => readFile(join(target, name))));
      if (Result.isSuccess(content)) {
        if (sha256(new Uint8Array(content.success)) !== hash) return "modified";
      } else {
        const error = content.failure.cause;
        if (!isDynamicRecord(error) || error.code !== "ENOENT") return "modified";
        missing = true;
      }
    }
  }
  const expected = enabled ? 2 : 1;
  return complete === expected && !missing ? "installed" : "needs-repair";
});

function lockedSlugs(lock: SkillsLock): Set<string> {
  return new Set(Object.values(lock.skills).flatMap(entryFolders));
}

function lockPath(workspace: string): string {
  return join(workspace, ".openbot", "skills-lock.json");
}
const readLock = Effect.fn("SkillMarketplace.readLock")(function* (
  workspace: string,
): Effect.fn.Return<SkillsLock, SkillMarketplaceFailure> {
  const content = yield* Effect.result(skillIO(() => readFile(lockPath(workspace), "utf8")));
  if (Result.isFailure(content)) {
    const error = content.failure.cause;
    if (isDynamicRecord(error) && error.code === "ENOENT") return { version: 1, skills: {} };
    return yield* content.failure;
  }
  return yield* skillSync(() => {
    const value = JSON.parse(content.success);
    if (!isSkillsLock(value)) throw new Error(sourceText("error.skill.lockInvalid"));
    return value;
  });
});
export const readPackFolders = Effect.fn("SkillMarketplace.readPackFolders")(function* (workspace: string) {
  const lock = yield* readLock(workspace);
  return new Map(
    Object.values(lock.skills).flatMap(
      (entry): Array<[string, string[]]> => (entry.folders ? [[entry.slug, entry.folders]] : []),
    ),
  );
});
const writeLock = Effect.fn("SkillMarketplace.writeLock")((workspace: string, lock: SkillsLock) =>
  writeFileAtomically(lockPath(workspace), `${JSON.stringify(lock, null, 2)}\n`, { createDirectory: true }).pipe(
    toSkillMarketplaceFailure,
  ),
);
const pathExists = Effect.fn("SkillMarketplace.pathExists")((path: string) =>
  skillIO(() => lstat(path)).pipe(
    Effect.as(true),
    Effect.catch(() => Effect.succeed(false)),
  ),
);

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isLockEntry(value: unknown): value is LockEntry {
  return (
    isDynamicRecord(value) &&
    isString(value.skillId) &&
    (value.versionId === undefined || isString(value.versionId)) &&
    isString(value.slug) &&
    isString(value.name) &&
    isNumber(value.version) &&
    isString(value.bundleSha256) &&
    isString(value.receiptId) &&
    isDynamicRecord(value.files) &&
    Object.values(value.files).every(isString) &&
    (value.enabled === undefined || isBoolean(value.enabled)) &&
    (value.description === undefined || isString(value.description)) &&
    (value.folders === undefined ||
      (Array.isArray(value.folders) &&
        value.folders.every(
          (folder) => isString(folder) && folder.startsWith(`${value.slug}-`) && SKILL_FOLDER_PATTERN.test(folder),
        )))
  );
}

function isSkillsLock(value: unknown): value is SkillsLock {
  return (
    isDynamicRecord(value) &&
    value.version === 1 &&
    isDynamicRecord(value.skills) &&
    Object.values(value.skills).every(isLockEntry)
  );
}

const assertSkillPaths = Effect.fn("SkillMarketplace.checkPaths")(function* (workspace: string, slug: string) {
  for (const target of [
    ...targetDirectories(workspace, slug),
    disabledDirectory(workspace, slug),
    lockPath(workspace),
  ]) {
    let current = resolve(workspace);
    const parts = relative(current, target).split(/[\\/]/u);
    for (const part of ["", ...parts]) {
      current = join(current, part);
      const entry = yield* Effect.result(skillIO(() => lstat(current)));
      if (Result.isFailure(entry)) {
        const error = entry.failure.cause;
        if (isDynamicRecord(error) && error.code === "ENOENT") break;
        return yield* entry.failure;
      }
      if (entry.success.isSymbolicLink())
        return yield* new SkillMarketplaceFailure({ cause: new Error(sourceText("error.skill.installPathSymlink")) });
    }
  }
});

export class SkillMarketplaceFailure extends Schema.TaggedError<SkillMarketplaceFailure>()("SkillMarketplaceFailure", {
  cause: Schema.Defect(),
}) {}

const { io: skillIO, sync: skillSync, rewrap: toSkillMarketplaceFailure } = causeHelpers(SkillMarketplaceFailure);
