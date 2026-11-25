import { isMobileConnectDevelopmentHost } from "@openbot/contracts/mobile-connect";

export function buildContentSecurityPolicy(packaged: boolean, developmentSignalUrl?: string): string {
  const developmentSources = packaged
    ? ""
    : ` http://localhost:* ws://localhost:*${developmentSignalSource(developmentSignalUrl)}`;
  const developmentImageSources = packaged ? "" : " http://127.0.0.1:* http://localhost:*";

  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: openbot-attachment: openbot-remote-attachment: openbot-avatar: openbot-remote-avatar: openbot-server-logo: openbot-remote-server-logo: https:${developmentImageSources}`,
    "font-src 'self' data:",
    "media-src 'self' blob: openbot-attachment: openbot-remote-attachment:",
    `connect-src 'self' openbot-attachment: openbot-remote-attachment: ws://127.0.0.1:*${developmentSources}`,
    "object-src 'none'",
    "frame-src 'self' openbot-attachment: openbot-remote-attachment: openbot-visual: openbot-remote-visual: http://127.0.0.1:* http://localhost:*",
    "base-uri 'none'",
  ].join("; ");
}

function developmentSignalSource(value: string | undefined): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (
      url.protocol !== "ws:" ||
      !isMobileConnectDevelopmentHost(url.hostname) ||
      url.username !== "" ||
      url.password !== ""
    ) {
      return "";
    }
    return ` ${url.origin}`;
  } catch {
    return "";
  }
}
