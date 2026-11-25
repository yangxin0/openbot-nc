// @vitest-environment node

import { describe, expect, it } from "vitest";
import { decodeRelayImportResult, decodeRelayState } from "./relay-decoding";

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
