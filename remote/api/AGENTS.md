# `remote/api`

This is the central relay server (`src/relay/`). It ends TLS, verifies each member certificate and a
signed proof of its private key, proves its own identity with a certificate of the team root, and
passes opaque bytes between two members of one team. It does not store or log the bytes of a
connection. See [docs/central-server.md](../../docs/central-server.md).

- TLS: the server certificate is `<data>/tls/server.crt` and `server.key`, or `RELAY_TLS_CERT_PATH`
  and `RELAY_TLS_KEY_PATH`. `RELAY_TLS_CLIENT_CERTIFICATES=required` also makes TLS refuse a socket
  with no certificate of the root. The proof in the first message stays necessary in all modes.
- CA files: `<data>/ca/` holds the root and the team authority keys, encrypted with
  `RELAY_CA_PASSPHRASE` when it is set. Only the `ca` commands that sign read them; `serve` does not.
  Keep the file permissions that `certificate-authority.ts` sets.
- Server identity: `serve` refuses to start when the identity certificate is missing, expired, not
  issued by the root, or does not name the host of `RELAY_PUBLIC_URL`. Do not weaken these checks or
  the checks of a member certificate (issuer, team, validity, revocation, proof).
- Never log, print or put in an error message a private key, a passphrase, an identity file, a
  proof, a metrics token or the bytes of a connection. Compare secrets in constant time.
- The wire messages come from `@openbot/contracts/relay-protocol`. Keep released messages compatible.
- This project uses Bun types. Keep them inside `remote/api`; root `scripts/**` and Electron main use
  Node types. See [check design notes](../../docs/development-checks.md#check-coverage).
- `bun run test:relay` starts the real server process with a new root and checks these rules over
  real TLS and WebSocket.
