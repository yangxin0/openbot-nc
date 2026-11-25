import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { runCauseEffect } from "../src/backend/effect-boundary";
import {
  LOCAL_PROFILE_FILE,
  type LocalProfile,
  type LocalProfileStore,
  openLocalProfileStore,
} from "../src/main/local-profile-store";
import { TEAM_STORE_FILE, TeamStore } from "../src/main/team-store";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", "local-profile-e2e");
const SESSION_FILE = "openbot-central-auth-v1.bin";
const SESSION_BYTES = "an old session file that this version must not read, change or delete";

interface OwnerFixture {
  accountId?: string;
  email?: string;
  name?: string;
  chatColor?: string;
  avatarUrl?: string;
}

function host(serverId: string, owner: OwnerFixture) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return {
    version: 1,
    serverId,
    serverName: `Server ${serverId}`,
    enabledOnLaunch: true,
    publicKey,
    privateKey,
    members: [
      {
        id: `owner-of-${serverId}`,
        ...(owner.accountId ? { accountId: owner.accountId } : {}),
        username: owner.email ?? "owner",
        email: owner.email ?? null,
        name: owner.name ?? null,
        avatarUrl: owner.avatarUrl ?? null,
        ...(owner.chatColor ? { chatColor: owner.chatColor } : {}),
        role: "owner",
        disabled: false,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: `member-of-${serverId}`,
        accountId: `member-account-${serverId}`,
        username: "member@example.com",
        email: "member@example.com",
        name: "Member",
        avatarUrl: "https://account.invalid/v1/avatars/member",
        role: "member",
        disabled: false,
        createdAt: "2026-01-02T00:00:00.000Z",
      },
    ],
    invites: [],
    sessions: [],
  };
}

async function directory(name: string, teamFile?: unknown): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), `openbot-local-profile-${name}-`));
  if (teamFile !== undefined) await writeFile(join(path, TEAM_STORE_FILE), JSON.stringify(teamFile));
  await writeFile(join(path, SESSION_FILE), SESSION_BYTES);
  return path;
}

async function open(path: string): Promise<{ team: TeamStore; profile: LocalProfileStore }> {
  const team = new TeamStore(join(path, TEAM_STORE_FILE));
  await runCauseEffect(team.initialize());
  const profile = await runCauseEffect(
    openLocalProfileStore(join(path, LOCAL_PROFILE_FILE), () => team.localProfileSeed()),
  );
  return { team, profile };
}

const storedTeamFile = z.object({ hosts: z.array(z.object({ serverId: z.string() }).loose()) });

async function storedHosts(path: string): Promise<string> {
  const text = await readFile(join(path, TEAM_STORE_FILE), "utf8");
  return JSON.stringify(storedTeamFile.parse(JSON.parse(text)).hosts);
}

const checks: Array<{ name: string; value: string }> = [];

function check<Value>(name: string, value: Value): Value {
  checks.push({ name, value: JSON.stringify(value) });
  return value;
}

const directories: string[] = [];
let passed = false;
let failure: string | undefined;

