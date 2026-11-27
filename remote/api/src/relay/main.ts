import { X509Certificate } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { Effect, Result } from "effect";
import { toString as qrCode } from "qrcode";
import { startAdminServer } from "./admin";
import { ADMIN_LOGIN_MINUTES, AdminLogins, adminListenProblem, adminLoginUrl, adminOrigin } from "./admin-logins";
import { CERTIFICATE_DAYS, CertificateAuthority, type CertificateRecord } from "./certificate-authority";
import { type RelayConfig, readRelayConfig } from "./config";
import { createEnrollHandler } from "./enroll-route";
import { Enrollment, JOIN_CODE_ID_LENGTH, JOIN_CODE_MINUTES } from "./enrollment";
import { certificateFingerprint } from "./identity";
import { startRelayServer } from "./server";
import { RelayService } from "./service";

const TRUST_CHECK_INTERVAL_MS = 2_000;
const EXPIRY_CHECK_INTERVAL_MS = 60_000;
const DEFAULT_ROOT_NAME = "OpenBot Root CA";
const DEFAULT_TEAM = "Default";

const USAGE = `Usage:
  serve                                  Start the relay server (default).
  ca init [--name <name>] [--days <n>]    Make the root certificate and the team "Default".
  ca team add <team> [--days <n>]         Make the certificate authority of a team.
  ca issue --team <team> --user <user> [--device <device>] [--days <n>] [--out <file>]
                                          Make the certificate of one device of a user.
  ca server --dns <name> [--ip <address>] [--days <n>]
                                          Make the identity and TLS certificate of this server.
  ca code --team <team> --user <user> [--device <device>] [--minutes <n>] [--days <n>]
                                          Make a one-time join code for one device of a user.
  ca codes [--team <team>]                List the open join codes.
  ca code cancel <code identifier>        Cancel an open join code.
  ca revoke <serial | fingerprint | key identifier>
  ca list [--team <team>]
  ca root                                 Print the root certificate and its fingerprint.
  admin login                             Print a one-time sign-in link of the admin page.`;

class UsageError extends Error {}

async function run<A, E extends { message: string }>(operation: Effect.Effect<A, E>): Promise<A> {
  const result = await Effect.runPromise(Effect.result(operation));
  if (Result.isFailure(result)) throw new UsageError(result.failure.message);
  return result.success;
}

function days(value: string | undefined, fallback: number, option = "--days"): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new UsageError(`${option} must be an integer.`);
  return parsed;
}

function subjectText(parts: ReadonlyArray<string | null>): string {
  return parts.filter((part) => part !== null).join(" / ");
}

function recordLine(record: CertificateRecord): string {
  const state = record.revokedAt !== null ? "revoked" : record.expiresAt <= Date.now() ? "expired" : "valid";
  const subject = subjectText([record.team, record.user, record.device]);
  const expires = new Date(record.expiresAt).toISOString().slice(0, 10);
  const label = record.label ? ` (${record.label})` : "";
  return `${record.kind.padEnd(6)} ${state.padEnd(7)} ${expires} ${record.serial} ${record.keyId} ${subject}${label}`;
}

function rootFingerprint(pem: string): string {
  return certificateFingerprint(new X509Certificate(pem));
}

