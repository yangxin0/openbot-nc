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
const SCOPES = ["src", "packages", "resources", "electron-builder.yml", "scripts/hosting", "remote"];
const VENDOR = /openbot\.run|nightly-labs|openpanel/giu;

const IGNORED_SPELLINGS: readonly IgnoredSpelling[] = [
  { text: "openPanel", reason: "camelCase identifiers for the verb phrase open panel, such as openPanelThread" },
];

const MOBILE_AND_ACCOUNT_SERVICE =
  "apps/mobile or apps/auth-api still import it; no desktop code calls its vendor URL builders. Deleted with those apps.";
const SIGNAL_SERVICE =
  "deployment of the vendor Signal service for WebRTC peers; deleted with WebRTC and the vendor infrastructure.";
const HOSTED_SERVER_OPERATIONS =
  "vendor hosted-server pool operations for apps/auth-api; deleted with the vendor infrastructure.";

const ALLOWED_PATHS: readonly AllowedPath[] = [
  { path: "packages/contracts/src/invite-links.ts", reason: MOBILE_AND_ACCOUNT_SERVICE },
  { path: "packages/contracts/src/plugin-links.ts", reason: MOBILE_AND_ACCOUNT_SERVICE },
  { path: "packages/contracts/src/marketplace-links.ts", reason: MOBILE_AND_ACCOUNT_SERVICE },
  { path: "packages/contracts/src/agent-template-links.ts", reason: MOBILE_AND_ACCOUNT_SERVICE },
  { path: "packages/contracts/src/feedback.ts", reason: MOBILE_AND_ACCOUNT_SERVICE },
  { path: "packages/contracts/src/hosted-servers.ts", reason: MOBILE_AND_ACCOUNT_SERVICE },
  {
    path: "packages/contracts/src/ipc-agent-import.ts",
    reason: "HERMES_SKILL_COMMAND is shown only by the apps/mobile import guide; the desktop guide does not show it.",
  },
  {
    path: "packages/i18n/src/messages/*/mobile/server.ts",
    reason: "apps/mobile catalog; the desktop does not render these keys.",
  },
  {
    path: "packages/i18n/src/messages/*/extension.ts",
    reason: "apps/browser-extension catalog; the desktop does not render these keys.",
  },
  {
    path: "packages/telemetry/src/**",
    reason: "analytics transport of apps/mobile and apps/browser-extension; the desktop sends no analytics.",
  },
  {
    path: "packages/logging/src/identifiers.ts",
    reason: "maskIdentifiers is called only by the apps/mobile support log, which keeps vendor hosts readable.",
  },
  {
    path: "packages/logging/src/identifiers.test.ts",
    reason: "redaction test of maskIdentifiers for the apps/mobile support log.",
  },
  {
    path: "packages/ui/src/features/social-follow/social-networks.ts",
    reason: "used only by the apps/auth-api landing footer.",
  },
  {
    path: "src/renderer/src/features/updates/whats-new-releases.json",
    reason: "released What's new notes; history text that only the release process changes, not an address.",
  },
  {
    path: "src/renderer/src/features/updates/whats-new/*.json",
    reason: "translations of released What's new notes; history text, not an address.",
  },
  { path: "remote/.env.example", reason: SIGNAL_SERVICE },
  { path: "remote/.env.production", reason: SIGNAL_SERVICE },
  { path: "remote/README.md", reason: SIGNAL_SERVICE },
  { path: "remote/compose.yaml", reason: SIGNAL_SERVICE },
  { path: "remote/api/src/capacity-report.ts", reason: SIGNAL_SERVICE },
  { path: "remote/nginx/**", reason: SIGNAL_SERVICE },
  { path: "scripts/hosting/leaseweb-pool.ts", reason: HOSTED_SERVER_OPERATIONS },
  { path: "scripts/hosting/leaseweb-bootstrap-e2e.ts", reason: HOSTED_SERVER_OPERATIONS },
  { path: "scripts/hosting/pool-archive-e2e.ts", reason: HOSTED_SERVER_OPERATIONS },
  { path: "scripts/hosting/release-boat-template.sh", reason: HOSTED_SERVER_OPERATIONS },
  { path: "scripts/hosting/setup-account-server.ts", reason: HOSTED_SERVER_OPERATIONS },
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
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...SCOPES],
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
