import { isIP } from "node:net";
import { join } from "node:path";
import { Effect, Option, Schema } from "effect";
import type { RelayAdminConfig } from "./config";
import { OneTimeStore } from "./one-time-store";

export const ADMIN_LOGIN_MINUTES = 10;
const ADMIN_LOGIN_SECRET_BYTES = 32;
const OPEN_LOGINS_LIMIT = 20;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const WILDCARD_HOSTS = new Set(["[::]", "0.0.0.0"]);

const AdminLoginEntry = Schema.Struct({
  version: Schema.Literal(1),
  createdAt: Schema.Int,
  expiresAt: Schema.Int,
});
type AdminLoginEntry = typeof AdminLoginEntry.Type;
const decodeEntry = Schema.decodeUnknownOption(AdminLoginEntry);

export class AdminLogins {
  readonly #store: OneTimeStore<AdminLoginEntry>;
  readonly #now: () => number;

  constructor(dataDirectory: string, now: () => number = Date.now) {
    this.#now = now;
    this.#store = new OneTimeStore({
      directory: join(dataDirectory, "admin", "logins"),
      decode: (value) => Option.getOrNull(decodeEntry(value)),
      limit: OPEN_LOGINS_LIMIT,
      noun: "sign-in link",
      now,
    });
  }

  readonly create = Effect.fn("AdminLogins.create")(() =>
    Effect.gen({ self: this }, function* () {
      const createdAt = this.#now();
      const entry: AdminLoginEntry = { version: 1, createdAt, expiresAt: createdAt + ADMIN_LOGIN_MINUTES * 60_000 };
      const { secret, hash } = yield* this.#store.create(entry, ADMIN_LOGIN_SECRET_BYTES);
      return { token: Buffer.from(secret).toString("base64url"), hash, expiresAt: entry.expiresAt };
    }),
  );

  readonly claim = Effect.fn("AdminLogins.claim")((token: string) =>
    Effect.gen({ self: this }, function* () {
      if (!TOKEN_PATTERN.test(token)) return null;
      const claimed = yield* this.#store.claim(Buffer.from(token, "base64url"));
      if (claimed === null) return null;
      yield* this.#store.finish(claimed.hash);
      return claimed.hash;
    }),
  );

  readonly cleanup = Effect.fn("AdminLogins.cleanup")(() => this.#store.cleanup());
}

export function adminAuthority(admin: RelayAdminConfig): string {
  return `${isIP(admin.host) === 6 ? `[${admin.host}]` : admin.host}:${admin.port}`;
}

export function adminOrigin(admin: RelayAdminConfig): string {
  return `http://${adminAuthority(admin)}`;
}

export function adminLoginUrl(admin: RelayAdminConfig, token: string): string {
  return `${adminOrigin(admin)}/admin/login#${token}`;
}

export function adminListenProblem(admin: RelayAdminConfig): string | null {
  const family = isIP(admin.host);
  if (family === 0) {
    return "RELAY_ADMIN_HOST must be an IP address, such as the tailnet address of this server.";
  }
  const canonical = canonicalAddress(admin.host, family);
  if (admin.allowPublic) return null;
  if (WILDCARD_HOSTS.has(canonical)) {
    return `RELAY_ADMIN_HOST=${admin.host} listens on all addresses. Give a private address, such as the tailnet address of this server. Only RELAY_ADMIN_ALLOW_PUBLIC=1 permits this.`;
  }
  if (!isPrivateAddress(canonical, family)) {
    return `RELAY_ADMIN_HOST=${admin.host} is a public address. The admin page uses plain HTTP, so give a private address, such as the tailnet address of this server. Only RELAY_ADMIN_ALLOW_PUBLIC=1 permits this.`;
  }
  return null;
}

function canonicalAddress(address: string, family: number): string {
  return family === 6 ? new URL(`http://[${address}]/`).hostname : new URL(`http://${address}/`).hostname;
}

function isPrivateAddress(canonical: string, family: number): boolean {
  if (family === 4) {
    const [first = 0, second = 0] = canonical.split(".").map(Number);
    return (
      first === 10 ||
      first === 127 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 100 && second >= 64 && second <= 127)
    );
  }
  if (canonical === "[::1]") return true;
  const firstGroup = canonical.slice(1).split(":")[0] ?? "";
  return firstGroup.length === 4 && /^f[cd]/u.test(firstGroup);
}
