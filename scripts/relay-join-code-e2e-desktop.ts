import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Result } from "effect";
import { RelayControl, type RelayControlState } from "../src/main/relay/control";
import { type RelayCipher, RelayIdentityStore } from "../src/main/relay/identity-store";
import { joinRelayWithCode } from "../src/main/relay/join-code";

interface Step {
  name: string;
  code: string;
  expect: string;
}

interface Config {
  storeDirectory: string;
  waitMs: number;
  steps: Step[];
}

const config: Config = JSON.parse(readFileSync(process.argv[2] ?? "", "utf8"));
const cipher: RelayCipher = {
  encrypt: (value) => Buffer.from(value, "utf8").reverse(),
  decrypt: (value) => Buffer.from(value).reverse().toString("utf8"),
};

function settled(control: RelayControl): Promise<RelayControlState> {
  return new Promise((resolveState, reject) => {
    const timer = setTimeout(() => reject(new Error("The control socket did not settle.")), config.waitMs);
    const listener = (state: RelayControlState) => {
      if (state.status === "connecting") return;
      clearTimeout(timer);
      control.off("state", listener);
      resolveState(state);
    };
    control.on("state", listener);
  });
}

mkdirSync(config.storeDirectory, { recursive: true });
const results: unknown[] = [];
for (const step of config.steps) {
  const path = join(config.storeDirectory, `${step.name}.json`);
  const store = new RelayIdentityStore({ path, cipher });
  const joined = await Effect.runPromise(Effect.result(joinRelayWithCode(step.code, { label: "E2E desktop" })));
  if (Result.isFailure(joined)) {
    results.push({ name: step.name, status: "refused", code: joined.failure.code, stored: existsSync(path) });
    continue;
  }
  const saved = await Effect.runPromise(Effect.result(store.importBundle(joined.success)));
  if (Result.isFailure(saved)) {
    results.push({ name: step.name, status: "not_saved", code: saved.failure.reason, stored: existsSync(path) });
    continue;
  }
  const control = new RelayControl({ identity: store, reconnect: { baseMs: 100, maxMs: 500 } });
  const outcome = settled(control);
  await Effect.runPromise(control.start());
  const state = await outcome;
  results.push({
    name: step.name,
    status: state.status,
    code: state.status === "offline" ? state.code : null,
    stored: existsSync(path),
    plainKeyInStore: readFileSync(path, "utf8").includes("PRIVATE KEY"),
    keyId: saved.success.keyId,
    team: saved.success.team,
    user: saved.success.user,
  });
  await Effect.runPromise(control.stop());
}
process.stdout.write(`RESULTS ${JSON.stringify(results)}\n`);
