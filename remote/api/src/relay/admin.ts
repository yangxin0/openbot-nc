import { createHash, randomBytes, timingSafeEqual, X509Certificate } from "node:crypto";
import { readFile } from "node:fs/promises";
import { RELAY_KEY_ID_PATTERN } from "@openbot/contracts/relay-protocol/messages";
import { Effect, Option, Result, Schema } from "effect";
import { toString as qrCode } from "qrcode";
import { type AdminLogins, adminAuthority, adminOrigin } from "./admin-logins";
import pageStyle from "./admin-page/admin.css" with { type: "text" };
import pageScript from "./admin-page/admin.js" with { type: "text" };
import pageHtml from "./admin-page/index.html" with { type: "text" };
import themeScript from "./admin-page/theme.js" with { type: "text" };
import { CERTIFICATE_DAYS, type CertificateAuthority, type CertificateRecord } from "./certificate-authority";
import type { RelayAdminConfig } from "./config";
import { type Enrollment, JOIN_CODE_ID_LENGTH, JOIN_CODE_MINUTES, rootFingerprint } from "./enrollment";
import { certificateFingerprint } from "./identity";
import { SlidingWindowLimit } from "./rate-limit";
import type { RelayLiveMember, RelayService } from "./service";

const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join("; ");

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Robots-Tag": "noindex, nofollow",
};

const PAGE_PATHS = new Set(["/admin", "/admin/", "/admin/login"]);
const SESSION_COOKIE = "openbot_relay_admin";
const CSRF_HEADER = "x-openbot-csrf";
const SESSION_ABSOLUTE_MS = 12 * 60 * 60_000;
const SESSION_IDLE_MS = 60 * 60_000;
const SESSION_LIMIT = 32;
const SECRET_BYTES = 32;
const BODY_BYTES_LIMIT = 16 * 1024;
const SIGN_IN_WINDOW_MS = 60_000;
const SIGN_IN_PER_ADDRESS = 10;
const SIGN_IN_OVERALL = 30;
const LOG_PREFIX_LENGTH = 8;

const SignInBody = Schema.Struct({ token: Schema.String });
const TeamBody = Schema.Struct({ team: Schema.String, days: Schema.optionalKey(Schema.Int) });
const CodeBody = Schema.Struct({
  team: Schema.String,
  user: Schema.String,
  device: Schema.optionalKey(Schema.NullOr(Schema.String)),
  minutes: Schema.optionalKey(Schema.Int),
  days: Schema.optionalKey(Schema.Int),
});
const CancelBody = Schema.Struct({ id: Schema.String });
const RevokeBody = Schema.Struct({ keyId: Schema.String });
const decodeSignIn = Schema.decodeUnknownOption(Schema.fromJsonString(SignInBody));
const decodeTeam = Schema.decodeUnknownOption(Schema.fromJsonString(TeamBody));
const decodeCode = Schema.decodeUnknownOption(Schema.fromJsonString(CodeBody));
const decodeCancel = Schema.decodeUnknownOption(Schema.fromJsonString(CancelBody));
const decodeRevoke = Schema.decodeUnknownOption(Schema.fromJsonString(RevokeBody));

interface AdminSession {
  csrf: string;
  createdAt: number;
  lastSeenAt: number;
}

export interface AdminServerOptions {
  admin: RelayAdminConfig;
  authority: CertificateAuthority;
  enrollment: Enrollment;
  logins: AdminLogins;
  service: RelayService;
  audiences: ReadonlySet<string> | null;
  publicUrl: string | null;
  tlsCertificatePath: string | null;
  now?: () => number;
}

interface AdminServer {
  port: number;
  stop(): Promise<void>;
}

type MemberStatus = "valid" | "expired" | "revoked";

export function startAdminServer(options: AdminServerOptions): AdminServer {
  const handler = new AdminHandler(options);
  const server = Bun.serve({
    hostname: options.admin.host,
    port: options.admin.port,
    maxRequestBodySize: BODY_BYTES_LIMIT,
    fetch: (request, bunServer) => handler.handle(request, bunServer.requestIP(request)?.address ?? "unknown"),
  });
  return {
    port: server.port ?? options.admin.port,
    async stop() {
      await server.stop(true);
    },
  };
}

class AdminHandler {
  readonly #options: AdminServerOptions;
  readonly #authority: string;
  readonly #origin: string;
  readonly #now: () => number;
  readonly #sessions = new Map<string, AdminSession>();
  readonly #signInPerAddress = new SlidingWindowLimit(SIGN_IN_PER_ADDRESS, SIGN_IN_WINDOW_MS);
  readonly #signInOverall = new SlidingWindowLimit(SIGN_IN_OVERALL, SIGN_IN_WINDOW_MS);

