import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { HostStatus, RelayState } from "@openbot/contracts/ipc";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect } from "effect";
import { chromium, type Page } from "playwright-core";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { RelaySetupError } from "../src/main/relay-service";
import { ServerMode, type ServerModeOptions } from "../src/main/server-mode";
import { ServerSetupPage } from "../src/main/server-setup-page";

const logger = createOpenBotLogger("server-setup-page-e2e");
const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, ".openbot-build/server-setup-page-e2e");
const browserExecutable = process.argv.find((value) => value.startsWith("--browser-executable="))?.split("=")[1];
const rendererRoot = resolve(
  process.argv.find((value) => value.startsWith("--renderer="))?.split("=")[1] ?? join(ROOT, "out/renderer"),
);
if (!existsSync(join(rendererRoot, "server-setup.html"))) {
  throw new Error(`${rendererRoot} has no server-setup.html. Build the renderer first: bun run build.`);
}

const IDENTITY_PATH = "/srv/openbot/server.json";
const INVALID_IDENTITY =
  'This identity file is not valid. Use a file that the "ca issue" command of the relay server made.';
const SERVER_NAME = "Build";
const IMPORT_COMMAND = "openbot import-identity <file>";

const offline: RelayState = {
  identity: null,
  identityIssue: null,
  control: { status: "offline", code: "stopped", message: null, retryInMs: null },
  members: [],
  hosting: false,
  hostingState: { status: "off", message: null },
};
let relayState: RelayState = structuredClone(offline);
const importedPaths: string[] = [];
const relay: ServerModeOptions["relay"] = {
  state: () => structuredClone(relayState),
  importFile: (path: string, replace: boolean) =>
    Effect.suspend(() => {
      importedPaths.push(path);
      if (path !== IDENTITY_PATH || (relayState.identity && !replace))
        return Effect.fail(new RelaySetupError({ cause: new Error(INVALID_IDENTITY) }));
      relayState = {
        ...relayState,
        identity: {
          team: "Acme",
          user: "server",
          device: "rack-1",
          keyId: "k".repeat(43),
          relayUrl: "wss://relay.example.com/v1/relay",
          expiresAt: Date.now() + 86_400_000,
        },
        control: { status: "online" },
      };
      return Effect.succeed(structuredClone(relayState));
    }),
  setHosting: (enabled: boolean) =>
    Effect.sync(() => {
      relayState = {
        ...relayState,
        hosting: enabled,
        hostingState: enabled
          ? { status: "online", message: "Your team can connect to this OpenBot-NC through the relay server." }
          : { status: "off", message: null },
      };
      return structuredClone(relayState);
    }),
  resumeHosting: () => Effect.void,
};

let hostStatus: HostStatus = {
  phase: "idle",
  configured: false,
  enabledOnLaunch: false,
  serverId: null,
  serverName: null,
  apiUrl: null,
  logoUrl: null,
  appearance: null,
  apiOnline: false,
  message: null,
};
const host: ServerModeOptions["host"] = {
  getStatus: () => structuredClone(hostStatus),
  configure: (input) =>
    Effect.sync(() => {
      hostStatus = { ...hostStatus, configured: true, serverName: input.serverName, serverId: "server-e2e" };
      return structuredClone(hostStatus);
    }),
  updateIdentity: (input) =>
    Effect.sync(() => {
      hostStatus = { ...hostStatus, serverName: input.serverName ?? hostStatus.serverName };
      return structuredClone(hostStatus);
    }),
};

const runtime = await mkdtemp(join(tmpdir(), "openbot-setup-page-"));
const controlSocketPath = join(runtime, "control.sock");
const serverMode = new ServerMode({
  environment: { controlSocketPath, setupPagePort: null },
  version: "0.0.0-e2e",
  relay,
  host,
  memory: null,
  onError: (message, error) => logger.warn(message, error),
});
await runCauseEffect(serverMode.listen());
const port = await freePort();
const page = new ServerSetupPage({
  port,
  address: "127.0.0.1",
  rendererRoot,
  request: serverMode.setupRequest,
  onError: (message, error) => logger.warn(message, error),
});
await runCauseEffect(page.listen());
const origin = `http://127.0.0.1:${port}`;