async function certificateCommand(config: RelayConfig, command: string[]): Promise<void> {
  const authority = new CertificateAuthority({
    dataDirectory: config.dataDirectory,
    passphrase: config.caPassphrase,
    publicUrl: config.publicUrl,
  });
  const [firstWord, ...afterFirstWord] = command;
  const revokeReference = firstWord === "revoke" ? afterFirstWord.filter((word) => word !== "--") : null;
  if (revokeReference !== null) {
    const [reference] = revokeReference;
    if (reference === undefined || revokeReference.length !== 1) throw new UsageError(USAGE);
    const revoked = await run(authority.revoke(reference));
    for (const record of revoked) console.log(recordLine(record));
    console.log(
      `Revoked ${revoked.length} certificate(s). A server that runs closes their connections in a few seconds.`,
    );
    return;
  }
  const { values, positionals } = parseArgs({
    args: command,
    allowPositionals: true,
    options: {
      name: { type: "string" },
      days: { type: "string" },
      team: { type: "string" },
      user: { type: "string" },
      device: { type: "string" },
      out: { type: "string" },
      dns: { type: "string", multiple: true },
      ip: { type: "string", multiple: true },
      minutes: { type: "string" },
    },
  });
  const [action, ...rest] = positionals;
  const enrollment = new Enrollment({
    authority,
    dataDirectory: config.dataDirectory,
    publicUrl: config.publicUrl,
  });
  if (action === "code" && rest[0] === "cancel") {
    if (rest[1] === undefined || rest.length !== 2) throw new UsageError(USAGE);
    const cancelled = await run(enrollment.cancelCode(rest[1]));
    console.log(`Cancelled join code ${cancelled.hash.slice(0, JOIN_CODE_ID_LENGTH)}.`);
    return;
  }
  if (action === "code") {
    if (values.team === undefined || values.user === undefined) throw new UsageError("Give --team and --user.");
    const minutes = days(values.minutes, JOIN_CODE_MINUTES.default, "--minutes");
    const created = await run(
      enrollment.createCode({
        team: values.team,
        user: values.user,
        device: values.device ?? null,
        minutes,
        days: days(values.days, CERTIFICATE_DAYS.member.default),
        creator: "cli",
      }),
    );
    process.stdout.write(`${await qrCode(created.url, { type: "terminal", small: true })}\n`);
    console.log(created.url);
    console.log(
      `Join code ${created.id} for ${subjectText([created.entry.team, created.entry.user, created.entry.device])}. It works once, until ${new Date(created.entry.expiresAt).toISOString()} (${minutes} minutes).`,
    );
    return;
  }
  if (action === "codes") {
    const codes = await run(enrollment.listCodes());
    for (const { hash, entry } of codes) {
      if (values.team !== undefined && entry.team !== values.team) continue;
      const expires = new Date(entry.expiresAt).toISOString();
      console.log(
        `${hash.slice(0, JOIN_CODE_ID_LENGTH)} ${expires} ${entry.creator.padEnd(5)} ${subjectText([entry.team, entry.user, entry.device])}`,
      );
    }
    return;
  }
  if (action === "init") {
    const record = await run(
      authority.initialize({
        name: values.name ?? DEFAULT_ROOT_NAME,
        days: days(values.days, CERTIFICATE_DAYS.root.default),
      }),
    );
    console.log(`The root certificate is ready. SHA-256 fingerprint: ${record.fingerprint}`);
    const team = await run(authority.addTeam({ team: DEFAULT_TEAM, days: CERTIFICATE_DAYS.team.default }));
    console.log(`The team "${DEFAULT_TEAM}" is ready. Key identifier: ${team.keyId}`);
    return;
  }
  if (action === "team" && rest[0] === "add" && rest[1] !== undefined) {
    const record = await run(
      authority.addTeam({ team: rest[1], days: days(values.days, CERTIFICATE_DAYS.team.default) }),
    );
    console.log(`The team "${rest[1]}" is ready. Key identifier: ${record.keyId}`);
    return;
  }
  if (action === "issue") {
    if (values.team === undefined || values.user === undefined) throw new UsageError("Give --team and --user.");
    const { record, bundle } = await run(
      authority.issueMember({
        team: values.team,
        user: values.user,
        device: values.device ?? null,
        days: days(values.days, CERTIFICATE_DAYS.member.default),
      }),
    );
    const text = `${JSON.stringify(bundle, null, 2)}\n`;
    if (values.out === undefined) process.stdout.write(text);
    else {
      await writeFile(values.out, text, { mode: 0o600 });
      console.log(`The identity file is at ${values.out}. It holds a private key: move it safely, then delete it.`);
      console.log(`Key identifier: ${record.keyId}`);
    }
    return;
  }
  if (action === "server") {
    const { record, paths } = await run(
      authority.issueServer({
        dnsNames: values.dns ?? [],
        ipAddresses: values.ip ?? [],
        days: days(values.days, CERTIFICATE_DAYS.server.default),
      }),
    );
    console.log(`The server certificate is at ${paths.certificate}. Serial number: ${record.serial}`);
    console.log(
      "A server that runs proves its identity with it in a few seconds. When TLS also uses this file, start the server again.",
    );
    return;
  }
  if (action === "list") {
    const records = await run(authority.list());
    for (const record of records) {
      if (values.team === undefined || record.team === values.team) console.log(recordLine(record));
    }
    return;
  }
  if (action === "root") {
    const pem = await run(authority.rootCertificate());
    process.stdout.write(pem);
    console.log(`SHA-256 fingerprint: ${rootFingerprint(pem)}`);
    return;
  }
  throw new UsageError(USAGE);
}

