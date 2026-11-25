# Web client delivery

This fork has no account service. The central server serves the web client at `/app`
(`RELAY_WEB_CLIENT_DIR`, see [central server](central-server.md#web-client)), and the client connects
only to the relay socket of the same origin.

- Build: `bun run web-client:build` writes the static files to `.openbot-build/web-client/`
  (`web-client.vite.config.ts`, page `src/renderer/web-client/index.html`, entry
  `src/renderer/src/features/web-client/web-client-entry.tsx`).
- Identity: the first screen (`WebIdentityScreen.tsx`) takes the identity file as pasted text or as
  a chosen file. The browser keeps the private key in IndexedDB as a key that cannot be exported
  (`@openbot/team-client/relay-client`). An identity of a different central server is refused.
  Account settings > Team identity shows the identity, the connection and the team members, and
  removes the identity (the saved server data of this browser goes too).
- Servers: one tab holds the relay control socket (Web Lock `openbot.web.relay-control:<key>`) and
  shares the roster with the other tabs (`BroadcastChannel`). Each member that hosts is one server,
  named by its label, with "shared by user · device". A server that left the roster stays as
  offline. The client opens the host with Team protocol V2 over relay tunnels
  (`createRelayTeamPeer`); the role comes from `GET /v1/me` of the host. Members are managed through
  the host routes `/v1/team/members`.
- Final relay states (server refused, certificate revoked or expired, identity used elsewhere) show
  a full screen with Retry and Remove identity.
- Removed with the account service: email and company sign-in, invitations (join, preview,
  invite links), owner transfer, account profile and avatar, sessions, host logos and server hiding
  from the account, the extension sign-in page, the plugin link from the public site, the phone app
  screen with the store links, and the Signal and WebRTC path.
- Test: `bun run test:relay-web-client` (real relay, real host, Chromium).
