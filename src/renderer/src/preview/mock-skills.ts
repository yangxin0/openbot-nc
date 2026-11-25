import {
  type GithubSkillSource,
  githubSkillDetail,
  githubSkillId,
  type InstalledSkill,
  isGithubSkillId,
  type MarketplaceSkillDetail,
  type OpenBotDesktopApi,
} from "@openbot/contracts/ipc";
import { STORY_INSTALLED_SKILLS, STORY_MARKETPLACE_SKILL_DETAILS } from "./fixtures";
import { clone } from "./mock-support";

export interface MockSkillsOptions {
  localSkills?: MarketplaceSkillDetail[];
  installedSkills?: Record<string, InstalledSkill[]>;
}

function storyReleaseNotesSkill(): MarketplaceSkillDetail {
  const skill = STORY_MARKETPLACE_SKILL_DETAILS["skill-release-notes"];
  if (!skill) throw new Error("The release notes skill fixture is missing.");
  return skill;
}
const GITHUB_COMMIT = "c5d8b1e2f4a6c8e0b2d4f6a8c0e2b4d6f8a0c2e4";
const GITHUB_SKILLS: readonly (readonly [string, string])[] = [
  ["docx", "Creates, edits and reads Word documents, with tracked changes and comments."],
  ["frontend-design", "Builds distinctive, production-grade web interfaces."],
  ["mcp-builder", "Guides the build of an MCP server in Python or TypeScript."],
  ["pdf", "Extracts text and tables, fills in forms, and merges or splits PDF files."],
  ["skill-creator", "Helps write a new skill and test it."],
  ["xlsx", "Creates and edits spreadsheets with formulas, formatting and charts."],
];

function mockGithubSource(): GithubSkillSource {
  return {
    owner: "anthropics",
    repo: "skills",
    commit: GITHUB_COMMIT,
    committedAt: "2026-10-28T14:12:00.000Z",
    path: "",
    skills: GITHUB_SKILLS.map(([slug, description]) => {
      const path = `skills/${slug}`;
      return {
        id: githubSkillId({ owner: "anthropics", repo: "skills", commit: GITHUB_COMMIT, path }),
        path,
        slug,
        name: slug,
        description,
        instructions: `# ${slug}\n\n${description}\n`,
        files: ["SKILL.md", "reference.md"],
      };
    }),
  };
}

function readMockGithub(link: string): GithubSkillSource {
  const match = /^(?:https?:\/\/)?(?:www\.)?github\.com\/anthropics\/skills(?:\/(?:tree|blob)\/[^/]+\/?(.*))?$/iu.exec(
    link.trim(),
  );
  if (!match)
    throw new Error("OpenBot-NC cannot open this repository. The repository is private, or it does not exist.");
  const folder = (match[1] ?? "").replace(/\/?SKILL\.md$/iu, "").replace(/\/$/u, "");
  const source = mockGithubSource();
  const skills = source.skills.filter(
    (skill) => !folder || skill.path === folder || skill.path.startsWith(`${folder}/`),
  );
  if (skills.length === 0) throw new Error(`There is no SKILL.md in ${folder}.`);
  return { ...source, path: folder, skills };
}

function mockGithubDetail(skillId: string): MarketplaceSkillDetail | undefined {
  const source = mockGithubSource();
  const skill = source.skills.find((item) => item.id === skillId);
  return skill && githubSkillDetail(source, skill);
}

