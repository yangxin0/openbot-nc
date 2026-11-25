import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { withoutElectronRuntimeFlags } from "./electron-spawn-env";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const buildRoot = await mkdtemp(join(tmpdir(), "openbot-tool-result-size-"));
const reportPath = join(projectRoot, ".openbot-build/tool-result-size/report.json");
const runId = randomUUID();
const measurementSchema = z.union([z.number(), z.boolean(), z.string()]);
type Measurement = z.infer<typeof measurementSchema>;

try {
  await mkdir(dirname(reportPath), { recursive: true });
  const entry = join(dirname(reportPath), "tool-result-size.mjs");
  await run(process.execPath, [
    "build",
    join(projectRoot, "scripts/tool-result-size-electron.ts"),
    "--target=node",
    "--format=esm",
    "--external=electron",
    "--external=quickjs-emscripten-core",
    "--external=@jitl/quickjs-wasmfile-release-sync",
    `--outfile=${entry}`,
  ]);
  const sourceSha = (await output("git", ["rev-parse", "HEAD"])).trim();
  await run(
    join(projectRoot, "node_modules/.bin/electron"),
    [
      ...(process.platform === "linux" ? ["--no-sandbox"] : []),
      entry,
      `--fixture-root=${buildRoot}`,
      `--report-path=${reportPath}`,
      `--source-sha=${sourceSha}`,
      `--run-id=${runId}`,
    ],
    true,
  );
  const report = z
    .object({
      status: z.literal("passed"),
      runId: z.literal(runId),
      measurements: z.record(z.string(), measurementSchema),
    })
    .loose()
    .parse(JSON.parse(await readFile(reportPath, "utf8")));
  const measurements = report.measurements;
  const failed = expectations(measurements);
  const full = { ...report, status: failed.length ? "failed" : "passed", failed, measurements };
  await writeFile(reportPath, `${JSON.stringify(full, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ status: full.status, report: reportPath, failed, ...measurements })}\n`);
  if (failed.length) process.exitCode = 1;
} finally {
  await rm(buildRoot, { recursive: true, force: true });
}

function expectations(measurements: Record<string, Measurement>): string[] {
  const under = (name: string, limit: number) => typeof measurements[name] === "number" && measurements[name] <= limit;
  const hits = (name: string) => typeof measurements[name] === "string" && measurements[name].endsWith(", hit");
  const checks: Record<string, boolean> = {
    screenshotMatchesCssViewport: measurements.screenshotMatchesCssViewport === true,
    pointFromImageHitsBox: measurements.pointFromImageHitsBox === true,
    emulatedLargerThanView: hits("emulatedLargerThanView"),
    emulatedScale3: hits("emulatedScale3"),
    emulatedMobilePreset: hits("emulatedMobilePreset"),
    evaluateResultChars: under("evaluateResultChars", 16_500),
    evaluateOver64KbSaysHow: measurements.evaluateOver64KbSaysHow === true,
    runScriptResultChars: under("runScriptResultChars", 16_500),
    runScriptQuotedResultChars: under("runScriptQuotedResultChars", 16_500),
    runScriptStringNoteCountsString: measurements.runScriptStringNoteCountsString === true,
    partCuts: typeof measurements.partCuts === "number" && measurements.partCuts > 0,
    partNotesCountTheSlice: measurements.partNotesCountTheSlice === true,
    partsJoinToValue: measurements.partsJoinToValue === true,
  };
  return Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
}

async function run(command: string, args: string[], electron = false): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: "inherit",
      env: electron ? withoutElectronRuntimeFlags(process.env) : process.env,
    });
    let force: NodeJS.Timeout | undefined;
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      force = setTimeout(() => child.kill("SIGKILL"), 3_000);
    }, 120_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      clearTimeout(force);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      clearTimeout(force);
      if (code === 0 && signal === null) resolve();
      else reject(new Error(`Tool result size process failed (${code ?? signal}).`));
    });
  });
}

async function output(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: projectRoot, stdio: ["ignore", "pipe", "inherit"] });
    let text = "";
    child.stdout.on("data", (chunk: Buffer) => {
      text += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("exit", (code) => (code === 0 ? resolve(text) : reject(new Error("Unable to read the source SHA."))));
  });
}
