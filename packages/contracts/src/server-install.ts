import { INPUT_LIMITS } from "./input-limits";
import type { ConversationMessage } from "./ipc-conversation-messages";
import { slugifyTeamServerName } from "./validation";

export function parseHostedServerName(value: string): string | null {
  const name = value.trim();
  if (name.length < INPUT_LIMITS.serverNameMin || name.length > INPUT_LIMITS.serverName || /\p{Cc}/u.test(name)) {
    return null;
  }
  return slugifyTeamServerName(name).length >= INPUT_LIMITS.serverNameMin ? name : null;
}

const SERVER_INSTALL_ITEM_TYPE_PREFIX = "server-install:";
const ITEM_TYPE_LIMIT = 128;

export interface ServerInstallEvent {
  expiresAt: number;
  name: string | null;
}

export function serverInstallItemType(event: ServerInstallEvent): string {
  if (!Number.isSafeInteger(event.expiresAt) || event.expiresAt < 0) throw new Error("A valid expiry is required.");
  const base = `${SERVER_INSTALL_ITEM_TYPE_PREFIX}${event.expiresAt}:`;
  const named = event.name === null ? base : `${base}${encodeURIComponent(event.name)}`;
  return named.length <= ITEM_TYPE_LIMIT ? named : base;
}

export function serverInstallEvent(message: ConversationMessage): ServerInstallEvent | null {
  if (message.author !== "system" || message.source !== "system" || message.status !== "completed") return null;
  if (!message.itemType?.startsWith(SERVER_INSTALL_ITEM_TYPE_PREFIX)) return null;
  const match = /^([0-9]{1,16}):(.*)$/su.exec(message.itemType.slice(SERVER_INSTALL_ITEM_TYPE_PREFIX.length));
  if (!match?.[1] || match[2] === undefined) return null;
  const expiresAt = Number(match[1]);
  if (!Number.isSafeInteger(expiresAt)) return null;
  if (!match[2]) return { expiresAt, name: null };
  try {
    return { expiresAt, name: parseHostedServerName(decodeURIComponent(match[2])) };
  } catch {
    return null;
  }
}
