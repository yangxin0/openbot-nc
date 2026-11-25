import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { withoutElectronRuntimeFlags } from "./electron-spawn-env";
import { BENCH_ENV, BENCH_PROVIDERS, BENCH_TAG, LIVE_PROVIDERS } from "./provider-live/targets";
import { readScriptArguments } from "./script-arguments";

const ROOT = resolve(import.meta.dirname, "..");

const parsed = readScriptArguments({
  usage: "Usage: bun scripts/provider-live-e2e.ts [--target=<codex|claude|antigravity|grok>] [--bench]",
  options: { target: { type: "string" }, bench: { type: "boolean" } },
});
if (!parsed) process.exit(0);
const target = parsed.values.target;
const bench = parsed.values.bench === true;
const providers: readonly string[] = bench ? BENCH_PROVIDERS : LIVE_PROVIDERS;
if (target !== undefined && !providers.includes(target))
  throw new Error(`Unknown provider: ${target}. Use one of: ${providers.join(", ")}.`);

const environment = withoutElectronRuntimeFlags(process.env);

function run(command: string, args: string[], env: NodeJS.ProcessEnv = environment): number {
  return spawnSync(command, args, { cwd: ROOT, env, stdio: "inherit" }).status ?? 1;
}

rmSync(join(ROOT, "scripts/provider-live/.e2e"), { recursive: true, force: true });

if (run("bun", ["run", "build"]) !== 0) throw new Error("The desktop app did not build.");
const exitCode = run(
  join(ROOT, "node_modules/.bin/e2e"),
  [
    "run",
    "--config",
    join(ROOT, "scripts/provider-live/e2e.config.ts"),
    ...(target ? ["--target", target] : []),
    ...(bench ? ["--tag", BENCH_TAG] : ["--exclude-tag", BENCH_TAG]),
  ],
  {
    ...environment,
    E2E_TELEMETRY_DISABLED: "1",
    ...(bench ? { [BENCH_ENV]: "1" } : {}),
  },
);
process.exit(exitCode);
