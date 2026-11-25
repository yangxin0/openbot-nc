# Central server

The central server connects the OpenBots of a team to each other. Each OpenBot opens a WebSocket to
it. The server uses certificates to know who connects. It also makes and manages these
certificates. One server can serve many teams.

The code is in `remote/api/src/relay/`. The wire messages are in
`packages/contracts/src/relay-protocol/`.

This server replaces the account service and Signal. There is no account, no email sign-in, no
invitation and no WebRTC.

## How it works

- A certificate names the team (`O`), the user (`CN`) and, optionally, the device (`OU`).
- Each OpenBot that connects with a valid certificate of a team is a member of that team. There is
  no other member list.
- The server sends each member the list of the members of its team that are connected.
- A member can open a connection to a member of the same team that hosts. The server passes the
  bytes between the two sockets. It cannot connect members of different teams.
- The identifier of a member is the SHA-256 of the public key in its certificate. So a member
  cannot take the address of a different member.
- The verification goes in the two directions. The server verifies the certificate of each
  OpenBot, and each OpenBot verifies that the server is the server of its team: the server proves
  that it has a certificate of the team root (the server identity certificate).

## What the server can read

The data of a connection goes through the server. TLS protects each of the two sockets, but the
server process sees the bytes between them. It does not store them or write them to a log.

A person who controls the server, or its root private key, controls who can connect. Keep the
server and its data directory safe.

Not done: encryption from one OpenBot to the other inside the connection. The connection carries
opaque bytes, so this needs no server change.

## Certificates

The server keeps three levels:

| Level | Made by | Signs |
| --- | --- | --- |
| Root | `ca init` | Team authorities and the identity certificate of the server |
| Team authority (intermediate) | `ca team add` | The members of one team only |
| Member | `ca issue` | Nothing. It identifies one device of one user |

The server refuses a member certificate when:

- no authority of this server issued it;
- a team authority issued it for a different team;
- it is expired, not valid yet or revoked, or its team authority is revoked;
- it does not name one team and one user;
- the sender does not prove that it has the private key. The server sends a random value, and the
  member signs it together with its own random value, the server address and the purpose of the
  socket.

An OpenBot refuses the server, and does not try again, when the server identity certificate:

- was not issued directly by the root in the identity file of the OpenBot;
- is not for server authentication, is a certificate authority, or has no ECDSA P-256 key;
- is expired or not valid yet;
- does not name the host of the server address (a DNS name exactly, or an IP address);
- or when the signature of the server does not verify.

The server identity certificate is `<data>/tls/server.crt` and `server.key`, made by `ca server`.
`serve` does not start when it is missing, when the root did not issue it, when it is expired, or
when it does not name the host of `RELAY_PUBLIC_URL`. A wildcard name does not match a host. A server
that runs loads a new identity certificate in 5 seconds or less.

## Set up with Docker

1. Set the public address in `remote/.env.relay`:

   ```sh
   RELAY_PUBLIC_URL=wss://relay.example.com/v1/relay
   ```

2. Make the root, the identity certificate of the server and the first team:

   ```sh
   compose="docker compose -f remote/compose.relay.yaml --env-file remote/.env.relay"
   $compose run --rm relay ca init
   $compose run --rm relay ca server --dns relay.example.com
   $compose run --rm relay ca team add "My Team"
   ```

3. Start the server:

   ```sh
   $compose up -d --build
   ```

4. Make one identity file for each device of each user:

   ```sh
   $compose run --rm relay ca issue --team "My Team" --user alice --device laptop > alice-laptop.json
   ```

   The file holds the certificate, the private key, the root certificate and the server address.
   Move it to the device safely, then delete it.

Not confirmed: the Docker image and `remote/compose.relay.yaml` were not built on the computer that
wrote this guide. The server and the commands were tested with Bun 1.3.11 outside Docker.

## Set up without Docker

