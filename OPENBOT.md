# OpenBot-NC compared with OpenBot

OpenBot-NC is a non-commercial fork of OpenBot for a person or a small team. This document lists what
changed compared with the original repository.

| | |
| --- | --- |
| Original | `nightly-labs/openbot`, branch `main` (git remote `openbot`) |
| Fork base | `61645b885` (2026-11-25), "Save the owner's WhatsApp messages to an allowed contact (#16200)" |
| Fork | `yangxin0/openbot-nc`, branch `main` (git remote `origin`) |
| Size of the change | 25 commits, 4,515 files, 53,955 lines added, 442,820 lines removed |
| Not merged | 191 newer commits of the original `main` (local branch `openbot`, at `100c60e89`) |

To see the change yourself:

```sh
git log --oneline 61645b885..main
git diff --stat 61645b885 main
```

The release notes with every user-visible change are in `changelog.d/fork-central-relay.md` and
`apps/mobile/changelog.d/fork-central-relay.md`. Some entries there describe intermediate steps that
later commits replaced (relay tunnels, sessions, two sockets per app). This document describes the
final state.

## Goals

- Non-commercial only. The license stays PolyForm Noncommercial 1.0.0. `LICENSE` is unchanged.
- One central server that you run yourself. No service of the original vendor is used.
- No paid features.
- No WebRTC.

## How the apps connect

### Original OpenBot

- A vendor account service (`apps/auth-api`, Cloudflare Workers) did sign-in, members, invitations,
  billing, hosted servers, push notifications, phone updates and analytics.
- A vendor Signal server and a TURN relay set up WebRTC between a client and a host. Requests,
  events and files went over WebRTC data channels. Remote desktop used Sunshine and Moonlight.

### OpenBot-NC

- **Central server.** One program, `openbot-relay` (`remote/api/src/relay`, built with
  `bun run relay:build`). It is a hub, not a relay:
  - Each app (desktop, Linux server, web client, browser extension, phone) keeps its own WebSocket to
    the central server and talks only to the central server. There is no connection, session,
    tunnel or handshake between two devices.
  - The server keeps a record of each signed-in app: team, user, device, label, hosting state,
    capabilities, message key and the time it was last heard. It answers questions about an app
    from this record. It tells the team when an app comes online or goes offline.
  - A request for data that lives on a host (agents, chats, files) goes to the server encrypted for
    that host. The server passes it on while the host is online. Otherwise it answers "offline" at
    once, and the app waits for the server's "online" notice.
  - Any message proves that an app is alive. An app sends a separate ping only after 10 seconds
    with no traffic. The server closes a silent app after 30 seconds, or after 5 minutes for a phone
    in the background.
- **Certificates.** The server is its own certificate authority: root, then one authority for each
  team, then one certificate for each device. The certificate names the team (O), the user (CN)
  and the device (OU). All apps with a certificate of the same team are one team. One server can
  serve many teams.
- **Mutual verification.** The app signs its sign-in message with its certificate key, with a
  timestamp and a fresh random value (no challenge round). The server proves with a certificate of
  the team root that it is the team's own server, also when its TLS certificate comes from a public
  authority.
- **End-to-end encryption for each message.** Each app makes a new message key for each connection
  and signs it with its certificate key. Two apps derive a key pair from their message keys (ECDH,
  HKDF-SHA256) and encrypt each message with AES-256-GCM and a counter. The apps refuse changed,
  replayed or substituted messages. The central server sees who sends to whom, when and how much,
  but not the content.
- **Hosts.** A host serves each sender with its own Team protocol V2 peer, keyed by the sender's
  certificate. A repeated request acts only once. An app that was offline gets the events that it
  missed.
- **Joining a team.** A one-time join code (`openbot-relay ca code`, or the admin page). The device
  makes its own key and sends only its public key to `/v1/enroll`. Identity files (`ca issue`) still
  work.
- **Admin page.** On a private address of the server only, for example its tailnet address
  (`RELAY_ADMIN_HOST`). Sign in with a one-time link from `openbot-relay admin login`.
- **Web client.** Served by the central server at `https://<server>/app`.

```
App (iPhone)               Central server                     Host (Mac)
  │ sign-in (signed)  ───────▶ │ record: online                   │
  │                            │ ◀──────────────── sign-in (signed)│
  │ question about the Mac ──▶ │ answers from its record           │
  │ ◀───────────────────────── │                                   │
  │ request, encrypted ──────▶ │ ──── request, encrypted ────────▶ │
  │ ◀──── answer, encrypted ── │ ◀─── answer, encrypted ────────── │
  │ request (host offline) ──▶ │ "offline" at once                 │
```

The full protocol, the settings and the set-up are in `docs/central-server.md`.

## Added

- The central server with its certificate authority, the hub protocol, join codes, the admin page
  and the web client (`remote/api/src/relay`, `packages/contracts/src/relay-protocol`).
- Settings > Team in the desktop app: team, user, device, central server, expiry date, connection
  state and connected members. Join with a code, import or replace an identity file, and the switch
  "Share this computer's agents with my team".
- "Join with code" in the desktop app, the web client, the browser extension, the phone app (paste,
  or scan the QR code) and the Linux server (`openbot-nc join`, the code on standard input).
- The shared hub client for the browser, the extension and the phone (`packages/team-client`). It
  uses WebCrypto in browsers and pure JavaScript crypto (`@noble/curves`, `@noble/hashes`,
  `@noble/ciphers`) on the phone, because Hermes has no WebCrypto.
- A local profile on the desktop: name and chat color, with no sign-in.
- End-to-end tests for the central server and each client, for example `test:relay`,
  `test:relay-hub`, `test:relay-app`, `test:relay-web-client`, `test:relay-extension`,
  `test:relay-mobile-client`, `test:relay-join-code` and `test:relay-admin`.