  constructor(options: AdminServerOptions) {
    this.#options = options;
    this.#authority = adminAuthority(options.admin);
    this.#origin = adminOrigin(options.admin);
    this.#now = options.now ?? Date.now;
  }

  async handle(request: Request, address: string): Promise<Response> {
    if (request.headers.get("host") !== this.#authority) {
      return problem(403, "forbidden", "This host name is not the address of the admin page.");
    }
    const url = new URL(request.url);
    if (request.method === "GET" || request.method === "HEAD") return this.#read(request, url);
    if (request.method !== "POST") return problem(405, "invalid_request", "This method is not permitted.");
    if (request.headers.get("origin") !== this.#origin) {
      return problem(403, "forbidden", "The request did not come from the admin page.");
    }
    if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      return problem(403, "forbidden", "The request must be JSON.");
    }
    const body = await request.text().catch(() => "");
    if (url.pathname === "/admin/api/session") return this.#signIn(body, address);
    const session = this.#session(request);
    if (session === null || !sameSecret(request.headers.get(CSRF_HEADER) ?? "", session.session.csrf)) {
      return problem(403, "forbidden", "Sign in again.");
    }
    if (url.pathname === "/admin/api/logout") {
      this.#sessions.delete(session.key);
      console.log(`Admin session ${session.key.slice(0, LOG_PREFIX_LENGTH)} signed out.`);
      return json({ signedOut: true }, 200, { "Set-Cookie": `${SESSION_COOKIE}=; ${cookieAttributes(0)}` });
    }
    if (url.pathname === "/admin/api/teams") return this.#addTeam(body);
    if (url.pathname === "/admin/api/codes") return this.#createCode(body);
    if (url.pathname === "/admin/api/codes/cancel") return this.#cancelCode(body);
    if (url.pathname === "/admin/api/revoke") return this.#revoke(body);
    return problem(404, "not_found", "Not found.");
  }

  async #read(request: Request, url: URL): Promise<Response> {
    const path = url.pathname;
    if (PAGE_PATHS.has(path)) return asset(pageHtml, "text/html; charset=utf-8");
    if (path === "/admin/admin.css") return asset(pageStyle, "text/css; charset=utf-8");
    if (path === "/admin/admin.js") return asset(pageScript, "text/javascript; charset=utf-8");
    if (path === "/admin/theme.js") return asset(themeScript, "text/javascript; charset=utf-8");
    if (!path.startsWith("/admin/api/")) return problem(404, "not_found", "Not found.");
    const session = this.#session(request);
    if (session === null) return problem(401, "signed_out", "Sign in first.");
    if (path === "/admin/api/session") return json({ csrf: session.session.csrf });
    if (path === "/admin/api/overview") return this.#overview();
    if (path === "/admin/api/teams") return this.#teams();
    if (path === "/admin/api/members") return this.#members(url.searchParams.get("team") ?? "");
    if (path === "/admin/api/codes") return this.#codes();
    return problem(404, "not_found", "Not found.");
  }

  async #signIn(body: string, address: string): Promise<Response> {
    if (!this.#signInPerAddress.take(address) || !this.#signInOverall.take("all")) {
      return problem(429, "rate_limited", "Too many sign-in attempts. Try again in a minute.");
    }
    const input = Option.getOrNull(decodeSignIn(body));
    const claimed = input === null ? null : await outcome(this.#options.logins.claim(input.token));
    if (claimed === null || !claimed.ok || claimed.value === null) {
      console.log(`Admin sign-in from ${address} was refused.`);
      return problem(403, "sign_in_refused", "This sign-in link is not valid, expired or used. Run admin login again.");
    }
    this.#forgetSessions();
    const id = randomBytes(SECRET_BYTES).toString("base64url");
    const key = sessionKey(id);
    const now = this.#now();
    const session: AdminSession = {
      csrf: randomBytes(SECRET_BYTES).toString("base64url"),
      createdAt: now,
      lastSeenAt: now,
    };
    this.#sessions.set(key, session);
    console.log(
      `Admin session ${key.slice(0, LOG_PREFIX_LENGTH)} started from ${address} with sign-in link ${claimed.value.slice(0, LOG_PREFIX_LENGTH)}.`,
    );
    return json({ csrf: session.csrf }, 200, {
      "Set-Cookie": `${SESSION_COOKIE}=${id}; ${cookieAttributes(SESSION_ABSOLUTE_MS / 1000)}`,
    });
  }

  #session(request: Request): { key: string; session: AdminSession } | null {
    const id = cookieValue(request.headers.get("cookie") ?? "", SESSION_COOKIE);
    if (id === null) return null;
    const key = sessionKey(id);
    const session = this.#sessions.get(key);
    if (!session) return null;
    const now = this.#now();
    if (now - session.createdAt >= SESSION_ABSOLUTE_MS || now - session.lastSeenAt >= SESSION_IDLE_MS) {
      this.#sessions.delete(key);
      return null;
    }
    session.lastSeenAt = now;
    return { key, session };
  }

  #forgetSessions(): void {
    const now = this.#now();
    for (const [key, session] of this.#sessions) {
      if (now - session.createdAt >= SESSION_ABSOLUTE_MS || now - session.lastSeenAt >= SESSION_IDLE_MS) {
        this.#sessions.delete(key);
      }
    }
    const oldest = [...this.#sessions.entries()].sort((left, right) => left[1].lastSeenAt - right[1].lastSeenAt);
    for (const [key] of oldest.slice(0, Math.max(0, this.#sessions.size - SESSION_LIMIT + 1))) {
      this.#sessions.delete(key);
    }
  }

  async #overview(): Promise<Response> {
    const { authority, service, enrollment } = this.#options;
    const [rootPem, records, codes, identity] = await Promise.all([
      outcome(authority.rootCertificate()),
      outcome(authority.list()),
      outcome(enrollment.listCodes()),
      outcome(authority.serverIdentity()),
    ]);
    if (!rootPem.ok) return problem(503, "unavailable", rootPem.message);
    const root = new X509Certificate(rootPem.value);
    return json({
      relayUrl: this.#options.publicUrl,
      joinServer: enrollment.server,
      rootFingerprint: certificateFingerprint(root),
      joinRootFingerprint: rootFingerprint(rootPem.value),
      rootExpiresAt: Date.parse(root.validTo),
      serverIdentity: identity.ok
        ? {
            names: new X509Certificate(identity.value.certificate).subjectAltName ?? "",
            expiresAt: identity.value.expiresAt,
          }
        : { problem: identity.message },
      tlsExpiresAt: await this.#tlsExpiry(),
      membersOnline: service.metrics().members,
      teams: records.ok ? records.value.filter((record) => record.kind === "team").length : null,
      openCodes: codes.ok ? codes.value.length : null,
    });
  }

  async #tlsExpiry(): Promise<number | null> {
    const path = this.#options.tlsCertificatePath;
    if (path === null) return null;
    try {
      return Date.parse(new X509Certificate(await readFile(path)).validTo);
    } catch {
      return null;
    }
  }

  async #teams(): Promise<Response> {
    const records = await outcome(this.#options.authority.list());
    if (!records.ok) return problem(503, "unavailable", records.message);
    const live = this.#options.service.liveMembers();
    const teams = records.value
      .filter((record) => record.kind === "team" && record.team !== null)
      .map((record) => ({
        name: record.team,
        keyId: record.keyId,
        serial: record.serial,
        expiresAt: record.expiresAt,
        status: this.#status(record),
        members: records.value.filter((member) => member.kind === "member" && member.team === record.team).length,
        membersOnline: live.filter((member) => member.team === record.team).length,
      }));
    return json({ teams });
  }

  async #members(team: string): Promise<Response> {
    const records = await outcome(this.#options.authority.list());
    if (!records.ok) return problem(503, "unavailable", records.message);
    const live = new Map<string, RelayLiveMember>();
    for (const member of this.#options.service.liveMembers()) live.set(member.fingerprint, member);
    const members = records.value
      .filter((record) => record.kind === "member" && record.team === team)
      .map((record) => {
        const online = live.get(record.fingerprint);
        return {
          user: record.user,
          device: record.device,
          label: record.label ?? online?.label ?? null,
          keyId: record.keyId,
          serial: record.serial,
          issuedAt: record.issuedAt,
          expiresAt: record.expiresAt,
          status: this.#status(record),
          online: online !== undefined,
          hosting: online?.hosting ?? false,
        };
      })
      .sort((left, right) => (left.user ?? "").localeCompare(right.user ?? "") || left.issuedAt - right.issuedAt);
    return json({ team, members });
  }

  async #codes(): Promise<Response> {
    const codes = await outcome(this.#options.enrollment.listCodes());
    if (!codes.ok) return problem(503, "unavailable", codes.message);
    return json({
      codes: codes.value.map(({ hash, entry }) => ({
        id: hash.slice(0, JOIN_CODE_ID_LENGTH),
        team: entry.team,
        user: entry.user,
        device: entry.device,
        days: entry.days,
        createdAt: entry.createdAt,
        expiresAt: entry.expiresAt,
        creator: entry.creator,
      })),
    });
  }

  async #addTeam(body: string): Promise<Response> {
    const input = Option.getOrNull(decodeTeam(body));
    if (input === null) return problem(400, "invalid_request", "Give the team name.");
    const added = await outcome(
      this.#options.authority.addTeam({ team: input.team, days: input.days ?? CERTIFICATE_DAYS.team.default }),
    );
    if (!added.ok) return problem(400, "invalid_request", added.message);
    console.log(`Admin added the team "${input.team}". Key identifier: ${added.value.keyId}`);
    return json({ team: input.team, keyId: added.value.keyId, expiresAt: added.value.expiresAt });
  }

  async #createCode(body: string): Promise<Response> {
    const input = Option.getOrNull(decodeCode(body));
    if (input === null) return problem(400, "invalid_request", "Give the team and the user.");
    const created = await outcome(
      this.#options.enrollment.createCode({
        team: input.team,
        user: input.user,
        device: input.device?.trim() || null,
        minutes: input.minutes ?? JOIN_CODE_MINUTES.default,
        days: input.days ?? CERTIFICATE_DAYS.member.default,
        creator: "admin",
      }),
    );
    if (!created.ok) return problem(400, "invalid_request", created.message);
    const { url, id, entry } = created.value;
    const svg = await qrCode(url, { type: "svg", errorCorrectionLevel: "M", margin: 2 });
    console.log(`Admin made join code ${id} for ${subjectText(entry.team, entry.user, entry.device)}.`);
    return json({
      id,
      url,
      team: entry.team,
      user: entry.user,
      device: entry.device,
      expiresAt: entry.expiresAt,
      qr: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
    });
  }

  async #cancelCode(body: string): Promise<Response> {
    const input = Option.getOrNull(decodeCancel(body));
    if (input === null) return problem(400, "invalid_request", "Give the code identifier.");
    const cancelled = await outcome(this.#options.enrollment.cancelCode(input.id));
    if (!cancelled.ok) return problem(400, "invalid_request", cancelled.message);
    const id = cancelled.value.hash.slice(0, JOIN_CODE_ID_LENGTH);
    console.log(`Admin cancelled join code ${id}.`);
    return json({ id });
  }

  async #revoke(body: string): Promise<Response> {
    const input = Option.getOrNull(decodeRevoke(body));
    if (input === null || !RELAY_KEY_ID_PATTERN.test(input.keyId)) {
      return problem(400, "invalid_request", "Give the key identifier of a member.");
    }
    const { authority, service, audiences } = this.#options;
    const records = await outcome(authority.list());
    if (!records.ok) return problem(503, "unavailable", records.message);
    if (!records.value.some((record) => record.kind === "member" && record.keyId === input.keyId)) {
      return problem(404, "not_found", "No member has this key identifier.");
    }
    const revoked = await outcome(authority.revoke(input.keyId));
    if (!revoked.ok) return problem(400, "invalid_request", revoked.message);
    const trust = await outcome(authority.trust(audiences));
    if (trust.ok) service.applyTrust(trust.value);
    console.log(`Admin revoked ${revoked.value.length} certificate(s) of key ${input.keyId}.`);
    return json({ revoked: revoked.value.length });
  }

  #status(record: CertificateRecord): MemberStatus {
    if (record.revokedAt !== null) return "revoked";
    return record.expiresAt <= this.#now() ? "expired" : "valid";
  }
}

type Outcome<A> = { ok: true; value: A } | { ok: false; message: string };

async function outcome<A, E extends { message: string }>(effect: Effect.Effect<A, E>): Promise<Outcome<A>> {
  const result = await Effect.runPromise(Effect.result(effect));
  return Result.isFailure(result)
    ? { ok: false, message: result.failure.message }
    : { ok: true, value: result.success };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...SECURITY_HEADERS, ...headers } });
}

function problem(status: number, error: string, message: string): Response {
  return json({ error, message }, status);
}

function asset(text: string, contentType: string): Response {
  return new Response(text, { headers: { ...SECURITY_HEADERS, "Content-Type": contentType } });
}

function cookieAttributes(maxAgeSeconds: number): string {
  return `Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}

function cookieValue(header: string, name: string): string | null {
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=") || null;
  }
  return null;
}

function sessionKey(id: string): string {
  return createHash("sha256").update(id).digest("hex");
}

function sameSecret(actual: string, expected: string): boolean {
  return timingSafeEqual(createHash("sha256").update(actual).digest(), createHash("sha256").update(expected).digest());
}

function subjectText(team: string, user: string, device: string | null): string {
  return [team, user, device].filter((part) => part !== null).join(" / ");
}
