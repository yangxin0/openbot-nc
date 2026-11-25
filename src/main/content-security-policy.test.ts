import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy } from "./content-security-policy";

const PACKAGED_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: openbot-attachment: openbot-remote-attachment: openbot-avatar: openbot-remote-avatar: openbot-server-logo: openbot-remote-server-logo: https:",
  "font-src 'self' data:",
  "media-src 'self' blob: openbot-attachment: openbot-remote-attachment:",
  "connect-src 'self' openbot-attachment: openbot-remote-attachment: ws://127.0.0.1:*",
  "object-src 'none'",
  "frame-src 'self' openbot-attachment: openbot-remote-attachment: openbot-visual: openbot-remote-visual: http://127.0.0.1:* http://localhost:*",
  "base-uri 'none'",
];

const VENDOR_SOURCE = /openbot\.run|analytics\.|wss:/u;

describe("buildContentSecurityPolicy", () => {
  it("keeps every directive of a packaged build and adds no source", () => {
    expect(buildContentSecurityPolicy(true).split("; ")).toEqual(PACKAGED_POLICY);
  });

  it.each([true, false])("names no vendor or remote Signal source when packaged=%s", (packaged) => {
    const policy = buildContentSecurityPolicy(packaged, "ws://192.168.1.143:3101/v1/signal");

    expect(policy).not.toMatch(VENDOR_SOURCE);
  });

  it("adds only the local development sources to connect-src and img-src of a development build", () => {
    const directives = buildContentSecurityPolicy(false, "ws://192.168.1.143:3101/v1/signal").split("; ");
    const expected = PACKAGED_POLICY.map((directive) => {
      if (directive.startsWith("connect-src "))
        return `${directive} http://localhost:* ws://localhost:* ws://192.168.1.143:3101`;
      if (directive.startsWith("img-src ")) return `${directive} http://127.0.0.1:* http://localhost:*`;
      return directive;
    });

    expect(directives).toEqual(expected);
  });

  it("lets the renderer play an attachment recording, but only from the attachment schemes", () => {
    const policy = buildContentSecurityPolicy(true);

    expect(policy).toContain("media-src 'self' blob: openbot-attachment: openbot-remote-attachment:");
    expect(policy).not.toContain("media-src 'self' blob: openbot-attachment: openbot-remote-attachment: https:");
  });

  it("does not add public or production Signal origins through the development option", () => {
    expect(buildContentSecurityPolicy(false, "ws://signal.example.com/v1/signal")).not.toContain(
      "ws://signal.example.com",
    );
    expect(buildContentSecurityPolicy(true, "ws://192.168.1.143:3101/v1/signal")).not.toContain(
      "ws://192.168.1.143:3101",
    );
  });
});
