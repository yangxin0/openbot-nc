import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RelayControl } from "./control";
import { RelayHostClient } from "./hub-client";

const RELAY_ADDRESS_SUFFIX = ".relay.invalid";
const KEY_ID_HEX_LENGTH = 64;
const KEY_ID_LABEL_LENGTH = 32;

export function relayOrigin(target: string): string {
  const key = Buffer.from(target, "base64url").toString("hex");
  return `http://${key.slice(0, KEY_ID_LABEL_LENGTH)}.${key.slice(KEY_ID_LABEL_LENGTH)}${RELAY_ADDRESS_SUFFIX}`;
}

export function isRelayAddress(url: URL): boolean {
  return url.hostname.endsWith(RELAY_ADDRESS_SUFFIX);
}

export function relayTargetOf(url: URL): string | null {
  if (!isRelayAddress(url)) return null;
  const hex = url.hostname.slice(0, -RELAY_ADDRESS_SUFFIX.length).split(".").join("");
  if (hex.length !== KEY_ID_HEX_LENGTH || !/^[0-9a-f]+$/u.test(hex)) return null;
  const target = Buffer.from(hex, "hex").toString("base64url");
  return relayOrigin(target) === `http://${url.hostname}` ? target : null;
}

export interface RelayFetch {
  readonly origin: string;
  readonly client: RelayHostClient;
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  close: () => void;
}

export function createRelayFetch(options: {
  control: RelayControl;
  target: string;
  transferDirectory?: string;
}): RelayFetch {
  const client = new RelayHostClient(
    options.control,
    options.target,
    options.transferDirectory ?? join(tmpdir(), "openbot-relay-client", options.target),
  );
  return {
    origin: relayOrigin(options.target),
    client,
    fetch: (input, init) => client.fetch(input, init),
    close: () => void client.dispose(),
  };
}
