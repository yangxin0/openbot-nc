# OpenBot-NC

[![License](https://img.shields.io/badge/license-PolyForm_Noncommercial_1.0.0-blue.svg)](LICENSE)

OpenBot-NC is a non-commercial fork of [OpenBot](NOTICE) for a person or a small team. It is a
local-first desktop workspace for persistent AI agents. Each agent has its own workspace and
conversation. The app supports the local Codex App Server, Claude Code, Grok CLI, OpenCode, Gemini,
Cursor CLI, Cline CLI, Kimi Code CLI, Devin CLI, GitHub Copilot CLI, Mistral Vibe and Hermes Agent,
and custom ACP agents and OpenAI-compatible endpoints. It also gives queues, file transfers, an
embedded browser, channels, routines, workflows and agent-to-agent messages.

The team runs its own central server. There is no vendor account, no paid feature and no WebRTC.

> [!WARNING]
> Agents run with full access to the computer after the explicit first-start consent. They can
> read and change files, run commands, use the network and control the embedded browser. Run only
> agents and tasks that you trust, keep backups, and read [Security](#security) before use.

## License

OpenBot-NC is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE). You can use,
change and share it only for permitted non-commercial purposes. It is a fork of OpenBot by its
original authors. Keep [LICENSE](LICENSE) and [NOTICE](NOTICE) with each copy. These are the
Required Notice lines of the licensor:

```text
Required Notice: Copyright 2026 Synthetify Labs spółka z ograniczoną odpowiedzialnością.
Required Notice: For a commercial license, contact licenses@openbot.run.
```

The original authors do not support or endorse this fork. OpenBot-NC is not affiliated with OpenAI,
Anthropic, xAI or another provider. Provider names only describe compatibility.

## How it works

- The **central server** (`remote/api/src/relay`, guide: [docs/central-server.md](docs/central-server.md))
  is the only server. Your team runs it. It makes the root, team and member certificates.
- A certificate names the team (`O`), the user (`CN`) and the device (`OU`). Each OpenBot-NC that has
  a valid certificate of a team is a member of that team. There is no other member list. One central
  server can serve many teams.
- The client and the central server verify each other. The central server passes the bytes of each
  connection between two members of the same team. TLS protects each socket, and the two members
  encrypt each connection from end to end, so the server cannot read or change chats, files or
  commands. The server does not store or log the bytes.
- An OpenBot-NC that shares its agents is a server for the team. The desktop app, a Linux server, the
  web client, the Chrome extension and the phone app connect to it through the central server.
- Agents, conversations, files and browser data stay on the computer that runs them. See
  [PRIVACY.md](PRIVACY.md).

## Quick start

### 1. Run the central server

Run these commands on the server computer, with the repository and Bun 1.4.2, or use Docker or one
program file (see [docs/central-server.md](docs/central-server.md)):

```sh
export RELAY_DATA_DIR=/var/lib/openbot-relay
export RELAY_PUBLIC_URL=wss://relay.example.com/v1/relay
bun remote/api/src/relay/main.ts ca init
bun remote/api/src/relay/main.ts ca server --dns relay.example.com
bun remote/api/src/relay/main.ts serve
```

`ca init` makes the root certificate and a team named "Default". For personal use, that team is
enough. To add another team, run `ca team add "My Team"`.

### 2. Make one join code for each device

```sh
bun remote/api/src/relay/main.ts ca code --team Default --user alice --device laptop
```

The command prints a one-time link (`openbot-nc://enroll?...`) and a QR code. It works once, for
15 minutes by default. The device makes its own key and sends only its public key, so no private key
moves between computers. Make a separate code for each device: the desktop, the web client, the
extension and the phone. The admin page makes codes too (see
[central server](docs/central-server.md#admin-page)).

The other way is an identity file that holds the private key:

```sh
bun remote/api/src/relay/main.ts ca issue --team Default --user alice --device laptop --out alice-laptop.json
```

Move the file to the device safely, then delete it.

### 3. Install or build the desktop app

OpenBot-NC has no public download and does not update itself. Install a build that your team made,
or build one on a computer with the repository:

```sh
git clone https://github.com/yangxin0/openbot-nc.git
cd openbot-nc
bun install --frozen-lockfile
bun run dist:mac
```

Use `bun run dist:win`, `bun run dist:linux` or `bun run dist:linux:arm64` for the other systems.
The local macOS build is not signed. The release workflow builds signed packages in your own GitHub
repository (see [docs/RELEASING.md](docs/RELEASING.md)).

### 4. Join the team

Open Settings > Team ("Connect to your team" in the "+" menu of the server list), or use "Join with
a code" in the first start. Paste the join code and select Join. A click on the `openbot-nc://enroll`
link opens the same dialog with the code in it; OpenBot-NC joins only when you select Join. To use an
identity file, select "Import identity file" instead. To share the agents of this computer with the
team, turn on "Share this computer's agents with my team" in Settings > Team. You can also start the
app with `--import-relay-identity=<file>` and `--relay-hosting=on`.

### 5. Use the other clients

- **Linux server**: build the AppImage, run
  `sudo bash scripts/install-server.sh --release <AppImage>`, then `openbot-nc join` and paste the
  join code (or `--identity <file>` at install). See
  [self-hosted servers](docs/self-hosted-server.md) and [Docker](docs/docker.md).
- **Web client**: build it with `bun run web-client:build`, set `RELAY_WEB_CLIENT_DIR` on the central
  server, and open `https://<your server>/app`. See
  [central server](docs/central-server.md#web-client).
- **Chrome extension**: run `bun run extension:build`, open `chrome://extensions`, turn on Developer
  mode, select Load unpacked and select `.openbot-build/browser-extension/`. See
  [central server](docs/central-server.md#browser-extension).
- **Phone app**: build it with your own Apple team and Android key. See
  [central server](docs/central-server.md#phone-app) and [apps/mobile/README.md](apps/mobile/README.md).

## Development

Development needs stable [Bun](https://bun.sh/) 1.4.2, Node.js 24 (the version in `.nvmrc`), and at
least one supported agent CLI.

```sh
bun install --frozen-lockfile
bun run codex:doctor
bun run dev
```

In a new git worktree, run `bun run dev:bootstrap` first.

### Commands

| Command | Purpose |
| --- | --- |
| `bun run dev` | Start the Electron app with renderer HMR on a profile of this worktree. `--shared` opens the shared `OpenBot-NC Dev` profile. |
| `bun run dev:stop` | Stop the development stack of this worktree. |
| `bun run dev:test-client` | Start the app and a second client with its own profile. |
| `bun run dev:status` | Show the development stacks. |
| `bun run dev:seed` | Replace the shared development profile with sample data. `--dry-run` changes nothing. |
| `bun run dev:reset` | Delete the development profiles. |
| `bun run dev:automation` | Drive a running development app for smoke checks. |
| `bun run preview` | Preview the built Electron app. |
| `bun run storybook` | Start Storybook for the shared UI. |
| `bun run codex:doctor` | Check the Codex CLI, the App Server handshake and the login. |
| `bun run cua-driver:doctor` | Check the Computer Use driver. |
| `bun run test:changed` | Run the tests that import a file changed since `origin/main`. |
| `bun run test:related -- <source>` | Run the tests of named source files. |
| `bun run test:relay` | Run the central server E2E test. |
| `bun run typecheck:node`, `bun run typecheck:renderer` | Check the types of one project. |
| `bun run relay:build` | Build the central server as one program file. |
| `bun run web-client:build` | Build the web client into `.openbot-build/web-client/`. |
| `bun run extension:build` | Build the Chrome extension into `.openbot-build/browser-extension/`. |
| `bun run mobile:go` | Start the phone app in Expo Go. |
| `bun run dist:mac`, `dist:win`, `dist:linux` | Build an installer for one system. |
| `bun run release:patch` | Prepare a release (also `release:minor` and `release:major`). |

Read [AGENTS.md](AGENTS.md) and [CONTRIBUTING.md](CONTRIBUTING.md) before you change code. The
architecture notes are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Removed compared with OpenBot

- The vendor account service, email sign-in, invitations, Mobile Connect and owner transfer.
- WebRTC, the Signal service and its TURN relay. All traffic goes through the central server.
- Paid features: billing, credits, the commercial license seats, referrals and hosted servers.
- Vendor push notifications, over-the-air phone updates, analytics, failure reports, feedback and
  the self-update of the app.
- The agent and skill marketplace, shared agent templates, hosted sites, and the Slack, Discord and
  Telegram apps. WhatsApp stays.
- Remote desktop, live voice, webhook triggers and the GitHub App connection.
- The vendor store release workflows, the Nix flake, the Umbrel app and the vendor release images.

The full list is in [CHANGELOG.md](CHANGELOG.md) and in the notes of `changelog.d/`.

## Security

Read [SECURITY.md](SECURITY.md) before you report a vulnerability. Do not put credentials, private
files, conversation contents or sensitive diagnostics in a public issue.

Full local access is an explicit product decision, not a security boundary. Reports are especially
useful when remote content can reach Electron privileges, managed attachment paths can escape their
roots, IPC sender validation can be bypassed, or a certificate of one team can reach another team.
