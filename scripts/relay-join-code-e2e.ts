import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer as createHttpsServer, request as httpsRequest } from "node:https";
import { createServer as createNetServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { connect as tlsConnect } from "node:tls";
import { inspect } from "node:util";
import {
  decodeRelayEnrollRequest,
  decodeRelayEnrollResponse,
  parseRelayJoinCode,
  RELAY_ROOT_PATH,
  type RelayJoinCode,
} from "@openbot/contracts/relay-protocol/enrollment";
import { RELAY_PATH } from "@openbot/contracts/relay-protocol/messages";
import { webRelayCrypto } from "@openbot/team-client/relay-crypto";
import { joinRelayWithCode, RelayJoinError } from "@openbot/team-client/relay-join";

interface Check {
  name: string;
  passed: boolean;
  error?: string;
}

interface ChildStep {
  name: string;
  code: string;
  expect: "online" | string;
}

interface ChildResult {
  name: string;
  status: string;
  code: string | null;
  stored: boolean;
  plainKeyInStore?: boolean;
  keyId?: string | null;
  team?: string | null;
  user?: string | null;
  storedParts?: number;
  reloadedKeyId?: string | null;
  subtle?: string;
}

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, ".openbot-build/relay-join-code-e2e");
const MAIN = resolve(ROOT, "remote/api/src/relay/main.ts");
const DESKTOP_CHILD = resolve(ROOT, "scripts/relay-join-code-e2e-desktop.ts");
const PHONE_CHILD = resolve(ROOT, "scripts/relay-join-code-e2e-phone.ts");
const ELECTRON_STUB = resolve(ROOT, "scripts/relay-team-api-e2e-electron.mjs");
const READY_LINE = "OpenBot relay is ready";
const WAIT_MS = 60_000;
const TEAM = "Acme";

const checks: Check[] = [];
const secrets: string[] = [];
const children: ChildProcess[] = [];
const tamperedCodes = new Set<string>();
let enrollRequests = 0;
const sentCodes = new Set<string>();

async function check(name: string, run: () => void | Promise<void>): Promise<void> {
  try {
    await run();
    checks.push({ name, passed: true });
  } catch (error) {
    checks.push({ name, passed: false, error: error instanceof Error ? error.message : inspect(error) });
  }
}

