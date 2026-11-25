import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const ROOT = resolve(import.meta.dirname, "../..");
const { packageManager } = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
const pinnedBun = typeof packageManager === "string" ? packageManager.replace(/^bun@/u, "") : "";
if (Bun.version !== pinnedBun) {
  process.stderr.write(
    `The relay program must be built with Bun ${pinnedBun}, the version in package.json. This is Bun ${Bun.version}.\n`,
  );
  process.exit(1);
}
const { values } = parseArgs({ options: { target: { type: "string" }, outfile: { type: "string" } } });
const outfile = resolve(values.outfile ?? resolve(ROOT, ".openbot-build/relay/openbot-relay"));
const result = spawnSync(
  process.execPath,
  [
    "build",
    resolve(ROOT, "remote/api/src/relay/main.ts"),
    "--compile",
    "--no-compile-autoload-dotenv",
    "--no-compile-autoload-bunfig",
    ...(values.target === undefined ? [] : [`--target=${values.target}`]),
    "--outfile",
    outfile,
  ],
  { cwd: ROOT, stdio: "inherit" },
);
if (result.status === 0) process.stdout.write(`Wrote ${outfile}\n`);
process.exit(result.status ?? 1);
