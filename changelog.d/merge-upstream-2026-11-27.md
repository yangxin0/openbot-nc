### Added

- Sidebar tabs for All, Unread and your folders, and Archive or Delete for a thread from the sidebar.
  You can also hide Marketplace and Help in the narrow bar on the left.
- Live cursors of the other people on a shared workflow canvas, and a toast with Open when an agent
  makes a workflow.
- A page in an agent's browser asks for the location only after you select Allow in the agent's chat.
  On a joined server, Allow sends the location of your own device. You can also answer a site's own
  sign-in prompt in the browser, and a page dialog shows in the live view of a joined server.
- A Spread choice for pooled provider accounts, so the agents of a provider share the accounts
  evenly.
- The agent dock shows the open thread of an agent and lets you change it.
- Small copies of chat images in local chats and on joined servers, so long chats with pictures open
  faster.
- CoinMarketCap in Apps.

### Changed

- Gemini works without Google's internal Code Assist API, finishes a sign-in from the address that
  the browser shows, and moves an agent to its backup model when Google refuses the license.
- A server downloads its own Codex when the installed Codex is incomplete, and a Docker server starts
  again when its main process stops responding.
- Whisper does not send a recording with no speech.
- The database keeps 64 MB in its page cache, indexes thread activities and deletes chat updates that
  a later update replaces, so a busy server does less work and the database stops growing.

### Fixed

- Many fixes for Claude, Codex, Gemini, OpenCode, Pi, Kimi Code, Cursor, Grok and ACP agents: turns
  that stayed open, lost sessions, refused requests, kept models and efforts, and clearer error
  messages.
- MCP servers: a local sign-in uses the `/callback` return address that more sign-in servers accept,
  a server that needs more access asks for a new sign-in, and a missing program shows one alert.
- A joined server file that does not fit in the transfer budget waits for room instead of failing.
- On Windows, fewer main-process stalls, MCP commands in folders with non-English names, and a clear
  message when security software stops the window. When the window cannot start, the start recovery
  shows as a message box.
- On Linux, the agent dock shows in the OpenBot-NC window on niri and without a compositor, and
  typing works again after Computer Use on X11.
- WhatsApp shows when it does not accept an agent's answer, and refuses a post to a contact with no
  account.
