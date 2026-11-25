import { isDynamicRecord, isString } from "../runtime-values";
import { RELAY_CERTIFICATE_PEM_LIMIT, RELAY_CHAIN_LIMIT, RELAY_SUBJECT_NAME_PATTERN } from "./messages";

export const RELAY_IDENTITY_BUNDLE_VERSION = 1;

export interface RelayIdentityBundle {
  version: typeof RELAY_IDENTITY_BUNDLE_VERSION;
  relayUrl: string | null;
  team: string;
  user: string;
  device: string | null;
  certificate: string;
  chain: string[];
  root: string;
  privateKey: string;
}

export function decodeRelayIdentityBundle(value: unknown): RelayIdentityBundle | null {
  if (!isDynamicRecord(value) || value.version !== RELAY_IDENTITY_BUNDLE_VERSION) return null;
  const pem = (text: unknown): text is string =>
    isString(text) && text.length > 0 && text.length <= RELAY_CERTIFICATE_PEM_LIMIT;
  const name = (text: unknown): text is string => isString(text) && RELAY_SUBJECT_NAME_PATTERN.test(text);
  if (value.relayUrl !== null && !isRelayUrl(value.relayUrl)) return null;
  if (!name(value.team) || !name(value.user)) return null;
  if (value.device !== null && !name(value.device)) return null;
  if (!pem(value.certificate) || !pem(value.root) || !pem(value.privateKey)) return null;
  if (!Array.isArray(value.chain) || value.chain.length > RELAY_CHAIN_LIMIT || !value.chain.every(pem)) return null;
  return {
    version: RELAY_IDENTITY_BUNDLE_VERSION,
    relayUrl: value.relayUrl,
    team: value.team,
    user: value.user,
    device: value.device,
    certificate: value.certificate,
    chain: [...value.chain],
    root: value.root,
    privateKey: value.privateKey,
  };
}

export function isRelayUrl(value: unknown): value is string {
  if (!isString(value) || value.length > 512) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "wss:" || url.protocol === "ws:") && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}
