import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { inspect } from "node:util";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import WsSocket from "ws";

interface PhoneConfig {
  phoneText: string;
  ownerText: string;
  wrongKeyText: string;
  otherHostText: string;
  otherHostKeyId: string;
  hostKeyId: string;
  agentId: string;
  serverRoot: string;
  foreignProofRelayUrl: string;
  otherTeamPeerRelayUrl: string;
  fileBase64: string;
  out: string;
  waitMs: number;
}

interface PhoneFacts {
  storedParts?: number;
  partLengths?: number[];
  hostId?: string;
  team?: string | null;
  urlTypes?: string[];
  fileSha256?: string;
  otherTeamRelayRefusal?: string;
  otherTeamPeerRefusal?: string;
  foreignStates?: string[];
  memberRoles?: string[];
  liveReturnMs?: number;
  deadReturnMs?: number;
  returnLines?: string[];
}

interface PhoneCheck {
  name: string;
  passed: boolean;
  error?: string;
}

const config: PhoneConfig = JSON.parse(readFileSync(process.argv[2] ?? "", "utf8"));
const checks: PhoneCheck[] = [];
const facts: PhoneFacts = {};
const randomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
Object.defineProperty(globalThis, "crypto", {
  value: undefined,
  configurable: true,
  writable: true,
});

class ShimCloseEvent extends Event {
  constructor(
    readonly code: number,
    readonly reason: string,
  ) {
    super("close");
  }
}

class ReactNativeLikeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static binaryFramesSent = 0;
  static urlTypes = new Set<string>();
  static readonly instances: ReactNativeLikeWebSocket[] = [];
  static readonly changed = new Set<() => void>();
  readyState = ReactNativeLikeWebSocket.CONNECTING;
  frozen = false;
  helloSent = false;
  pingsSent = 0;
  serverClosed = false;
  #binaryType: "blob" | "arraybuffer" = "blob";
  readonly #socket: WsSocket;

  constructor(url: unknown) {
    super();
    ReactNativeLikeWebSocket.instances.push(this);
    ReactNativeLikeWebSocket.urlTypes.add(typeof url);
    if (typeof url !== "string") throw new TypeError("This WebSocket takes a string address, as React Native does.");
    this.#socket = new WsSocket(url, { ca: config.serverRoot });
    this.#socket.on("open", () => {
      this.readyState = ReactNativeLikeWebSocket.OPEN;
      this.dispatchEvent(new Event("open"));
    });
    this.#socket.on("message", (data, isBinary) => {
      if (this.frozen) return;
      const bytes = Buffer.concat(
        Array.isArray(data) ? data : [Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data)],
      );
      if (!isBinary) {
        this.dispatchEvent(new MessageEvent("message", { data: bytes.toString("utf8") }));
        return;
      }
      const decoded = Buffer.from(bytes.toString("base64"), "base64");
      const payload =
        this.#binaryType === "arraybuffer"
          ? decoded.buffer.slice(decoded.byteOffset, decoded.byteOffset + decoded.byteLength)
          : { blobId: "not-an-array-buffer" };
      this.dispatchEvent(new MessageEvent("message", { data: payload }));
    });
    this.#socket.on("error", () => {
      if (this.frozen) return;
      this.readyState = ReactNativeLikeWebSocket.CLOSED;
      this.dispatchEvent(new Event("error"));
    });
    this.#socket.on("close", (code, reason) => {
      this.serverClosed = true;
      for (const listener of [...ReactNativeLikeWebSocket.changed]) listener();
      if (this.frozen) return;
      this.readyState = ReactNativeLikeWebSocket.CLOSED;
      this.dispatchEvent(new ShimCloseEvent(code, reason.toString("utf8")));
    });
  }

  get binaryType(): "blob" | "arraybuffer" {
    return this.#binaryType;
  }

  set binaryType(value: string) {
    if (value !== "blob" && value !== "arraybuffer")
      throw new Error("binaryType must be either 'blob' or 'arraybuffer'");
    this.#binaryType = value;
  }

  send(data: unknown): void {
    if (this.readyState === ReactNativeLikeWebSocket.CONNECTING) throw new Error("INVALID_STATE_ERR");
    if (this.frozen) return;
    if (typeof data === "string") {
      if (data.includes('"type":"hello"')) this.helloSent = true;
      if (data.includes('"type":"ping"')) this.pingsSent += 1;
      this.#socket.send(data);
      return;
    }
    if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
      const view =
        data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      ReactNativeLikeWebSocket.binaryFramesSent += 1;
      this.#socket.send(Buffer.from(Buffer.from(view).toString("base64"), "base64"));
      return;
    }
    throw new Error("Unsupported data type");
  }

  close(code?: number, reason?: string): void {
    if (this.frozen) {
      this.#socket.terminate();
      return;
    }
    this.#socket.close(code ?? 1000, reason);
  }

  get open(): boolean {
    return this.readyState === ReactNativeLikeWebSocket.OPEN && !this.serverClosed;
  }
}

