import { readFileSync } from "node:fs";

interface Step {
  name: string;
  code: string;
  expect: string;
}

interface Config {
  waitMs: number;
  steps: Step[];
}

const config: Config = JSON.parse(readFileSync(process.argv[2] ?? "", "utf8"));
const randomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
Object.defineProperty(globalThis, "crypto", {
  value: { getRandomValues: randomValues },
  configurable: true,
  writable: true,
});

const memory = new Map<string, string>();
const memoryStore = {
  getItemAsync: async (key: string) => memory.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    memory.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    memory.delete(key);
  },
};

const { isDynamicRecord } = await import("@openbot/contracts/runtime-values");
const { createNobleRelayCrypto } = await import("@openbot/team-client/relay-crypto-noble");
const { startRelayControl } = await import("@openbot/team-client/relay-client");
const { RelayJoinError } = await import("@openbot/team-client/relay-join");
const { createPhoneIdentityStore, PHONE_IDENTITY_KEY } = await import(
  "../apps/mobile/src/features/identity/model/phone-identity"
);

function partsOf(value: unknown): number {
  return isDynamicRecord(value) && typeof value.parts === "number" ? value.parts : 0;
}

const crypto = createNobleRelayCrypto({ randomBytes: (size) => randomValues(new Uint8Array(size)) });
const results: unknown[] = [];
for (const step of config.steps) {
  memory.clear();
  const store = createPhoneIdentityStore(memoryStore, crypto);
  const subtle = "subtle" in globalThis.crypto ? "defined" : "undefined";
  try {
    const identity = await store.joinWithCode(step.code);
    const control = startRelayControl(identity, { crypto });
    const state = await new Promise<string>((resolveState, reject) => {
      const timer = setTimeout(() => reject(new Error("The phone control did not connect.")), config.waitMs);
      const unsubscribe = control.subscribe((snapshot) => {
        if (snapshot.state.status === "connecting") return;
        clearTimeout(timer);
        unsubscribe();
        resolveState(snapshot.state.status === "online" ? "online" : `offline:${snapshot.state.code}`);
      });
    });
    control.stop();
    const reloaded = await createPhoneIdentityStore(memoryStore, crypto).load();
    const saved = memory.get(PHONE_IDENTITY_KEY);
    results.push({
      name: step.name,
      status: state,
      code: null,
      stored: saved !== undefined,
      storedParts: saved === undefined ? 0 : partsOf(JSON.parse(saved)),
      keyId: identity.keyId,
      user: identity.user,
      team: identity.team,
      reloadedKeyId: reloaded?.keyId ?? null,
      subtle,
    });
  } catch (error) {
    results.push({
      name: step.name,
      status: "refused",
      code:
        error instanceof RelayJoinError ? error.code : error instanceof Error ? `error: ${error.message}` : "unknown",
      stored: memory.size > 0,
      subtle,
    });
  }
}
process.stdout.write(`RESULTS ${JSON.stringify(results)}\n`);
process.exit(0);