try {
  const fresh = await directory("fresh");
  directories.push(fresh);
  const first = await open(fresh);
  const second = await open(fresh);
  const newInstallationIdIsStable = check(
    "newInstallationIdIsStable",
    first.profile.get().id === second.profile.get().id,
  );
  const newInstallationHasNoHost = check("newInstallationHasNoHost", first.team.getIdentity() === null);
  assert.match(first.profile.get().id, /^[0-9a-f-]{36}$/u);
  assert.equal(newInstallationIdIsStable, true);
  assert.equal(newInstallationHasNoHost, true);

  const active = await directory("active", {
    version: 2,
    activeAccountId: "account-b",
    hosts: [
      host("a", { accountId: "account-a", email: "a@example.com", name: "Ann" }),
      host("b", {
        accountId: "account-b",
        email: "b@example.com",
        name: "Ben",
        chatColor: "#3366ff",
        avatarUrl: "https://account.invalid/v1/avatars/ben",
      }),
    ],
  });
  directories.push(active);
  const activeOpened = await open(active);
  const activeHostOwner = check("activeHostOwner", activeOpened.profile.get());
  assert.deepEqual(activeHostOwner, { id: "account-b", name: "Ben", chatColor: "#3366ff" });

  const changes: LocalProfile[] = [];
  activeOpened.profile.on("changed", (profile) => changes.push(profile));
  const user = activeOpened.profile.get();
  await runCauseEffect(activeOpened.team.activateOwner(user));
  activeOpened.team.assertOwner(user);
  await runCauseEffect(activeOpened.team.syncOwnerProfile(user));
  const owner = activeOpened.team.listMembers().find((member) => member.role === "owner");
  const member = activeOpened.team.listMembers().find((candidate) => candidate.role === "member");
  const existingHost = check("existingHost", {
    serverId: activeOpened.team.getIdentity()?.serverId,
    ownerMemberId: activeOpened.team.accountMemberId("account-b"),
    ownerEmail: owner?.email,
    ownerUsername: owner?.username,
    ownerAvatarUrl: owner?.avatarUrl,
    memberDisabled: member?.disabled,
  });
  assert.deepEqual(existingHost, {
    serverId: "b",
    ownerMemberId: "owner-of-b",
    ownerEmail: "b@example.com",
    ownerUsername: "b@example.com",
    ownerAvatarUrl: null,
    memberDisabled: false,
  });

  const renamed = await runCauseEffect(activeOpened.profile.update({ name: "Benjamin" }));
  const colored = await runCauseEffect(activeOpened.profile.update({ chatColor: "#aa5500" }));
  assert.equal(renamed.name, "Benjamin");
  assert.equal(colored.chatColor, "#aa5500");
  const profileChanges = check(
    "profileChanges",
    changes.map((change) => [change.name, change.chatColor]),
  );
  assert.deepEqual(profileChanges, [
    ["Benjamin", "#3366ff"],
    ["Benjamin", "#aa5500"],
  ]);
  const profileAfterEdit = check("profileAfterEdit", (await open(active)).profile.get());
  assert.deepEqual(profileAfterEdit, { id: "account-b", name: "Benjamin", chatColor: "#aa5500" });
  await runCauseEffect(activeOpened.team.syncOwnerProfile(activeOpened.profile.get()));
  const editedOwner = activeOpened.team.listMembers().find((candidate) => candidate.role === "owner");
  const ownerAfterEdit = check("ownerAfterEdit", { name: editedOwner?.name, chatColor: editedOwner?.chatColor });
  assert.deepEqual(ownerAfterEdit, { name: "Benjamin", chatColor: "#aa5500" });
  const sessionFileKept = check(
    "sessionFileKept",
    (await readFile(join(active, SESSION_FILE), "utf8")) === SESSION_BYTES,
  );
  assert.equal(sessionFileKept, true);

  const single = await directory("single", {
    version: 2,
    activeAccountId: null,
    hosts: [host("c", { accountId: "account-c", email: "c@example.com", name: "Cy" })],
  });
  directories.push(single);
  const singleOpened = await open(single);
  const signedOutWithOneOwner = check("signedOutWithOneOwner", singleOpened.profile.get());
  assert.deepEqual(signedOutWithOneOwner, { id: "account-c", name: "Cy", chatColor: null });
  await runCauseEffect(singleOpened.team.activateOwner(singleOpened.profile.get()));
  const signedOutWithOneOwnerHost = check("signedOutWithOneOwnerHost", singleOpened.team.getIdentity()?.serverId);
  assert.equal(signedOutWithOneOwnerHost, "c");

  const several = await directory("several", {
    version: 2,
    activeAccountId: null,
    hosts: [
      host("d", { accountId: "account-d", email: "d@example.com" }),
      host("e", { accountId: "account-e", email: "e@example.com" }),
    ],
  });
  directories.push(several);
  const hostsBefore = await storedHosts(several);
  const severalOpened = await open(several);
  await runCauseEffect(severalOpened.team.activateOwner(severalOpened.profile.get()));
  const signedOutWithSeveralOwners = check("signedOutWithSeveralOwners", {
    newId: !["account-d", "account-e"].includes(severalOpened.profile.get().id),
    activeHost: severalOpened.team.getIdentity()?.serverId ?? null,
    hostsUnchanged: JSON.stringify(await storedHosts(several)) === JSON.stringify(hostsBefore),
  });
  assert.deepEqual(signedOutWithSeveralOwners, { newId: true, activeHost: null, hostsUnchanged: true });

  const created = await directory("created");
  directories.push(created);
  const createdOpened = await open(created);
  const createdUser = createdOpened.profile.get();
  await runCauseEffect(createdOpened.team.activateOwner(createdUser));
  await runCauseEffect(createdOpened.team.configureForOwner("My computer", createdUser));
  createdOpened.team.assertOwner(createdUser);
  const createdOwner = createdOpened.team.listMembers().find((candidate) => candidate.role === "owner");
  const reopened = await open(created);
  await runCauseEffect(reopened.team.activateOwner(createdUser));
  const hostOfProfileWithNoEmail = check("hostOfProfileWithNoEmail", {
    ownerEmail: createdOwner?.email,
    ownerUsername: createdOwner?.username,
    ownerMemberFound: createdOpened.team.accountMemberId(createdUser.id) === createdOwner?.id,
    sameHostAfterRestart: reopened.team.getIdentity()?.serverId === createdOpened.team.getIdentity()?.serverId,
  });
  assert.deepEqual(hostOfProfileWithNoEmail, {
    ownerEmail: null,
    ownerUsername: "owner",
    ownerMemberFound: true,
    sameHostAfterRestart: true,
  });
  passed = true;
} catch (error) {
  failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  await Promise.all(directories.map((path) => rm(path, { recursive: true, force: true })));
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed, checks, failure }, null, 2)}\n`);
}

process.stdout.write(`${JSON.stringify({ passed, report: join(OUT, "report.json") })}\n`);
if (!passed) {
  process.stderr.write(`${failure}\n`);
  process.exitCode = 1;
}
