import type { RelayDesktopApi, RelayMemberSummary, RelayState } from "@openbot/contracts/ipc";
import { parseRelayJoinCode } from "@openbot/contracts/relay-protocol/enrollment";
import { sourceText } from "@openbot/i18n/source";
import { clone } from "./mock-support";

export type MockRelayScenario = "none" | "online" | "offline" | "expiring" | "hosting";

export interface MockRelayOptions {
  relay?: MockRelayScenario;
}

const MOCK_KEY_ID = "mock-self-key-0000000000000000000000000000000";
const MOCK_HOST_KEY_ID = "mock-host-key-0000000000000000000000000000000";
const MOCK_LAB_KEY_ID = "mock-lab-key-00000000000000000000000000000000";
const MOCK_PEER_KEY_ID = "mock-peer-key-0000000000000000000000000000000";
const MOCK_HOST_SERVER_ID = "mock-relay-host";
const MOCK_LAB_SERVER_ID = "mock-relay-lab";
const DAY_MS = 86_400_000;
const RETRY_MS = 30_000;

interface MockRelayModel {
  imported: boolean;
  hosting: boolean;
  offline: boolean;
  expiresInDays: number;
  hiddenServerIds: Set<string>;
}

function members(model: MockRelayModel): RelayMemberSummary[] {
  if (model.offline) return [];
  return [
    {
      keyId: MOCK_KEY_ID,
      user: "jenny",
      device: "laptop",
      label: model.hosting ? "Jenny's OpenBot" : null,
      hosting: model.hosting,
      self: true,
      serverId: null,
      hidden: false,
    },
    {
      keyId: MOCK_HOST_KEY_ID,
      user: "build-server",
      device: "server",
      label: "Build server",
      hosting: true,
      self: false,
      serverId: MOCK_HOST_SERVER_ID,
      hidden: model.hiddenServerIds.has(MOCK_HOST_SERVER_ID),
    },
    {
      keyId: MOCK_LAB_KEY_ID,
      user: "sam",
      device: "mac-mini",
      label: "Lab",
      hosting: true,
      self: false,
      serverId: MOCK_LAB_SERVER_ID,
      hidden: model.hiddenServerIds.has(MOCK_LAB_SERVER_ID),
    },
    {
      keyId: MOCK_PEER_KEY_ID,
      user: "alex",
      device: "desktop",
      label: null,
      hosting: false,
      self: false,
      serverId: null,
      hidden: false,
    },
  ];
}

function hostingState(model: MockRelayModel): RelayState["hostingState"] {
  if (!model.hosting) return { status: "off", message: null };
  if (!model.imported) return { status: "no_identity", message: sourceText("error.host.relayIdentityMissing") };
  if (model.offline) return { status: "offline", message: sourceText("error.remote.relayUnreachable") };
  return { status: "online", message: sourceText("status.host.relayReady") };
}

function stateOf(model: MockRelayModel): RelayState {
  return {
    identity: model.imported
      ? {
          team: "Acme",
          user: "jenny",
          device: "laptop",
          keyId: MOCK_KEY_ID,
          relayUrl: "wss://relay.example.com/v1/relay",
          expiresAt: Date.now() + model.expiresInDays * DAY_MS,
        }
      : null,
    identityIssue: null,
    control: !model.imported
      ? { status: "offline", code: "stopped", message: null, retryInMs: null }
      : model.offline
        ? {
            status: "offline",
            code: "connect_failed",
            message: sourceText("error.remote.relayUnreachable"),
            retryInMs: RETRY_MS,
          }
        : { status: "online" },
    members: model.imported ? members(model) : [],
    hosting: model.hosting,
    hostingState: hostingState(model),
  };
}

function initialModel(scenario: MockRelayScenario): MockRelayModel {
  return {
    imported: scenario !== "none",
    hosting: scenario === "hosting" || scenario === "offline",
    offline: scenario === "offline",
    expiresInDays: scenario === "expiring" ? 12 : 365,
    hiddenServerIds: new Set([MOCK_LAB_SERVER_ID]),
  };
}

export function createMockRelay(options: MockRelayOptions = {}): RelayDesktopApi {
  const model = initialModel(options.relay ?? "none");
  const listeners = new Set<(state: RelayState) => void>();
  const publish = (): RelayState => {
    const state = stateOf(model);
    for (const listener of listeners) listener(clone(state));
    return clone(state);
  };
  const imported = (): RelayState => {
    model.imported = true;
    model.offline = false;
    model.expiresInDays = 365;
    return publish();
  };
  return {
    getState: async () => clone(stateOf(model)),
    importIdentity: async () => {
      if (model.imported) throw new Error(sourceText("error.remote.relayIdentityExists"));
      return { status: "imported", state: imported() };
    },
    replaceIdentity: async () => ({ status: "imported", state: imported() }),
    joinWithCode: async (code) => {
      if (!parseRelayJoinCode(code)) throw new Error(sourceText("error.remote.relayJoinInvalidCode"));
      if (model.imported) throw new Error(sourceText("error.remote.relayIdentityExists"));
      return imported();
    },
    replaceWithCode: async (code) => {
      if (!parseRelayJoinCode(code)) throw new Error(sourceText("error.remote.relayJoinInvalidCode"));
      return imported();
    },
    takePendingJoinCode: async () => null,
    onOpenJoinCode: () => () => undefined,
    removeIdentity: async () => {
      model.imported = false;
      model.offline = false;
      return publish();
    },
    setHosting: async (enabled) => {
      model.hosting = enabled;
      return publish();
    },
    unhideHost: async (serverId) => {
      model.hiddenServerIds.delete(serverId);
      return publish();
    },
    onState: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
