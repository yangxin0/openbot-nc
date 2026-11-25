import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";

interface AllowedPath {
  path: string;
  reason: string;
}

interface IgnoredSpelling {
  text: string;
  reason: string;
}

interface Hit {
  path: string;
  line: number;
  text: string;
}

const ROOT = resolve(import.meta.dirname, "..");
const EXCLUDED = [
  ":(glob,exclude)**/*.md",
  ":(glob,exclude)changelog.d/**",
  ":(glob,exclude)apps/mobile/changelog.d/**",
  ":(exclude)LICENSE",
  ":(exclude)NOTICE",
  ":(glob,exclude)**/bun.lock",
  ":(glob,exclude)**/package-lock.json",
  ":(glob,exclude)**/yarn.lock",
  ":(glob,exclude)packages/contracts/src/team-protocol/fixtures/**",
  ":(glob,exclude)src/renderer/src/vendor/**",
  ":(glob,exclude)packages/whatsapp/vendor/**",
  ":(glob,exclude)marketplace/production-catalog/bundles/**",
];
const VENDOR = /openbot\.run|nightly-labs|openpanel/giu;

const IGNORED_SPELLINGS: readonly IgnoredSpelling[] = [
  { text: "openPanel", reason: "camelCase identifiers for the verb phrase open panel, such as openPanelThread" },
];

const VENDOR_URL_BUILDERS =
  "vendor link and contact builders that desktop, team client or phone code still imports; Stage 3 and Stage 4 remove those callers.";

const ALLOWED_PATHS: readonly AllowedPath[] = [
  { path: "scripts/check-vendor-endpoints.ts", reason: "the vendor pattern of this check." },
  {
    path: "scripts/relay-extension-e2e.ts",
    reason: "the pattern that fails the test when the built extension names a vendor host.",
  },
  {
    path: "scripts/mcp-sign-in-client-metadata-document-e2e.ts",
    reason: "fixture: an MCP OAuth record that an older release stored with the vendor client metadata address.",
  },
  { path: "packages/contracts/src/invite-links.ts", reason: VENDOR_URL_BUILDERS },
  { path: "packages/contracts/src/plugin-links.ts", reason: VENDOR_URL_BUILDERS },
  { path: "packages/contracts/src/agent-template-links.ts", reason: VENDOR_URL_BUILDERS },
  { path: "packages/contracts/src/feedback.ts", reason: VENDOR_URL_BUILDERS },
  { path: "packages/contracts/src/hosted-servers.ts", reason: VENDOR_URL_BUILDERS },
  {
    path: "packages/contracts/src/ipc-agent-import.ts",
    reason: "HERMES_SKILL_COMMAND is shown only by the apps/mobile import guide; the desktop guide does not show it.",
  },
  {
    path: "packages/i18n/src/messages/*/mobile/server.ts",
    reason: "apps/mobile catalog; the desktop does not render these keys.",
  },
  {
    path: "src/renderer/src/features/updates/whats-new-releases.json",
    reason: "released What's new notes; history text that only the release process changes, not an address.",
  },
  {
    path: "src/renderer/src/features/updates/whats-new/*.json",
    reason: "translations of released What's new notes; history text, not an address.",
  },
];

const logger = createOpenBotLogger("check-vendor-endpoints");

function globExpression(glob: string): RegExp {
  const pattern = glob
    .split("**")
    .map((part) =>
      part
        .split("*")
        .map((text) => text.replace(/[.+?^${}()|[\]\\]/gu, "\\$&"))
        .join("[^/]*"),
    )
    .join(".*");
  return new RegExp(`^${pattern}$`, "u");
}

const allowed = ALLOWED_PATHS.map((entry) => ({ ...entry, expression: globExpression(entry.path), used: false }));

function scopedFiles(): string[] {
  const output = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ".", ...EXCLUDED],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  return [...new Set(output.split("\0").filter(Boolean))].sort();
}

function readText(path: string): string | null {
  let bytes: Buffer;
  try {
    bytes = readFileSync(resolve(ROOT, path));
  } catch {
    return null;
  }
  return bytes.includes(0) ? null : bytes.toString("utf8");
}

function vendorHits(path: string, text: string): Hit[] {
  const hits: Hit[] = [];
  for (const [index, line] of text.split("\n").entries()) {
    const matches = [...line.matchAll(VENDOR)].filter(
      (match) => !IGNORED_SPELLINGS.some((ignored) => match[0] === ignored.text),
    );
    if (matches.length > 0) hits.push({ path, line: index + 1, text: line.trim().slice(0, 160) });
  }
  return hits;
}

function main(): void {
  const refused: Hit[] = [];
  let scanned = 0;
  for (const path of scopedFiles()) {
    const text = readText(path);
    if (text === null) continue;
    scanned++;
    const hits = vendorHits(path, text);
    if (hits.length === 0) continue;
    const entry = allowed.find((candidate) => candidate.expression.test(path));
    if (entry) {
      entry.used = true;
      continue;
    }
    refused.push(...hits);
  }
  for (const hit of refused) logger.error(`${hit.path}:${hit.line}: vendor endpoint: ${hit.text}`);
  const stale = allowed.filter((entry) => !entry.used);
  for (const entry of stale) logger.error(`Allowed path with no vendor endpoint, remove it: ${entry.path}`);
  if (refused.length > 0 || stale.length > 0) {
    logger.error(
      `${refused.length} vendor endpoint lines and ${stale.length} unused allowed paths in ${scanned} files.`,
    );
    process.exitCode = 1;
    return;
  }
  logger.info(`No vendor endpoint outside the allowed paths in ${scanned} files.`);
}

main();
