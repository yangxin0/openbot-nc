import { readFileSync } from "node:fs";

interface Step {
  name: string;
  code: string;
  expect: string;
}

interface Config {
  waitMs: number;
  ownRoot?: boolean;
  steps: Step[];
}

const config: Config = JSON.parse(readFileSync(process.argv[2] ?? "", "utf8"));
const randomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
Object.defineProperty(globalThis, "crypto", {
  value: undefined,
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
const { nodeRelayJoinTls } = await import("../src/main/relay/join-trust");
const { default: WebSocket } = await import("ws");

type SocketFactory = NonNullable<Parameters<typeof startRelayControl>[1]>["openSocket"];

function rootSocketFactory(root: string): SocketFactory {
  return (url, events) => {
    const socket = new WebSocket(url, { ca: root, perMessageDeflate: false });
    socket.on("open", () => events.open());
    socket.on("message", (data, binary) => {
      const bytes = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (binary) events.binary(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
      else events.text(bytes.toString("utf8"));
    });
    socket.on("close", (code, reason) => events.closed(code, reason.toString("utf8")));
    socket.on("error", () => undefined);
    return {
      get bufferedAmount() {
        return socket.bufferedAmount;
      },
      send: (data) => socket.send(data),
      close: (code, reason) => socket.close(code, reason),
    };
  };
}

function partsOf(value: unknown): number {
  return isDynamicRecord(value) && typeof value.parts === "number" ? value.parts : 0;
}

const crypto = createNobleRelayCrypto({ randomBytes: (size) => randomValues(new Uint8Array(size)) });
const results: unknown[] = [];
for (const step of config.steps) {
  memory.clear();
  const store = createPhoneIdentityStore(memoryStore, crypto, config.ownRoot ? nodeRelayJoinTls : undefined);
  const subtle = typeof globalThis.crypto === "undefined" ? "undefined" : "defined";
  try {
    const identity = await store.joinWithCode(step.code);
    const control = startRelayControl(identity, {
      crypto,
      ...(config.ownRoot ? { openSocket: rootSocketFactory(identity.root) } : {}),
    });
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
