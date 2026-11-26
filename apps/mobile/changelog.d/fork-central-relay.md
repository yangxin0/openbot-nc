### Changed

- In the background the app keeps its connection to the central server and to your servers, and stops
  its heartbeats; the central server keeps the connection of a phone for 5 minutes with no message.
  When the app comes back, it sends a heartbeat with a 1.5 second answer time and opens a new
  connection at the same time. When the old connection answers first, the app goes on with no new
  sign-in and no reload; the next request takes about one round trip. Otherwise the new connection
  takes over and the app gets the events that it missed from the server. The data that the app shows
  stays on the screen while it refreshes. A server that is offline gets no new attempts until the
  central server says that it is online. The support log has one line for each return with the
  result and the time, and the median heartbeat round trip once a minute. The central server must be
  on the hub version.
- The app uses the new central server hub: one WebSocket, a sign-in with one message, and each
  message encrypted from end to end with a key of this connection. The central server must also be
  on this version.
- When the app comes back to the front, it checks its connection to the central server and opens a
  new connection at the same time, and keeps the one that answers first. A connection to a server is
  ready in about one second. Before, the app could wait 15 seconds or more on a connection that iOS
  had closed in the background. While the app
  runs, it sends a heartbeat every 10 seconds; it stops in the background.
- Settings > Team identity > Connection shows the connection to the central server with its round
  trip time, or "Reconnecting…" while the app waits to connect again. A server stays bright in the
  list while it is online on the central server and only the connection to it reconnects.
- The app keeps one control WebSocket to the central server while it is in front, and opens one
  data WebSocket for all its connections when it needs one; the data socket closes after 5 minutes
  with no data. Connecting to a server takes about one round trip through the central server
  instead of several new sockets. The app and the central server must run this version.
- The app is OpenBot-NC: bundle identifier and package `app.openbotnc.mobile`, URL scheme
  `openbot-nc`. It installs next to the original app and does not update it.
- The app connects to the servers of your team through your team's central server. To start, paste
  the identity file that the server admin made for this phone, or choose the file. Each phone needs
  its own identity (`--device phone`). The app keeps the identity in the keychain of the phone.
- The server list shows the computers of your team that host OpenBot-NC while they are online. A
  server that went offline stays in the list until you remove it from this phone.
- Settings > Team identity shows the team, the user, the device, the central server, the expiry
  date and the connection. Remove identity deletes the identity, the saved copy of your servers and
  chats, and the chat backdrop from the phone.
- When the certificate expires or the server admin revokes it, the app deletes the identity and its
  saved copy of your servers and chats, and asks for a new identity.

### Added

- Join with a one-time code. Paste the code, or select "Scan QR code" and scan it. The iPhone Camera
  app opens a join code link in the app with the code filled in, and the app joins only when you tap
  Join. The phone makes its own key, and only its public key goes to the server. Settings > Team
  identity > "Replace with a code" replaces the identity after a confirmation.

- End-to-end encryption between the phone and your OpenBots. The central server cannot read or
  change chats or files in transit. All OpenBots, the web client, the extension and the phone must
  run this version.
- Server settings > Members for an owner or admin of a server: the members of the team that
  connected to the server, with their roles. Change the role of a member between member and admin,
  give roles to a member, disable or enable a member, or remove a member. The server must be online.
- The app reads your role on each server when it connects, so the settings of an owner or admin
  show on the phone.

### Removed

- Sign-in with an email code, Apple or Google, the account, and the account sessions.
- Mobile Connect pairing with a QR code or a pairing link, invitations and invitation links.
- Billing, credits, referrals, profile editing and cloud (hosted) servers.
- Owner transfer, invitations and Signal home in Server settings.
- The WebRTC connection to servers. The app uses only the central server.
- Remote desktop. The server drawer has no Remote desktop tool, and you can no longer see or
  control the screen of a server computer from the phone.
- GPT live voice. The voice conversation of a chat always uses the voices of the phone, and
  Settings > Voice has no GPT Live Voice tab.
- Product analytics and error reports. The app sends no event to any analytics service, and
  Settings has no Privacy page.
- Push notifications, notification sounds, notification settings and the Mute action of a chat.
  The app shows no notifications.
- Live Activities and the Dynamic Island.
- Over-the-air updates, the update banner and the minimum app version check. A new version comes
  only with a new build.
- The rating request, the Help links (Discord, GitHub, X) and the bug report form. Settings > Support
  log keeps the log of this phone, and you can still save the log file.
- The agent and app marketplace, shared agent links and plugin links. Chat suggestions show only the
  connectors of the server and its MCP sign-ins.
- The website and privacy links in Settings > About, and the Share OpenBot quick action.
- Shortcuts (List Agents, Send Message, Open Agent).
- Sending a share from the iOS share sheet without the app. A share now opens the app, and you
  choose the agent there.
- The plan disk size of cloud servers in Server settings > Storage and in the machine summary.
