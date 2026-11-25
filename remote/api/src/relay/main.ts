import { X509Certificate } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { Effect, Result } from "effect";
import {
  CERTIFICATE_DAYS,
  CertificateAuthority,
  type CertificateAuthorityError,
  type CertificateRecord,
} from "./certificate-authority";
import { type RelayConfig, readRelayConfig } from "./config";
import { certificateFingerprint } from "./identity";
import { startRelayServer } from "./server";
import { RelayService } from "./service";

const TRUST_CHECK_INTERVAL_MS = 5_000;
const EXPIRY_CHECK_INTERVAL_MS = 60_000;
const DEFAULT_ROOT_NAME = "OpenBot Root CA";

const USAGE = `Usage:
  serve                                  Start the relay server (default).
  ca init [--name <name>] [--days <n>]    Make the root certificate.
  ca team add <team> [--days <n>]         Make the certificate authority of a team.
  ca issue --team <team> --user <user> [--device <device>] [--days <n>] [--out <file>]
                                          Make the certificate of one device of a user.
  ca server --dns <name> [--ip <address>] [--days <n>]
                                          Make the identity and TLS certificate of this server.
  ca revoke <serial | fingerprint | key identifier>
  ca list [--team <team>]
  ca root                                 Print the root certificate and its fingerprint.`;

class UsageError extends Error {}

async function run<A>(operation: Effect.Effect<A, CertificateAuthorityError>): Promise<A> {
  const result = await Effect.runPromise(Effect.result(operation));
  if (Result.isFailure(result)) throw new UsageError(result.failure.message);
  return result.success;
}

function days(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new UsageError("--days must be an integer.");
  return parsed;
}

function recordLine(record: CertificateRecord): string {
  const state = record.revokedAt !== null ? "revoked" : record.expiresAt <= Date.now() ? "expired" : "valid";
  const subject = [record.team, record.user, record.device].filter((part) => part !== null).join(" / ");
  const expires = new Date(record.expiresAt).toISOString().slice(0, 10);
  return `${record.kind.padEnd(6)} ${state.padEnd(7)} ${expires} ${record.serial} ${record.keyId} ${subject}`;
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
    },
  });
  const [action, ...rest] = positionals;
  if (action === "init") {
    const record = await run(
      authority.initialize({
        name: values.name ?? DEFAULT_ROOT_NAME,
        days: days(values.days, CERTIFICATE_DAYS.root.default),
      }),
    );
    console.log(`The root certificate is ready. SHA-256 fingerprint: ${record.fingerprint}`);
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

async function serve(config: RelayConfig): Promise<void> {
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
  const server = startRelayServer(config, service, [rootPem]);
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

  let stopping: Promise<void> | null = null;
  const shutdown = () => {
    stopping ??= (async () => {
      clearInterval(trustTimer);
      clearInterval(expiryTimer);
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
  else throw new UsageError(USAGE);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "The command failed.");
  process.exit(1);
});
