import { readFileSync, writeFileSync } from "node:fs";
import { inspect } from "node:util";
import WsSocket from "ws";

interface PhoneConfig {
  phoneText: string;
  serverRoot: string;
  hostKeyId: string;
  uploadBase64: string;
  out: string;
  waitMs: number;
}

const config: PhoneConfig = JSON.parse(readFileSync(process.argv[2] ?? "", "utf8"));
const randomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true, writable: true });

const client = await import("./relay-session-latency-e2e-client");
const counts = client.installCountingWebSocket(WsSocket, config.serverRoot);
const { createNobleRelayCrypto } = await import("@openbot/team-client/relay-crypto-noble");
const { createRelayIdentityFromText } = await import("@openbot/team-client/relay-client");
const { PhoneRelayRuntime } = await import("../apps/mobile/src/features/identity/model/phone-relay-runtime");
const { createPhoneRelayPeer } = await import("../apps/mobile/src/features/identity/model/phone-relay");

const crypto = createNobleRelayCrypto({ randomBytes: (size) => randomValues(new Uint8Array(size)) });

try {
  const identity = await createRelayIdentityFromText(config.phoneText, { crypto });
  const runtime = new PhoneRelayRuntime({ identity, crypto }, () => undefined, { baseMs: 100, maxMs: 500 });
  runtime.start();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out: the phone relay is online.")), config.waitMs);
    const look = () => {
      if (runtime.snapshot().state.status !== "online") return;
      clearTimeout(timer);
      stop();
      resolve();
    };
    const stop = runtime.subscribe(look);
    look();
  });
  const measured = await client.measureTeamClient({
    sessions: runtime,
    createPeer: (actions) => createPhoneRelayPeer(runtime, actions),
    hostKeyId: config.hostKeyId,
    uploadBase64: config.uploadBase64,
    sessionOpens: () => counts.sessionOpens,
    sockets: () => counts.sockets,
    waitMs: config.waitMs,
  });
  writeFileSync(config.out, JSON.stringify({ ok: true, measured, globalCrypto: typeof globalThis.crypto }));
  runtime.stop();
} catch (error) {
  writeFileSync(
    config.out,
    JSON.stringify({ ok: false, error: error instanceof Error ? error.stack : inspect(error) }),
  );
}
process.exit(0);
