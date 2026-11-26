// @vitest-environment node

import { describe, expect, it } from "vitest";
import { decodeRelayImportResult, decodeRelayJoinCodeLink, decodeRelayState } from "./relay-decoding";

const IDENTITY = {
  team: "Acme",
  user: "alice",
  device: "laptop",
  keyId: "a".repeat(43),
  relayUrl: "wss://relay.example.com/v1/relay",
  expiresAt: 1_800_000_000_000,
};
const MEMBER = {
  keyId: "b".repeat(43),
  user: "build",
  device: null,
  label: "Build server",
  hosting: true,
  self: false,
  serverId: "server-1",
  hidden: false,
};
const STATE = {
  identity: IDENTITY,
  identityIssue: null,
  control: { status: "offline", code: "certificate_revoked", message: "Revoked.", retryInMs: null },
  members: [MEMBER],
  hosting: true,
  hostingState: { status: "error", message: "Revoked." },
};

describe("decodeRelayState", () => {
  it("keeps the identity summary, the roster and the hosting state", () => {
    expect(decodeRelayState(STATE)).toEqual(STATE);
  });

  it("drops secret fields that main must never send", () => {
    const leaked = {
      ...STATE,
      privateKey: "-----BEGIN PRIVATE KEY-----",
      identity: { ...IDENTITY, privateKey: "-----BEGIN PRIVATE KEY-----", certificate: "-----BEGIN CERTIFICATE-----" },
      members: [{ ...MEMBER, sessionToken: "token" }],
    };
    const decoded = decodeRelayState(leaked);
    expect(decoded).toEqual(STATE);
    expect(JSON.stringify(decoded)).not.toMatch(/PRIVATE KEY|CERTIFICATE|token/u);
  });

  it("accepts a state with no identity and a stopped connection", () => {
    const empty = {
      identity: null,
      identityIssue: "OpenBot cannot read or write its identity file.",
      control: { status: "offline", code: "stopped", message: null, retryInMs: null },
      members: [],
      hosting: false,
      hostingState: { status: "off", message: null },
    };
    expect(decodeRelayState(empty)).toEqual(empty);
  });

  it.each([
    ["an unknown connection code", { ...STATE, control: { ...STATE.control, code: "unknown" } }],
    ["an unknown connection status", { ...STATE, control: { status: "lost" } }],
    ["an unknown hosting status", { ...STATE, hostingState: { status: "maybe", message: null } }],
    ["a member with no self flag", { ...STATE, members: [{ ...MEMBER, self: undefined }] }],
    ["an identity with no key id", { ...STATE, identity: { ...IDENTITY, keyId: 7 } }],
    ["a missing hosting choice", { ...STATE, hosting: "on" }],
  ])("rejects %s", (_name, value) => {
    expect(() => decodeRelayState(value)).toThrow();
  });
});

describe("decodeRelayImportResult", () => {
  it("keeps a canceled dialog and an imported state", () => {
    expect(decodeRelayImportResult({ status: "canceled" })).toEqual({ status: "canceled" });
    expect(decodeRelayImportResult({ status: "imported", state: STATE })).toEqual({ status: "imported", state: STATE });
  });

  it("rejects an unknown result", () => {
    expect(() => decodeRelayImportResult({ status: "replaced" })).toThrow();
    expect(() => decodeRelayImportResult(null)).toThrow();
  });
});

describe("decodeRelayJoinCodeLink", () => {
  const LINK = `openbot-nc://enroll?v=1&server=relay.example.com&code=${"0".repeat(26)}&root=${"r".repeat(43)}`;

  it("keeps a join code link, without the spaces around it", () => {
    expect(decodeRelayJoinCodeLink(LINK)).toBe(LINK);
    expect(decodeRelayJoinCodeLink(`  ${LINK}\n`)).toBe(LINK);
  });

  it.each([
    ["no link", null],
    ["a number", 7],
    ["a different link", "openbot-nc://plugin/example"],
    ["a code of the wrong length", LINK.replace("0".repeat(26), "0".repeat(25))],
    ["an unknown field", `${LINK}&token=secret`],
    ["a root fingerprint of the wrong length", LINK.replace("r".repeat(43), "r".repeat(42))],
  ])("drops %s", (_name, value) => {
    expect(decodeRelayJoinCodeLink(value)).toBeNull();
  });
});

describe("join with code results", () => {
  it("keep the relay state and drop secret fields", () => {
    const decoded = decodeRelayState({
      ...STATE,
      identity: { ...IDENTITY, privateKey: "-----BEGIN PRIVATE KEY-----" },
    });
    expect(decoded).toEqual(STATE);
  });

  it("reject a result that is not a relay state", () => {
    expect(() => decodeRelayState({ status: "imported", state: STATE })).toThrow();
    expect(() => decodeRelayState(undefined)).toThrow();
  });
});
