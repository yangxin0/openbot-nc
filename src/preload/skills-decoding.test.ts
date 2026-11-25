import { describe, expect, it } from "vitest";
import { decodeSkillDetail, decodeSkillDetails } from "./skills-decoding";

const DETAIL = {
  category: "coding",
  id: "local-skill-0f8fad5b-d9cb-469f-a165-70867728950e",
  slug: "release-scout",
  name: "Release Scout",
  description: "Checks every release.",
  creatorName: "Ada",
  creatorAvatarUrl: null,
  version: 1,
  installs: 0,
  featured: false,
  iconUrl: null,
  updatedAt: "2026-10-31T00:00:00.000Z",
  versionId: "1",
  bundleSha256: "0".repeat(64),
  files: ["SKILL.md"],
  instructions: "Check every release.",
};

describe("Skill detail decoding", () => {
  it.each([true, false])("keeps verified %s in a skill list", (verified) => {
    expect(decodeSkillDetails([{ ...DETAIL, verified }])[0]?.verified).toBe(verified);
  });

  it.each([
    ["absent", {}],
    ["not a boolean", { verified: "yes" }],
  ])("leaves out a verified flag that is %s", (_name, flags) => {
    expect(decodeSkillDetail({ ...DETAIL, ...flags })).not.toHaveProperty("verified");
  });
});
