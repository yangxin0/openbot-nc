### Changed

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

### Removed

- Sign-in with an email code, Apple or Google, the account, and the account sessions.
- Mobile Connect pairing with a QR code or a pairing link, invitations and invitation links.
- Billing, credits, referrals, profile editing and cloud (hosted) servers.
- Member lists, member roles, owner transfer and Signal home in Server settings.
- The WebRTC connection to servers. The app uses only the central server.
- Remote desktop. The server drawer has no Remote desktop tool, and you can no longer see or
  control the screen of a server computer from the phone.
- GPT live voice. The voice conversation of a chat always uses the voices of the phone, and
  Settings > Voice has no GPT Live Voice tab.
