import {
  createAgentTemplateShareUrl,
  OPENBOT_AGENT_TEMPLATE_PATH_PREFIX,
  parseAgentTemplateUrl,
} from "@openbot/contracts/agent-template-links";
import { createPluginShareUrl, parsePluginUrl } from "@openbot/contracts/plugin-links";

export type IncomingLink =
  | { kind: "plugin"; url: string }
  | { kind: "template"; url: string; templateId: string }
  | { kind: "invalid" };

function parseIncomingLink(value: string): IncomingLink {
  try {
    const templateId = parseAgentTemplateUrl(value);
    return { kind: "template", url: createAgentTemplateShareUrl(templateId), templateId };
  } catch {}
  try {
    return { kind: "plugin", url: createPluginShareUrl(parsePluginUrl(value)) };
  } catch {
    return { kind: "invalid" };
  }
}

const requests = new Map<string, IncomingLink>();
let sequence = 0;
export function rememberIncomingLink(link: IncomingLink): string {
  if (link.kind !== "invalid") {
    for (const [id, pending] of requests) {
      if (pending.kind === link.kind && pending.url === link.url) return id;
    }
  }
  const id = String(++sequence);
  requests.set(id, link);
  if (requests.size > 8) {
    const oldest = requests.keys().next().value;
    if (oldest) requests.delete(oldest);
  }
  return id;
}

export function readIncomingLink(id: string | undefined): IncomingLink {
  return (id && requests.get(id)) || { kind: "invalid" };
}

export function forgetIncomingLink(id: string | undefined): void {
  if (id) requests.delete(id);
}

export function redirectIncomingLink(path: string, initial: boolean): string | null {
  if (path === "openbot://" || path === "openbot:///" || path === "openbot:") return initial ? "/" : null;
  if (/^exps?:\/\//u.test(path)) return path;
  if (path.startsWith("/") && !path.startsWith("//")) {
    const url = new URL(path, "https://openbot.run");
    if (
      url.pathname !== "/join" &&
      !url.pathname.startsWith("/plugins/") &&
      !url.pathname.startsWith(OPENBOT_AGENT_TEMPLATE_PATH_PREFIX)
    )
      return path;
    path = url.toString();
  }
  return `/incoming-link?request=${rememberIncomingLink(parseIncomingLink(path))}`;
}