interface Checks {
  page?: { status: number; policy: string };
  refusals?: Record<string, number>;
  controlRefusals?: Record<string, number>;
  identityMissing?: { heading: string; command: boolean };
  invalidImport?: { status: number; error: string | undefined; message: string | undefined };
  imported?: { status: number; identity: string | undefined; team: string | undefined; user: string | undefined };
  notShared?: string;
  shared?: { hosting: string | undefined; heading: string };
  language?: string;
}
const checks: Checks = {};
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

try {
  const pageResponse = await fetch(`${origin}/`);
  assert.equal(pageResponse.status, 200);
  const policy = pageResponse.headers.get("content-security-policy") ?? "";
  assert.match(policy, /default-src 'none'/u);
  assert.match(policy, /script-src 'self'(;|$)/u);
  assert.match(policy, /form-action 'none'/u);
  checks.page = { status: pageResponse.status, policy };

  const post = (path: string) => fetch(`${origin}${path}`, { method: "POST", headers: { "x-openbot-setup": "1" } });
  const refusals = {
    noHeader: (await fetch(`${origin}/api/status`)).status,
    crossSite: (
      await fetch(`${origin}/api/status`, { headers: { "x-openbot-setup": "1", "sec-fetch-site": "cross-site" } })
    ).status,
    loginStart: (await post("/api/login/start")).status,
    loginVerify: (await post("/api/login/verify")).status,
    retry: (await post("/api/retry")).status,
    logout: (await post("/api/logout")).status,
    claim: (await post("/api/login/claim")).status,
    mobileConnect: (await post("/api/mobile-connect")).status,
    pathEscape: (await fetch(`${origin}/assets/..%2F..%2Fpackage.json`)).status,
    sourceFile: (await fetch(`${origin}/index.html`)).status,
  };
  assert.deepEqual(refusals, {
    noHeader: 403,
    crossSite: 403,
    loginStart: 404,
    loginVerify: 404,
    retry: 404,
    logout: 404,
    claim: 404,
    mobileConnect: 404,
    pathEscape: 404,
    sourceFile: 404,
  });
  checks.refusals = refusals;

  const controlRefusals = {
    loginStart: (await control("POST", "/v1/login/start", { email: "owner@example.com" })).status,
    loginVerify: (await control("POST", "/v1/login/verify", { challenge: "c", code: "1" })).status,
    claim: (await control("POST", "/v1/login/claim", { claim: "x" })).status,
    logout: (await control("POST", "/v1/logout", {})).status,
    mobileConnect: (await control("POST", "/v1/mobile-connect", {})).status,
    relativePath: (await control("POST", "/v1/identity", { path: "server.json" })).status,
    hostingValue: (await control("POST", "/v1/hosting", { enabled: "yes" })).status,
  };
  assert.deepEqual(controlRefusals, {
    loginStart: 404,
    loginVerify: 404,
    claim: 404,
    logout: 404,
    mobileConnect: 404,
    relativePath: 400,
    hostingValue: 400,
  });
  assert.deepEqual(importedPaths, [], "A refused request reached the identity import.");
  checks.controlRefusals = controlRefusals;

  const browser = await chromium.launch(
    browserExecutable ? { executablePath: browserExecutable } : { channel: "chrome" },
  );
  try {
    const context = await browser.newContext({ locale: "en-US", viewport: { width: 1000, height: 760 } });
    const tab = await context.newPage();
    const pageErrors: string[] = [];
    tab.on("pageerror", (error) => pageErrors.push(error.message));
    tab.on("console", (message) => {
      if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) {
        pageErrors.push(message.text());
      }
    });
    await tab.goto(`${origin}/`);
    await tab.getByRole("heading", { name: "Import an identity file" }).waitFor();
    await tab.getByText(IMPORT_COMMAND, { exact: true }).waitFor();
    assert.equal(await tab.getByLabel("Email").count(), 0, "The page still asks for an email.");
    await settledScreenshot(tab, join(OUT, "1-identity-missing.png"));
    checks.identityMissing = { heading: "Import an identity file", command: true };

    const invalid = await control("POST", "/v1/identity", { path: "/srv/openbot/other.json" });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.lines.error, "identity_refused");
    assert.equal(invalid.lines.message, INVALID_IDENTITY);
    checks.invalidImport = { status: invalid.status, error: invalid.lines.error, message: invalid.lines.message };

    const imported = await control("POST", "/v1/identity", { path: IDENTITY_PATH });
    assert.equal(imported.status, 200);
    assert.equal(imported.lines.identity, "ready");
    assert.equal(imported.lines.team, "Acme");
    assert.equal(imported.lines.user, "server");
    assert.equal(imported.lines.hosting, "off");
    checks.imported = {
      status: imported.status,
      identity: imported.lines.identity,
      team: imported.lines.team,
      user: imported.lines.user,
    };

    const renamed = await control("POST", "/v1/name", { name: SERVER_NAME });
    assert.equal(renamed.status, 200);
    assert.equal(hostStatus.serverName, SERVER_NAME);
    const notShared = `${SERVER_NAME} does not share its agents`;
    await tab.getByRole("heading", { name: notShared }).waitFor({ timeout: 30_000 });
    await tab.getByText("Team Acme, user server").waitFor();
    await tab.getByText("openbot hosting on", { exact: true }).waitFor();
    await settledScreenshot(tab, join(OUT, "2-not-shared.png"));
    checks.notShared = notShared;

    const shared = await control("POST", "/v1/hosting", { enabled: "on" });
    assert.equal(shared.status, 200);
    assert.equal(shared.lines.hosting, "on");
    const online = `${SERVER_NAME} is online`;
    await tab.getByRole("heading", { name: online }).waitFor({ timeout: 30_000 });
    await settledScreenshot(tab, join(OUT, "3-online.png"));
    checks.shared = { hosting: shared.lines.hosting, heading: online };

    const polish = await browser.newContext({ locale: "pl-PL" });
    const polishTab = await polish.newPage();
    await polishTab.goto(`${origin}/`);
    await polishTab.getByRole("heading", { name: online }).waitFor();
    const language = await polishTab.evaluate(() => document.documentElement.lang);
    assert.equal(language, "pl");
    await polish.close();
    checks.language = language;

    assert.deepEqual(pageErrors, [], "The page wrote errors.");
  } finally {
    await browser.close();
  }

  const report = {
    ok: true,
    checks,
    screenshots: ["1-identity-missing.png", "2-not-shared.png", "3-online.png"],
  };
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  logger.info(`Setup page e2e passed. Report: ${join(OUT, "report.json")}`);
} catch (error) {
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify({ ok: false, checks, error: String(error) }, null, 2)}\n`);
  throw error;
} finally {
  await runCauseEffect(page.close());
  await runCauseEffect(serverMode.close());
  rmSync(runtime, { recursive: true, force: true });
}

function control(
  method: "GET" | "POST",
  path: string,
  fields: Record<string, string>,
): Promise<{ status: number; lines: Record<string, string> }> {
  const body = new URLSearchParams(fields).toString();
  return new Promise((resolveAnswer, reject) => {
    const outgoing = httpRequest(
      {
        socketPath: controlSocketPath,
        method,
        path,
        headers: { "content-type": "application/x-www-form-urlencoded", "content-length": Buffer.byteLength(body) },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const lines: Record<string, string> = {};
          for (const line of Buffer.concat(chunks).toString("utf8").split("\n")) {
            const separator = line.indexOf("=");
            if (separator > 0) lines[line.slice(0, separator)] = line.slice(separator + 1);
          }
          resolveAnswer({ status: response.statusCode ?? 0, lines });
        });
      },
    );
    outgoing.once("error", reject);
    outgoing.end(body);
  });
}

async function settledScreenshot(page: Page, path: string): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) =>
          Number.isFinite(animation.effect?.getComputedTiming().endTime ?? Number.POSITIVE_INFINITY),
        )
        .map((animation) => animation.finished),
    ),
  );
  await page.screenshot({ path });
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() =>
        typeof address === "object" && address ? resolvePort(address.port) : reject(new Error("No port.")),
      );
    });
  });
}
