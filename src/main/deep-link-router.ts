import { APP_LINK_PROTOCOL, APP_LINK_SCHEME } from "@openbot/contracts/app-identity";
import { parsePluginUrl } from "@openbot/contracts/plugin-links";

export type DeepLink = { kind: "plugin"; slug: string } | { kind: "mcp-auth"; state: string; code: string };

const MCP_OAUTH_HOST = "mcp-auth";

export const MCP_OAUTH_REDIRECT_URL = `${APP_LINK_SCHEME}://${MCP_OAUTH_HOST}`;

export function parseDeepLink(value: string): DeepLink | null {
  try {
    return { kind: "plugin", slug: parsePluginUrl(value) };
  } catch {}

  return parseMcpAuthUrl(value);
}

function parseMcpAuthUrl(value: string): DeepLink | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== APP_LINK_PROTOCOL || url.hostname !== MCP_OAUTH_HOST) return null;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return null;
  return { kind: "mcp-auth", state, code };
}

export function findDeepLink(values: string[]): DeepLink | null {
  for (const value of values) {
    const link = parseDeepLink(value);
    if (link) return link;
  }
  return null;
}