function deadline<T>(description: string, promise: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out: ${description}`)), WAIT_MS);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        address && typeof address === "object" ? resolvePort(address.port) : reject(new Error("No port.")),
      );
    });
  });
}

function command(environment: Record<string, string>, ...args: string[]): { status: number; output: string } {
  const result = spawnSync("bun", [MAIN, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...environment },
    encoding: "utf8",
  });
  return { status: result.status ?? 1, output: `${result.stdout}${result.stderr}` };
}

function makeCode(
  environment: Record<string, string>,
  user: string,
  device: string,
): { text: string; code: RelayJoinCode } {
  const result = command(environment, "ca", "code", "--team", TEAM, "--user", user, "--device", device);
  assert.equal(result.status, 0, result.output);
  const text = result.output
    .split("\n")
    .find((line) => line.trim().startsWith("openbot-nc://enroll?"))
    ?.trim();
  assert.ok(text, "ca code must print a join code.");
  const code = parseRelayJoinCode(text);
  assert.ok(code, "The join code must parse.");
  secrets.push(code.code);
  return { text, code };
}

function withRoot(text: string, root: string): string {
  return text.replace(/root=[A-Za-z0-9_-]{43}/u, `root=${root}`);
}

function startRelay(environment: Record<string, string>): Promise<{ child: ChildProcess; log: string[] }> {
  const log: string[] = [];
  const child = spawn("bun", [MAIN, "serve"], {
    cwd: ROOT,
    env: { ...process.env, ...environment },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  child.stdout.on("data", (chunk: Buffer) => log.push(chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => log.push(chunk.toString()));
  return deadline(
    "the relay server is ready",
    new Promise((resolveReady, reject) => {
      const look = () => {
        if (!log.join("").includes(READY_LINE)) return;
        child.stdout.off("data", look);
        resolveReady({ child, log });
      };
      child.stdout.on("data", look);
      child.once("exit", () => reject(new Error(`The relay stopped: ${log.join("")}`)));
    }),
  );
}

function startProxy(options: {
  port: number;
  relayPort: number;
  dataDirectory: string;
  root: string;
  withoutRootRoute?: boolean;
}) {
  const tls = {
    cert: readFileSync(join(options.dataDirectory, "tls", "server.crt")),
    key: readFileSync(join(options.dataDirectory, "tls", "server.key")),
  };
  const swapCertificate = readFileSync(join(options.dataDirectory, "tls", "server.crt"), "utf8");
  const forward = (request: IncomingMessage, response: ServerResponse, body: Buffer) => {
    const upstream = httpsRequest(
      {
        host: "127.0.0.1",
        port: options.relayPort,
        path: request.url,
        method: request.method,
        headers: request.headers,
        ca: options.root,
        servername: "localhost",
      },
      (answer) => {
        const chunks: Buffer[] = [];
        answer.on("data", (chunk: Buffer) => chunks.push(chunk));
        answer.on("end", () => {
          let text = Buffer.concat(chunks).toString("utf8");
          const sent = parseCode(body);
          if (request.url === "/v1/enroll" && answer.statusCode === 200 && sent !== null && tamperedCodes.has(sent)) {
            const decoded = decodeRelayEnrollResponse(JSON.parse(text));
            if (decoded) text = JSON.stringify({ ...decoded, certificate: swapCertificate });
          }
          const headers = { ...answer.headers, "content-length": String(Buffer.byteLength(text)) };
          response.writeHead(answer.statusCode ?? 502, headers).end(text);
        });
      },
    );
    upstream.on("error", () => response.writeHead(502).end());
    upstream.end(body);
  };
  const server = createHttpsServer(tls, (request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks);
      if (request.url === "/v1/enroll" && request.method === "POST") {
        enrollRequests += 1;
        const sent = parseCode(body);
        if (sent !== null) sentCodes.add(sent);
      }
      if (options.withoutRootRoute && request.url === RELAY_ROOT_PATH) {
        response.writeHead(404).end("Not found");
        return;
      }
      forward(request, response, body);
    });
  });
  server.on("upgrade", (request: IncomingMessage, client: Socket, head: Buffer) => {
    const upstream = tlsConnect({
      host: "127.0.0.1",
      port: options.relayPort,
      ca: options.root,
      servername: "localhost",
    });
    upstream.on("secureConnect", () => {
      const lines = [`${request.method} ${request.url} HTTP/${request.httpVersion}`];
      for (let index = 0; index < request.rawHeaders.length; index += 2)
        lines.push(`${request.rawHeaders[index]}: ${request.rawHeaders[index + 1]}`);
      upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (head.byteLength > 0) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    const close = () => {
      upstream.destroy();
      client.destroy();
    };
    upstream.on("error", close);
    client.on("error", close);
    upstream.on("close", close);
    client.on("close", close);
  });
  return new Promise<typeof server>((resolveServer) =>
    server.listen(options.port, "127.0.0.1", () => resolveServer(server)),
  );
}

function parseCode(body: Buffer): string | null {
  try {
    return decodeRelayEnrollRequest(JSON.parse(body.toString("utf8")))?.code ?? null;
  } catch {
    return null;
  }
}

function runChild(
  script: string,
  config: unknown,
  extraAuthority: string | null,
  label: string,
): Promise<ChildResult[]> {
  const configPath = join(work, `${label}.json`);
  writeFileSync(configPath, JSON.stringify(config));
  const child = spawn(process.execPath, ["--import", "tsx", "--import", ELECTRON_STUB, script, configPath], {
    cwd: ROOT,
    env: extraAuthority === null ? withoutExtraAuthorities() : { ...process.env, NODE_EXTRA_CA_CERTS: extraAuthority },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  const output: string[] = [];
  child.stdout.on("data", (chunk: Buffer) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => output.push(chunk.toString()));
  return deadline(
    `the ${label} process ends`,
    new Promise((resolveResults, reject) =>
      child.once("exit", (code) => {
        childOutputs.push(output.join(""));
        const line = output
          .join("")
          .split("\n")
          .find((entry) => entry.startsWith("RESULTS "));
        if (code !== 0 || !line) reject(new Error(`The ${label} process failed (${code}): ${output.join("")}`));
        else resolveResults(JSON.parse(line.slice("RESULTS ".length)));
      }),
    ),
  );
}

function withoutExtraAuthorities(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  delete environment.NODE_EXTRA_CA_CERTS;
  return environment;
}

function rootAnswer(port: number, root: string): Promise<{ status: number; text: string }> {
  return new Promise((resolveAnswer, reject) => {
    const outgoing = httpsRequest(
      { host: "127.0.0.1", port, path: RELAY_ROOT_PATH, method: "GET", ca: root, servername: "localhost" },
      (answer) => {
        const chunks: Buffer[] = [];
        answer.on("data", (chunk: Buffer) => chunks.push(chunk));
        answer.on("end", () =>
          resolveAnswer({ status: answer.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }),
        );
      },
    );
    outgoing.on("error", reject);
    outgoing.end();
  });
}

function result(results: ChildResult[], name: string): ChildResult {
  const found = results.find((entry) => entry.name === name);
  assert.ok(found, `No result for ${name}.`);
  return found;
}

const work = mkdtempSync(join(tmpdir(), "openbot-relay-join-code-e2e-"));
const dataDirectory = join(work, "data");
const childOutputs: string[] = [];
let relayLog: string[] = [];
let proxy: Awaited<ReturnType<typeof startProxy>> | null = null;
let oldProxy: Awaited<ReturnType<typeof startProxy>> | null = null;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

try {
  const [relayPort, healthPort, proxyPort, oldProxyPort] = await Promise.all([
    freePort(),
    freePort(),
    freePort(),
    freePort(),
  ]);
  const publicUrl = `wss://localhost:${proxyPort}${RELAY_PATH}`;
  const environment: Record<string, string> = { RELAY_DATA_DIR: dataDirectory, RELAY_PUBLIC_URL: publicUrl };
  for (const args of [
    ["ca", "init"],
    ["ca", "team", "add", TEAM],
    ["ca", "server", "--dns", "localhost", "--ip", "127.0.0.1"],
  ]) {
    const done = command(environment, ...args);
    assert.equal(done.status, 0, done.output);
  }
  const rootPath = join(dataDirectory, "ca", "root.crt");
  const root = readFileSync(rootPath, "utf8");
  const relay = await startRelay({
    ...environment,
    RELAY_HOST: "127.0.0.1",
    RELAY_PORT: String(relayPort),
    RELAY_HEALTH_PORT: String(healthPort),
  });
  relayLog = relay.log;
  proxy = await startProxy({ port: proxyPort, relayPort, dataDirectory, root });
  oldProxy = await startProxy({ port: oldProxyPort, relayPort, dataDirectory, root, withoutRootRoute: true });

  const desktop = makeCode(environment, "alice", "laptop");
  const otherRoot = withRoot(
    makeCode(environment, "alice", "tablet").text,
    createHash("sha256").update("not the root").digest("base64url"),
  );
  const otherRootSecret = parseRelayJoinCode(otherRoot)?.code ?? "";
  const oldServer = makeCode(environment, "alice", "phone").text.replace(
    /server=[^&]+/u,
    `server=localhost:${oldProxyPort}`,
  );
  const oldServerSecret = parseRelayJoinCode(oldServer)?.code ?? "";
  const tampered = makeCode(environment, "alice", "desk");
  tamperedCodes.add(tampered.code.code);
  const phone = makeCode(environment, "bob", "phone");
  const ownRootPhone = makeCode(environment, "bob", "tablet");

  const desktopResults = await runChild(
    DESKTOP_CHILD,
    {
      storeDirectory: join(work, "desktop"),
      waitMs: WAIT_MS,
      steps: [
        { name: "join", code: desktop.text, expect: "online" },
        { name: "reuse", code: desktop.text, expect: "code_unknown" },
        { name: "root", code: otherRoot, expect: "root_mismatch" },
        { name: "tampered", code: tampered.text, expect: "key_mismatch" },
        { name: "old_server", code: oldServer, expect: "server_untrusted" },
      ] satisfies ChildStep[],
    },
    null,
    "desktop",
  );

  await check("the relay serves its root certificate at /v1/root to anyone", async () => {
    const answer = await rootAnswer(relayPort, root);
    assert.equal(answer.status, 200);
    assert.equal(answer.text.trim(), root.trim());
  });

  await check(
    "(a) a desktop with no extra authority joins a server that has only its own root, and gets welcome",
    () => {
      const joined = result(desktopResults, "join");
      assert.equal(joined.status, "online", JSON.stringify(joined));
      assert.equal(joined.stored, true);
      assert.equal(joined.plainKeyInStore, false, "The stored identity must keep the private key encrypted.");
      assert.equal(joined.team, TEAM);
      assert.equal(joined.user, "alice");
      assert.match(joined.keyId ?? "", /^[A-Za-z0-9_-]{43}$/u);
    },
  );

  await check("(a) a second use of the same code fails with code_unknown, and nothing is stored", () => {
    const reused = result(desktopResults, "reuse");
    assert.equal(reused.code, "code_unknown", JSON.stringify(reused));
    assert.equal(reused.stored, false);
  });

  await check("(c) a code with a root fingerprint that is not the server root is refused and nothing is stored", () => {
    const refused = result(desktopResults, "root");
    assert.equal(refused.code, "root_mismatch", JSON.stringify(refused));
    assert.equal(refused.stored, false);
    assert.ok(otherRootSecret !== "" && !sentCodes.has(otherRootSecret), "The code must not reach the server.");
  });

  await check(
    "(f) a server with only its own root and no /v1/root gives server_untrusted, and the code is not sent",
    () => {
      const refused = result(desktopResults, "old_server");
      assert.equal(refused.code, "server_untrusted", JSON.stringify(refused));
      assert.equal(refused.stored, false);
      assert.ok(oldServerSecret !== "" && !sentCodes.has(oldServerSecret), "The code must not reach the server.");
    },
  );

  await check("(d) a response with a changed certificate (test proxy) is refused and nothing is stored", () => {
    const refused = result(desktopResults, "tampered");
    assert.equal(refused.code, "key_mismatch", JSON.stringify(refused));
    assert.equal(refused.stored, false);
  });

  const phoneResults = await runChild(
    PHONE_CHILD,
    { waitMs: WAIT_MS, steps: [{ name: "phone", code: phone.text, expect: "online" }] satisfies ChildStep[] },
    rootPath,
    "phone",
  );

  const ownRootPhoneResults = await runChild(
    PHONE_CHILD,
    {
      waitMs: WAIT_MS,
      ownRoot: true,
      steps: [{ name: "phone_own_root", code: ownRootPhone.text, expect: "online" }] satisfies ChildStep[],
    },
    null,
    "phone-own-root",
  );

  await check(
    "(g) the phone path with a join transport and a root socket joins a server with only its own root",
    () => {
      const joined = result(ownRootPhoneResults, "phone_own_root");
      assert.equal(joined.status, "online", JSON.stringify(joined));
      assert.equal(joined.user, "bob");
      assert.equal(joined.reloadedKeyId, joined.keyId);
    },
  );

  await check("(b) the phone path joins a server with a trusted certificate in a process with no crypto.subtle", () => {
    const joined = result(phoneResults, "phone");
    assert.equal(joined.subtle, "undefined");
    assert.equal(joined.status, "online", JSON.stringify(joined));
    assert.equal(joined.user, "bob");
    assert.ok((joined.storedParts ?? 0) > 0, "The phone store must keep the identity.");
    assert.equal(joined.reloadedKeyId, joined.keyId, "The stored identity must load again with the same key.");
  });

  await check("(e) a code for a different server host is refused before any request", async () => {
    const other = makeCode(environment, "carol", "browser");
    const before = enrollRequests;
    let fetched = 0;
    const error = await joinRelayWithCode(other.text, {
      crypto: webRelayCrypto,
      server: "relay.example.com",
      fetch: async (...args) => {
        fetched += 1;
        return fetch(...args);
      },
    }).then(
      () => null,
      (cause: unknown) => cause,
    );
    assert.ok(error instanceof RelayJoinError, inspect(error));
    assert.equal(error.code, "other_server");
    assert.equal(fetched, 0);
    assert.equal(enrollRequests, before);
  });

  await check("no log or process output has a code secret", () => {
    const text = [relayLog.join(""), ...childOutputs].join("\n");
    for (const secret of secrets) assert.ok(!text.includes(secret), "A code secret is in a log.");
    assert.ok(!/BEGIN (EC )?PRIVATE KEY/u.test(text), "A private key is in a log.");
  });
} catch (error) {
  checks.push({ name: "setup", passed: false, error: error instanceof Error ? error.message : inspect(error) });
} finally {
  proxy?.close();
  oldProxy?.close();
  for (const child of children) if (child.exitCode === null && child.pid !== undefined) child.kill("SIGTERM");
  rmSync(work, { recursive: true, force: true });
}

const passed = checks.every((entry) => entry.passed);
const report = { passed, checks, enrollRequests, at: new Date().toISOString() };
writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
for (const entry of checks)
  process.stdout.write(`${entry.passed ? "PASS" : "FAIL"} ${entry.name}${entry.error ? `: ${entry.error}` : ""}\n`);
process.stdout.write(`Report: ${join(OUT, "report.json")}\n`);
process.exit(passed && existsSync(join(OUT, "report.json")) ? 0 : 1);