## Changed

- **Name and identity.** The app is OpenBot-NC, with app ID `app.openbotnc.desktop`, phone bundle ID
  `app.openbotnc.mobile`, link scheme `openbot-nc://`, and its own data folders (`OpenBot-NC`,
  `~/OpenBot-NC`). On a Linux server it installs in `/opt/OpenBot-NC`, runs as
  `openbot-nc.service` and its command is `openbot-nc`. The product name shows as OpenBot-NC in all
  15 languages.
- **Signing.** The macOS and iPhone apps are signed with the Apple team of this fork (`HRQ4QNY8PW`).
  `build/entitlements.mac.development.plist` lets you sign a build for your own Mac with an Apple
  Development certificate.
- **Updates.** The app does not update itself. A Linux server installs a release only from an
  AppImage that you give. The Docker image comes from your own build.
- **Browser extension.** It connects through the central server, has no vendor permissions, and
  installs as an unpacked extension (`bun run extension:build`).
- **Phone app.** It connects through the central server, keeps its identity in the keychain, and
  keeps its connection for a short time in the background.
- **MCP sign-in** comes back to OpenBot-NC on this computer (`http://127.0.0.1`), not through vendor
  web pages.
- **Documents.** README, privacy policy, contribution rules, release guide, server guides and
  architecture notes describe OpenBot-NC. The rules for coding agents (`AGENTS.md`) are updated;
  their Non-negotiable section changed only by a developer decision.

## Removed

- **Paid features:** billing, credits, the commercial license and seats, referrals, invite codes,
  paid cloud servers, plans, paywall and upgrade offers, and credit models in workflows.
- **Vendor services:** the account service and its sign-in, sessions, invitations, owner transfer,
  company sign-in, host key rotation and Mobile Connect; the Signal server and TURN relay; the status
  page, site router, phone update server, and the Slack, Discord and Telegram apps.
- **WebRTC:** all WebRTC and Signal code, remote desktop (Sunshine and Moonlight), and Codex live
  voice.
- **Marketplaces and sharing:** the agent and skill marketplaces, shared agent templates, hosted
  sites, the GitHub App connection, webhook triggers, and X posting from the extension.
- **Telemetry and vendor links:** usage analytics, failure reports, feedback to the vendor, phone push
  notifications, Live Activities, and links to vendor web pages and app stores.
- **Vendor release machinery:** store and over-the-air release workflows, the Chrome Web Store build,
  vendor deploy scripts, the paid hosting scripts (boat, Leaseweb, pool), the Nix flake, the Umbrel
  app, and vendor skills for coding agents.

## Data and compatibility

- OpenBot-NC does not read or change the data of an OpenBot app on the same computer. A new
  installation starts empty.
- No database migration of the app changed. Only the migrations of the removed account service are
  gone.
- Files that are no longer used stay on disk unread, for example the old account session file and
  saved WebRTC servers.
- OpenBot-NC cannot connect to OpenBot hosts, clients or vendor servers.
- All apps of a team and the central server must run the same OpenBot-NC version.
- `NOTICE` lost only the notice block of the pictures that were removed with remote desktop.

## Known gaps

- The phone and the web client cannot open the live browser view of a host yet.
- A browser profile that uses a member's computer as its proxy shows it offline.
- Team members cannot read the safe mode reason of a server.
- The desktop shows no upload progress for attachments sent to a team server.
- Only one tab of the web client holds the connection at a time.
- New interface texts are in English in the 14 other languages (`packages/i18n/untranslated.json`).
- On a new connection, the time before the first packet reaches the central server depends on the
  phone's network path. The return to the app with the connection still open takes about 0.2 to
  0.6 seconds to the first answer.

## Commits

| Commit | Change |
| --- | --- |
| `ad06cc260` | Make OpenBot-NC: one central relay server with certificates |
| `71a8b628f` | Verify the server, and remove the account client from the desktop |
| `a166fc353` | Carry Team protocol V2 over relay tunnels, with a browser client |
| `c5b658044` | Run the web client on the central relay, served at /app |
| `8b725c0eb` | Run the browser extension on the central relay |
| `de1c04566` | Run the phone app on the central relay |
| `09e73df12` | Remove the vendor parts of the phone app, and rename it OpenBot-NC |
| `feb46a123` | Remove the vendor infrastructure |
| `63f0af3c5` | Remove the last WebRTC and Signal code |
| `998e1a060` | Show the product name as OpenBot-NC in all languages |
| `0c6a811f0` | Write the documents for the fork, and remove vendor release sources |
| `e419c9e7c` | Remove leftovers of the vendor marketplace and account service |
| `fb01eddf4` | Name the fork repository yangxin0/openbot-nc |
| `f81386093` | Encrypt relay tunnels end to end |
| `ab69bb80f` | Give the phone native modules a homepage |
| `cbefd6af2` | Remove the minimum app version sentence from the support window rule |
| `3a59b1d18` | Add join codes and an admin page to the central server |
| `d2786d49e` | Join a team with a one-time code in every client |
| `61300f222` | Sign the Mac and iPhone apps with the fork's Apple team |
| `63371d044` | Fix the phone peer: do not use the global crypto |
| `8c44fe8d3` | Make the chat narrower again when the right side panel opens |
| `cab389b88` | Use one control and one data WebSocket per app |
| `c2ebeb76f` | Send heartbeats from every app, and reconnect fast |
| `61272c76a` | Make the central server a hub, not a relay |
| `3bb204451` | Run the web client, the extension and the phone on the hub |

The relay tunnel, session and two-socket designs of the earlier commits were replaced by the hub in
`61272c76a` and `3bb204451`.
