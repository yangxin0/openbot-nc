import {
  GITHUB_SKILL_INSTRUCTIONS_MAX_LENGTH,
  GITHUB_SKILLS_PER_LINK,
  type GithubSkill,
  type GithubSkillSource,
  INSTALLED_SKILL_ORIGINS,
  type InstalledSkill,
  isGithubCommit,
  isSkillCategory,
  isSkillNote,
  type MarketplaceSkillDetail,
  parseGithubSkillId,
  SKILL_DESCRIPTION_MAX_LENGTH,
} from "@openbot/contracts/ipc";
import {
  decodeRecord,
  nullableString,
  requiredBoolean,
  requiredNumber,
  requiredString,
} from "@openbot/contracts/ipc-decoding";
import { isBoolean, isOneOf, isString } from "@openbot/contracts/runtime-values";

function decodeSkillSummary(value: unknown) {
  const item = decodeRecord(value, "marketplace skill");
  if (!isSkillCategory(item.category)) throw new Error("Invalid skill category.");
  return {
    id: requiredString(item, "id"),
    slug: requiredString(item, "slug"),
    name: requiredString(item, "name"),
    description: requiredString(item, "description"),
    category: item.category,
    creatorName: requiredString(item, "creatorName"),
    creatorAvatarUrl: item.creatorAvatarUrl === undefined ? null : nullableString(item, "creatorAvatarUrl"),
    version: requiredNumber(item, "version"),
    installs: requiredNumber(item, "installs"),
    featured: requiredBoolean(item, "featured"),
    ...(isBoolean(item.verified) ? { verified: item.verified } : {}),
    iconUrl: nullableString(item, "iconUrl"),
    updatedAt: requiredString(item, "updatedAt"),
  };
}

export function decodeSkillDetails(value: unknown): MarketplaceSkillDetail[] {
  if (!Array.isArray(value)) throw new Error("Invalid local skill list.");
  return value.map(decodeSkillDetail);
}

export function decodeSkillDetail(value: unknown): MarketplaceSkillDetail {
  const item = decodeRecord(value, "skill detail");
  const summary = decodeSkillSummary(item);
  if (!Array.isArray(item.files) || !item.files.every(isString)) throw new Error("Invalid skill files.");
  return {
    ...summary,
    versionId: requiredString(item, "versionId"),
    bundleSha256: requiredString(item, "bundleSha256"),
    files: item.files,
    instructions: requiredString(item, "instructions"),
    ...(isString(item.examplePrompt) && item.examplePrompt.trim().length <= 1000
      ? { examplePrompt: item.examplePrompt.trim() }
      : {}),
  };
}

export function decodeInstalledSkill(value: unknown): InstalledSkill {
  const item = decodeRecord(value, "installed skill");
  const state = item.state;
  if (!isOneOf(["installed", "update-available", "modified", "needs-repair"], state)) {
    throw new Error("Invalid installed skill state.");
  }
  const description = optionalSkillDescription(item.description);
  return {
    skillId: requiredString(item, "skillId"),
    slug: requiredString(item, "slug"),
    name: requiredString(item, "name"),
    installedVersion: requiredNumber(item, "installedVersion"),
    availableVersion: requiredNumber(item, "availableVersion"),
    state,
    ...(item.enabled === false ? { enabled: false } : item.enabled === true ? { enabled: true } : {}),
    ...(isOneOf(INSTALLED_SKILL_ORIGINS, item.origin) ? { origin: item.origin } : {}),
    ...(description ? { description } : {}),
    ...(isSkillNote(item.location) ? { location: item.location } : {}),
    ...(isSkillNote(item.problem) ? { problem: item.problem } : {}),
  };
}

function optionalSkillDescription(value: unknown): string | undefined {
  if (!isString(value)) return undefined;
  const description = value.trim();
  return description && description.length <= SKILL_DESCRIPTION_MAX_LENGTH ? description : undefined;
}

function decodeGithubSkill(value: unknown): GithubSkill {
  const item = decodeRecord(value, "GitHub skill");
  const id = requiredString(item, "id");
  const instructions = requiredString(item, "instructions");
  if (!parseGithubSkillId(id) || instructions.length > GITHUB_SKILL_INSTRUCTIONS_MAX_LENGTH)
    throw new Error("Invalid GitHub skill.");
  if (!Array.isArray(item.files) || !item.files.every(isString)) throw new Error("Invalid GitHub skill files.");
  return {
    id,
    path: requiredString(item, "path"),
    slug: requiredString(item, "slug"),
    name: requiredString(item, "name"),
    description: requiredString(item, "description"),
    instructions,
    files: item.files,
  };
}

export function decodeGithubSkillSourceFromMain(value: unknown): GithubSkillSource {
  const item = decodeRecord(value, "GitHub skills");
  const commit = requiredString(item, "commit");
  if (!isGithubCommit(commit)) throw new Error("Invalid GitHub commit.");
  if (!Array.isArray(item.skills) || item.skills.length > GITHUB_SKILLS_PER_LINK)
    throw new Error("Invalid GitHub skills.");
  return {
    owner: requiredString(item, "owner"),
    repo: requiredString(item, "repo"),
    commit,
    committedAt: requiredString(item, "committedAt"),
    path: requiredString(item, "path"),
    skills: item.skills.map(decodeGithubSkill),
  };
}

export function decodeInstalledSkillsFromMain(value: unknown): InstalledSkill[] {
  if (!Array.isArray(value)) throw new Error("Invalid installed skills.");
  return value.map(decodeInstalledSkill);
}
