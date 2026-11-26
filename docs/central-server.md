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
- Each OpenBot keeps at most two WebSockets to the server: a control socket while it runs with an
  identity, and one data socket that all its connections share. A connection to a member of the same
  team that hosts is a session on these sockets. The server passes the session data between the data
  sockets of the two members. It cannot connect members of different teams.
- The identifier of a member is the SHA-256 of the public key in its certificate. So a member
  cannot take the address of a different member.
- The verification goes in the two directions. The server verifies the certificate of each
  OpenBot, and each OpenBot verifies that the server is the server of its team: the server proves
  that it has a certificate of the team root (the server identity certificate).

## What the server can read

The data of a session goes through the server. TLS protects each socket, and the two OpenBots
encrypt the bytes of the session from end to end (see [End-to-end encryption](#end-to-end-encryption)).
The server can see who opens a session to whom, when, the session numbers, and the number and size of
the encrypted frames. It cannot read or change chats, files or commands. It does not store the bytes or
write them to a log. It keeps a data ticket in memory only as its SHA-256, for at most 60 seconds.

A person who controls the server, or its root private key, controls who can connect: with the root
key, that person can make a certificate for a new member. Keep the server and its data directory
safe.

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

5. To serve the web client at `/app`, build it with `bun run web-client:build`. Then set
   `RELAY_WEB_CLIENT_DIR` in `remote/.env.relay` to the build folder, as an absolute path or a path
   that starts with `./` (relative to `remote/`), and start the server again with `$compose up -d`.
   Compose mounts that folder read-only at `/web-client` in the container and sets
   `RELAY_WEB_CLIENT_DIR=/web-client` for the server. With no value, the server does not serve `/app`.

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
| `ca code --team <team> --user <user> [--device <device>] [--minutes <n>] [--days <n>]` | Makes a one-time join code and prints it as a link and a terminal QR code. The code works once, for 15 minutes by default (1 to 1440). The certificate is valid for 365 days by default (1 to 1095). Needs a `wss:` `RELAY_PUBLIC_URL`. |
| `ca codes [--team <team>]` | Lists the open join codes with their identifier, expiry and maker. It does not print the secret. |
| `ca code cancel <code identifier>` | Cancels an open join code. Give at least the first 6 characters of the identifier. |
| `admin login` | Prints a one-time sign-in link of the admin page. The link works once, for 10 minutes. |
| `ca revoke <serial, fingerprint or key identifier>` | Revokes certificates. A key identifier revokes each certificate of that key. The serial of a team authority revokes the team. |
| `ca list [--team <team>]` | Lists the certificates with their state. |
| `ca root` | Prints the root certificate and its fingerprint. |

A server that runs reads a change of the certificate store in 5 seconds or less. It then closes the
connections of a revoked certificate. A new team needs no restart.

Names can have letters, digits, spaces and `. _ @ -`, from 1 to 64 characters.

## Join codes

A join code lets a device join a team with no identity file. The device makes its own P-256 key, and
only its public key goes to the server. So no private key leaves the device.

1. The administrator makes a code with `ca code --team "My Team" --user alice --device laptop`, or on
   the admin page.
2. The person gets the code as a link or a QR code, for example
   `openbot-nc://enroll?v=1&server=relay.example.com&code=<26 characters>&root=<43 characters>`.
   `server` is the host of `RELAY_PUBLIC_URL`, `code` is a secret of 128 bits in Crockford base32,
   and `root` is the base64url SHA-256 of the root certificate (the client checks it).
3. The client sends `POST https://<server>/v1/enroll` with its public key and a signature that proves
   the private key. The server issues the member certificate with the team authority, exactly as
   `ca issue` does, and sends it with the team chain and the root.

Before the join, a device does not have the root of the team, so it checks the TLS certificate of
`https://<server>` with the certificate authorities of its system or browser. Use a TLS certificate
of a public authority for join codes (see
[Use a TLS certificate of a public authority](#use-a-tls-certificate-of-a-public-authority)). A
server that has only the certificate of `ca server` works with identity files, not with join codes.

The wire format is in `packages/contracts/src/relay-protocol/enrollment.ts`. The client code is
`joinRelayWithCode` and `enrollRelayKey` in `packages/team-client/src/relay-join.ts`. Each client
checks the answer before it keeps the identity: the relay address must be on the server of the code,
the SHA-256 of the root must be the `root` of the code, the certificate must have the public key of
the device and the team, user and device of the answer, the root and the team authority must have
issued it, and it must be valid now. A client keeps nothing when a check fails.

Join with a code in each client:

- **Desktop app**: Settings > Team ("Connect to your team" in the "+" menu of the server list), or
  "Join with a code" in the first start. Paste the code and select Join. With an identity already,
  select "Use a code" in Settings > Team: OpenBot-NC asks before it replaces the identity. A click on
  an `openbot-nc://enroll?...` link opens the same dialog with the code in it, and OpenBot-NC joins
  only when you select Join. The app makes a P-256 key with `node:crypto` and keeps it encrypted
  with the identity, the same as an imported identity file.
- **Linux server**: run `openbot-nc join` and paste the code when the command asks for it, or send
  it on standard input (`openbot-nc join < code.txt`). The command does not take the code as an
  argument, so the code does not show in the process list. `--replace` replaces an identity that the
  server has already, and `--hosting on` shares the agents after the join.
- **Web client**: paste the code under "Join code" on the identity screen. The `server` of the code
  must be the host of the page, else the page shows an error and sends nothing. In Settings > Team
  identity, "Use a code" replaces the identity. The browser keeps its key in IndexedDB, and the key
  cannot be exported.
- **Browser extension**: paste the code under "Join code" in the side panel. The extension sends the
  request to `https://<server>/v1/enroll`. It needs no host permission, because the server permits
  requests from any origin.
- **Phone app**: paste the code, or select "Scan QR code" and scan the QR code of the code. The
  iPhone Camera app opens an `openbot-nc://enroll?...` link in the app with the code filled in; the
  app joins only when you tap Join. Settings > Team identity > "Replace with a code" asks before it
  replaces the identity. The phone keeps the identity in its keychain, on this device only.

Each code works once. A used, expired, cancelled or unknown code gets the same answer
(`code_unknown`). When the certificate cannot be made after the server took the code, the code stays
used: make a new one. At most 100 codes can be open at the same time.

The server keeps each code as `<data>/ca/codes/<SHA-256 of the secret>.json` (mode 0600): the team,
user, device, certificate days, times and maker, never the secret. A `<hash>.used` file that only one
request can make marks a code as taken, also across processes. The server removes expired and used
codes when it starts and at each request.

`/v1/enroll` is on the main listener, accepts requests from any origin with no credentials (CORS),
takes at most 8 KiB, and limits the requests of each address and of all addresses together
(`RELAY_ENROLL_LIMIT_PER_ADDRESS`, `RELAY_ENROLL_LIMIT`). The server writes a log line with the
first 12 characters of the code identifier and the key identifier, never the code.

## Admin page

The admin page shows the root fingerprint, the server identity and TLS expiry, the members online,
the teams (add a team), the members of a team with their state and connection (revoke a member),
and the join codes (make a code with its link and QR code, list and cancel codes). Its text is in
English only, like the commands.

The page uses plain HTTP, so it listens only on a private address, such as the tailnet address of
the server. It is never on the public listener. For example, on a server with the tailnet address
`100.101.224.97`:

```sh
RELAY_ADMIN_HOST=100.101.224.97
RELAY_ADMIN_PORT=8992
```

`serve` refuses to start when `RELAY_ADMIN_HOST` is not an IP address, is a wildcard address
(`0.0.0.0`, `::`), or is a public address. Private addresses are loopback, `10/8`, `172.16/12`,
`192.168/16`, the Tailscale range `100.64/10` and IPv6 `fc00::/7`. Only
`RELAY_ADMIN_ALLOW_PUBLIC=1` permits a different address. Do not set it on a public address.

To sign in, run the command as the user of the server, so that the server can read the files that
it writes:

```sh
sudo openbot-relay admin login
```

Open the link on a computer of the tailnet. The token is in the part after `#`, so it does not go
into a log. The link works once, for 10 minutes. The server keeps only its SHA-256 in
`<data>/admin/logins/`. A session stays in the memory of the server for 12 hours at most, and ends
after 1 hour with no request. A restart ends all sessions.

The page refuses a request when the `Host` header is not the address of the page, and a request that
changes data when its `Origin` is not the page, when it has no CSRF token of the session, or when it
is not JSON. The cookie is `HttpOnly` and `SameSite=Strict`. Each answer has a strict Content Security
Policy and `Cache-Control: no-store`. The server limits sign-in attempts. A revoke on the page closes
the connections of the member at once.

## Settings

| Variable | Default | Function |
| --- | --- | --- |
| `RELAY_DATA_DIR` | `./relay-data` | The certificate store. It holds the private keys of the authorities. |
| `RELAY_PUBLIC_URL` | none | The address that members use, `wss://<host>/v1/relay`. The server refuses a proof for a different address, and writes this address in each identity file. Set it in production. |
| `RELAY_HOST`, `RELAY_PORT` | `0.0.0.0`, `8443` | The listener. The port is `8081` with `RELAY_TLS_DISABLED=true`. |
| `RELAY_TLS_CERT_PATH`, `RELAY_TLS_KEY_PATH` | `<data>/tls/server.crt`, `server.key` | The TLS certificate of the server. A certificate of a public authority is also possible. The identity certificate stays in `<data>/tls/`. |
| `RELAY_TLS_DISABLED` | `false` | `true` when a proxy in front of the server does TLS. |
| `RELAY_TLS_CLIENT_CERTIFICATES` | `off` | `required` makes TLS refuse a socket that has no certificate of the root. The proof in the first message is always necessary. |
| `RELAY_CA_PASSPHRASE` | none | Encrypts the private keys of the authorities on the disk. The `ca` commands that sign need it. `serve` needs it for join codes and for a new team on the admin page. |
| `RELAY_TRUST_PROXY` | `false` | `true` uses the first `X-Forwarded-For` address for the limit of each address. |
| `RELAY_HEALTH_HOST`, `RELAY_HEALTH_PORT` | `127.0.0.1`, `8080` | `/health/live`, `/health/ready` and `/metrics`. |
| `RELAY_METRICS_TOKEN` | none | Bearer token for `/metrics`. With no token, `/metrics` answers 404. |
| `RELAY_MAX_SOCKETS_PER_IP` | `128` | Sockets from one address. |
| `RELAY_MAX_SESSIONS_PER_SOCKET` | `256` | Sessions of one member, opened and accepted. |
| `RELAY_MAX_SESSIONS_PER_PAIR` | `32` | Sessions that one member opens to one other member. |
| `RELAY_MAX_PENDING_PER_MEMBER` | `32` | Sessions that wait for one member to accept. |
| `RELAY_CLIENT_HEARTBEAT_TIMEOUT_MS` | `30000` | The server closes a control socket that sent no `ping` for this time, with its data socket and sessions, and removes the member from the roster. Only for an app that sends `heartbeat` in `hello`. |
| `RELAY_HIGH_WATER_BYTES` | `262144` | Bytes in the send buffer of a data socket before the server keeps the next frames in its own queue for that member. |
| `RELAY_ADMIN_HOST` | none | The private IP address of the admin page. With no value, there is no admin page. |
| `RELAY_ADMIN_PORT` | `8992` | The port of the admin page. |
| `RELAY_ADMIN_ALLOW_PUBLIC` | none | `1` permits a wildcard or public `RELAY_ADMIN_HOST`. |
| `RELAY_ENROLL_LIMIT_PER_ADDRESS` | `10` | Join requests from one address in one minute. |
| `RELAY_ENROLL_LIMIT` | `60` | Join requests from all addresses in one minute. |
| `RELAY_WEB_CLIENT_DIR` | none | A folder with the web client build (`bun run web-client:build`). When it is set, the server serves the web client at `/app`. `serve` refuses to start when the folder has no `index.html`. |

`serve` needs the certificates and the registry. For join codes it also needs the private key of
each team authority. To keep the root private key off the server, move `<data>/ca/root.key` to a
safe place after you make the teams and the server certificate. Put it back to make a new team.

The `ca` commands and `serve` can change `<data>/ca/registry.json` at the same time. Each change takes
the lock file `<data>/ca/lock` first. A command waits up to 10 seconds for it, and removes a lock that
is older than 30 seconds.

## Protocol

The endpoint is `WSS /v1/relay`. Each OpenBot opens two WebSockets to it, never more: the control
socket and the data socket. Control messages are JSON text. Session data is binary and goes only on
the data socket.

### Control socket

1. The server sends `challenge` with a nonce (32 random bytes, base64url).
2. The peer sends `hello` with its own nonce (`clientNonce`, 32 random bytes, base64url), the role
   `member`, `hosting`, an optional label, `features: ["sessions-v2", "heartbeat"]`, its certificate,
   the team authority certificate, and a signature of `relayHelloTranscript` (server nonce, client
   nonce, server address, role).
3. The server verifies the hello. Before any other message, it sends `server-proof` with its identity
   certificate and a signature of `relayServerProofTranscript` (server nonce, client nonce, server
   address, role, key identifier of the peer). The signature is ECDSA P-256 with SHA-256, in the IEEE
   P1363 format (64 bytes), base64url. The peer checks the certificate and the signature with its own
   values before it accepts `welcome`. When the check fails, or another message comes first, the peer
   closes the socket and sends nothing more. The desktop reports `server_refused` and does not connect
   again.
4. The server answers `welcome` with the team, the members and
   `features: ["sessions-v2", "heartbeat"]`, and sends `members` after each change. `presence` changes `hosting` and the label. The sharing switch only
   changes `hosting`; it never opens or closes a socket. A client that gets no `sessions-v2` in
   `welcome` stops with "The relay server needs an update."
5. The control socket stays open while the app runs with an identity. The phone closes it when the
   app goes to the background (iOS stops background sockets) and opens it again when the app comes
   back.

### Heartbeat

A browser cannot send WebSocket ping frames, so the heartbeat is a JSON message on the control
socket. The app sends it only when `welcome` lists `heartbeat`; the server applies its timeout only to
an app that sent `heartbeat` in `hello`. So an app and a server of the previous version keep working
with this version, without the heartbeat.

| Message | Direction | Fields |
| --- | --- | --- |
| `ping` | app to server, control or data socket | `id` (a counter, 1 to 2^31-1) |
| `pong` | server to app, on the same socket, at once | the same `id` |

| Rule | Value |
| --- | --- |
| The app sends a `ping` on the control socket | right after `welcome`, then every 10 s (`RELAY_HEARTBEAT_INTERVAL_MS`) |
| No `pong` within 3 s (`RELAY_HEARTBEAT_TIMEOUT_MS`) | the app closes the control socket at once (it does not wait for the close handshake), shows the connection as down with the code `heartbeat_timeout`, and connects again at once, then with the usual backoff |
| A connection that was online for 30 s or more drops | the first new attempt starts at once |
| The phone comes back to the front | the app sends a `ping` on the old control socket (1.5 s timeout, `RELAY_RESUME_CHECK_TIMEOUT_MS`) and at the same moment opens a new control socket. When the `pong` comes before the new socket sends `hello`, the app closes the new socket and keeps the old one. Otherwise the new socket wins: after its `welcome`, the app closes the old control socket (its data socket and sessions fail with `heartbeat_timeout`) and uses the new one. The server replaces the old control socket of the member when it verifies the new `hello`, so the roster shows the member once. A second control socket exists for at most one connect time |
| The Mac wakes | the app sends a `ping` at once with a 1.5 s timeout; with no `pong`, it connects again with no backoff |
| The phone goes to the background | it stops the heartbeat |
| A data socket is open | the app sends the same `ping` on it every 10 s; with no `pong` within 3 s it closes the data socket, its sessions fail with `heartbeat_timeout`, and the next need opens a new data socket |
| The server gets no `ping` on a control socket for 30 s (`RELAY_CLIENT_HEARTBEAT_TIMEOUT_MS`) | it sends `error` `heartbeat_timeout`, closes the socket, its data socket and its sessions, and sends the new roster |

A `ping` on the data socket does not count for the control socket. A `ping` before `welcome` is a
protocol error.

A new session (`session-open`) goes only on a confirmed control socket: one that answered a `ping`
within the last 10 s, or the resume check, and never while the resume race runs. Otherwise the app
sends a `ping` and waits for the `pong`, or for the new connection. When the control socket drops while a session opens, the app opens the
session again once on the new connection.

The connection state that an app shows is the state of its control socket: "Online" (phone:
"Connected", with the heartbeat round trip) only after `welcome` and while `pong` messages come back,
"Reconnecting" while it waits to connect again. The state of each server of the team is separate:
online or offline from the roster, and the session to it on that server's row or screen. On the phone,
a server stays bright while it is in the roster and only its session reconnects.

Each app writes one log line for each connection with its phases, one line when a data socket binds,
and one line each minute with the median of the last 5 heartbeat round trips (desktop: the main log,
`relay-client`; phone: the support log). The lines hold only times and codes, for example:

```text
relay connected in 437 ms (TCP+TLS+WebSocket open 293 ms, challenge to welcome 144 ms)
relay data socket bound in 300 ms
relay heartbeat rtt median 138 ms (5 samples)
relay heartbeat missed; closing the control socket
relay control closed (heartbeat_timeout) after 7011 ms
```

### Data socket

- The client asks for a ticket on the control socket (`data-ticket`). The server answers
  `data-ticket` with a random 256-bit ticket, base64url. A ticket is good for one use, for 60 seconds,
  only for that control socket and its key identifier. The server keeps only its SHA-256.
- The client opens the data socket at the same time as it asks for the ticket. When the socket is
  open and the ticket has come, it sends `data-hello` with the ticket as its first message. There is
  no challenge round and no second certificate proof (the server still sends `challenge`; the data
  socket does not answer it). The server binds the data socket to the control socket of the member. A
  ticket that is unknown, used or expired gives `authentication_failed`.
- The data socket carries only session frames. A text message on it, or a frame on the control
  socket, is a protocol error.
- The client asks for a ticket only when it has no data socket. So a `data-ticket` request closes the
  data socket that the server still has for the member (for example one that stopped answering) with
  the code 1000. The sessions stay, and frames wait for the new data socket.
- The client opens it at the first need: an outgoing session, a `session-incoming`, or `data-wanted`.
  The server sends `data-wanted` when frames wait for a member that has no data socket; it keeps the
  frames until the data socket comes.
- The client closes it after 5 minutes with no session data (`dataIdleMs`, default 300 seconds), with
  the code 1000. The sessions stay open, and the control socket stays open. Another close code ends
  all sessions of the member. When the control socket closes, or the certificate is revoked, the
  server closes the data socket and all sessions of the member.
- The desktop gives the data socket the TLS session of the control socket, so TLS can resume.

### Sessions

| Message | Direction | Fields |
| --- | --- | --- |
| `session-open` | client to server | `session` (number that the opener chooses, 1 to 2^31-1, not used again on that socket), `target` (key identifier), `first` (the end-to-end hello, base64url) |
| `session-incoming` | server to target | `session` (number that the server chooses for the target, 2^31 to 2^32-1), `connectionId`, `from` (certificate of the opener), `first` |
| `session-accept` | target to server | `session`, `first` (the end-to-end reply) |
| `session-refuse` | target to server | `session`, `code` (`refused` or `rate_limited`) |
| `session-opened` | server to opener | `session`, `connectionId`, `peer` (certificate of the target), `first` |
| `session-failed` | server to opener | `session`, `code` (`target_unavailable`, `refused`, `rate_limited`, `invalid_message`) |
| `session-credit` | both | `session`, `bytes` |
| `session-close` | both | `session` (stops the session at once) |

- The server routes only to a member of the same team that hosts and sent `sessions-v2`. It makes a
  new random `connectionId` (16 bytes, base64url) for each session and gives the same value to both
  sides. A target that does not answer in 15 seconds gives `target_unavailable`.
- A data frame is one binary message: byte 0 the frame version (1), byte 1 the kind (1 data, 2 end),
  bytes 2 to 5 the session number (32-bit big-endian, the number of the receiving socket), then the
  payload (at most 64 KiB; none for an end frame). The payload is the end-to-end record stream. The
  server rewrites the session number and passes the payload as it is.
- An end frame closes the session after the data before it, so a graceful end keeps the order of the
  data. `session-close` stops at once.
- Flow control: each direction of a session starts with a window of 1 MiB. A sender sends at most its
  credit; the receiver gives `session-credit` when the application has taken the bytes (in batches of
  256 KiB). The server checks each frame against the credit and refuses a credit above the window.
  The window is 1 MiB, not 256 KiB, so that one session can move about 10 MiB/s at a round trip of 100
  ms.
- Fairness: each client sends at most 64 KiB of one session in turn, round robin, and keeps the rest
  in its own queue while the data socket buffer holds more than 128 KiB. The server keeps a queue for
  each session of each member, and sends round robin while the send buffer holds less than
  `RELAY_HIGH_WATER_BYTES`. Control messages go on their own socket, so a transfer never delays them.
- Limits: sessions of one member (`RELAY_MAX_SESSIONS_PER_SOCKET`), sessions from one member to one
  member (`RELAY_MAX_SESSIONS_PER_PAIR`), sessions that wait for one member
  (`RELAY_MAX_PENDING_PER_MEMBER`). A frame over the credit, a frame on a session that is not open, or
  a session number that is used again closes the control socket of the sender.

A browser, extension or phone connection to a server is one session with three channels (`rpc`,
`events`, `files`). After the end-to-end handshake, the client sends the marker `OPENBOT-V2:2\n`, then
chunks: a channel tag (1 byte: 0 `rpc`, 1 `events`, 2 `files`), a length (2 bytes, big-endian, at most
16381) and that many bytes of the V2 record stream of the channel. Both sides keep the order of each
channel and interleave chunks of 16 KiB round robin. The files channel uses at most half of the window,
so a file transfer does not delay `rpc` or `events`. A desktop client sends HTTP on its sessions, with
keep-alive.

An invalid message closes the socket with an `error` message.

The rules of the server proof that need no cryptography (transcript, host name match, date and usage
rules) are in `packages/contracts/src/relay-protocol/server-proof.ts`, so that a browser client can
use them with WebCrypto. The desktop check is in `src/main/relay/server-proof.ts`.

The desktop accepts a TLS certificate of the system roots (the default roots of Node, with
`NODE_EXTRA_CA_CERTS`) or of the root in its identity file, with the normal host name check. It
refuses `ws:` except on its own computer. Node `ws` turns off the Nagle delay on its sockets
(`setNoDelay`).

### Performance

`bun run test:relay-session-latency` puts a delay of 100 ms each way between each device and the
server, so one round trip through the server costs 400 ms. Results on this computer (2026-11-26):

| Measure | Result |
| --- | --- |
| Desktop session ready, data socket open | 412 ms (about 1 round trip) |
| Desktop first request on a new session, data socket open | 829 ms (about 2 round trips) |
| Desktop first request when both data sockets were closed | 1,100 ms |
| First request after the idle close of the data socket | 831 ms |
| Further requests | 409 to 417 ms (1 round trip) |
| Browser and phone: three channels ready (one session) | 844 ms and 857 ms |
| Browser and phone requests | 414 to 436 ms |
| A request or a new session during a 4 MiB transfer | 413 to 450 ms |
| WebSockets for each app | 1 control and 1 data |

## End-to-end encryption

Each session starts with a handshake between the two OpenBots, before any application byte. The
rules are in `packages/contracts/src/relay-protocol/tunnel-crypto.ts`, and the desktop, the web
client, the extension and the phone run them in `packages/team-client/src/relay-sessions.ts`. The
handshake rides on the session messages, so a new session costs one round trip through the server
before data flows: `e2e-hello` is `first` of `session-open`, `e2e-reply` is `first` of
`session-accept` (and of `session-opened`), and `e2e-finish` is the first data frame, followed at once
by application data.

Each handshake message and each record is a frame: a length (4 bytes, big-endian) and the body. A
handshake body starts with the version (1) and the type.

| Message | From | Body |
| --- | --- | --- |
| `e2e-hello` (type 1) | client | version, type, ephemeral ECDH P-256 public key (65 bytes, uncompressed), random nonce (32 bytes) |
| `e2e-reply` (type 2) | host | version, type, ephemeral public key (65 bytes), nonce (32 bytes), signature (64 bytes) |
| `e2e-finish` (type 3) | client | version, type, signature (64 bytes) |

- The transcript is a sequence of items, each with a 4-byte big-endian length: the context
  `openbot-relay-e2e-v1`, the label (`host` or `client`), the `connectionId` of the session (from
  `session-incoming` and `session-opened`), the key identifier of the client, the key identifier of
  the host, the client ephemeral key, the client nonce, the host ephemeral key and the host nonce.
- Each end signs the SHA-256 of the transcript with its label, with the key of its member
  certificate (ECDSA P-256, SHA-256, IEEE P1363). The other end verifies it with the public key of
  the certificate that it checked for this session. So the server cannot replace a key, replay an
  old reply, or join two different sessions.
- Keys: the ECDH secret of the two ephemeral keys, salt = SHA-256 of the transcript with no label,
  HKDF-SHA256 with the info `openbot-relay-e2e-v1 c2h` and `openbot-relay-e2e-v1 h2c` gives one
  AES-256-GCM key for each direction. The ephemeral private keys are used once and dropped.
- Records: a 4-byte big-endian length and the ciphertext with its 16-byte tag. The plaintext of a
  record is at most 16 KiB. The nonce is 4 zero bytes and an 8-byte big-endian counter for each
  direction, from 0. The additional data is the length header.
- The client can send data right after `e2e-finish`. The host gives the connection to the
  application only after it verified `e2e-finish`.
- A bad frame, a wrong version, a bad signature, a record that fails authentication or a counter
  that is used up closes the connection. The error codes are `tunnel_handshake_failed`,
  `tunnel_peer_unverified`, `tunnel_integrity_failed`, `tunnel_counter_exhausted` and
  `tunnel_identity_unusable` (the key of the identity is not ECDSA P-256). The handshake has a
  deadline of 10 seconds on the host.
- The encryption is mandatory. A peer that sends plain bytes (HTTP or the V2 marker) is refused.
  All OpenBots, the web client, the extension and the phone must run the same version.
- The server can still cut a session. The application then sees a closed connection, as with a
  network fault.

## Web client

The server can serve the web client at `https://<host>/app`, on the same origin as
`wss://<host>/v1/relay`. Each person pastes the identity file or chooses the file in the browser.
The browser keeps the private key in IndexedDB as a key that cannot be exported. The page loads only
files of the same origin, and it connects only to the relay socket of the same origin. So an
identity file must name the same server (`RELAY_PUBLIC_URL`) as the address of the page.

1. Build the files on a computer with the repository: `bun run web-client:build`. The build writes
   `.openbot-build/web-client/` (`index.html`, and the JavaScript, CSS, fonts and pictures in
   `assets/`).
2. Copy the folder to the server, for example to `/opt/openbot-relay/web-client/`, readable by the
   user of the service.
3. Add `RELAY_WEB_CLIENT_DIR=/opt/openbot-relay/web-client` to the settings of the service (for
   example `/etc/openbot-relay.env`) and start the service again.

To update the web client, build it again, replace the folder and start the service again.

With `RELAY_TLS_CLIENT_CERTIFICATES=required`, a browser cannot open the page: it has no TLS client
certificate. Keep that setting `off` to use the web client.

The rules of `/app`:

- `GET` and `HEAD` only. `/app` and `/app/` give `index.html`. A path that is not a file gives
  `index.html`, so the routes of the client work, except for a path in `assets/` or a path with a
  file extension: these give 404.
- A path cannot leave the folder: the server refuses `.` and `..` segments, encoded slashes and
  back slashes, and a symbolic link to a file out of the folder. It never lists a folder.
- `Cache-Control`: `public, max-age=31536000, immutable` for the hashed files in `assets/`,
  `no-cache` for `index.html` and the other files.
- Each answer has these headers: `Content-Security-Policy: default-src 'none'; script-src 'self';
  style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self';
  media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`,
  `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin` and a
  `Permissions-Policy`.
- Styles need `'unsafe-inline'`: the shared SolidJS components and the toast library set static
  `style` attributes, the toast library adds a `<style>` element, and a Mermaid diagram has a
  `<style>` element in its SVG. Scripts stay strict: only files of the same origin, no `eval`. An
  inline style cannot load a file from a different origin, because `img-src`, `font-src` and
  `connect-src` permit only the same origin.

`/v1/relay` and the health endpoints do not change.

## Browser extension

The Chrome extension OpenBot-NC opens your team's agents in the side panel. It connects only to
the central server that its identity file names. It sends no analytics and uses no other server.

1. Build it on a computer with the repository: `bun run extension:build`. The build writes the
   unpacked extension to `.openbot-build/browser-extension/`.
2. In Chrome, open `chrome://extensions`, turn on **Developer mode**, select **Load unpacked** and
   select that folder.
3. Issue an identity for the extension only, for example
   `bun remote/api/src/relay/main.ts ca issue --team Acme --user alice --device extension --out alice-extension.json`.
   Two connections with the same certificate disconnect each other, so do not use the identity of
   the person's desktop or web client.
4. Open the side panel, then paste the text of the identity file or choose the file. The extension
   keeps the private key in its IndexedDB as a key that cannot be exported.

The side panel connects to the central server and to the shared servers of the team while it is
open. Browser sharing for agents keeps a connection to the selected server from an offscreen
document of the extension while the side panel is closed. Settings in the server menu show the
identity and remove it. The extension has no X posting: the X agent came from the agent
marketplace.

## Phone app

The phone app OpenBot-NC (`apps/mobile`, iOS bundle identifier and Android package
`app.openbotnc.mobile`, URL scheme `openbot-nc`) connects only to the central server that its
identity file names. It sends no analytics, gets no push notifications and no over-the-air updates,
and uses no other server. A developer builds it with their own Apple team and Android signing key.

1. Issue an identity for the phone only, for example
   `bun remote/api/src/relay/main.ts ca issue --team Acme --user alice --device phone --out alice-phone.json`.
   Two connections with the same certificate disconnect each other, so do not use the identity of
   the person's desktop, web client or extension.
2. Send the file to the phone. In the app, paste the text of the identity file or choose the file.
   The app keeps the identity in the keychain of the phone (this device only).
3. An owner or admin of a server sees Server settings > Members: the members of the team that
   connected to that server, with their roles. They change the role of a member between member and
   admin, give roles to a member when the server has roles, disable a member, or remove a member. A
   removed member with a valid certificate joins again as a member; disable the member or revoke the
   certificate to keep them out.

Build the app on a Mac with Xcode and Android Studio (the developer runs these commands; the
repository does not run them):

```sh
bun install
cd apps/mobile
bunx expo prebuild --clean
bunx expo run:ios --device --configuration Release
bunx expo run:android --variant release
```

- iOS: set your Apple team ID as `ios.appleTeamId` in `apps/mobile/app.json` before `expo prebuild`
  (the repository leaves it unset), or select the team for the app target and the
  `expo-sharing-extension` target in the workspace that `expo prebuild` makes in `apps/mobile/ios/`.
  Register the bundle identifiers `app.openbotnc.mobile` and
  `app.openbotnc.mobile.ShareExtension` and the App Group `group.app.openbotnc.mobile` in your
  Apple Developer account, or change them in `app.json` to identifiers of your team.
- Android: `expo run:android --variant release` signs with the debug key of the generated project.
  For your own key, put it in `apps/mobile/android/app/build.gradle` (`signingConfigs.release`)
  after `expo prebuild`, or build with your own EAS account: `bunx eas-cli init`, then
  `bunx eas-cli build --platform android --profile production --local`. `eas.json` has no project
  of the original vendor.

## Test

```sh
bun run test:relay
```

The test starts the real server process with a new root, connects real WebSocket clients, and
writes `.openbot-build/relay-e2e/report.json`. It also checks the `/app` files, the fallback to
`index.html`, the refusal of paths out of the folder, and the headers.

```sh
bun run test:relay-admin
```

This test starts the real server with the admin page on `127.0.0.1`. It makes join codes with
`ca code`, enrolls clients with WebCrypto P-256 keys, and checks the client check of the contract, a
second use, an expired code, a wrong proof, two requests with one code at the same time, CORS, the
body limit and the rate limit. The new member connects to `/v1/relay`. It checks the admin sign-in,
the Host, Origin, CSRF and session refusals, the security headers, teams, codes and a revoke that
closes the live socket. It drives the page in Chrome and fails on a CSP violation or a console
error, and checks that the server log holds no secret. It writes screenshots and `report.json` to
`.openbot-build/relay-admin-e2e/`.

```sh
bun run test:relay-web-client
```

This test builds the web client, starts the real server with `RELAY_WEB_CLIENT_DIR` and a host with
relay hosting, and drives Chromium at `https://localhost:<port>/app`: it imports an identity by
paste and by file, opens the agent list, sends a message, removes the identity, and fails on a CSP
violation. It writes screenshots and `report.json` to `.openbot-build/relay-web-client-e2e/`.

```sh
bun run test:relay-extension
```

This test builds the extension, starts the real server and a host with relay hosting, and loads the
unpacked extension in Chromium. It checks the manifest, imports an identity by paste, sends a
message, runs one browser sharing command on a shared tab through the relay, reopens the side panel,
removes the identity, imports one by file, and fails on a console error, a CSP violation or a
request to another server. It writes screenshots and `report.json` to
`.openbot-build/relay-extension-e2e/`.

```sh
bun run test:relay-tunnel-encryption
```

This test puts a relay in the middle with a valid server proof between a desktop client and a host
with relay hosting. It speaks the session protocol with control and data sockets and records every
byte of each session. It checks that a chat message, its
reply and a file go through and that the recorded bytes hold no plaintext, also for the V2 session of a
phone process with noble crypto and no `crypto.subtle`. It checks that a changed byte closes the
connection with `tunnel_integrity_failed` and the application gets no data, and that a replaced
ephemeral key, a replayed reply, a session with a different identifier and plain HTTP are
refused. It measures one 8 MiB transfer through the real server for the desktop and the noble
crypto, and writes `.openbot-build/relay-tunnel-encryption-e2e/report.json`.

```sh
bun run test:relay-heartbeat
```

This test starts the real server with a heartbeat timeout of 5 s, a host with relay hosting, a desktop
client, the phone runtime (noble crypto) and the browser control, with a TCP proxy that adds 67 ms each
way (134 ms round trip, as from the developer's Mac to the server) and that can stop a connection in
both directions without closing it, like an iOS suspension. It checks that the heartbeat round trip is
about one round trip to the server; that a stopped control socket is found within the interval and
3 s, and that a session opened meanwhile works on the new connection; that on phone resume a new control
socket races a stopped one, the session is ready in about one connect time and one round trip, and
`session-open` goes only on the new socket; that a live old socket wins the race, the extra socket
closes and no session is lost; that the server
closes a control socket with no `ping` and the others see the member go offline; that a data socket with
no `pong` is replaced and a new session works; and that the app state stays online while only a host
session reconnects. It measures the parts of one request round trip (client, server, host) from the
times at which the proxy sees each part. It writes `.openbot-build/relay-heartbeat-e2e/report.json`.

Results on this computer (2026-11-26), 67 ms each way:

| Measure | Result |
| --- | --- |
| Heartbeat round trip (desktop, host, phone) | 139, 151, 147 ms |
| One request through the server and the host | 280 to 284 ms: network 268 ms, server 0 to 2 ms each way, host 4 to 9 ms, client 3 to 6 ms |
| Stopped control socket found (interval 1 s in the test) | 3,710 ms; new connection 424 ms |
| Phone resume, old control socket stopped: new connection, session ready | 437 ms, 757 ms after resume; state stays online |
| Phone resume, old control socket alive: extra socket lifetime, session ready | 90 ms, 402 ms after resume; the kept session still answers |
| Server closes a control socket with no `ping` (timeout 5 s) | the member leaves the roster after 5,138 ms |
| Stopped data socket found, next request | 2,884 ms, 587 ms |

```sh
bun run test:relay-session-latency
```

This test starts the real server, a host with relay hosting, a desktop client, the browser client
code and the phone client code (noble crypto, no global `crypto`), with a TCP proxy that adds 100 ms
each way. It checks the round trips in the table of [Performance](#performance), one session with
three channels for each browser and phone connection, at most two WebSockets for each app, the idle
close of the data socket and its new start, and that a 4 MiB transfer does not delay a request or a
new session. It writes `.openbot-build/relay-session-latency-e2e/report.json`.