async function adminCommand(config: RelayConfig, command: string[]): Promise<void> {
  if (command.length !== 1 || command[0] !== "login") throw new UsageError(USAGE);
  if (config.admin === null) throw new UsageError("Set RELAY_ADMIN_HOST to the address of the admin page first.");
  const problem = adminListenProblem(config.admin);
  if (problem !== null) throw new UsageError(problem);
  const login = await run(new AdminLogins(config.dataDirectory).create());
  console.log(`Open this link in ${ADMIN_LOGIN_MINUTES} minutes. It works once:`);
  console.log(adminLoginUrl(config.admin, login.token));
}

async function serve(config: RelayConfig): Promise<void> {
  const adminProblem = config.admin === null ? null : adminListenProblem(config.admin);
  if (adminProblem !== null) throw new UsageError(`The admin page did not start. ${adminProblem}`);
  const authority = new CertificateAuthority({
    dataDirectory: config.dataDirectory,
    passphrase: config.caPassphrase,
    publicUrl: config.publicUrl,
  });
  const trust = await run(authority.trust(config.audiences));
  const rootPem = await run(authority.rootCertificate());
  const serverIdentity = await run(authority.serverIdentity());
  if (config.tls && !(await Bun.file(config.tls.certificatePath).exists())) {
    throw new UsageError(
      `No TLS certificate is at ${config.tls.certificatePath}. Run "ca server --dns <name>", set RELAY_TLS_CERT_PATH and RELAY_TLS_KEY_PATH, or set RELAY_TLS_DISABLED=true behind a TLS proxy.`,
    );
  }
  const service = new RelayService(trust, serverIdentity, config.limits);
  const enrollment = new Enrollment({ authority, dataDirectory: config.dataDirectory, publicUrl: config.publicUrl });
  await run(enrollment.cleanup());
  const enroll = enrollment.server === null ? null : createEnrollHandler(enrollment, config.enrollLimits);
  const server = startRelayServer(config, service, [rootPem], enroll);
  const logins = new AdminLogins(config.dataDirectory);
  if (config.admin !== null) await run(logins.cleanup());
  const admin =
    config.admin === null
      ? null
      : startAdminServer({
          admin: config.admin,
          authority,
          enrollment,
          logins,
          service,
          audiences: config.audiences,
          publicUrl: config.publicUrl,
          tlsCertificatePath: config.tls?.certificatePath ?? null,
        });
  let stamp = await run(authority.changeStamp());
  let reloading = false;
  const trustTimer = setInterval(() => {
    if (reloading) return;
    reloading = true;
    void (async () => {
      const next = await run(authority.changeStamp());
      if (next === stamp) return;
      service.applyTrust(await run(authority.trust(config.audiences)));
      const nextIdentity = await Effect.runPromise(Effect.result(authority.serverIdentity()));
      if (Result.isFailure(nextIdentity)) {
        console.error(`The relay keeps its previous server identity. ${nextIdentity.failure.message}`);
        return;
      }
      service.applyServerIdentity(nextIdentity.success);
      stamp = next;
      console.log("The relay loaded the changed certificate store.");
    })()
      .catch((error: unknown) => {
        console.error("The relay could not load the certificate store.", error instanceof Error ? error.message : "");
      })
      .finally(() => {
        reloading = false;
      });
  }, TRUST_CHECK_INTERVAL_MS);
  const expiryTimer = setInterval(() => service.expire(), EXPIRY_CHECK_INTERVAL_MS);
  const protocol = config.tls ? "wss" : "ws";
  console.log(`OpenBot relay is ready at ${protocol}://${config.host}:${server.port}/v1/relay`);
  console.log(`Root certificate SHA-256 fingerprint: ${rootFingerprint(rootPem)}`);
  if (config.tls?.clientCertificatesRequired) console.log("TLS refuses a connection that has no team certificate.");
  if (config.webClientDirectory !== null) console.log(`The web client is at /app, from ${config.webClientDirectory}`);
  if (enroll !== null) console.log(`Join codes are taken at https://${enrollment.server}/v1/enroll`);
  if (admin !== null && config.admin !== null) {
    const origin = adminOrigin({ ...config.admin, port: admin.port });
    console.log(`The admin page is at ${origin}/admin. Sign in with a link from "admin login".`);
  }

  let stopping: Promise<void> | null = null;
  const shutdown = () => {
    stopping ??= (async () => {
      clearInterval(trustTimer);
      clearInterval(expiryTimer);
      await admin?.stop();
      await server.stop();
      process.exit(0);
    })();
    return stopping;
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const config = readRelayConfig();
  if (command === undefined || command === "serve") await serve(config);
  else if (command === "ca") await certificateCommand(config, rest);
  else if (command === "admin") await adminCommand(config, rest);
  else throw new UsageError(USAGE);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "The command failed.");
  process.exit(1);
});