Object.defineProperty(globalThis, "WebSocket", { value: ReactNativeLikeWebSocket, configurable: true, writable: true });

async function check(name: string, run: () => void | Promise<void>): Promise<void> {
  try {
    await run();
    checks.push({ name, passed: true });
  } catch (error) {
    checks.push({ name, passed: false, error: error instanceof Error ? error.message : inspect(error) });
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function deadline<T>(description: string, promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolveValue, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out: ${description}.`)), config.waitMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolveValue(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function errorCode(error: unknown): string {
  if (error instanceof Error && "code" in error && typeof error.code === "string") return error.code;
  if (error instanceof Error && "key" in error && typeof error.key === "string") return error.key;
  return error instanceof Error ? `unknown: ${error.message}` : "unknown";
}

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

const { createNobleRelayCrypto } = await import("@openbot/team-client/relay-crypto-noble");
const { createRelayIdentityFromText, relayHubTunnelTransport, relayTeamHostId, startRelayControl } = await import(
  "@openbot/team-client/relay-client"
);
const { TEAM_API_ROUTES } = await import("@openbot/contracts/team-api-routes");
const { isDynamicRecord, isString } = await import("@openbot/contracts/runtime-values");
const identityModule = await import("../apps/mobile/src/features/identity/model/phone-identity");
const relayModule = await import("../apps/mobile/src/features/identity/model/phone-relay");
const { PhoneRelayRuntime } = await import("../apps/mobile/src/features/identity/model/phone-relay-runtime");
const membersModule = await import("../apps/mobile/src/features/servers/model/server-members");
const { sourceText } = await import("@openbot/i18n/source");
const adminRequired = sourceText("error.team.adminRequired");

const crypto = createNobleRelayCrypto({ randomBytes: (size) => randomValues(new Uint8Array(size)) });
const store = identityModule.createPhoneIdentityStore(memoryStore, crypto);
const runtimes: InstanceType<typeof PhoneRelayRuntime>[] = [];
const held: {
  identity: Awaited<ReturnType<typeof store.importText>> | null;
  peer: ReturnType<typeof relayModule.createPhoneRelayPeer> | null;
} = { identity: null, peer: null };
const events: string[] = [];
const diagnostics: string[] = [];
const updates: string[] = [];
const relayLines: string[] = [];
const PHONE_LIVENESS = { liveness: { idleMs: 1_000, answerMs: 2_000 } };
const ownerHeld: { peer: ReturnType<typeof relayModule.createPhoneRelayPeer> | null } = { peer: null };

class PeerRequestError extends Error {}

function peerTeamApi(peer: ReturnType<typeof relayModule.createPhoneRelayPeer>): TeamApiRequest {
  return async (method, path, decode, body) => {
    const result = await deadline(
      `${method} ${path}`,
      peer.execute({ id: commandId(), type: "request", method, path, body: body ?? {} }),
    );
    if (!result.ok) throw new PeerRequestError(result.error ?? "The request failed.");
    return decode(result.body);
  };
}

function refusal(error: unknown): string {
  return error instanceof PeerRequestError ? error.message : errorCode(error);
}
const eventWaiters = new Set<() => void>();

function waitFor(description: string, accepts: () => boolean): Promise<void> {
  return deadline(
    description,
    new Promise<void>((resolveValue) => {
      const look = () => {
        if (!accepts()) return;
        eventWaiters.delete(look);
        ReactNativeLikeWebSocket.changed.delete(look);
        resolveValue();
      };
      eventWaiters.add(look);
      ReactNativeLikeWebSocket.changed.add(look);
      look();
    }),
  );
}

function observe(milliseconds: number): Promise<void> {
  return new Promise((resolveValue) => setTimeout(resolveValue, milliseconds));
}
let commandCount = 0;
const commandId = () => `phone-command-${++commandCount}`;

function untilSnapshot<T>(
  runtime: InstanceType<typeof PhoneRelayRuntime>,
  description: string,
  pick: () => T | null,
): Promise<T> {
  return deadline(
    description,
    new Promise<T>((resolveValue) => {
      const look = () => {
        const value = pick();
        if (value === null) return;
        stop();
        resolveValue(value);
      };
      const stop = runtime.subscribe(look);
      look();
    }),
  );
}

try {
  await check("The phone process has no global crypto, like Hermes, so any use of it would fail", () => {
    assert(typeof globalThis.crypto === "undefined", "A global crypto is still present.");
  });

  await check("The phone identity module imports pasted text with the noble crypto into the secure store", async () => {
    const identity = await store.importText(config.phoneText);
    held.identity = identity;
    assert(identity.team === "Acme" && identity.user === "alice" && identity.device === "phone", inspect(identity));
    const header = memory.get(identityModule.PHONE_IDENTITY_KEY);
    assert(header !== undefined, "The store has no identity header.");
    const parts = [...memory.entries()].filter(([key]) => key.startsWith(`${identityModule.PHONE_IDENTITY_KEY}.part.`));
    assert(parts.length > 1, `The bundle must be split, it has ${parts.length} parts.`);
    assert(
      parts.every(([, value]) => value.length <= identityModule.PHONE_IDENTITY_PART_LENGTH),
      "A stored part is too long.",
    );
    assert(
      parts
        .map(([, value]) => value)
        .join("")
        .includes("PRIVATE KEY"),
      "The key must stay in the secure store.",
    );
    assert(!JSON.stringify(identity).includes("PRIVATE KEY"), "The private key must not be in the identity object.");
    facts.storedParts = parts.length;
    facts.partLengths = parts.map(([, value]) => value.length);
  });

  await check("The saved identity loads again from the secure store", async () => {
    const loaded = await store.load();
    assert(loaded !== null && loaded.keyId === held.identity?.keyId, "The loaded identity differs.");
    held.identity = loaded;
  });

  await check("A bundle with a wrong private key is refused at import and the saved identity stays", async () => {
    const before = new Map(memory);
    const refusal = await store.importText(config.wrongKeyText).then(
      () => "accepted",
      (error: unknown) => errorCode(error),
    );
    assert(refusal === "mobile.identity.error.keyMismatch", refusal);
    assert(JSON.stringify([...memory]) === JSON.stringify([...before]), "The store changed.");
  });

  const phoneIdentity = held.identity;
  assert(phoneIdentity !== null, "No phone identity.");
  const runtime = new PhoneRelayRuntime(
    { identity: phoneIdentity, crypto },
    () => undefined,
    { baseMs: 100, maxMs: 500 },
    {
      ...PHONE_LIVENESS,
      log: (_level, line) => {
        relayLines.push(line);
        for (const waiter of [...eventWaiters]) waiter();
      },
    },
  );
  runtimes.push(runtime);
  let hostId = "";
  let phoneSocket: ReactNativeLikeWebSocket | null = null;

  await check("The relay control starts and the host shows in the server list from the roster", async () => {
    runtime.start();
    phoneSocket = ReactNativeLikeWebSocket.instances.at(-1) ?? null;
    const hosts = await untilSnapshot(runtime, "the host in the roster", () => {
      const snapshot = runtime.snapshot();
      if (snapshot.state.status !== "online") return null;
      const listed = relayModule.mergeRelayHosts([], snapshot, phoneIdentity);
      return listed.some((host) => host.devicePublicKey === config.hostKeyId) ? listed : null;
    });
    const host = hosts.find((candidate) => candidate.devicePublicKey === config.hostKeyId);
    assert(host !== undefined, "The host is missing.");
    hostId = host.hostId;
    assert(host.hostId === relayTeamHostId({ user: "host-user", device: "server" }), host.hostId);
    assert(
      relayModule
        .rosterHosts(runtime.snapshot(), phoneIdentity)
        .every((member) => member.keyId !== phoneIdentity.keyId),
      "The phone lists itself.",
    );
    facts.hostId = host.hostId;
    facts.team = runtime.snapshot().team?.name ?? null;
  });

  await check("A V2 peer over relay tunnels connects with the noble crypto and lists the host's agents", async () => {
    const peer = relayModule.createPhoneRelayPeer(runtime, {
      current: {
        onConnectionUpdate: async (update) => {
          updates.push(update.state);
          for (const waiter of [...eventWaiters]) waiter();
        },
        onDiagnostic: async (diagnostic) => {
          diagnostics.push(diagnostic.step);
        },
        onTeamEvent: async (_hostId, event) => {
          events.push(JSON.stringify(event));
          for (const waiter of [...eventWaiters]) waiter();
        },
      },
    });
    held.peer = peer;
    const connected = await deadline(
      "the connect",
      peer.execute({ id: commandId(), type: "connect", hostId, hostPublicKey: config.hostKeyId }),
    );
    assert(connected.ok, connected.error ?? "The connect failed.");
    const listed = await deadline(
      "the agent list",
      peer.execute({ id: commandId(), type: "request", method: "GET", path: TEAM_API_ROUTES.agents.all, body: {} }),
    );
    assert(listed.ok && listed.status === 200, inspect(listed));
    assert(JSON.stringify(listed.body).includes(config.agentId), "The agent is not in the list.");
    assert(ReactNativeLikeWebSocket.binaryFramesSent > 0, "No binary frame went through the WebSocket shim.");
    facts.urlTypes = [...ReactNativeLikeWebSocket.urlTypes];
  });

  await check("A message to the agent gets its reply event through the relay", async () => {
    const activePeer = held.peer;
    assert(activePeer !== null, "No peer.");
    const reply = deadline(
      "the reply event",
      new Promise<void>((resolveValue) => {
        const look = () => {
          if (!events.some((event) => event.includes(config.agentId) && event.includes("Done."))) return;
          eventWaiters.delete(look);
          resolveValue();
        };
        eventWaiters.add(look);
        look();
      }),
    );
    const sent = await deadline(
      "the message",
      activePeer.execute({
        id: commandId(),
        type: "request",
        method: "POST",
        path: TEAM_API_ROUTES.agent.messages(config.agentId),
        body: { agentId: config.agentId, text: "Hello from the phone over the relay", timezone: "UTC" },
      }),
    );
    assert(sent.ok && (sent.status ?? 0) >= 200 && (sent.status ?? 0) < 300, inspect(sent));
    await reply;
  });

  await check("A file goes up and comes back with the same hash", async () => {
    const activePeer = held.peer;
    assert(activePeer !== null, "No peer.");
    const uploaded = await deadline(
      "the upload",
      activePeer.execute({
        id: commandId(),
        type: "request",
        method: "POST",
        path: `${TEAM_API_ROUTES.attachments}?name=phone.bin&mime=application%2Foctet-stream`,
        body: null,
        upload: { name: "phone.bin", mimeType: "application/octet-stream", base64: config.fileBase64 },
      }),
    );
    assert(uploaded.status === 201, inspect(uploaded));
    const body = uploaded.body;
    assert(isDynamicRecord(body) && isString(body.id), inspect(body));
    const downloaded = await deadline(
      "the download",
      activePeer.execute({
        id: commandId(),
        type: "request",
        method: "GET",
        path: TEAM_API_ROUTES.attachment(body.id),
        body: {},
      }),
    );
    const file = downloaded.body;
    assert(isDynamicRecord(file) && isString(file.base64), inspect(downloaded).slice(0, 400));
    const expected = sha256(Buffer.from(config.fileBase64, "base64"));
    assert(sha256(Buffer.from(file.base64, "base64")) === expected, "The hash differs.");
    facts.fileSha256 = expected;
  });

  await check("A plain member cannot read the member list of the host, and reads itself as a member", async () => {
    const activePeer = held.peer;
    assert(activePeer !== null, "No peer.");
    const api = peerTeamApi(activePeer);
    const refused = await membersModule.listServerMembers(api).then(
      () => "listed",
      (error: unknown) => refusal(error),
    );
    assert(refused === adminRequired, `The host gave: ${refused}`);
    const me = await membersModule.readCurrentMember(api);
    assert(me.role === "member" && me.username === "alice" && !me.disabled, inspect(me));
  });

  const ownerMemory = new Map<string, string>();
  const ownerStore = identityModule.createPhoneIdentityStore(
    {
      getItemAsync: async (key: string) => ownerMemory.get(key) ?? null,
      setItemAsync: async (key: string, value: string) => {
        ownerMemory.set(key, value);
      },
      deleteItemAsync: async (key: string) => {
        ownerMemory.delete(key);
      },
    },
    crypto,
  );

  await check("The server owner reads the member list with the roles over the relay", async () => {
    const ownerIdentity = await ownerStore.importText(config.ownerText);
    const ownerRuntime = new PhoneRelayRuntime(
      { identity: ownerIdentity, crypto },
      () => undefined,
      {
        baseMs: 100,
        maxMs: 500,
      },
      PHONE_LIVENESS,
    );
    runtimes.push(ownerRuntime);
    ownerRuntime.start();
    await untilSnapshot(ownerRuntime, "the owner relay online", () =>
      ownerRuntime.snapshot().state.status === "online" ? true : null,
    );
    const peer = relayModule.createPhoneRelayPeer(ownerRuntime, {
      current: { onConnectionUpdate: async () => undefined, onTeamEvent: async () => undefined },
    });
    ownerHeld.peer = peer;
    const connected = await deadline(
      "the owner connect",
      peer.execute({ id: commandId(), type: "connect", hostId, hostPublicKey: config.hostKeyId }),
    );
    assert(connected.ok, connected.error ?? "The owner connect failed.");
    const api = peerTeamApi(peer);
    const me = await membersModule.readCurrentMember(api);
    assert(me.role === "owner", inspect(me));
    const members = membersModule.sortServerMembers(await membersModule.listServerMembers(api));
    const alice = members.find((member) => member.username === "alice");
    assert(alice !== undefined && alice.role === "member" && !alice.disabled, inspect(members));
    assert(members[0]?.role === "owner", "The owner is not first.");
    assert(membersModule.canManageServerMember(me, alice), "The owner cannot manage the member.");
    assert(!membersModule.canManageServerMember(me, me), "The owner can manage itself.");
    facts.memberRoles = members.map((member) => member.role);
  });

  await check(
    "In the background the phone keeps its connection and sends no pings; on return the old connection answers and is kept",
    async () => {
      const activePeer = held.peer;
      const socket = phoneSocket;
      assert(activePeer !== null && socket !== null, "No peer or socket.");
      const hub = await runtime.hub(new AbortController().signal);
      const generation = hub.connectionGeneration();
      const socketsBefore = ReactNativeLikeWebSocket.instances.length;
      const updatesBefore = updates.length;
      runtime.pause();
      const pingsBefore = socket.pingsSent;
      await observe(1_500);
      assert(socket.pingsSent === pingsBefore, "The phone sent a ping in the background.");
      assert(socket.open, "The connection closed in the background.");
      const started = performance.now();
      runtime.resume();
      const listed = await deadline(
        "the request after the return",
        activePeer.execute({
          id: commandId(),
          type: "request",
          method: "GET",
          path: TEAM_API_ROUTES.agents.all,
          body: {},
        }),
      );
      facts.liveReturnMs = Math.round(performance.now() - started);
      assert(listed.ok && listed.status === 200, inspect(listed));
      await waitFor("the kept connection line", () =>
        relayLines.some((line) => line.startsWith("relay return: connection kept")),
      );
      assert(hub.connectionGeneration() === generation, "A new connection replaced the live one.");
      const candidates = ReactNativeLikeWebSocket.instances.slice(socketsBefore);
      assert(candidates.length <= 1, `${candidates.length} new sockets.`);
      assert(
        candidates.every((candidate) => !candidate.helloSent),
        "A second connection signed in.",
      );
      await waitFor("the unused candidate socket closes", () => candidates.every((candidate) => !candidate.open));
      assert(socket.open, "The kept socket is not open.");
      assert(!updates.slice(updatesBefore).includes("offline"), "The host peer went offline.");
    },
  );

  await check(
    "After the server dropped the silent phone, the return uses a new connection and the peer catches up from its last event number",
    async () => {
      const activePeer = held.peer;
      const ownerPeer = ownerHeld.peer;
      const socket = phoneSocket;
      assert(activePeer !== null && ownerPeer !== null && socket !== null, "No peer or socket.");
      const hub = await runtime.hub(new AbortController().signal);
      const generation = hub.connectionGeneration();
      const eventsBefore = events.length;
      const diagnosticsBefore = diagnostics.length;
      const updatesBefore = updates.length;
      const text = "Hello from the owner while the phone is away";
      runtime.pause();
      socket.frozen = true;
      const sent = await deadline(
        "the owner's message",
        ownerPeer.execute({
          id: commandId(),
          type: "request",
          method: "POST",
          path: TEAM_API_ROUTES.agent.messages(config.agentId),
          body: { agentId: config.agentId, text, timezone: "UTC" },
        }),
      );
      assert(sent.ok && (sent.status ?? 0) < 300, inspect(sent));
      await waitFor("the server drops the silent phone", () => socket.serverClosed);
      const started = performance.now();
      runtime.resume();
      await waitFor("the host peer sees the connection change", () => updates.slice(updatesBefore).includes("offline"));
      const connected = await deadline(
        "the connect after the return",
        activePeer.execute({ id: commandId(), type: "connect", hostId, hostPublicKey: config.hostKeyId }),
      );
      assert(connected.ok, connected.error ?? "The connect failed.");
      const listed = await deadline(
        "the first answer after the return",
        activePeer.execute({
          id: commandId(),
          type: "request",
          method: "GET",
          path: TEAM_API_ROUTES.agents.all,
          body: {},
        }),
      );
      facts.deadReturnMs = Math.round(performance.now() - started);
      assert(listed.ok && listed.status === 200, inspect(listed));
      await waitFor("the missed events", () => events.slice(eventsBefore).some((event) => event.includes(text)));
      assert(
        !diagnostics.slice(diagnosticsBefore).includes("event-reset"),
        `The host reset the events: ${diagnostics.slice(diagnosticsBefore).join(", ")}`,
      );
      assert(hub.connectionGeneration() === generation + 1, "The connection was not replaced once.");
      assert(
        relayLines.some((line) => line.startsWith("relay return: new connection used")),
        relayLines.join(" | "),
      );
      facts.returnLines = relayLines.filter((line) => line.startsWith("relay "));
    },
  );

  await check("The owner makes a member an admin, and back; the member list follows the role", async () => {
    const ownerPeer = ownerHeld.peer;
    const alicePeer = held.peer;
    assert(ownerPeer !== null && alicePeer !== null, "No peer.");
    const owner = peerTeamApi(ownerPeer);
    const member = peerTeamApi(alicePeer);
    const alice = (await membersModule.listServerMembers(owner)).find((entry) => entry.username === "alice");
    assert(alice !== undefined, "Alice is not listed.");
    const promoted = await membersModule.updateServerMember(owner, { memberId: alice.id, role: "admin" });
    assert(promoted.role === "admin" && promoted.id === alice.id, inspect(promoted));
    const seen = await membersModule.listServerMembers(member);
    assert(
      seen.some((entry) => entry.role === "owner"),
      "The admin does not see the owner.",
    );
    const ownerEntry = seen.find((entry) => entry.role === "owner");
    assert(ownerEntry !== undefined, "No owner entry.");
    const refusedOwnerChange = await membersModule
      .updateServerMember(member, { memberId: ownerEntry.id, role: "member" })
      .then(
        () => "changed",
        (error: unknown) => refusal(error),
      );
    assert(refusedOwnerChange !== "changed", "An admin changed the owner.");
    const demoted = await membersModule.updateServerMember(owner, { memberId: alice.id, role: "member" });
    assert(demoted.role === "member", inspect(demoted));
    const refused = await membersModule.listServerMembers(member).then(
      () => "listed",
      (error: unknown) => refusal(error),
    );
    assert(refused === adminRequired, `After the change back the host gave: ${refused}`);
  });

  await check("The owner disables a member and enables it again", async () => {
    const ownerPeer = ownerHeld.peer;
    assert(ownerPeer !== null, "No owner peer.");
    const owner = peerTeamApi(ownerPeer);
    const alice = (await membersModule.listServerMembers(owner)).find((entry) => entry.username === "alice");
    assert(alice !== undefined, "Alice is not listed.");
    const disabled = await membersModule.updateServerMember(owner, { memberId: alice.id, disabled: true });
    assert(disabled.disabled, inspect(disabled));
    const enabled = await membersModule.updateServerMember(owner, { memberId: alice.id, disabled: false });
    assert(!enabled.disabled && enabled.role === "member", inspect(enabled));
  });

  await check("A host of another team is not in the roster and the relay refuses the dial", async () => {
    const otherIdentity = await createRelayIdentityFromText(config.otherHostText, { crypto });
    const control = startRelayControl(otherIdentity, { hosting: true, label: "Other team host", crypto });
    await deadline(
      "the other team host online",
      new Promise<void>((resolveOnline) => {
        const stop = control.subscribe((snapshot) => {
          if (snapshot.state.status !== "online") return;
          stop();
          resolveOnline();
        });
      }),
    );
    try {
      assert(
        relayModule
          .rosterHosts(runtime.snapshot(), phoneIdentity)
          .every((member) => member.keyId !== config.otherHostKeyId),
        "The host of another team is in the roster.",
      );
      const refusal = await deadline(
        "the refused dial",
        relayHubTunnelTransport(runtime)
          .open("relay:check", config.otherHostKeyId, new AbortController().signal)
          .then(
            (tunnels) => {
              tunnels.close();
              return "opened";
            },
            (error: unknown) => errorCode(error),
          ),
      );
      assert(refusal === "host_offline", refusal);
      facts.otherTeamRelayRefusal = refusal;
    } finally {
      control.stop();
    }
  });

  await check("A host certificate of another team is refused by the phone's own check", async () => {
    const pointed = await createRelayIdentityFromText(
      JSON.stringify({ ...JSON.parse(config.phoneText), relayUrl: config.otherTeamPeerRelayUrl }),
      { crypto },
    );
    const pointedControl = startRelayControl(pointed, { crypto });
    const refusal = await deadline(
      "the dial at the fake relay",
      relayHubTunnelTransport(pointedControl)
        .open("relay:check", config.otherHostKeyId, new AbortController().signal)
        .then(
          () => "opened",
          (error: unknown) => `${errorCode(error)}:${error instanceof Error ? error.message : ""}`,
        ),
    ).finally(() => pointedControl.stop());
    assert(refusal.startsWith("peer_refused:"), refusal);
    facts.otherTeamPeerRefusal = refusal;
  });

  await check("A server identity from another root gives server_refused with no retry", async () => {
    const pointedText = JSON.stringify({ ...JSON.parse(config.phoneText), relayUrl: config.foreignProofRelayUrl });
    const separate = identityModule.createPhoneIdentityStore(
      {
        getItemAsync: async () => null,
        setItemAsync: async () => undefined,
        deleteItemAsync: async () => undefined,
      },
      crypto,
    );
    const pointed = await separate.importText(pointedText);
    const states: string[] = [];
    const foreign = new PhoneRelayRuntime(
      { identity: pointed, crypto },
      (code) => states.push(`ended:${code}`),
      {
        baseMs: 50,
        maxMs: 100,
      },
      PHONE_LIVENESS,
    );
    runtimes.push(foreign);
    foreign.subscribe(() => states.push(foreign.snapshot().state.status));
    foreign.start();
    const final = await untilSnapshot(foreign, "the refused control", () => {
      const state = foreign.snapshot().state;
      return state.status === "offline" && state.code !== "stopped" ? state : null;
    });
    assert(final.status === "offline" && final.code === "server_refused" && final.retryInMs === null, inspect(final));
    assert(relayModule.relayFinalCode(foreign.snapshot()) === "server_refused", "The code is not final.");
    assert(!relayModule.relayEndsIdentity(foreign.snapshot()), "A refused server must not end the identity.");
    foreign.stop();
    facts.foreignStates = states;
  });

  await check("Remove identity empties the secure store", async () => {
    await store.remove();
    assert(memory.size === 0, `The store keeps ${memory.size} items.`);
    assert((await store.load()) === null, "An identity still loads.");
  });
} finally {
  for (const runtime of runtimes) runtime.stop();
  await held.peer?.dispose().catch(() => undefined);
  await ownerHeld.peer?.dispose().catch(() => undefined);
}

writeFileSync(config.out, `${JSON.stringify({ checks, facts }, null, 2)}\n`);
process.exit(0);
