# `remote/api`

This is the central relay server (`src/relay/`). It ends TLS, verifies each member certificate and a
signed proof of its private key, proves its own identity with a certificate of the team root, and
passes opaque bytes between two members of one team. It does not store or log the bytes of a
connection. See [docs/central-server.md](../../docs/central-server.md).

- TLS: the server certificate is `<data>/tls/server.crt` and `server.key`, or `RELAY_TLS_CERT_PATH`
  and `RELAY_TLS_KEY_PATH`. `RELAY_TLS_CLIENT_CERTIFICATES=required` also makes TLS refuse a socket
  with no certificate of the root. The proof in the first message stays necessary in all modes.
- CA files: `<data>/ca/` holds the root and the team authority keys, encrypted with
  `RELAY_CA_PASSPHRASE` when it is set. The `ca` commands that sign read them, and `serve` reads a
  team key to issue a certificate for a join code and the root key to add a team on the admin page.
  Keep the file permissions that `certificate-authority.ts` sets. Each read-modify-write of
  `ca/registry.json` takes the lock in `file-lock.ts`, in the commands and in `serve`.
- Join codes and admin sign-in links: store only the SHA-256 of the secret (`one-time-store.ts`). A
  code is taken by the exclusive creation of its `.used` file before the certificate is issued. Give
  the same answer (`code_unknown`) for an unknown, expired, cancelled and used code. `/v1/enroll`
  issues a certificate for the public key of the client only; the server never makes a private key
  for a join code.
- Admin page (`admin.ts`, `admin-page/`): never serve it on the public listener. It listens only on
  `RELAY_ADMIN_HOST`, and `serve` refuses a wildcard or public address without
  `RELAY_ADMIN_ALLOW_PUBLIC=1`. Keep the Host check, the Origin, CSRF and JSON checks on each request
  that changes data, the `HttpOnly` and `SameSite=Strict` cookie, the security headers and the
  sign-in rate limit. Keep sessions in memory, keyed by the SHA-256 of the session id. Its text is
  English only, like the commands. `bun run test:relay-admin` checks these rules.
- Server identity: `serve` refuses to start when the identity certificate is missing, expired, not
  issued by the root, or does not name the host of `RELAY_PUBLIC_URL`. Do not weaken these checks or
  the checks of a member certificate (issuer, team, validity, revocation, proof).
- Never log, print or put in an error message a private key, a passphrase, an identity file, a
  proof, a metrics token, a join code secret, a sign-in token, a session id, a CSRF token or the bytes
  of a connection. Logs name a code or a session only by a prefix of its hash. Compare secrets in
  constant time. Only `ca code` and the admin page answer that makes a code show the code.
- The wire messages come from `@openbot/contracts/relay-protocol`. Keep released messages compatible.
- This project uses Bun types. Keep them inside `remote/api`; root `scripts/**` and Electron main use
  Node types. See [check design notes](../../docs/development-checks.md#check-coverage).
- `bun run test:relay` starts the real server process with a new root and checks these rules over
  real TLS and WebSocket.
