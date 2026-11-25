export const APP_NAME = "OpenBot-NC";
export const APP_ID = "app.openbotnc.desktop";
export const APP_HOME_FOLDER = "OpenBot-NC";
export const APP_LINK_SCHEME = "openbot-nc";
export const APP_LINK_PROTOCOL = `${APP_LINK_SCHEME}:`;

const READABLE_APP_LINK_PROTOCOLS: ReadonlySet<string> = new Set([APP_LINK_PROTOCOL, "openbot:"]);

export function isReadableAppLinkProtocol(protocol: string): boolean {
  return READABLE_APP_LINK_PROTOCOLS.has(protocol);
}
