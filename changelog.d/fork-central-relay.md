### Added

- A central server that connects the OpenBots of a team with WebSocket and no WebRTC. It makes the
  root, team and member certificates, and lets in only an OpenBot that has a certificate of its
  team. One server can serve many teams. See `docs/central-server.md`.
- Join a team through the central server. Start OpenBot with `--import-relay-identity=<file>` to
  import the identity file of `ca issue`, and with `--relay-hosting=on` or `off` to share the agents
  of this computer with the team, or stop. On a Linux server, use `openbot-nc import-identity <file>`
  and `openbot-nc hosting on|off`. Sharing is off on a new installation.
- Settings > Team. It shows your team, user, device, central server, the expiry date of your
  identity (with a warning when fewer than 30 days remain), the connection to the central server
  and the members of the team that are connected. A server of a team member that you removed has a
  "Show again" action. Replace or remove the identity file here.
- Import the identity file of your central server in Settings > Team, from "Connect to your team" in
  the "+" menu of the server list, or from the optional "Connect to your team" step of the first
  start. OpenBot works on this computer with no identity too.
- The "Share this computer's agents with my team" switch in Settings > Team, with the state of the
  sharing under it.
- The servers of team members show the user and the device that share them. When the central server
  refuses a connection for good, for example for an expired certificate, the server screen has a
  "Team settings" action next to "Retry".
- OpenBot and the central server now verify each other. The server proves with a certificate of the
  team root that it is the team's own server, also when its TLS certificate comes from a public
  authority. When the proof is wrong, OpenBot stops and says "The central server did not prove that
  it belongs to your team." The server needs `ca server --dns <public host>` and this version.
- The web client on your central server, at `https://<your server>/app`. Paste your identity file or
  choose the file to connect; the browser keeps the private key and cannot read it back. It shows the
  servers that your team shares, with the user and device that share each one, and their agents and
  chats. Account settings > Team identity shows the identity and removes it. Set
  `RELAY_WEB_CLIENT_DIR` on the server to the folder that `bun run web-client:build` writes. The
  hosts need this version.
- `remote/compose.relay.yaml` serves the web client too: set `RELAY_WEB_CLIENT_DIR` to the build
  folder (an absolute path or a path that starts with `./`), and Compose mounts it read-only.

### Changed

- OpenBot opens with no sign-in. It makes a local profile on this computer, with your name and chat
  color, and never connects to an account service. You cannot set a profile picture.
- The "+" menu of the server list no longer offers "Add remote server" with an invitation, and the
  first start no longer shows the invitation step. Team servers come from the central server.
- This build does not update itself: it does not check for, download or install releases, and
  Settings > Updates says so. A Linux server installs a release only from an AppImage that you give:
  `install-server.sh --release <file or https URL> [--sha512 <base64>]`, `openbot-nc update <file or URL>`
  or `openbot-hosted-update stage <file or URL>`. The update timer of a server no longer downloads.
- The list of provider runtime versions that must not be installed comes with the app; OpenBot no
  longer reads it from GitHub.
- MCP sign-in comes back to OpenBot on this computer (`http://127.0.0.1`) and registers OpenBot with
  the sign-in server when that server allows it. It no longer goes through pages on `openbot.run`.
  A sign-in server that accepts only apps with a client ID document cannot sign in, and OpenBot says
  so; add your own sign-in app to such a server. Meta Ads no longer has a built-in sign-in app: add
  your own, with the address that Marketplace, Apps shows. A saved sign-in stays. A Meta Ads sign-in
  ends when its token must be renewed, and a sign-in that ends must be done again.
- Invitation links that OpenBot makes start with `openbot-nc://join`, not `https://openbot.run/join`.
- Routine calendar feeds use new event IDs (`@routines.openbot.local`). A calendar app that
  subscribed to a feed can show the coming runs again once.
- OpenBot no longer allows pages from `openbot.run` in its window, and sends no OpenBot web address
  to MCP servers.
- The app is now OpenBot-NC (non-commercial), with its own app ID (`app.openbotnc.desktop`) and its own
  data folders: `OpenBot-NC` in the application data folder, `~/OpenBot-NC` for agents and shared
  files, `OpenBot-NC` caches and `openbot-nc` temporary folders. On a Linux server it installs in
  `/opt/OpenBot-NC`, keeps data in `/srv/openbot-nc-hosted`, runs as `openbot-nc.service` and its
  command is `openbot-nc`. The desktop opens `openbot-nc://` links and makes its own links with
  `openbot-nc://`. OpenBot-NC does not read or change the data of an OpenBot app on the same
  computer, and a new installation starts empty.
- The Chrome extension connects through your central server. Paste the identity file of the
  extension or choose the file; the extension keeps the private key and cannot read it back. Issue a
  separate identity for the extension, for example with `--device extension`. Settings in the server
  menu show the team, user, device, central server, expiry date and connection, and remove the
  identity after a confirm step. The extension is now named OpenBot-NC. Build it with
  `bun run extension:build` and load `.openbot-build/browser-extension/` with Load unpacked.

### Removed

- Paid features: billing, credits, the commercial license and its seats, referrals and invite codes,
  the paid cloud servers with their plans, paywall, plan end and upgrade offers, and the Credits and
  Pricing pages. Settings has no Billing and no Invite friends tab.
- The limit of 3 members for a server on this computer. The limit of the app for one server stays.
- Workflow steps cannot use OpenBot credit models. A saved step with such a model shows that its
  model is not available; choose a model of your own Sunra or Higgsfield account.
- The "Install server" dialog and the agent tool that made a one-time install command. They needed a
  server claim of the account service.