export function createMockSkills(options: MockSkillsOptions, onChanged: (agentId: string) => void = () => {}) {
  const localSkills = clone(
    options.localSkills ?? [
      {
        ...storyReleaseNotesSkill(),
        id: "local-skill-11111111-1111-4111-8111-111111111111",
        name: "Weekly summary",
        slug: "weekly-summary",
        creatorName: "Local",
        version: 1,
        versionId: "1",
      },
    ],
  );
  const localRevisions = new Map(localSkills.map((skill) => [`${skill.id}:${skill.version}`, skill]));
  const installedSkills = new Map(Object.entries(clone(options.installedSkills ?? STORY_INSTALLED_SKILLS)));

  function readInstalledSkills(agentId: string): InstalledSkill[] {
    return installedSkills.get(agentId) ?? [];
  }

  function writeInstalled(agentId: string, next: InstalledSkill[]): void {
    installedSkills.set(agentId, next);
    onChanged(agentId);
  }

  const skills: OpenBotDesktopApi["skills"] = {
    localList: async () => clone(localSkills),
    localGet: async ({ skillId, revision }) => {
      const skill = revision
        ? localRevisions.get(`${skillId}:${revision}`)
        : localSkills.find((item) => item.id === skillId);
      if (!skill) throw new Error("Local skill not found.");
      return clone(skill);
    },
    localCreate: async ({ agentId, sourcePath }) => {
      const name = sourcePath.split("/").at(-1) || "New skill";
      const skill = {
        ...storyReleaseNotesSkill(),
        id: `local-skill-${crypto.randomUUID()}`,
        name,
        slug: name,
        creatorName: "Local",
        version: 1,
        versionId: "1",
      };
      localSkills.push(skill);
      localRevisions.set(`${skill.id}:1`, skill);
      await skills.localInstall({ agentId, skillId: skill.id, revision: 1 });
      return clone(skill);
    },
    localRevise: async ({ agentId, skillId, expectedRevision }) => {
      const index = localSkills.findIndex((item) => item.id === skillId);
      const current = localSkills[index];
      if (!current || current.version !== expectedRevision)
        throw new Error("The skill changed. Read its latest revision before revising it.");
      const skill = { ...current, version: expectedRevision + 1, versionId: String(expectedRevision + 1) };
      localSkills[index] = skill;
      localRevisions.set(`${skill.id}:${skill.version}`, skill);
      if (readInstalledSkills(agentId).some((item) => item.skillId === skillId))
        await skills.localInstall({ agentId, skillId, revision: skill.version });
      return clone(skill);
    },
    localInstall: async ({ agentId, skillId, revision }) => {
      const skill = await skills.localGet({ skillId, revision });
      const previous = readInstalledSkills(agentId).find((item) => item.skillId === skillId);
      if (previous?.state === "modified")
        throw new Error("This skill has local changes. Confirm replacement to continue.");
      const installed: InstalledSkill = {
        skillId,
        name: skill.name,
        slug: skill.slug,
        installedVersion: revision,
        availableVersion: revision,
        state: "installed",
        origin: "local",
        enabled: previous?.enabled !== false,
        description: skill.description,
      };
      writeInstalled(agentId, [...readInstalledSkills(agentId).filter((item) => item.skillId !== skillId), installed]);
      return clone(installed);
    },
    listInstalled: async (agentId) =>
      clone(
        readInstalledSkills(agentId).map((skill) => {
          const latest = localSkills.find((item) => item.id === skill.skillId);
          return latest
            ? {
                ...skill,
                availableVersion: latest.version,
                state:
                  skill.state === "installed" && latest.version > skill.installedVersion
                    ? "update-available"
                    : skill.state,
              }
            : skill;
        }),
      ),
    install: async ({ agentId, skillId }) => {
      if (skillId.startsWith("local-skill-")) {
        const skill = await skills.localGet({ skillId });
        return skills.localInstall({ agentId, skillId, revision: skill.version });
      }
      const skill = isGithubSkillId(skillId) ? mockGithubDetail(skillId) : undefined;
      if (!skill) throw new Error("Skill not found");
      const previous = readInstalledSkills(agentId).find((item) => item.skillId === skillId);
      const installed: InstalledSkill = {
        skillId: skill.id,
        slug: skill.slug,
        name: skill.name,
        installedVersion: skill.version,
        availableVersion: skill.version,
        state: "installed",
        enabled: previous?.enabled !== false,
        origin: previous?.origin ?? "marketplace",
        description: skill.description,
      };
      writeInstalled(agentId, [...readInstalledSkills(agentId).filter((item) => item.skillId !== skillId), installed]);
      return clone(installed);
    },
    uninstall: async ({ agentId, skillId }) => {
      const skill = readInstalledSkills(agentId).find((item) => item.skillId === skillId);
      if (skill?.origin === "managed") throw new Error("This skill is managed by OpenBot.");
      writeInstalled(
        agentId,
        readInstalledSkills(agentId).filter((item) => item.skillId !== skillId),
      );
    },
    setEnabled: async ({ agentId, skillId, enabled }) => {
      const current = readInstalledSkills(agentId);
      const skill = current.find((item) => item.skillId === skillId);
      if (!skill) throw new Error("Skill not found.");
      if (skill.origin === "managed") throw new Error("This skill is managed by OpenBot.");
      const next: InstalledSkill = { ...skill, enabled };
      writeInstalled(
        agentId,
        current.map((item) => (item.skillId === skillId ? next : item)),
      );
      return clone(next);
    },
  };

  return {
    skills,
    installedSkills,
    readInstalledSkills,
    readGithub: async (link: string) => clone(readMockGithub(link)),
  };
}
