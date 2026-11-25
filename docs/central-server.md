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
| Root | `ca init` | Team authorities and the TLS certificate of the server |
| Team authority (intermediate) | `ca team add` | The members of one team only |
| Member | `ca issue` | Nothing. It identifies one device of one user |

The server refuses a member certificate when:

- no authority of this server issued it;
- a team authority issued it for a different team;
- it is expired, not valid yet or revoked, or its team authority is revoked;
- it does not name one team and one user;
- the sender does not prove that it has the private key. The server sends a random value, and the
  member signs it together with the server address and the purpose of the socket.

## Set up with Docker

1. Set the public address in `remote/.env.relay`:

   ```sh
   RELAY_PUBLIC_URL=wss://relay.example.com/v1/relay
   ```

2. Make the root, the TLS certificate of the server and the first team:

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
| `ca server --dns <name> [--ip <address>] [--days <n>]` | Makes the TLS certificate of the server in `<data>/tls/`. Start the server again to use it. |
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
| `RELAY_TLS_CERT_PATH`, `RELAY_TLS_KEY_PATH` | `<data>/tls/server.crt`, `server.key` | The TLS certificate of the server. A certificate of a public authority is also possible. |
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

1. The server sends `challenge` with a nonce.
2. The peer sends `hello` with its role, its certificate, the team authority certificate, and a
   signature of `relayHelloTranscript` (nonce, server address, role, target or connection).
3. Role `member`: the control socket of an OpenBot. The server answers `welcome` with the team and
   the members, and sends `members` after each change. `presence` changes `hosting` and the label.
4. Role `client`: a connection to one member (`target`). The server sends `incoming` to the control
   socket of the target.
5. Role `accept`: the target opens a second socket for that connection. The server sends `open` to
   the two sockets, with the certificate of the other side. Then it passes each binary message.
6. `pause` and `resume` tell a sender that the other side is slow. On Bun 1.4 the server also stops
   reading from the sender.

A text message on an open connection, binary data on any other socket, or an invalid message closes
the socket with an `error` message.

## Test

```sh
bun run test:relay
```

The test starts the real server process with a new root, connects real WebSocket clients, and
writes `.openbot-build/relay-e2e/report.json`.