```sh
export RELAY_DATA_DIR=/var/lib/openbot-relay
export RELAY_PUBLIC_URL=wss://relay.example.com/v1/relay
bun remote/api/src/relay/main.ts ca init
bun remote/api/src/relay/main.ts ca server --dns relay.example.com
bun remote/api/src/relay/main.ts ca team add "My Team"
bun remote/api/src/relay/main.ts serve
```

## Use a TLS certificate of a public authority

Browsers and phones trust a certificate of a public authority, such as Let's Encrypt, with no
set-up. OpenBot also trusts the system roots of its computer. The server still needs its identity
certificate from the team root, because a public certificate proves only the name of the host:

```sh
bun remote/api/src/relay/main.ts ca server --dns relay.example.com
```

Then give TLS the public certificate:

```sh
RELAY_TLS_CERT_PATH=/var/lib/openbot-relay/tls-public/fullchain.pem
RELAY_TLS_KEY_PATH=/var/lib/openbot-relay/tls-public/privkey.pem
```

The server reads the TLS files only when it starts. A certbot deploy hook copies the renewed files
to a folder that the server user can read, and starts the server again. For example,
`/etc/letsencrypt/renewal-hooks/deploy/openbot-relay.sh`:

```sh
#!/bin/sh
set -e
install -d -o openbot-relay -g openbot-relay -m 700 /var/lib/openbot-relay/tls-public
install -o openbot-relay -g openbot-relay -m 600 "$RENEWED_LINEAGE/fullchain.pem" /var/lib/openbot-relay/tls-public/fullchain.pem
install -o openbot-relay -g openbot-relay -m 600 "$RENEWED_LINEAGE/privkey.pem" /var/lib/openbot-relay/tls-public/privkey.pem
systemctl restart openbot-relay.service
```

Make the file executable (`chmod 755`). Make a new identity certificate with `ca server` before it
expires (397 days by default). A server that runs uses it in 5 seconds or less, with no restart.

## Set up with one program file

This command puts the server and Bun in one file, so the server computer needs no Bun and no
Docker:

```sh
bun run relay:build --target=bun-linux-x64-baseline --outfile openbot-relay
```

Copy the file to the server and start it as a user that is not root, for example with a systemd
unit that sets `User`, the settings below and `ExecStart=<path>/openbot-relay serve`.

The build needs the Bun version in `package.json` (`packageManager`) and refuses any other.
The program that it makes contains that Bun version. A program with Bun 1.3.11 did not exit
after a stop signal while an OpenBot was connected.

The build turns off the loading of `.env` and `bunfig.toml` from the working folder. So a file in
that folder cannot change the settings of the server, and the program also works when its user
cannot open the working folder. Do not build the file with a plain `bun build --compile`.

## Commands

| Command | Result |
| --- | --- |
| `ca init [--name <name>] [--days <n>]` | Makes the root. It does not replace a root that exists. |
| `ca team add <team> [--days <n>]` | Makes the authority of a team. |
| `ca issue --team <team> --user <user> [--device <device>] [--days <n>] [--out <file>]` | Makes a member certificate and prints the identity file. |
| `ca server --dns <name> [--ip <address>] [--days <n>]` | Makes the identity certificate of the server in `<data>/tls/`. A server that runs proves its identity with it in 5 seconds or less. When TLS uses the same files, start the server again. |
| `ca revoke <serial, fingerprint or key identifier>` | Revokes certificates. A key identifier revokes each certificate of that key. The serial of a team authority revokes the team. |
| `ca list [--team <team>]` | Lists the certificates with their state. |
| `ca root` | Prints the root certificate and its fingerprint. |

A server that runs reads a change of the certificate store in 5 seconds or less. It then closes the
connections of a revoked certificate. A new team needs no restart.

Names can have letters, digits, spaces and `. _ @ -`, from 1 to 64 characters.

## Settings

