import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeRelayIdentityBundle } from "@openbot/contracts/relay-protocol/identity-bundle";
import { Effect } from "effect";
import { RelayControl, type RelayControlState } from "../src/main/relay/control";
import { type RelayCipher, RelayIdentityStore } from "../src/main/relay/identity-store";

const [bundlePath, storeDirectory, ...relayUrls] = process.argv.slice(2);
if (bundlePath === undefined || storeDirectory === undefined || relayUrls.length === 0) {
  throw new Error("Give the identity file, a store folder and one relay address at least.");
}
const bundle = decodeRelayIdentityBundle(JSON.parse(readFileSync(bundlePath, "utf8")));
if (!bundle) throw new Error("The identity file is not valid.");
const cipher: RelayCipher = {
  encrypt: (value) => Buffer.from(value, "utf8"),
  decrypt: (value) => Buffer.from(value).toString("utf8"),
};

function settled(control: RelayControl): Promise<RelayControlState> {
  return new Promise((resolveState) => {
    const listener = (state: RelayControlState) => {
      if (state.status === "connecting") return;
      control.off("state", listener);
      resolveState(state);
    };
    control.on("state", listener);
  });
}

const results: Array<{ relayUrl: string; status: string; code: string | null }> = [];
for (const [index, relayUrl] of relayUrls.entries()) {
  const store = new RelayIdentityStore({ path: join(storeDirectory, `system-roots-${index}.json`), cipher });
  await Effect.runPromise(store.importBundle({ ...bundle, relayUrl }));
  const control = new RelayControl({ identity: store, reconnect: { baseMs: 100, maxMs: 500 } });
  const outcome = settled(control);
  await Effect.runPromise(control.start());
  const state = await outcome;
  results.push({ relayUrl, status: state.status, code: state.status === "offline" ? state.code : null });
  await Effect.runPromise(control.stop());
}
process.stdout.write(`${JSON.stringify(results)}\n`);
