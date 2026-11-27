# Privacy

OpenBot-NC is a non-commercial fork of OpenBot. It is local first, but it is not offline only. This
document tells you which data stays on your computer and which data goes out.

## Summary

- Agent workspaces, conversations, attachments, browser data and team data stay on the computer that
  runs OpenBot-NC.
- OpenBot-NC sends nothing to the OpenBot vendor. It has no account service, no product analytics,
  no failure reports, no update feed, no push service, no marketplace service and no hosted sites.
- Data goes out only to these places:
  - the AI providers that your agents use;
  - the pages that you or an agent open, and the services of the plugins, MCP servers and apps that
    you connect;
  - the central server of your team, when you import an identity file.
- The phone app keeps an encrypted copy of what it shows (see
  [Web client, extension and phone app](#web-client-extension-and-phone-app)).

## Central server

The central server is the relay server that your team runs (see
[docs/central-server.md](docs/central-server.md)). The OpenBot vendor does not run it.

The server keeps these files in its data folder (`RELAY_DATA_DIR`):

- the root and team authority certificates, with their private keys;
- the registry of the certificates that it made: the team, the user, the device, the serial number,
  the fingerprint, the key identifier, the validity dates and the revoked state;
- its TLS certificate and its server identity certificate.

While it runs, the server knows these data, in memory only:

- the network address of each socket;
- the team, user, device and key identifier of each certificate that connects;
- when a socket opens and closes;
- the sharing state and the label that each OpenBot-NC sends;
- which member connects to which member;
- the number and size of the encrypted messages of each connection, in transit.

TLS protects each socket. Inside each connection, the two OpenBot-NC ends encrypt all bytes from end
to end (ECDH P-256, AES-256-GCM, see [docs/central-server.md](docs/central-server.md#end-to-end-encryption)).
Each end signs the key exchange with the key of its certificate, so the server cannot read or change
chats, files or commands in transit, and cannot put itself between the two ends. The server does not
store the encrypted bytes and does not write them to a log. Its log has only start, certificate store
and error lines. `/metrics` gives counts of sockets, teams, members and connections, with no names.
A person who controls the server or its root private key controls who can connect: with the root key,
that person can make a certificate for a new member and connect as that member.

## Web client, extension and phone app

The web client at `https://<your server>/app`, the Chrome extension and the phone app connect only to
the central server that their identity file names.

- The web client and the extension keep the private key in IndexedDB as a key that cannot be
  exported. The page and the extension cannot read the key back.
- The phone app keeps the identity in the keychain of the phone (this device only). It also keeps an
  encrypted, read-only copy of the agents, sections, recent chats, channels and drawer values of its
  servers, and the newest backdrop page that an agent set for its user. Remove identity, an expired
  or revoked certificate, and the removal of a server delete these copies.
- A desktop or browser client keeps a copy of the agent and channel pictures of a joined server, so
  that the saved workspace shows them while the host is offline. The removal of the server and the
  end of access delete it.
- Requests, messages and files between a client and a host go through the central server in transit,
  encrypted from end to end, as [Central server](#central-server) tells.

An owner or admin of a joined server can manage its host from their own computer, from the web
client or from the phone. A provider API key, a custom endpoint key or header, the code that a
provider sign-in page shows, and a new server logo then go from that client to the host through the
team connection. The web client does not store a key. The host stores them as it stores a change
made on the host. No response returns a key, and neither computer writes request bodies to its logs.

When a member of a joined server selects "Sign in on this computer" in the browser of that server,
the desktop app opens the site in a window on their computer, with a session in memory only. It then
sends the cookies of that site, and of no other site, to the host through the team connection. The
host sets them in the browser session of the tab. Neither computer logs the cookie values.
## AI conversation context

When a provider session is replaced, OpenBot sends a bounded excerpt of the current conversation
to the selected provider. The agent can request older messages from that same conversation through
local history tools. Requested text and selected saved work steps are then sent to that provider.
These tools exclude messages before the latest context reset and cannot search another conversation,
except a side thread of the same agent that the agent names by its task id.
A user can tag a browser tab or a side thread of the agent in a message. When OpenBot delivers the
message, it sends the provider the tab's title and address, or the thread's title, state, and the start
of its last answer. Card numbers and known secrets are removed first.
When a user selects "Teach a task" and saves the recording, OpenBot sends the agent's provider a
message with the steps in an attached text file: the host, path and title of each page, and the role and name of each control
that the user clicked. The steps have no query, no typed text and no field value. A discarded
recording is sent to nobody.
When a request needs where the user is, an agent can ask for the user's location with a card in the
chat. Nothing is sent until a person answers the card. An agent cannot ask in a channel or an external
chat. On the mobile app, **Share once** reads the phone's location (latitude, longitude, accuracy and
the time of the measurement) one time, only while the app is in use ("While Using the App"
permission), and sends it to the server as the answer. **Always allow** does the same and saves on
that phone that the agent may have it: later cards from that agent are answered on the phone without a
tap while the app is in use and the chat is open, when this person's own message started the request,
until the person taps **Ask every time**. Removing the identity, an expired or revoked certificate, and server removal delete
this choice. On a computer, the person can type a place instead. The server gives the answer to the agent's
provider as the result of the agent's request, so the provider gets it and can keep it in its session
history. The server does not store the location or the typed place in the SQLite database: the card
keeps only that the location was shared or not. The agent's reply, which can name the place, is stored
like any other message. The phone does not store the location, or follow it in the background.
A page in the OpenBot-NC browser can ask for the location. The browser asks the person first, and a page
gets nothing until the person selects **Allow**. On the computer that runs the browser, Allow lets the
page read the location of that computer. On a joined server, Allow reads the location of the member's
own device (latitude, longitude and accuracy) one time and sends it to the server, which gives it to
that tab only. The page can then send it to its site, as in any browser. The answer holds while the
tab stays on the same site. **Allow always** holds for that site in all agent tabs until OpenBot-NC or the
server restarts. On a joined server, it holds only in the tabs of the same agent, and the server keeps the
location that the member sent in memory for that time and gives it to the site again in those tabs.
OpenBot-NC does not store the location or the answer in the SQLite database.
Channel history keeps its existing membership and task checks. Messaging history stays within its
current link. The full conversation stays in local SQLite storage. These tools send no history text to
another service.

## Local scripts

Local scripts is off by default for each agent. When enabled, scripts that run as the same OS user
on the host can read a local token and use the loopback API. They can send messages, run routines,
read pending questions and approvals, and submit answers or approval decisions. OpenBot redacts
secrets in API responses. Secret questions and browser takeovers return notices only and must be
completed in OpenBot. OpenBot does not send these API responses to another service.
A script can send the data elsewhere under its own configuration.

## Agent and host usage

The Usage view stores numeric token counts, activity counts, provider and model identifiers,
internal session and turn identifiers, timestamps, and cost estimates in the host's local SQLite
database. Collection starts when this feature is installed. It does not import old provider
transcripts or store message contents, credentials, or raw provider responses.

Authenticated members of a host team can read aggregate usage for that host's agents through the
Team API, including from mobile. Desktop can also show the combined totals for all agents on one
host, with an optional agent filter. A host-wide response carries the combined totals, one row per
day, one row per model, one aggregate row per agent, identified by the agent's internal id, and one
row per day and provider with that provider's token count and cost estimate for the day. Agent
names are not part of the response; the client shows them from the agent list it already
reads. These records stay on the host. The central server passes them in transit only. Conversation clearing retains usage;
agent deletion removes it. A duplicate agent starts with no usage history.

Authenticated members of a host team can also see that host's storage through the Team API: how
much disk space each location, agent and chat uses, and the name, size, type, date and chat title of
each sent or generated file. They can also read the free and total size of the disk that holds the
host's OpenBot data. The response contains no file paths, and workspace and download files
are counted only as totals. Only owners and admins can delete a file or clear caches and logs. A
deleted file is removed from the host's disk; the message that sent it stays and shows that the file
is not available.

Costs are API-equivalent estimates in USD, not subscription charges. Missing usage, unknown prices,
and incomplete billing inputs remain marked as unavailable or partial.

## Data stored on the OpenBot computer

Saved agent memories, their inclusion settings, and their full-text search index stay in the local
SQLite database. Essential memories enter the agent's provider instructions within a fixed size
limit. Other saved memories reach the provider only when the agent retrieves them with a memory
tool. Search runs locally and does not use an external search or embedding service. Provider output
uses the application's secret redaction. After every
20 turns of an agent's chat or side thread, after 15 minutes with no new turn, when the user clears
the chat, and when the user closes a side thread, OpenBot sends the agent's profile, its essential
memories, the saved memories that relate most to the conversation, and the new part of the
conversation, with secrets redacted, to the agent's own provider, on the agent's model or on the
provider's lower-priced default model, which proposes memory changes. Nothing else receives them.
Server settings > General > Memory review sets the number of turns (10, 20 or 40) for the agents of
the server, or turns these reviews off; off, no review sends anything. An owner or admin of a joined
server can change it.

Server settings > General > Learn from my browsing is off by default. When it is on, and you or a
team member control a page of an agent's browser, OpenBot records the address of each page (the host
and the path, without the query or the hash, and with each path part that looks like a code or an id
replaced), its title, and the kind and the label of each control
you click. It does not record what you type, field values, password fields, card or one-time code
fields, secret tabs, or private sign-ins. The steps stay on this computer in
`openbot-browsing-steps-v1.json`. The next memory review of that agent sends them, with secrets
redacted, to the agent's own provider, as part of the review above, and then deletes them. Steps that
no review reads are deleted after 30 days. Turning the setting off deletes all recorded steps.

- `~/OpenBot-NC/Agents` contains one workspace per agent. A profile written by a release before the
  bot-to-agent rename holds them under `~/OpenBot-NC/Bots`; the application moves them on first launch.
- `~/OpenBot-NC/Shared` contains managed transfers shared between agents, and
  `~/OpenBot-NC/Shared/Data/agent-data.db` holds the records the agents keep for themselves between tasks.
  Every agent on this computer can read and write every table in that file, and the user can delete any
  table in agent settings.
- `~/OpenBot-NC/Downloads` contains files downloaded by the embedded browser.
- `~/Library/Application Support/OpenBot-NC` contains the OpenBot SQLite database, agent metadata,
  conversations, message queues, direct messages, reactions, read state, attachment drafts and
  indexes, team configuration, local team members and sessions, the browser profiles and their
  cookies, application preferences, and the provider CLIs OpenBot downloads. The downloaded CLIs are kept in
  one store for the whole computer, which no other profile data shares.
- The local team configuration contains team member profiles, password hashes and salts when local
  password sign-in is used, invite and session token hashes, and the team identity key pair.
- `~/.codex` is owned by Codex CLI and contains its login and thread data. OpenBot does not copy or
  manage Codex credentials.
- `~/.claude` is owned by Claude CLI and contains its login and session data. OpenBot does not copy
  or manage Claude credentials.
- The MCP sign-ins are kept in `~/Library/Application Support/OpenBot-NC`, encrypted by the operating
  system's secret storage in the same way as provider API keys. One record per server address holds
  the client registration and the access and refresh tokens. Removing the server in settings, or
  choosing Sign out on it, deletes its record. These values are redacted from logs, exports and diagnostics.
  The port and secret of the local MCP sign-in server are kept in
  `~/Library/Application Support/OpenBot-NC/openbot-mcp-oauth-proxy-v1.json`, encrypted in the same way.
- The Link payment account (Server settings › Vault › Cards) is kept in
  `~/Library/Application Support/OpenBot-NC/openbot-link-account-v1.json`, encrypted by the operating
  system's secret storage. It holds the Link access and refresh tokens and the account email.
  Disconnect deletes the file and asks Link to revoke the sign-in. A one-time Link card is not
  stored: OpenBot reads it from Link for each fill and types it into the page. The tokens and the
  card number are redacted from logs, exports and diagnostics.
- The NEAR Intents wallet (Server settings › Vault › Crypto) is kept in
  `~/Library/Application Support/OpenBot/openbot-near-wallet-v1.json`, encrypted by the operating
  system's secret storage. It holds the payment grant token, the owner's passkey credential ID and
  public key, the agents that can pay, the payment rules, today's spend, and the payments that wait
  for an answer. The app window never receives the token. Disconnect deletes the
  file. The token is redacted from logs, exports and diagnostics.
- The ElevenLabs API key for dictation and spoken replies is kept in
  `~/Library/Application Support/OpenBot-NC/voice-api-key.json`, encrypted by the operating system's
  secret storage. The app window never receives the key back. Remove key in **Settings → Voice**
  deletes the file. The key is redacted from logs, exports and diagnostics.
- The Groq API key for dictation is kept in
  `~/Library/Application Support/OpenBot-NC/groq-api-key.json`, encrypted by the operating system's
  secret storage. The app window never receives the key back. Remove key in **Settings → Voice**
  deletes the file. The key is redacted from logs, exports and diagnostics.
- The restricted Stripe key of the CRM is kept in
  `~/Library/Application Support/OpenBot-NC/crm-stripe-key.json` on the computer that runs OpenBot (on a
  joined server, on that server), encrypted by the operating system's secret storage. The app window
  receives only its last four characters. The customers, plans and payments that the sync copies from
  Stripe go in the CRM tables of `openbot.db`, as rows that a person adds. Disconnect on the CRM page
  deletes the key file; the copied rows stay until a person deletes them. The key is redacted from
  logs, exports and diagnostics.
- The xAI API key for spoken replies is kept in
  `~/Library/Application Support/OpenBot-NC/xai-api-key.json`, encrypted by the operating system's
  secret storage. The app window never receives the key back. Remove key in **Settings → Voice**
  deletes the file. The key is redacted from logs, exports and diagnostics.
- The API key of the voice server is kept in
  `~/Library/Application Support/OpenBot-NC/voice-server-key.json`, encrypted by the operating system's
  secret storage. The app window never receives the key back. Remove in the Voice server section of
  **Settings → Voice** deletes the file. The key is redacted from logs, exports and diagnostics.
- The Bitwarden connection keeps a CLI session key in process memory only. OpenBot does not
  save it to a file. Disconnect, eight hours without vault use, and app exit stop this connection.
  The log redactor can retain values in memory until exit to mask later messages.
  The Bitwarden CLI keeps its own encrypted vault cache. OpenBot reads login items in the folder
  `Shared with OpenBot`. Agents receive item ids, titles, and usernames; passwords and authenticator
  codes go through the main process to the browser page. This folder is an OpenBot access rule;
  the CLI session key can decrypt the wider vault. Use a separate Bitwarden account if you need
  the password manager itself to enforce that separation.
  An owner or admin of a joined server can connect that server's Bitwarden or Vaultwarden in
  Marketplace › Apps › Bitwarden with the server address, the personal API key and the master password. They
  go once, over the encrypted connection, to the server, which keeps them in
  `openbot-bitwarden-connector-v1.json` in its application data folder, encrypted by its operating
  system's secret storage, so it can unlock again after a restart. Its CLI keeps its own encrypted
  vault cache in `provider-state/bitwarden-host` in the same folder. The computer that sent them does
  not keep them, and no answer from the server carries them. Disconnect deletes the file and the
  cache. The API key and the master password can open the whole vault, not only the shared folder.
  They are redacted from logs, exports and diagnostics.
- The 1Password connection (Marketplace > 1Password) is kept in
  `~/Library/Application Support/OpenBot-NC/openbot-onepassword-connector-v1.json`, encrypted by the
  operating system's secret storage. It holds the service account token and the account ID only.
  OpenBot keeps the list of logins (titles and web addresses) in memory, never on disk. A password
  or a one-time code is read from 1Password when the browser fills it, goes only to that page, and
  is never sent to an agent, a provider, a log or a team member. The token and each filled value
  are redacted from logs, exports and diagnostics. An owner or admin of a joined server can paste a
  service account token for that server in Marketplace › Apps › 1Password. The token goes once, over the
  encrypted connection, to the server, which keeps it in the same file on its own disk. The
  computer that sent it does not keep it, and no answer from the server carries it.
- The Proton Pass connection (Marketplace › Apps › Proton Pass) runs Proton's `pass-cli`, which
  OpenBot downloads from proton.me and checks against a pinned SHA-256. The computer or server talks
  to Proton directly. A sign-in on Proton's web page makes an agent access key that reads only the
  vault `Shared with OpenBot`; you can also paste an agent access key that you made. OpenBot keeps
  only that access key, in `openbot-protonpass-connector-v1.json` in its application data folder,
  encrypted by the operating system's secret storage, and the CLI's session in
  `provider-state/protonpass-host` in the same folder. An extra password goes to the CLI once,
  through a pipe, and is not saved. OpenBot keeps the list of logins (titles, user names and web
  addresses) in memory, never on disk. Each time it reads a login, the CLI sends Proton the reason
  "OpenBot fills this login in its browser." A password or a one-time code goes only to the browser
  page that it fills, never to an agent, a provider, a log or a team member. The access key, the
  extra password and each filled value are redacted from logs, exports and diagnostics. An owner or
  admin of a joined server connects that server's Proton Pass from their own computer or phone: the
  sign-in page opens there, and the access key or the extra password goes once, over the encrypted
  connection, to the server. No answer from the server carries it. Disconnect deletes the file and
  the session; the agent access key stays on your Proton account until it ends after one year or
  you remove it in Proton Pass.
- The Vault (Server settings › Vault) is kept in
  `~/Library/Application Support/OpenBot-NC/openbot-vault-v1.json`, encrypted by the operating system's
  secret storage. It holds the logins, payment cards (number, expiry, security code, name), contact
  info and API keys (variable name, key, notes) that the user saves. A login can also keep a two-step
  (authenticator) setup key. OpenBot makes its sign-in codes on this computer; the key itself never
  leaves it, and no window, phone or agent gets it back after it is saved. On Linux with no keyring, OpenBot
  encrypts it with its own key file. The file never leaves this computer. An owner or admin of a joined
  server can open that server's Vault in Server settings, from the desktop app or the web app: the
  list goes over the encrypted connection with no password, card number, security code, API key or
  two-step key, and one of the first four goes to them only when they show or copy it. A server with
  `vault-v3` also sends the current two-step codes, each valid for its short period. The iPhone app shows the same list and never
  asks for a password, a card number, a security code or an API key: a new one that the owner or admin types on
  the phone goes once to the server, and the phone does not keep it. The same applies to a two-step key that the
  owner or admin pastes, scans with the camera or reads from a screenshot on the phone: the phone keeps it in memory
  only, makes the first codes from it so the user can check it on the site, and sends it once to the server on save.
  The camera picture and the screenshot stay on the phone. Other team members cannot read it. An agent gets the login sites and usernames, the card names with their last
  four digits and expiry, and the contact info; it never gets a password, a card number, a security
  code, two-step key or login notes. It can enter a two-step code into a sign-in page with the secure
  sign-in card, as it does a password, and save a setup key that a site shows when the user asks it to
  turn on two-step verification; only a person's message can start that save. An agent can add and change contact info, change the username of a login (not
  its site) and the name, expiry and billing address of a card, and delete items, with no approval: the
  chat shows each change, and an item that an agent adds keeps the agent's name. Agents cannot see,
  add, change or delete a Vault API key as an item. When an agent lists its API keys, OpenBot writes
  each Vault key that the agent can use, readable only by the user, to
  `~/Library/Application Support/OpenBot-NC/agent-api-keys/.vault/<agentId>/<NAME>`, outside every
  workspace, and gives the agent the path. All agents run as the same system user, so every agent on
  the server can read these files in its commands, also the files of a key that is for other agents
  or for "Only this agent". The choice of agents controls which agents OpenBot gives a key to; it does
  not keep a key from the other agents. A changed
  key is written again, and a deleted key or a Vault that cannot be read removes its file, also at
  start. When an agent has a key folder from 0.69 or earlier, or from a save without a Vault, each key
  for that agent only is also readable in that folder, `agent-api-keys/<agentId>/<NAME>`: a link to the
  Vault file, or, where Windows does not allow links, a copy of the key that is readable only by the user
  and follows the same rules. API keys are redacted from logs, exports and diagnostics. A password that the
  user types into the secure sign-in card goes to the Vault only while Save to Vault is checked. On a
  joined server, the box starts checked, any member can save, and the password goes to that server's
  Vault, not to the Vault of the computer where it was typed. All agents of that server can then sign
  in with it. Only an owner or admin can show it in the server's Vault. The
  first card fill on a site waits for the server owner's approval; team members and messaging
  services cannot give it. The card then keeps that site and the origins of its card frames, and
  later fills there need no approval; the user can remove a site in the card. The
  browser types those values into the page, where the page's own scripts can read them, as they read
  what a person types. Until that page navigates, the agent cannot take a screenshot, evaluate
  script or record in that tab, and its snapshots hide the card fields. Passwords and card numbers
  are redacted from logs, exports and diagnostics, also in the desktop app of an admin who showed
  or copied one. A CSV import is read on this computer, from its own file dialog or from the text of
  a CSV export that an owner or admin picks in the iPhone app (`vault-import-v1`). That text goes once
  over the encrypted connection; the answer carries only the counts, and the phone deletes its copy
  of the file after it reads it.
- `~/Library/Application Support/OpenBot-NC/logs/trace.ndjson` is a local trace of IPC calls,
  provider turns, main-process failures, and the steps of each connection to a joined server. Each
  line holds a time, the IPC channel name, the turn origin, the failure origin (`uncaughtException`
  or `unhandledRejection`) or the connection step (such as `remote-connect:ticket`), the duration,
  and the outcome word. A connection step does not name the server. The failure's error text goes only to the redacted log. The trace holds no payloads,
  messages, URLs, paths, or identifiers, and it goes through log redaction before it is written. It
  is kept to two files of 2 MB each and is never sent. It also records the exit of a renderer or
  helper process with its reason word and process type, each main-process delay of 1 second or more
  with the phase word described above, and the reason that OpenBot quit (such as
  `main_window_closed` or `quit`).
- `~/Library/Application Support/OpenBot-NC/logs/main/main.log` holds the redacted lines of the main
  process: startup failures, uncaught errors, the reason that OpenBot quit, and why an update check,
  download or install failed. It is kept to two
  files of 1 MB each and is never sent.
- OpenBot keeps crash dumps of its own processes in the `Crashpad` folder of its user data
  (`%APPDATA%\OpenBot-NC\Crashpad` on Windows). A dump holds part of the memory of the process that
  crashed, which can include conversation text, tokens or other secrets, and cannot be redacted.
  Dumps are never uploaded or added to a diagnostics export. Crashpad deletes old dumps by itself.
  Do not attach a dump to a public issue. 
- `~/Library/Application Support/OpenBot-NC/openbot-run-marker-v1.json` holds the app version, the
  start time and the last sign of life of the current run, written once a minute, whether the
  computer slept, and whether a quit started or ended. The file never leaves this computer.
- `~/Library/Application Support/OpenBot-NC/logs/resources.ndjson` holds one line a minute: the memory
  and CPU use of each OpenBot process group and provider id, the heap sizes and DOM node count of
  the app windows, the main process delay and its phase, the number of
  agent database statements, active turns and browser tabs. It holds no process IDs, program names,
  command lines or paths. It is kept to two files of 1 MB each and is never sent.
  `~/Library/Application Support/OpenBot-NC/openbot-resource-summary-v1.json` holds the totals of
  today and of the previous day for the diagnostics export.
- `~/Library/Application Support/OpenBot-NC/logs/stall-profiles.ndjson` holds one line for a minute in
  which the main process froze for 2 seconds or more, twice in a row: the functions of OpenBot's code
  that used the time, and their callers. A line holds function names, the file name of an OpenBot
  file, package names and Node module names. It holds no directories, arguments, values, queries or
  text of the user. It is kept to two files of 256 KB each and is never sent.
- `~/Library/Application Support/OpenBot-NC/openbot-agent-notification-levels-v1.json` holds the
  notification level that the owner and each member of this host chose for the whole server and for
  each agent ("All activity", "Only when it needs me" or "Nothing"), by member ID and agent ID. Each member reads and
  sets only their own levels, and the host applies them to the desktop notifications of this computer
  A removed member's levels are deleted. The file never leaves the host.
- `~/Library/Application Support/OpenBot-NC/openbot-sidebar-pins-v1.json` holds the agents and channels
  that the owner and each member of this host pinned, in their order, by member ID, with agent and
  channel IDs only. Each member reads and sets only their own list, so their desktop app, web client
  and phones show the same pins. A removed member's list is deleted. The file never leaves the host.

Attachments copied into OpenBot remain in managed storage after their original file is moved or
deleted. By default, all agents share one embedded browser profile, including cookies and website
sessions. An agent can instead use a profile of its own, or a named profile that only the agents
assigned to it share. Profile names stay in the local database of the computer that runs the agents.
On a joined server, an owner or admin reads the names, colors and agents of the host's profiles through
the encrypted host connection, and each member reads the name and color of the profile of a browser tab
that they can see. Cookies and site data of a profile do not leave the host. Clear data and Delete
remove the cookies and site data of a profile.
Websites receive the browser's Chromium user agent. HTTPS sites and local loopback HTTP sites also
receive basic client hints with the Chromium major version, operating-system name, and desktop flag.
Google account requests retain the Electron version token for sign-in compatibility.

## Other network connections

Network traffic can also occur when:

- the local Codex App Server connects to OpenAI;
- the local Claude Agent SDK connects to Anthropic through Claude CLI;
- a user or an agent visits a page in the embedded browser;
- a user submits text that is not a web address in the browser address bar, which sends the query to Google Search;
- a user clicks a web link in a chat of the desktop app or the web client, and it opens in the
  system browser or a new browser tab. OpenBot adds `utm_source=openbot` to the address, so the
  site can see that the visit came from OpenBot. It adds nothing else. It does not change a link that already has a `utm_source`,
  a link to a local or private address, or a link with sign-in or signature values such as `state`,
  `code`, `token` or `X-Amz-Signature`;
- a locally installed Codex plugin connects to its service;
- an MCP server the user enabled is reached at its own address, and, when that server asks for a
  sign-in, OpenBot connects to the server's authorization service to register itself, to exchange
  the grant the browser returns, and to renew the token. When the user signs out of the server or
  removes it, OpenBot sends the tokens it deleted to that same service once, to revoke them.
  Agents reach a server that OpenBot signed in to through a local server on `127.0.0.1`, which adds
  the token to each call, so the token does not go to the agent's process.
  That local server tells the MCP server that the client is OpenBot: it sends
  `User-Agent: OpenBot/<version>` and, when a session starts, the client name `openbot`, the
  OpenBot version and the title `<agent name> (OpenBot)`, so the server can show which agent made a
  change. Nothing else about the user's agents, conversations or files is sent in those requests. The
  sign-in page sends the grant back to `127.0.0.1` on the same computer, and the registration names
  no OpenBot web address;
- an owner or admin pastes a GitHub link into the Marketplace Skills search. The computer that runs
  OpenBot, or the joined server, reads that public repository from `api.github.com` and
  `raw.githubusercontent.com` without a GitHub account, with `User-Agent: OpenBot`. It reads the
  commit, the file list and each `SKILL.md`, and when the user adds a skill, the files of that skill
  folder. The requests carry the repository, the folder and the commit, and no other user data. The
  skill is kept with the agent like a Marketplace skill;
- an owner or admin connects Stripe on the CRM page. The computer that runs OpenBot, or the joined
  server, sends the restricted key to `api.stripe.com` and reads the account name, customers,
  subscriptions, invoices and products of that Stripe account, when the key is connected,
  every 5 minutes, and on Sync now. OpenBot only reads: it sends no CRM data to Stripe, and the
  requests carry no other user data. Disconnect stops the requests;
- the user presses Install on the 1Password page. OpenBot downloads the 1Password CLI release that it
  pins from `cache.agilebits.com`, checks its SHA-256, and keeps it in
  `~/Library/Application Support/OpenBot-NC/provider-state/1password-cli`. The request carries no user
  data;
- the user dictates or starts a voice conversation for the first time, or presses Download in **Settings →
  Voice**. OpenBot downloads the speech model that it pins, Parakeet TDT, Parakeet Unified EN,
  Underdog Bark 3.0 Plus, Whisper turbo or Cohere Transcribe, from `huggingface.co`, checks its size and SHA-256, and keeps it in `runtimes` in
  the application data folder. The request carries no user data. Dictation audio from these models
  stays on the computer, and the chosen model and language are saved in `voice-preference.json` in
  the same folder;
- the user selects ElevenLabs Scribe v2 Realtime in **Settings → Voice** and dictates or talks in
  a voice conversation. While the microphone records, or when a voice conversation turn ends, OpenBot streams the
  audio and the chosen language to `api.elevenlabs.io` with the user's own API key, and receives the
  text. Nothing else is sent: no conversation, file or agent instruction. ElevenLabs handles the
  audio and the text under its own policy and the user's ElevenLabs plan. The local models send
  nothing;
- the user selects Groq Whisper large-v3 turbo or Groq Whisper large-v3 in **Settings → Voice** and
  dictates or talks in a voice conversation. When the recording stops, or when a voice conversation turn ends,
  OpenBot sends the recorded audio, the chosen model and, when the user set one, the language to
  `api.groq.com` with the user's own API key, and receives the text. Nothing else is sent: no
  conversation, file or agent instruction. Groq handles the audio and the text under its own policy
  and the user's Groq plan;
- the user sets up a voice server in **Settings → Voice**. OpenBot sends requests only to the address
  that the user enters, with the user's API key when there is one. To connect, it lists the server's
  models and voices. When the server does dictation, OpenBot sends the recorded audio, the chosen
  model and, when the user set one, the language to `/v1/audio/transcriptions` and receives the text. When the server reads
  replies aloud, OpenBot sends the text of each reply that it reads, the chosen model and the voice to
  `/v1/audio/speech` and receives the audio. Nothing else is sent: no conversation, file or agent
  instruction. The server handles the audio and the text under the policy of the person who runs it.
  The address and the choices are saved in `voice-server.json` in the application data folder;
- the user sets up a voice server in **Settings → Voice** of the phone app. The phone sends the same
  requests as above directly to that address, not through a server of OpenBot. For dictation it keeps
  the recording in memory, writes it as a WAV file to the app's cache folder only while the request
  runs, and deletes it after. The address and the choices are saved in the phone's keychain, and the
  API key in a separate keychain entry. **Remove voice server** deletes both;
- the user turns on Read replies aloud, starts a voice conversation for the first time, or presses Download
  in the Spoken replies section of **Settings → Voice**. OpenBot downloads the Supertonic 3 voice
  model that it pins from `huggingface.co`, checks its size and SHA-256, and keeps it in `runtimes`
  in the application data folder. The request carries no user data. When Supertonic reads a reply
  aloud, the text and its audio stay on the computer. The setting and the chosen voice are saved in
  `speech-preference.json` in the same folder. When the user selects an ElevenLabs model (Flash
  v2.5, Multilingual v2 or Eleven v3) or xAI Text to Speech as the spoken replies model, OpenBot
  sends the text of each reply that it reads, the chosen model, the voice and the speech language to
  `api.elevenlabs.io` or `api.x.ai` with the user's own API key, and receives the audio. Listen
  sends a short sample text. Nothing else is sent: no conversation, file or agent instruction. The
  provider handles the text and the audio under its own policy and the user's plan.
  In a voice conversation, the spoken reply runs on this
  computer, also for an agent on a remote server. Speech recognition uses the model chosen in
  **Settings → Voice**: a local model runs on this computer, and ElevenLabs or Groq gets the audio as
  described above. A message that the user speaks to an agent on this computer keeps its recording,
  a WebM/Opus file in the message's own transfer folder, so that the user can play it again in the
  chat. The agent, its provider and team members get only the text. A remote server gets only the
  text, as for a typed message, and no recording is kept. Recordings show in the Storage tab of
  **Server Settings**, where the user can delete them, and are part of a data export. A recording is
  deleted with the agent's or channel's data;
- an agent uses the `openbot.web_search` tool. Only agents on a provider with no web search tool of
  its own get it. OpenBot starts a separate Codex App Server process, which sends the agent's question
  to OpenAI through the default Codex sign-in of this computer. OpenAI searches the web and returns a
  short answer with source URLs to the agent. Only the question and short OpenBot instructions go to
  OpenAI, not the agent's chat, files or instructions, and not the agent's own provider account.
  OpenAI handles the question under its own policy and the user's ChatGPT plan;
- an agent uses the `openbot.read_video` tool on a video link. The first time, OpenBot downloads the
  yt-dlp release that it pins from `github.com`, checks its SHA-256, and keeps it in `runtimes` in the
  application data folder. yt-dlp then requests the video page and the video file from the site of the
  link, as a browser does, with no cookies or sign-in. The file goes to a temporary folder on this
  computer and is deleted after the read. A hidden OpenBot window takes still frames and the sound on
  this computer. Only a speech recognition model that the user set up in **Settings → Voice**
  transcribes the sound: a local model keeps it on this computer, and Groq or a voice server gets the
  sound in parts of 60 seconds as described for dictation. The agent gets the title, the author, the
  counts, the description, the transcript and the frames;
- the user connects Bitwarden. OpenBot runs the installed `bw` CLI to sync with the server already
  configured in that CLI, including a self-hosted server. It syncs before listing or filling logins.
  These calls send no OpenBot conversations, files, or agent instructions to Bitwarden. For a
  joined server's connection, the server's own `bw` signs in to the server address that the admin
  entered with the API key, and unlocks with the master password on that server. When that server has
  no `bw`, it downloads the Bitwarden CLI release that OpenBot pins from `github.com`, checks its
  SHA-256, and keeps it in `provider-state/bitwarden-cli` in its application data folder. That
  download carries no user data;
- the user connects 1Password. Connect runs the user's own 1Password CLI (`op`) on this computer to
  create the vault "Shared with OpenBot" and a service account that can read only it. OpenBot then
  reads that vault from 1Password's servers with the token: the vault names, the login titles and
  web addresses, and, when an agent signs in to a site, that login's username and password or code.
  Nothing about the user's agents, conversations or files is sent to 1Password;
- the user connects Link in Server settings › Vault. OpenBot asks `login.link.com` for a sign-in
  code and a token, with the label "OpenBot on" and this computer's name, which Link shows in its list
  of connected apps. OpenBot renews and revokes the token there, and reads the account email from
  `api.link.com`. When an agent pays with Link, OpenBot reads the payment methods of the account
  from `api.link.com` and sends a payment request: the method ID, the amount and currency, the
  merchant name and address, and the agent's description of the purchase. Link asks the user to
  approve it, and OpenBot then reads the one-time card from `api.link.com`. Nothing else about the
  user's agents, conversations or files is sent to Link;
- a Linux server downloads an OpenBot AppImage only from an https URL that you give to
  `install-server.sh --release`, `openbot-nc update` or `openbot-hosted-update stage`; the desktop app
  does not check for, download or install updates;
- OpenBot checks for new provider CLI releases when it starts, once an hour, and when you select
  `Check for updates`. It asks `api.github.com` for Codex, Kimi, GitHub Copilot, Mistral and Gemini, `registry.npmjs.org` for Claude,
  OpenCode and Cline, `x.ai/cli` for Grok, `raw.githubusercontent.com/agentclientprotocol/registry` and
  `downloads.cursor.com` (for the download size) for Cursor, `static.devin.ai` (the manifest, and the
  download size) for Devin. The list of blocked versions comes with the app. These requests contain no account, agent,
  conversation or file data;
- an agent shows a visual reply, an agent checks its page with `html_preview`, or a user opens an
  HTML attachment, shared file or workspace file in the file preview. The page is HTML that the
  agent or the file wrote. It runs its scripts in a sandbox and can load scripts, styles, fonts
  and images from any address, such as a
  CDN. The server that holds those files gets the request and the network address of the computer,
  but no OpenBot cookies. The page cannot read the app, the conversation or other
  files. `html_preview` draws the page in a hidden window that has its own
  session in memory. The web client gets the page through the host connection and runs it in a
  sandboxed `srcdoc` frame with an opaque origin, so the page cannot read the web client's storage
  or its host keys; the browser sends no referrer for its requests. The mobile app runs the
  page in a web view, so the server gets the network address of the phone. On iPhone and iPad the
  web view keeps cookies and storage in memory only; on Android it has no page storage and no
  cookies for the files that the page loads. The page cannot call the app or read its files;
- a user opens an explicitly labeled external support or setup link;
- a WhatsApp number is linked. See [WhatsApp connections](#whatsapp-connections).

## Workflows

A workflow is a graph of steps that the user draws on a canvas. The host stores each workflow, its
graph, up to 50 earlier versions of the graph, its runs, and the input and output text of each step
in its local SQLite database. A run also keeps a copy of the graph. Runs stay until the workflow is
deleted.

- **Agent steps** send their input to the agent as a routine message. The agent's model provider
  gets it, as with other routine input.
- **Model and condition steps** send their input to the provider and model that the step names,
  without tools.
- **Outputs to a messaging place** post the workflow name and the text through that messaging
  connection.
- **Notifications** show the workflow name and at most 200 characters of text, with secrets
  removed, only when notification previews are on.

Members of a joined server can read, change, and run a workflow when they can see and use each
agent in it (`workflows-v1`). The graph and the step text then go to their computer.

An image or video step sends its prompt and its input pictures to the provider of its model, as an
agent turn does, and keeps the result on the computer that runs the workflow. A picture that a member
uploads to an asset step goes to that computer and stays in its Library.

A step with a Sunra model uses the Sunra sign-in of that computer's Apps. The computer sends the
prompt, the model, the size settings and the input pictures to Sunra's MCP server (`mcp.sunra.ai`):
it puts each input picture in Sunra's upload storage first, then asks Sunra to make the file, and
downloads the result only from Sunra's file hosts. Sunra keeps the file in a project named "OpenBot"
of the signed-in Sunra account, and the credits of that account pay for it. OpenBot does not change
which Sunra account pays. While the Canvas page is open, the computer also asks Sunra for the credits
of that account, with Sunra's `get_balance` tool, which spends no credits. It shows the number only
in the page rail, and each member of a joined server who can use workflows can see it. Sunra's own
privacy policy covers what Sunra keeps.

A step with a Higgsfield model uses the Higgsfield sign-in of that computer's Apps in the same way.
The computer sends the prompt, the model, the size settings and the input pictures to Higgsfield's
MCP server (`mcp.higgsfield.ai`): it puts each input picture in Higgsfield's upload storage first,
then asks Higgsfield to make the file, and downloads the result only from Higgsfield's file hosts.
Higgsfield keeps the file in the history of the signed-in Higgsfield account, and the credits of that
account pay for it. OpenBot never spends an unlimited-generation allowance of that account. While the
Canvas page is open, the computer also asks Higgsfield for the credits of that account, with
Higgsfield's `balance` tool, which spends no credits. It shows the number only in the page rail, and
each member of a joined server who can use workflows can see it. Higgsfield's own privacy policy
covers what Higgsfield keeps.

While the Canvas page is open, the computer also asks Sunra and Higgsfield for their model lists, and
for the price of the model and the settings of an image or video step. A price request sends the
model, the size settings and a fixed sample prompt. It sends no prompt of the user and no picture,
and it spends no credits. Each member of a joined server who can use workflows can see the models and
the prices.

Deleting an agent keeps the workflows and their step history without the agent. Deleting a
workflow deletes its versions, runs, steps, and receipts.


## WhatsApp connections

A WhatsApp number links as a device of the computer that runs the agents, as WhatsApp Web does. The
computer connects directly to WhatsApp's servers. No other service takes part: the central server does
not know the number, the link or any message, and Meta gets no OpenBot business account.
To link, the user scans a QR code that OpenBot shows, or types a pairing code on the phone. Before each
connection, OpenBot asks `web.whatsapp.com` for the current WhatsApp Web version, as a browser does.
OpenBot uses an unofficial client (a modified copy of the open-source Baileys library), so WhatsApp can
restrict or block a number that it sees as automated.

- **Stored on the host.** The device's keys, its Signal sessions, the messages that OpenBot sent in the
  last day (WhatsApp asks for them again when a phone could not decrypt one), the last 30 minutes of
  received messages that the agents took (so a crash does not lose them), and the reply chains of the
  last 7 days are in `<userData>/whatsapp/`. Every value is encrypted with a random key that the
  operating system's secret storage keeps, and the file is readable only by the user. The database
  holds the number, a masked name, which agent is the WhatsApp Orchestrator, the contacts and groups
  that the owner allowed, and one row per conversation that an agent answers. The messages of that
  conversation are kept as a conversation of that agent, and files people send are kept with the
  agent's attachments. The messages of the allowed chats that OpenBot sees, also those that do not
  mention the number, are kept in the database for 90 days after they arrive, so that an agent can
  read and search them. The files of these messages are downloaded when they arrive, up to 100 MB
  each, to `<userData>/whatsapp/files/`, readable only by the user, and are deleted with their
  message. The copies of one number use at most 2 GB: when they use more, the copies of the oldest
  messages are deleted first, and those messages keep only the names of their files. A message that
  its author deletes for everyone is deleted with its files, and a changed message keeps the new text. Names are kept in memory until OpenBot quits. Pairing requests are kept in memory for at
  most an hour. Disconnect logs the device out (when OpenBot is connected), deletes its keys, the saved
  messages and their files, and keeps the conversations, the workspace memories and the allowed
  senders.
- **Read from WhatsApp.** WhatsApp gives a linked device every message of the account. OpenBot reads
  only the owner's own "Message yourself" chat, direct messages of the contacts the owner allowed, and
  the groups the owner allowed, where a request starts only from a mention of the number or a reply in
  a conversation that an agent answers. Every other chat is dropped when it arrives and is not stored.
  When a device links, WhatsApp sends it a first part of the account's history; OpenBot keeps from it
  only contact names and the phone forms of contacts, in memory, and drops the messages. It does not
  ask WhatsApp for the full or recent history.
- **Given to the WhatsApp Orchestrator.** Every new WhatsApp request goes first to the orchestrator
  agent, which runs on its provider like any other agent and passes the work to a teammate with the
  facts it needs.
- **Managed from another computer.** An owner or admin of a joined server can link and manage the
  host's numbers from their own computer or the browser client. The host sends that client the QR code
  or pairing code of a link, the numbers and their names, the allowed contacts and groups, the pairing
  requests that wait, and the list of the number's groups, over the encrypted connection of the
  server. The QR code holds the one-use secret of that link. The stored keys of the device do not
  leave the host.
- **Sent to WhatsApp.** The agents' answers and the files they attach, short status posts, reactions,
  and approval requests with the command, folder and reason the provider gave, redacted. On a number
  used only by OpenBot, a person whom the owner did not allow gets one message with a pairing code.
  On the owner's personal number, OpenBot never writes to anyone else first. Any agent can post
  redacted text and files from its workspace or the OpenBot shared directory to the allowed chats.
  An answer or a post can ping a person that it mentions.

Anyone whom the owner allowed can give the agents work. The agents run on the host with the access
the user gave them.

## Agent access

Agents currently use `danger-full-access` with `approvalPolicy: never`. They can read and modify local
files, run programs, use the network, and control the embedded browser without an OpenBot confirmation
dialog. This is an explicit product behavior, not a host security boundary. Keep backups and do not
give an agent a task you would not allow a local command-line tool to perform.

On first launch, OpenBot explains this access and does not start the agent services until you
explicitly accept it. The acceptance record stays in OpenBot's local application-support directory.

Computer Use is provided by `cua-driver`, a local binary that OpenBot ships and starts as its own
child process. It starts only when you open the Computer Use panel or an agent uses the function, and
it stops when OpenBot stops. Because OpenBot starts it directly, macOS attributes the Screen Recording
and Accessibility grants to OpenBot, and macOS keeps control of the prompts. Windows and Linux ask for
no such grant. Screen contents and accessibility trees that an agent reads through the driver go to
that agent's provider, the same as any other message content.

The driver is third-party software with its own product analytics, which its vendor turns on by
default and which are not OpenBot's. They would send the driver version, the operating system, a
random installation identifier, and a bucketed record of each tool call to that vendor. They never
send screen contents, window or application names, typed text, or the content of a tool result.

On its own the driver also asks GitHub for a newer release each time it starts.

**OpenBot stops both calls, always.** Every copy of the driver OpenBot starts gets
`CUA_DRIVER_RS_TELEMETRY_ENABLED=0` and `CUA_DRIVER_RS_UPDATE_CHECK=0`, so it sends the vendor
nothing and asks GitHub nothing. OpenBot pins the driver version it packages, so a release check
could only offer you an update OpenBot would refuse. The driver reads the environment before its own
configuration, and OpenBot sets both variables last, so nothing can turn them back on for a driver
OpenBot started. OpenBot writes no file, so a driver you run yourself keeps the settings you gave
it.

## Exports

The account menu can export a local ZIP containing agent profiles, conversation snapshots, queues,
and managed message attachments. It intentionally excludes CLI credentials, browser cookies, and
agent workspace files.

The diagnostics export contains application and CLI versions, capability states, aggregate queue
counts, a summary of the local trace: counts, outcomes, and durations for each IPC channel,
turn origin, and failure origin, and the resource summary: the last sample and the memory, CPU,
responsiveness, database statement and crash figures of today and the previous day. It contains no conversations, visited URLs, account email, file
contents, or local file paths.

## Delete local data

Quit OpenBot, then remove the OpenBot folders listed above. Removing
`~/Library/Application Support/OpenBot-NC` also removes the embedded browser's cookies and logins.
Removing `~/OpenBot-NC` removes agent workspaces, transfers, downloads, and the records the agents kept. OpenBot does not delete
`~/.codex` or `~/.claude`; use each CLI's own controls if you also want to remove its local data.

Review folders before deleting them and keep a backup of anything you need.

## Questions

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md), without attaching
credentials, conversations, or unrelated private files.

When you ask OpenBot to generate or revise an agent profile, it sends your setup
prompt, the current profile draft (when present), and available sidebar section
names and identifiers to the selected AI provider through its local CLI. This
request does not include conversation history, saved memories, or workspace files.
The draft is reviewed before OpenBot saves it; generating a draft does not create
an OpenBot conversation or change an existing agent. The provider's own data and
CLI retention policies still apply.

When you change an agent's provider, the new provider receives the chat history with its first
message. That history includes the work steps that the previous provider recorded: commands, the end
of their output, changed file paths, tool names, searches and progress notes. OpenBot removes known
secrets from these steps first. Command output can contain file contents. Reasoning, diffs and
attachment contents are not sent.

## Providers and agent runtimes

### OpenCode

OpenBot downloads the OpenCode CLI (the `@opencode/cli` packages) and its license (from the
`opencode-ai` package) from `registry.npmjs.org`, then starts it with `opencode acp`. Prompts, attachments, and tool
results go to that local process. OpenCode can send them to the model provider selected in its
configuration. OpenCode's free models are the default, and they reach OpenCode Go with no account,
so a first OpenCode turn leaves this computer without a sign-in.

An OpenCode agent searches the web with OpenCode's own web search tool. OpenCode sends the search
query, and no other part of the chat, to one of the web search services that it supports, such as
Exa, Firecrawl, Parallel, Tavily or TinyFish. OpenCode 2 asks before its first search; OpenBot gives
the answer "allow" for it, so that an agent in a WhatsApp chat can search
too. OpenBot does not give this answer when OpenCode already has an answer that you gave, or when
your global OpenCode configuration file or the project's `opencode.json` sets `websearch`. Set
`"websearch": false` in one of them to stop web search.

An OpenCode Go key is optional and unlocks the paid catalog. OpenBot encrypts it with the operating
system's secret storage, writes it to a file that only your user account can read, and passes it
to the local OpenCode process. To show the remaining Go quota in Usage, OpenBot also sends the key
to `opencode.ai/zen/go/v1/usage`; that request contains no conversation, file, or model data, and
the response contains only the used percentage and reset time of each Go limit. OpenBot does not
send that usage to its maintainer. No screen, log, data export, or diagnostics report contains the
key; the data export lists it under `scope.excludes`.

When you saved no key in OpenBot, OpenBot reads the Go quota with the key that the OpenCode CLI
uses: an OpenCode Console connection in OpenCode's database (`opencode.db`), else the Go key. The Go
key is the `opencode-go` key in OpenCode's `auth.json` (or `OPENCODE_AUTH_CONTENT`), or
`OPENCODE_API_KEY` from the environment that started OpenBot when `auth.json` has none. Last, it
uses the `opencode` key in `auth.json`, the key that older OpenCode versions keep only there, unless
that key names a self-hosted Console. OpenBot reads
these from OpenCode's data folder (`$XDG_DATA_HOME/opencode`, or `~/.local/share/opencode`) and sends
the key only to `opencode.ai/zen/go/v1/usage`. When OpenCode rejects a key, OpenBot tries
the next one. OpenBot does not store, log, or show these keys. OpenBot does not copy OpenCode credentials or upload its session
files. OpenCode manages its own login and resume state.

### Gemini

OpenBot downloads Google's Antigravity CLI from its GitHub releases (`github.com`) when you select
Download on the Gemini row. Google's license does not let OpenBot include it in the application. OpenBot
starts the CLI's `acp` server as a local process. Prompts, attachments, and tool results go to that process,
and the server sends them to Google. Connect opens Google's sign-in page in your browser. On this
computer, Sign in saves a Gemini API key instead: OpenBot encrypts it in its existing provider
credential store, gives it to the server as `GEMINI_API_KEY`, and redacts it from logs. The server
sends the key to Google. The server keeps its login and session files in `~/.gemini/antigravity-acp`, or in the same folder of
`$GEMINI_HOME`. OpenBot tells it to keep the Google token in a file there, not in the macOS Keychain. Each Gemini
account that you add after the first keeps them in a folder of its own in OpenBot's data folder, and gets no saved API key;
Remove deletes that folder. Once, when an account still has the token file of the earlier Antigravity server
(`acp_token.json`), OpenBot copies its refresh token into the new token file in the same folder, so you do not
sign in again. The old file stays. The CLI's own log in that folder names your Google account. OpenBot does
not upload these files and does not put them in a diagnostics export. Reconnect and Remove delete the token file but
do not revoke the sign-in at Google; remove Antigravity's access in your Google account to do that. Google's terms
apply: <https://antigravity.google/terms>.
Gemini agents stay on this computer: OpenBot does not show them to team members.

OpenBot does not read the Gemini quota and does not call Google's internal Code Assist service. It
reads the server's token file only for the email of the Google account. Usage shows no Gemini plan usage.

### Cursor

OpenBot downloads the Cursor CLI from `downloads.cursor.com` when you select Download on the Cursor
row. Each provider update check also asks `downloads.cursor.com` for the size of the newest
download, also when you do not use Cursor. OpenBot starts the CLI as a local process. Prompts,
attachments, and tool results go to that process, and the CLI sends them to Cursor. Sign in opens
Cursor's sign-in page in your browser, or the CLI uses `CURSOR_API_KEY` from the environment that
started OpenBot. OpenBot gives that key only to the local CLI, in its environment, and does
not store it. The CLI keeps its login and session files
in `~/.cursor` (on Linux, the login is in `~/.config/cursor`). On macOS the CLI keeps its login in
the login Keychain. OpenBot does not copy or upload these files. Cursor's terms apply:
<https://cursor.com/terms-of-service>. Team members see the host's Cursor agents, as for the other
providers, when their app supports Cursor.

To show the remaining Cursor plan usage in Usage, OpenBot reads the CLI's access token: on macOS
from the Keychain item `cursor-access-token`, else from the CLI's `auth.json`. OpenBot sends the
token only to Cursor (`api2.cursor.sh`, or `CURSOR_API_ENDPOINT` when you set it for the CLI), in
the same usage request that the CLI sends. The request contains no conversation, file, or model
data. OpenBot does not store, log, or send the token or the usage to its maintainer.

A Cursor account after the first is a Cursor API key that you type under Providers › Cursor › Add
account. OpenBot keeps the key encrypted on the OpenBot computer, in the same file as the other
provider API keys, and deletes it when you remove the account. For a joined server, the key goes to
that server's host over the encrypted Team channel and is kept there. To check a key, OpenBot sends
it to Cursor (`api2.cursor.sh`, or `CURSOR_API_ENDPOINT`), in the request with which the CLI signs a
key in, and does not keep the answer. The CLI processes of the agents on that account get the key in
their environment. Those processes keep their sign-in in memory only: they do not read or change the
CLI's own login. OpenBot does not log the key or send it to its maintainer.

### Cline

OpenBot downloads the Cline CLI from `registry.npmjs.org`, and its license file from `github.com`,
when you select Download on the Cline row. OpenBot starts the CLI as a local process. Prompts,
attachments, and tool results go to that process, and the CLI sends them to Cline and to the model
provider you select in Cline. The provider of a free model can use your prompts to train models.
Sign in opens Cline's sign-in page in your browser, or the CLI uses `CLINE_API_KEY` from the
environment that started OpenBot. OpenBot gives that key only to the local CLI, in its environment,
and does not store it. The CLI keeps its login and session files in `~/.cline`, or in `$CLINE_DIR`.
OpenBot does not read, copy, or upload these files. When OpenBot reads the Cline model list, it
also sends `GET https://api.cline.bot/api/v1/ai/cline/recommended-models` to read Cline's free
models, which the CLI does not list. The request has no account, key, or prompt in it, and Cline
sees the IP address of this computer. Cline's terms apply:
<https://cline.bot/tos>. Team members see the host's Cline agents, as
for the other providers, when their app supports Cline.

### Kimi

OpenBot downloads the Kimi Code CLI from `github.com` (GitHub release assets), and its license file
from `github.com`, when you select Download on the Kimi row. OpenBot starts the CLI as a local
process. Prompts, attachments, and tool results go to that process, and the CLI sends them to
Moonshot AI: `api.kimi.ai` for a global account, or `api.kimi.com` for a mainland China account.
Sign in runs `kimi login`, which opens Kimi's sign-in page in your browser: `auth.kimi.ai` for
Connect, or `auth.kimi.com` when you select the kimi.com (China) item in the row's ⋯ menu. The CLI
keeps its login, device ID, session files, and settings in `~/.kimi`, or in `$KIMI_SHARE_DIR`.
OpenBot reads the API address in `config.toml` on this computer, to start the CLI with the
region of its login. OpenBot does not copy or upload these files. Unless you
set `telemetry = false` in `~/.kimi/config.toml`, or set `KIMI_DISABLE_TELEMETRY=1` in the
environment that starts OpenBot, the CLI sends anonymous usage events to
`telemetry-logs.kimi.com`. OpenBot does not change this setting. Moonshot AI's terms for Kimi Code
apply. Team members see the host's Kimi agents when their app supports Kimi.

To show the Kimi Code plan usage in Usage, OpenBot reads the CLI's API address and the name of its
token in `config.toml`, and the CLI's access token in `credentials`: in `~/.kimi` or
`$KIMI_SHARE_DIR` for Kimi CLI 1.x, and in `~/.kimi-code` or `$KIMI_CODE_HOME` for Kimi Code 2.x.
OpenBot sends the token only to Moonshot AI (`api.kimi.ai`, `api.kimi.com`, or `KIMI_CODE_BASE_URL`
when you set it for the CLI), in the same usage request that the CLI's `/usage` command sends. The
request contains no conversation, file, or model data. OpenBot does not store, log, or send the
token or the usage to its maintainer.

### Devin

OpenBot downloads the Devin CLI from `static.devin.ai` when you select Download on the Devin row.
OpenBot starts the CLI as a local process. Prompts, attachments, and tool results go to that
process, and the CLI sends them to Cognition (`app.devin.ai` and `api.devin.ai`). Sign in opens
Devin's sign-in page on `app.devin.ai` in your browser. The CLI keeps its login and session files
in `~/.local/share/devin`, its settings in `~/.config/devin`, and its plans in `~/.devin`, or in the
XDG folders that you set. OpenBot does not read, copy, or upload these files; it reads only the
change time of `credentials.toml`, to see a sign-in. When it starts, the CLI reads feature flags and
sends product analytics events to Cognition. OpenBot does not change these settings. Cognition's
terms for Devin apply. Team members see the host's Devin agents when their app supports Devin.

### GitHub Copilot

OpenBot downloads the GitHub Copilot CLI from GitHub Releases (`github.com/github/copilot-cli`) when
you select Download on the GitHub Copilot row. OpenBot starts the CLI as a local process. Prompts,
attachments, and tool results go to that process, and the CLI sends them to GitHub
(`api.githubcopilot.com` and `api.github.com`). Sign in opens GitHub's sign-in page on `github.com`
in your browser. The CLI keeps its sign-in in the system keychain, and its settings and session
files in `~/.copilot`, or in `$COPILOT_HOME`. OpenBot does not read, copy, or upload them. The CLI
uses `COPILOT_GITHUB_TOKEN`, `GH_TOKEN` or `GITHUB_TOKEN` when OpenBot's environment has one; OpenBot
does not log or export these values. The CLI sends its own usage data to GitHub, and OpenBot does not
change that setting. GitHub's terms for Copilot apply. Team members see the host's Copilot agents
when their app supports GitHub Copilot.

### Mistral

OpenBot downloads Mistral Vibe's ACP server from GitHub Releases (`github.com/mistralai/mistral-vibe`)
when you select Download on the Mistral row. OpenBot starts it as a local process. Prompts,
attachments, and tool results go to that process, and Vibe sends them to Mistral
(`api.mistral.ai`). Vibe also asks Mistral for its model list, your account details, and the
settings that your Mistral organization manages (`console.mistral.ai` and `chat.mistral.ai`). Sign in
opens Mistral's sign-in page in your browser, and Vibe asks Mistral until the sign-in ends. Vibe
keeps the API key of the sign-in in the system keychain, or in `~/.vibe/.env`, and its settings, logs
and session files in `~/.vibe`, or in `$VIBE_HOME`. OpenBot does not read, copy, or upload them. Vibe
uses `MISTRAL_API_KEY` when OpenBot's environment has it; OpenBot does not log or export this value.
OpenBot starts Vibe with its telemetry off (`VIBE_ENABLE_TELEMETRY=false`), so it sends no usage
events, traces or experiment requests, unless your Mistral organization's managed settings turn
telemetry on. OpenBot also turns on Vibe's model catalogue (`VIBE_EXPERIMENTAL_ENABLE_MODEL_CATALOG=true`):
when a session opens, Vibe asks Mistral (`api.mistral.ai`) for the models of your account, with the
same API key, and keeps the list in `model_catalog_cache.json` in `~/.vibe`, or in `$VIBE_HOME`.
Mistral's terms apply. Team members see the host's Mistral agents when their app supports Mistral.

### Hermes

OpenBot does not download Hermes Agent. It starts the `hermes` that you installed, with `hermes acp`,
as a local process. Prompts, attachments, and tool results go to that process, and Hermes sends them
to Nous Portal or to the model provider that you select in Hermes. Sign in runs
`hermes auth add nous`, which opens Nous Portal's sign-in page in your browser. Hermes keeps its
sign-ins, settings, memories, skills and session history in `~/.hermes`, or in `$HERMES_HOME`, and
it can change them during a turn. OpenBot does not read, copy, or upload these files. It reads only
the change time of `auth.json`, `.env` and `config.yaml` in that folder, or in the Hermes profile
that you use, to see that you signed in. Hermes can also use the network
for its own tools and plugins, as you set them up in Hermes. Nous Research's terms apply. Team
members see the host's Hermes agents, as for the other providers, when their app supports Hermes.

### Inception

Inception agents run in the Pi CLI that OpenBot downloads for Pi. On this computer, Sign in on the
Inception row saves an Inception API key. OpenBot encrypts it in its existing provider credential
store, gives it to the local Pi process in its environment, and redacts it from logs. Pi does not
write the key to a file. Prompts, attachments, and tool results go to that process, and Pi sends
them with the key to `api.inceptionlabs.ai`. When OpenBot reads the Mercury model list, Pi does not
contact Inception. Pi keeps its session files in its own folder, as for Pi agents. OpenBot does not
copy or upload these files. Inception's terms apply: <https://www.inceptionlabs.ai/docs/terms-of-use>.
Inception agents stay on this computer: OpenBot does not show them to team members.

### DeepSeek

DeepSeek agents run in the Pi CLI that OpenBot downloads for Pi. On this computer, Connect on the
DeepSeek row saves a DeepSeek API key. OpenBot encrypts it in its existing provider credential
store, gives it to the local Pi process in its environment, and redacts it from logs. Pi does not
write the key to a file. Prompts, attachments, and tool results go to that process, and Pi sends
them with this key to `api.deepseek.com`, also when Pi has its own DeepSeek key. When OpenBot reads
the DeepSeek model list, Pi first refreshes its model catalog, as described in
[Pi, Muse, and ACP registry setup](#pi-muse-and-acp-registry-setup). Pi keeps its
session files in its own folder, as for Pi agents. OpenBot does not copy or upload these files.
DeepSeek's terms apply:
<https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html>.
DeepSeek agents stay on this computer: OpenBot does not show them to team members.

### OpenRouter

OpenRouter agents run in the Pi CLI that OpenBot downloads for Pi. On this computer, Connect on the
OpenRouter row saves an OpenRouter API key. OpenBot encrypts it in its existing provider credential
store, gives it to the local Pi process in its environment, and redacts it from logs. Pi does not
write the key to a file. Prompts, attachments, and tool results go to that process, and Pi sends
them with this key to `openrouter.ai`, also when Pi has its own OpenRouter key. OpenRouter sends the
request to the company that serves the selected model, and that company's terms also apply. When
OpenBot reads the OpenRouter model list, Pi first refreshes its model catalog, as described in
[Pi, Muse, and ACP registry setup](#pi-muse-and-acp-registry-setup). It also asks `openrouter.ai`,
with the key, for the models that the key can use. Pi keeps its session files in its own folder, as for Pi agents. OpenBot does not copy or upload these
files. OpenRouter's terms apply: <https://openrouter.ai/terms>. OpenRouter agents stay on this
computer: OpenBot does not show them to team members.

### Local model servers

When Server settings shows the Providers section of this computer, and once on the onboarding
provider step, OpenBot looks
for model servers on this computer. It sends `GET <address>/models` to
`http://127.0.0.1:11434/v1` (Ollama), `http://127.0.0.1:1234/v1` (LM Studio), and each address you
add under Local detection. These requests
contain no key, header, conversation or file data, and OpenBot does not follow a redirect. A found
server is only listed; OpenBot saves nothing until you select Add.

When you add or edit an endpoint, Load models sends the key and headers you typed to that address.
For a saved endpoint, OpenBot sends the stored key and headers only to the same origin as the saved
address. For each saved endpoint that OpenCode runs, with an address that ends in `/v1` and a model
with no saved efforts, OpenBot asks that origin if it is an Ollama server: `GET <origin>/api/version`
when OpenBot starts and when you save an endpoint. At a start, it asks again at most 3 times in the
first 90 seconds while the server does not answer. When the server is Ollama, OpenBot sends
`POST <origin>/api/show` with the model ID for each such model, to learn if the model can reason.
These requests contain the stored key and headers and no conversation or file data. OpenBot does not
follow a redirect and does not save the answers. Local detection can be turned off in Settings. Its switch, addresses, folders and hidden
rows are in `openbot-provider-detection-v1.json` in the app profile.

### Provider variables

An owner or admin can give Claude, Codex and Gemini environment variables on each provider page in
Server settings → Providers. When the variables name another address, such as a proxy like
CLIProxyAPI, the model requests of that provider, with the conversation, attachments and tool results
that they carry, go to that address and not to Anthropic, OpenAI or Google. What that address sends
on is its own choice. Names and plain values are in `openbot-provider-environment-v1.json` in the app
profile. A value marked sensitive is in the encrypted provider key file, goes only to that provider's
processes, and is not in a screen, log, export, or diagnostics report. The commands that agents run
can read the variables.

### Custom agents

A custom agent is an ACP program that you name. OpenBot starts it as a local process, and prompts, attachments, and tool results go to that process. What the program sends
to the network is its own choice. Check agent starts it once in an empty temporary folder, sends
`initialize`, opens one session with no MCP servers to read the agent's models, and stops it.
To find agents, OpenBot looks up the names of known agents on your `PATH` and in the folders you
add under Local detection. It does not start a file that it finds.

The command, arguments, and environment names are in `custom-agents.json` in the app profile. The
environment values are encrypted with the operating system's secret storage, go only to that
process, and are not in a screen, log, data export, or diagnostics report; the data export lists
them under `scope.excludes`. Custom agents stay on this computer: OpenBot does not show them to
team members.

## Shared desktop channels

Channel names, purposes, participating agents, linked conversation references, messages, tasks,
assignment records, history summaries, and human read positions are stored in the host's SQLite
database. All authenticated members of that server can read and use its channels. Agent membership
selects participating agents; it is not a separate human access boundary.

The selected lead's provider receives relevant channel content for routing and history summaries in
separate sessions without work tools. Assigned agents receive the channel purpose, responsibilities,
request, relevant source messages, shared history summary, recent messages, and attachment references.
Agents can retrieve earlier channel messages and other conversations on that server when needed.
Unrelated conversations are not sent automatically. Provider session internals remain internal.
The provider's own data policies apply to content it receives.

Archiving a channel stops its work and retains its transcript. Restore makes the channel available again.
These actions do not remove agents, their memories, or linked conversations. Channel traffic between
clients and a host goes through the central server in transit, encrypted from end to end. The central
server cannot read channel chats, does not store them and does not make routing decisions. This feature adds no mobile chat interface.

## Mobile queue drafts

A phone stores the text and attachment references of an active queue edit in its secure local
storage, and keeps a copy of each file the edit adds in its own application storage, so it can
recover the edit after navigation or restart. These copies stay on the phone and are removed when
the edit is saved or cancelled. The host keeps the original message and a persistent edit hold
until the edit is saved, cancelled, or the message is deleted.

The desktop editor also keeps its active queue edit, attachment references, and edit identity in
local application storage. This lets it recover the held draft after restart. Neither client
releases the host hold merely because the editor closes or disconnects. The host also preserves
attachment drafts released by edit cancellation or message deletion until they are sent or
discarded. This lets a disconnected desktop recover its saved composer backup after host restart.

## Phone background refresh

While the phone has an identity, the app reads your servers in the background, so it shows current
agents, chats and channels when you open it. iOS starts this refresh through Background App Refresh,
and Android through its job scheduler, at most once every 15 minutes. The system decides when it
runs, and it can run it less often or not at all. The app refreshes only while it is still in the
memory of the phone.

A refresh uses the same encrypted host connection and the same requests as the app on screen, for at
most 25 seconds. It sends no new data to the hosts, the central server, Apple or Google. The phone
keeps what it reads in the same encrypted copy that it keeps for an offline start. During a refresh,
the app does not mark a chat as read.

On iPhone, Settings > General > Background App Refresh turns this off. Removing the identity stops it on both
phones.

## Optional macOS Host Manager

An administrator can install a local Host Manager for several native macOS users. It reads only
registered UIDs, process IDs, application versions, restart readiness, timestamps, and health
booleans through separate local status directories. It does not read or back up tenant homes,
workspaces, databases, provider directories, browser data, or conversations. It does not
download releases and sends no tenant status or tenant content to any server.

The separate, optional administrator account-setup command creates new local Standard users and
empty private homes. It saves generated login passwords in a root-only file under
`/private/var/root` for the administrator to retrieve. It does not transmit those credentials or
include them in logs. The installed administrator CLI shows each password once on the controlling terminal after setup,
then removes the recovery file. A failed setup retains that root-only file for administrator recovery.
The administrator controls secure password delivery. Host verification reads home metadata only
and tests cross-user access using harmless temporary files outside tenant homes.

## Secure browser authentication

Passwords, email/SMS codes, and authenticator codes entered in a secure chat card are sent to the
shown HTTPS site for one submission. Connected desktop, mobile and browser clients send the value through
the authenticated Team API to the computer running the browser. The handoff does not add the value
to chat, provider tool arguments, diagnostics, or a credential store. Input and submission
values are held in memory for the operation; cancellation and submission clear the input.

OpenBot blocks agent browser access while consent is pending. Before entering a submitted value, it
blocks image capture and live browser streams, and stops
and discards the active browser recording before entry. After entry, protection stays until the
browser replaces the document. After a same-page submission, OpenBot clears the filled fields and,
when the value no longer appears in the page title, address, text, field values, or attributes, keeps
the page, so a later login step on the same page stays available. Page code can still hold the
value, so page evaluation and recording stay blocked in that tab and its connected popup or opener
tabs until the page navigates. Otherwise OpenBot loads the current URL as a new
document with a GET request instead. Failed submission or reload requires manual takeover. Recording does not restart
automatically, and the tab's back/forward history is cleared after replacement to prevent restoring
the sensitive document. The destination site receives the value and controls its own processing.
This protection does not isolate credentials from the operating system or agents with unrestricted
machine access. Values pasted into ordinary chat are not covered by secure handoff.

## Pi, Muse, and ACP registry setup

Pi and Muse run on the host selected for the agent. They receive the conversation input, attached
images, tool definitions, and enabled MCP server configuration needed for a turn. Provider account
files remain under each provider's control. An explicit Meta API key is encrypted in OpenBot's
existing provider credential store. Log in with code for Muse starts a local Muse process, with no
shell, no file writes and no Meta API key, that asks Meta for a code. You confirm the code on Meta's
page, and Muse keeps the account in its own files. Settings responses and settings-change events contain no
provider credentials; the event carries only the agent ID.

ACP registry search fetches the catalog from `cdn.agentclientprotocol.com`; search text is matched
on the host. Installation downloads the selected distribution from its published source. Pi update
checks use `api.github.com`. When OpenBot reads the model list of Pi, DeepSeek or OpenRouter, it runs
`pi update --models`. Pi then gets the current model list of each provider that has a key from
`pi.dev`. This request contains no key and no conversation data. Pi saves the lists in
`models-store.json` in its own folder. Muse update checks use `api.meta.ai`, and manifests and binaries come
from `lookaside.facebook.com`. Download requests reveal the host IP address and requested artifact.
Registry install records remain on the host, separate from conversations and credentials.

An authorized remote administrator can install, update, cancel, or remove a registry runtime on
the host through the encrypted Team connection. Removal does not delete agent configuration,
credentials, or conversations. The existing cloud service does not store those files.