| Variable | Default | Function |
| --- | --- | --- |
| `RELAY_DATA_DIR` | `./relay-data` | The certificate store. It holds the private keys of the authorities. |
| `RELAY_PUBLIC_URL` | none | The address that members use, `wss://<host>/v1/relay`. The server refuses a proof for a different address, and writes this address in each identity file. Set it in production. |
| `RELAY_HOST`, `RELAY_PORT` | `0.0.0.0`, `8443` | The listener. The port is `8081` with `RELAY_TLS_DISABLED=true`. |
| `RELAY_TLS_CERT_PATH`, `RELAY_TLS_KEY_PATH` | `<data>/tls/server.crt`, `server.key` | The TLS certificate of the server. A certificate of a public authority is also possible. The identity certificate stays in `<data>/tls/`. |
| `RELAY_TLS_DISABLED` | `false` | `true` when a proxy in front of the server does TLS. |
| `RELAY_TLS_CLIENT_CERTIFICATES` | `off` | `required` makes TLS refuse a socket that has no certificate of the root. The proof in the first message is always necessary. |
| `RELAY_CA_PASSPHRASE` | none | Encrypts the private keys of the authorities on the disk. The `ca` commands that sign need it. `serve` does not. |
| `RELAY_TRUST_PROXY` | `false` | `true` uses the first `X-Forwarded-For` address for the limit of each address. |
| `RELAY_HEALTH_HOST`, `RELAY_HEALTH_PORT` | `127.0.0.1`, `8080` | `/health/live`, `/health/ready` and `/metrics`. |
| `RELAY_METRICS_TOKEN` | none | Bearer token for `/metrics`. With no token, `/metrics` answers 404. |
| `RELAY_MAX_SOCKETS_PER_IP` | `128` | Sockets from one address. |
| `RELAY_MAX_TUNNELS_PER_MEMBER` | `64` | Connections that one certificate can open. |
| `RELAY_MAX_PENDING_PER_MEMBER` | `32` | Connections that wait for one member to accept. |

`serve` needs only the certificates and the registry. To keep the root private key off the server,
move `<data>/ca/root.key` to a safe place after you make the teams and the server certificate. Put
it back to make a new team.

## Protocol

The endpoint is `WSS /v1/relay`. Control messages are JSON text. Connection data is binary.

1. The server sends `challenge` with a nonce (32 random bytes, base64url).
2. The peer sends `hello` with its own nonce (`clientNonce`, 32 random bytes, base64url), its role,
   its certificate, the team authority certificate, and a signature of `relayHelloTranscript`
   (server nonce, client nonce, server address, role, target or connection).
3. The server verifies the hello. Before any other message, it sends `server-proof` with its
   identity certificate and a signature of `relayServerProofTranscript` (server nonce, client
   nonce, server address, role, key identifier of the peer, target or connection). The signature is
   ECDSA P-256 with SHA-256, in the IEEE P1363 format (64 bytes), base64url. The peer checks the
   certificate and the signature with its own values before it accepts `welcome`, `waiting` or
   `open`. When the check fails, or another message comes first, the peer closes the socket and
   sends nothing more. The desktop reports `server_refused` and does not connect again.
4. Role `member`: the control socket of an OpenBot. The server answers `welcome` with the team and
   the members, and sends `members` after each change. `presence` changes `hosting` and the label.
5. Role `client`: a connection to one member (`target`). The server sends `incoming` to the control
   socket of the target.
6. Role `accept`: the target opens a second socket for that connection. The server sends `open` to
   the two sockets, with the certificate of the other side. Then it passes each binary message.
7. `pause` and `resume` tell a sender that the other side is slow. On Bun 1.4 the server also stops
   reading from the sender.

A text message on an open connection, binary data on any other socket, or an invalid message closes
the socket with an `error` message.

The rules of the server proof that need no cryptography (transcript, host name match, date and usage
rules) are in `packages/contracts/src/relay-protocol/server-proof.ts`, so that a browser client can
use them with WebCrypto. The desktop check is in `src/main/relay/server-proof.ts`.

The desktop accepts a TLS certificate of the system roots (the default roots of Node, with
`NODE_EXTRA_CA_CERTS`) or of the root in its identity file, with the normal host name check. It
refuses `ws:` except on its own computer.

## Test

```sh
bun run test:relay
```

The test starts the real server process with a new root, connects real WebSocket clients, and
writes `.openbot-build/relay-e2e/report.json`.
