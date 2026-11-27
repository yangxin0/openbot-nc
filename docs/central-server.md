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
- Each app (OpenBot, web client, extension, phone) keeps one WebSocket to the server and talks only to
  the server. There is no connection, session or tunnel between two devices. A request to a member
  that hosts is a message to the server, encrypted for that member; the server passes it on when that
  member is online and answers "offline" at once when it is not. It cannot pass messages between
  members of different teams.
- The identifier of a member is the SHA-256 of the public key in its certificate. So a member
  cannot take the address of a different member.
- The verification goes in the two directions. The server verifies the certificate of each
  OpenBot, and each OpenBot verifies that the server is the server of its team: the server proves
  that it has a certificate of the team root (the server identity certificate).

## What the server can read

Each message between two apps is encrypted from end to end with keys that only the two apps have
(see [End-to-end encryption](#end-to-end-encryption)). TLS also protects each socket. The server can
see who sends a message to whom, when, the kind of the message (request, event or file data) and its
size. It cannot read or change chats, files or commands. It does not store messages or write them to
a log. It keeps a record of each connected app (certificate, team, user, device, label, hosting,
capabilities, message key, connection time, last message time) only while the app is connected.

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
- the sender does not prove that it has the private key. The member signs its `hello` (its random
  value, the time, the server address, its record and its message key) with the key of its
  certificate; the time must be within 60 seconds of the server time, and the server refuses a
  random value that it saw before.

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

2. Make the root, the team "Default" and the identity certificate of the server:

   ```sh
   compose="docker compose -f remote/compose.relay.yaml --env-file remote/.env.relay"
   $compose run --rm relay ca init
   $compose run --rm relay ca server --dns relay.example.com
   ```

   For personal use, the team "Default" is enough. To add another team, run
   `$compose run --rm relay ca team add "My Team"`.

3. Start the server:

   ```sh
   $compose up -d --build
   ```

4. Make one identity file for each device of each user:

   ```sh
   $compose run --rm relay ca issue --team Default --user alice --device laptop > alice-laptop.json
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
bun remote/api/src/relay/main.ts serve
```

`ca init` also makes the team "Default". Run `ca team add "My Team"` for another team.

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
| `ca init [--name <name>] [--days <n>]` | Makes the root and the team "Default". It does not replace a root that exists. |
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

1. The administrator makes a code with `ca code --team Default --user alice --device laptop`, or on
   the admin page.
2. The person gets the code as a link or a QR code, for example
   `openbot-nc://enroll?v=1&server=relay.example.com&code=<26 characters>&root=<43 characters>`.
   `server` is the host of `RELAY_PUBLIC_URL`, `code` is a secret of 128 bits in Crockford base32,
   and `root` is the base64url SHA-256 of the root certificate (the client checks it).
3. The client sends `POST https://<server>/v1/enroll` with its public key and a signature that proves
   the private key. The server issues the member certificate with the team authority, exactly as
   `ca issue` does, and sends it with the team chain and the root.

Before the join, a device does not have the root of the team. A server with only its own root (an
IP address and no domain is enough) and a server with a certificate of a public authority both work:

| Client | Server with only its own root | Server with a public certificate |
| --- | --- | --- |
| Desktop and Linux server (`openbot-nc join`) | Yes | Yes |
| Web client at `/app` | After the browser accepts the certificate of the page | Yes |
| Phone on iOS | Yes | Yes |
| Phone on Android and browser extension | Not yet: install the root on the device, or use a public certificate | Yes |

The desktop and the Linux server read `GET https://<server>/v1/root` without a TLS check. They use
that root only when its SHA-256 is the `root` of the code. Then they send the join request with TLS
checked against the system authorities and that root. When the root is not the root of the code,
they stop with `root_mismatch` before the code leaves the device. A server with no `/v1/root` (an
older version) gets the system authorities only; when they do not accept its certificate, the join
stops with `server_untrusted` and the code is not sent. The shared steps are `relayJoinTrustedFetch` in
`packages/team-client/src/relay-join.ts`; the desktop transport is `src/main/relay/join-trust.ts`. On
iOS the native module `apps/mobile/modules/relay-tls` does the requests and opens the relay
WebSocket with TLS checked against the system authorities and the team root. It uses the Network
framework, not `URLSession`: App Transport Security applies to `URLSession` also when the app checks
the server trust itself, so it refused the team root on the iPhone, and an IP address cannot be an ATS
exception. ATS stays on for all other connections of the app.

`/v1/root` is on the main listener, answers the root certificate as PEM to any origin, and holds no
secret. Use it also to install the root on a device that must trust the server.

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
| `RELAY_CLIENT_HEARTBEAT_TIMEOUT_MS` | `30000` | The server closes the socket of an app that sent nothing for this time, and the others see the app offline. |
| `RELAY_SUSPENDED_TIMEOUT_MS` | `300000` | The same time for an app that sent `suspendable` in `hello` (the phone in the background). |
| `RELAY_HELLO_WINDOW_MS` | `60000` | The greatest difference between the time in `hello` and the server time. |
| `RELAY_HIGH_WATER_BYTES` | `262144` | Bytes in the send buffer of a socket before the server keeps the next messages in the queue of that app. |
| `RELAY_QUEUE_BYTES` | `4194304` | Bytes that the server keeps for one app in each queue (small messages, file data). A message over the limit gets `undeliverable` `busy`. |
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

The endpoint is `WSS /v1/relay`. Each app opens one WebSocket to it and keeps it while it runs with an
identity. Control messages are JSON text. Messages between apps are binary. The version of the
protocol is 2; a message of a different version is refused, so all apps and the server update
together.

### Sign-in

The app sends `hello` as soon as the socket is open; there is no challenge round:

| Field | Value |
| --- | --- |
| `version`, `audience` | 2, and `wss://<host>` of the server address |
| `timestamp`, `clientNonce` | the time of the app (ms), and 32 random bytes (base64url) |
| `label`, `hosting`, `capabilities`, `suspendable` | the record of the app: its name, whether it hosts, its capabilities (at most 16, for example `team-http-v1` for a desktop), and `true` for a phone that can be suspended |
| `messageKey`, `messageKeySignature` | a new ECDH P-256 public key for this connection (65 bytes, uncompressed, base64url), and the signature of the certificate key over the length-prefixed items `openbot-relay-message-key-v1`, key identifier, message key, time (8 bytes) |
| `certificate`, `chain`, `signature` | the member certificate, the team authority, and the signature of the certificate key over the JSON array of `openbot-relay-hello-v2` and all the fields above |

The server checks the certificate (issuer, team, dates, revocation), the two signatures, that the
time is within `RELAY_HELLO_WINDOW_MS`, and that it did not see the pair (key identifier,
`clientNonce`) before (a bounded memory of 100,000 pairs). Then it sends `server-proof` (its identity
certificate and a signature over the JSON array of `openbot-relay-server-proof-v2`, `clientNonce`,
audience and the key identifier of the app) and `welcome` (`self`, `team`, `roster`). The app checks
the proof before it accepts `welcome`; when the check fails it closes the socket, reports
`server_refused` and does not connect again. So the app is online about one round trip after the
socket opens.

### Records and presence

The server keeps a record of each connected app: key identifier, user, device, label, hosting,
capabilities, suspendable, certificate, message key and its signature and time, connection time and
the time of its last message. `welcome` lists the records of the other online members of the team.
After a change the server sends `online` (`member`: the record, also when the hosting, the label or
the message key changes) or `offline` (`keyId`). `presence` (`hosting`, `label`) changes the record;
the sharing switch only changes `hosting`. A newer connection of the same certificate replaces the
older one (`replaced`), and the others get only `online` with the new record.

`info` (`id`, `about`: a key identifier) gets `info` (`id`, `member`: the record or `null`) from the
record alone; the server does not ask the app.

### Messages between apps

| Byte | Field |
| --- | --- |
| 0 | the frame type: 1 `send` (app to server), 2 `deliver` (server to app) |
| 1 | the kind: 1 request (`rpc`), 2 event, 3 file data |
| 2 to 5 | the message number (32 bits, big-endian), chosen by the sender |
| 6 to 37 | the key identifier: the recipient in `send`, the sender in `deliver` (the 32 bytes of the SHA-256) |
| 38 to the end | the encrypted payload, at most 64 KiB and 25 bytes |

The server checks that the recipient is an online member of the same team, writes the key
identifier of the sender into the frame and sends it as `deliver`. Otherwise it answers at once
`undeliverable` (`id`, `to`, `code`): `offline` (the recipient is not online in the team of the
sender), `not_member` (the sender itself) or `busy` (the queue of the recipient is full). The app
then waits for the `online` notice of the recipient. The server keeps two queues for each app,
small messages and file data, and sends the small messages first; each queue holds at most
`RELAY_QUEUE_BYTES`. The order of the messages of one kind from one sender stays the same.

### Liveness

| Rule | Value |
| --- | --- |
| Any message that the server gets | proves that the app is alive; there is no separate heartbeat while the app sends |
| The app sent or got nothing for 10 s | it sends `ping` (`id`); the server answers `pong` at once |
| After a `ping`, no message from the server within 3 s | the app closes the socket and connects again at once |
| Any message from the server | proves that the server is alive |
| The server got nothing from an app for 30 s (`RELAY_CLIENT_HEARTBEAT_TIMEOUT_MS`) | it sends `error` `heartbeat_timeout`, closes the socket and sends `offline` to the team |
| The same for an app with `suspendable` | 300 s (`RELAY_SUSPENDED_TIMEOUT_MS`) |
| A revoked certificate | the server closes the socket within a few seconds (it reads the registry every 2 s) and sends `offline` |

The app also sends `ping` after 10 s with nothing received, so it finds a dead socket while it only
sends. The Mac sends a `ping` at once when it wakes (1.5 s answer time). Each app writes one log line
for each connection (`relay connected in 289 ms (TCP+TLS+WebSocket open 145 ms, hello to welcome 144
ms)`), one when a connection ends, and the median heartbeat round trip once a minute; the lines hold
only times and codes.

#### Phone in the background and back

The phone sends `suspendable: true`. When the app goes to the background, it keeps the socket, the
roster and its connections to hosts, and stops its idle pings (`RelayHubClient.suspend`). The server
keeps it for `RELAY_SUSPENDED_TIMEOUT_MS`. If the socket closes in the background, the app connects
again only when it comes back.

When the app comes back (`RelayHubClient.resume`), it does two things at the same moment:

1. It sends `ping` on the old socket with an answer time of 1.5 s.
2. It opens a new socket and starts the sign-in.

The first to confirm wins. When the `pong` comes before the new socket sends `hello`, the app closes
the new socket, keeps the old connection and changes nothing: the host connections stay, and the next
request takes one round trip. When the new connection gets `welcome` first, or the old socket gives no
`pong` in time, the new connection takes over; the server replaces the older socket of the same
certificate, so the app has one connection again. The host connections then close, connect again
through the new connection, and send `event-ack` with the last event number, so the host sends only
the missed events. While the app waits, it shows the data that it has. The app writes one line for
each return: `relay return: connection kept (answer in 154 ms, no new sign-in)` or `relay return: new
connection used in 319 ms (the old connection did not answer)`.

A host that is not in the roster gets no new attempts. The app waits for the `online` notice of that
host, then connects at once; it does not try again on a timer.

### Application messages

The decrypted payload starts with one byte: the low four bits are 1 for text and 2 for binary, and
the bit 0x80 is set for a message from a host to a client. The rest is a Team protocol V2 frame (the
frozen codecs of `packages/contracts/src/team-protocol`), split into V2 fragments of at most 64 KiB.

- The web client, the extension and the phone send V2 `http.request` requests, event frames and file
  frames (`packages/team-client/src/relay-hub-channels.ts`).
- The desktop client sends V2 `http.raw` requests (`method`, `path`, `headers`, `body` text or
  `bodyTransferId` of a V2 file) and gets the answer as `status`, `headers` and `body` text or a V2
  file. The events come as V2 event frames with the unchanged V1 event as payload. So the remote
  server manager keeps its HTTP encodings (`src/main/relay/hub-client.ts`).
- The host serves each sender with one `TeamV2HostPeer`, signed in to its own Team API with the
  verified certificate (`loginWithRelayPeer`). It keeps the answer of each changing request for 10
  minutes and answers a repeated request number with it, without acting again. It keeps the events
  until the client acknowledges them (`event-ack`); when the roster shows the client offline it stops
  sending and keeps the sequence, and the client that comes back sends `event-ack` with its last number
  and gets the missed events. A client with no number (`0`) gets `event-reset`. Files use the V2 file
  frames with their acknowledgements and resume.

The rules of the server proof that need no cryptography (transcript, host name match, date and usage
rules) are in `packages/contracts/src/relay-protocol/server-proof.ts`. The wire messages and the
frame codec are in `packages/contracts/src/relay-protocol/hub.ts` and `decode.ts`.

The desktop accepts a TLS certificate of the system roots (the default roots of Node, with
`NODE_EXTRA_CA_CERTS`) or of the root in its identity file, with the normal host name check, and keeps
the TLS session so that the next connection can resume it. It refuses `ws:` except on its own
computer.

### Performance

`bun run test:relay-hub` puts a delay of 67 ms each way between each app and the server (134 ms round
trip). Results on this computer (2026-11-26):

| Measure | Result |
| --- | --- |
| Sign-in: hello to welcome | 144 ms (one round trip); 289 ms from the start of the socket |
| A request through the server and the host | 281 to 299 ms (one round trip through the server) |
| `info` about the host | 136 ms (one round trip to the server, no message to the host) |
| A small request while a 4 MiB file goes up or down | 275 to 304 ms |
| 4 MiB up, 4 MiB down | 920 ms, 922 ms |
| The `online` notice after the host connects again | 300 ms |
| Revoked app shown offline | 686 ms |
| WebSockets for each app | 1 |
| Phone back in front, old connection alive: the next answer from the host | 312 ms (kept, no new sign-in) |
| Phone back in front, old connection dead: the first answer from the host | 632 ms (new connection in 319 ms) |

## End-to-end encryption

The rules are in `packages/contracts/src/relay-protocol/message-crypto.ts`; the apps run them in
`packages/team-client/src/relay-hub.ts` with the crypto of the app (WebCrypto, or noble on the phone,
which has no global `crypto`).

- Each app makes a new ECDH P-256 key pair for each connection and signs the public key with the key
  of its certificate (see [Sign-in](#sign-in)). A recipient checks the certificate of the sender with
  its own root and team authority (same team, dates), then the signature of the message key, before it
  uses the key. A key with no valid signature, or one signed by a different member, is refused.
- For a pair of message keys, the ECDH secret and HKDF-SHA256 give two AES-256-GCM keys, one for each
  direction. The salt is the SHA-256 of the length-prefixed items `openbot-relay-message-v1`, the two
  key identifiers and the two message keys (in the order of the key identifiers); the info is
  `openbot-relay-message-v1`, sender, recipient.
- Each payload is an 8-byte counter and the ciphertext with its 16-byte tag. Each direction has a
  counter for each kind, from 1. The nonce is the kind, three zero bytes and the counter. The
  additional data is the length-prefixed sender, recipient, message number, kind and counter.
- The recipient refuses a payload that fails authentication, a counter that is not greater than the
  last counter of that kind for that pair of keys (a replay), and a sender with an unknown or unsigned
  key. The application gets nothing from a refused message. The counters are per kind because the
  server sends small messages before file data; the order in one kind does not change.
- The keys change with each connection, so a new connection has new counters.
- The server can still drop or delay a message, as a network fault does. The client then gets no
  answer, and a repeated request acts once.

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
document of the extension while the side panel is closed. The two use the same certificate, so the
side panel connects only after the background has closed the offscreen document. Settings in the server menu show the
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
bun run test:relay-hub
```

This test starts the real server with TLS turned off behind a TCP proxy that adds 67 ms each way and
records every byte that the server gets and sends, a host with relay hosting, fake providers, a
desktop client, raw hub clients and the phone client code with noble crypto. It checks the sign-in
without challenge, a request, the agent reply event, `info` without a message to the host, a host
that goes offline and comes back, a repeated request number, the catch-up of missed events, a 4 MiB
file up and down while small requests go on, that the recorded bytes hold no plaintext of requests,
replies or files, that a changed byte, a replayed message and a substituted message key are refused,
that a `hello` with an old time or a used nonce is refused, the server timeouts for a silent and a
suspendable app, the closing of a revoked app, one WebSocket for each app, and the return of a phone
to the front with a live and with a dead connection. It writes
`.openbot-build/relay-hub-e2e/report.json` with the times.