- Remote desktop. You can no longer see or control the screen of a server computer from OpenBot,
  and Server Settings has no Remote desktop section. The app no longer includes the Sunshine and
  Moonlight runtime.
- Codex live voice. The voice button starts the normal voice conversation: OpenBot listens, sends
  your words to the agent and reads the reply. Settings > Voice has no Live voice section, and the
  web client has no voice conversation.
- The agent marketplace, shared agent templates and the skill marketplace. The Marketplace has no
  Agents tab and no list of marketplace skills. The Skills tab shows your skills, local skills and
  skills from a GitHub link. Agent Settings has no Publish action, and OpenBot no longer opens
  marketplace and shared agent links. The X app is gone from the Marketplace, because its agent came
  from the marketplace. Skills and agents that you installed before stay on your agents.
- Hosted sites. Agents can no longer publish, replace or delete a site on `openbot.site`, Server
  Settings has no Sites section, and agents no longer get the site hosting skill. Site events in old
  chats still show.
- The Slack, Discord and Telegram apps. They connected through the OpenBot service. The Marketplace
  has no Slack, Discord or Telegram app, and agents can no longer read or post in them. Old chats
  from these apps stay readable. WhatsApp stays: it connects from this computer.
- Webhook triggers. A new routine runs on a schedule only, and agents no longer have the tools that
  make or change a webhook routine. A saved webhook routine no longer runs: give it a schedule or
  delete it. A transfer from another OpenBot skips its webhook routines and says so.
- The GitHub App connection, GitHub triggers and GitHub actions in workflows. Skills from a GitHub
  link still install.
- New workflow steps cannot use webhook, GitHub, Discord, Telegram or Slack triggers or outputs.
  Saved steps of these kinds stay in the workflow, but they do not run.
- Phone push notifications and Live Activities. They went through the OpenBot service.
- Usage analytics and failure reports. OpenBot sends no events and no failure report to any server.
  Settings and the first start have no analytics switch. Local logs stay. The files
  `openbot-error-reports-v1.json`, `openbot-analytics-install-id-v1.json`,
  `openbot-analytics-preference-v1.json` and `openbot-analytics-inventory-v1.json` stay on disk and
  are no longer read.
- Feedback to the OpenBot team. Agents no longer have the tools that send or remove a public GitHub
  issue, the Help menu has no Send feedback and Report a problem, and a phone can no longer send a
  report through a server. Old "report sent" cards in chats stay readable, with no Remove action.
- Company sign-in (single sign-on and SCIM) and its section in Server Settings > Members.
- The upload and download of server logos and appearance through the account service. A server keeps
  its logo and appearance on its own computer.
- Release checks of a server in Server Settings > Updates, which read the newest release from
  GitHub. Servers no longer offer this to other OpenBots.
- The Copy link action of a plugin in the Marketplace, and the Hermes "Install with a command" step
  of the agent import. Copy the export skill instead.
- Links to OpenBot web pages and communities: the "Pull up a chair" card with Discord and X, the
  follow and GitHub star prompts, the Guides, Discord and Full changelog items of the Help menu, the
  Terms and Privacy links of the first start, and the download buttons of the update and recovery
  screens. The Help menu opens What's new, which comes with the app.
- The sign-in screen and the account sessions list. OpenBot always opens with the local profile.
  Settings > Profile has no email, sign-out or sessions rows, and you cannot set a profile picture.
  The old files `openbot-central-auth-v1.bin` and `openbot-remote-sessions-v1.bin` stay on disk and
  are no longer read.
- Mobile Connect. Settings has no Mobile Connect tab (QR code, phone link, connected phones and the
  network route choice), and the server list has no "Get the mobile app" card.
- Invitations on the desktop. Server Settings > Members has no invitation links, email invitations
  or pending invitations, OpenBot no longer opens invitation links, and there is no "join with an
  invitation" step. The members of a team come from the central server.
- Owner transfer. OpenBot shows no ownership transfer offers, Server Settings has no Transfer
  ownership section, and servers no longer offer `owner-transfer-v1`.
- Server key rotation with the account service. Server Settings has no key rotation action, and
  servers no longer offer `host-key-rotation-v1`.
- Sign-in to a server with an account ticket (`/v1/join/account` and `/v1/auth/account`). A server
  answers these addresses with 401.
- Servers on this computer are no longer registered with the account service, and they no longer
  read members from it.
- Web sign-in: the web client has no email or company sign-in, no account profile, picture or
  session list, no invitations or owner transfer, and no browser extension sign-in page.
- The vendor web app links: the phone screen of the web client no longer links to the App Store and
  Google Play, and the web client opens directly.
- Extension sign-in: the email code, the sign-in through `openbot.run`, the account session and the
  analytics choice of the Chrome extension. The extension asks for no `identity` permission and no
  access to `api.openbot.run`, and websites cannot message it.
- Extension analytics. The Chrome extension sends no events.
- X posting from the Chrome extension, with its outbox and notifications. The X agent came from the
  agent marketplace, and the page rules came from the account service.
- The Sign out item of the extension server menu. Remove the identity in the extension settings.
- The vendor Signal server and its TURN relay (coturn). The central server is the only server.
- The vendor account service, status page, site router, mobile update server, and the Slack,
  Discord and Telegram chat apps, with their deploy and development commands (`dev:api`, `dev:all`
  and `dev:slack`; `bun run dev` starts the app only).
- The vendor release workflows: phone store builds and over-the-air updates, the Chrome Web Store
  build, the status page, release health reports, announcements and the account service deploy. The
  desktop release workflow builds for the GitHub releases of your own repository, and a new release
  goes to all installs unless `RELEASE_STAGING_PERCENTAGE` is set.
- The macOS app no longer claims `openbot.run` links (Universal Links).
