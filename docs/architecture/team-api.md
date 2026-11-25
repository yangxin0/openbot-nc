# Team API compatibility

## Team API compatibility boundary

All remote connections go through the central relay server (see
[central server](../central-server.md)). There is no WebRTC and no Signal service.

- The desktop client sends HTTP and the events WebSocket over relay tunnels: each request uses a
  relay stream to the host, and the host gives each accepted stream to its HTTP server in the
  process (`server.emit("connection", stream)`), so each request knows the verified peer.
  `POST /v1/auth/relay` (no body) gives a session for the certificate user of the socket.
- The web client, the browser extension and the phone app speak Team protocol V2 over relay tunnels
  (`createRelayTeamPeer`, `packages/team-client/src/relay-v2-tunnels.ts`). The host side is
  `src/main/relay-v2-tunnel-host.ts` and `src/main/team-v2-host-peer.ts`. The frames keep the V2
  framing and its limits.
- A member is keyed on the certificate user (`CN`); the device (`OU`) and the key do not matter. The
  user of the host is the owner, and each other user of the team is a member. The owner changes roles
  in Server Settings > Members.
- A client also checks the certificate of the peer against its own team authority and root.


Mobile chat loads the latest 50 messages through `conversation-page` and loads older pages by cursor.
Its Legend List (`KeyboardAwareLegendList` from `@legendapp/list/keyboard`) renders only the rows near
the viewport, gets every loaded message, and retains the visible position when older pages are added.
A row renders again only when its message changes; other row state comes from a React context.
Reply references travel with each page. A page with no overlap replaces the cached window so a
reconnect cannot leave an invisible gap. Older-page responses do not advance the live revision.
The in-memory conversation store notifies subscribers per agent and combines streamed text once
per animation frame. Windows above 50 messages are released when their last subscriber leaves;
the complete history remains in the host database. Connection recovery prioritizes observed chats.
Mobile chat keeps viewport and composer measurements in its motion controller. The last user
message is the list's `anchoredEndSpace` anchor: the list adds a blank-space inset under it, and
streamed replies consume that inset without autoscrolling. Initial history positioning and the
first-send/first-response animation are separate states. Pending message bubbles reconcile through
the host receipt ID, not message text.
Mobile replies use the existing `replyToMessageId` field and retain their source after delivery.
Agent bubbles support swipe-to-reply and a long-press action sheet with haptic feedback. The
sheet has one nested native stack for actions and text selection; message text stays in memory,
outside route parameters. Failed sends restore the reply target, and the composer can cancel it.
Selected mobile attachments use the existing Team V2 file frames followed by the attachment upload endpoint;
the native/DOM bridge limits each file to 10 MB and cancels transfers when its connection is replaced.
The optional `conversation-unread` capability adds a separate `POST /v1/agents/:id/conversation/unread`
operation. Ordinary read acknowledgements remain monotonic; explicit unread resets persist in the
host's SQLite and emit the same invalidation. Older hosts disable only this optional action.
That route marks the whole chat. The optional `conversation-unread-from-v1` capability (protocol 9
only, `packages/contracts/src/team-protocol/conversation-unread-from-v1.ts`, host route
`src/main/team-api/route-conversation-unread-from.ts`) adds `POST /v1/conversations/unread-from` with
`{ agentId, fromMessageId }`: the member's read mark moves to the message shown before it, and the
answer is the new read state. It needs `view` on the agent, as the other read routes do. A message
the chat does not show is not found. The phone's message sheet and the desktop message menu on a
joined server use it for Mark unread. After it, the open chat does not read itself again until it
opens again. The chat shows a NEW line above the first unread message. The line keeps the message
that the host had as first unread when the chat opened, because the open chat then reads itself.

Protocol v1 remains frozen for compatibility fixtures, but its public HTTP, WebSocket, and Cloudflare
Tunnel transport is retired. The old public endpoints return `host_update_required`.

The desktop client starts each remote connection with `GET /v1/compatibility`. The response contains the host application version, the minimum and maximum Team API protocol versions, and host capabilities. The client selects the highest protocol in the shared range. Application SemVer does not select or reject a protocol.

The first released Team API protocol is `1`. All later HTTP requests include `OpenBot-Protocol-Version` and `OpenBot-App-Version`. The event socket uses the `openbot-team-v1` WebSocket subprotocol. A host without the compatibility endpoint is treated as an old host and is blocked. A request without the required protocol headers is treated as an old client and is blocked.

Each protocol has a frozen codec and adapter in `packages/contracts/src/team-protocol`. The v1 HTTP codec owns the fixed route registry and validates JSON requests and responses before the adapter converts current values. Uploads, downloads, and other binary routes use the same negotiated headers and error envelope. The host does not write current service or IPC values directly to the network. Breaking or semantic changes add a new protocol directory and registry entry. A released adapter keeps its original meaning.

From protocol 8, provider ids and auth kinds are open values. A new provider is a new value, not a
new protocol. A client keeps an agent of a provider that it does not know, and shows it disabled
with an update prompt. See [Providers](providers.md) for the frozen lists that hide new providers
from peers below 8.

Protocol 9 is the protocol 8 wire with capability lists of up to 256 names (`v9.ts`). Protocols 7
and 8 read at most 128 capabilities, and their lists are full. A capability with `since: 9` in
`TEAM_CAPABILITY_REGISTRY` (`current.ts`) is in `TEAM_PROTOCOL_V9_ONLY_CAPABILITIES`: a host leaves
it out of the compatibility list of a peer below 9, and a client sends it only to a host that
negotiated 9. On Team V2, where no protocol header is sent, the marker `long-capability-lists-v1` says
that a peer reads 256. It is in the bootstrap list, so the first compatibility read of a protocol 9
host is already complete.

Protocol 10 is the protocol 9 wire with two capability lists (`v10.ts`). The protocol 9 list is full,
and protocol 10 does not send it again: it is the frozen baseline. A protocol 10 peer sends
`capabilities`, with the names after protocol 9 and the markers, and `absent`, with the baseline
names that it does not serve. The full set is `(baseline - absent) + capabilities`. Over HTTP the
lists are the `OpenBot-Capabilities` and `OpenBot-Absent-Capabilities` headers; over Team V2 they are
the `capabilities` and `absent` keys of `http.request`, and the marker `capability-baseline-v1` says
that a request has the two lists. `capabilities` also keeps `long-capability-lists-v1`, so a host of
protocol 9 reads a protocol 10 request as protocol 9. A host ignores an unknown name in `absent`
and refuses a malformed list with `protocol_error`. `/v1/compatibility` answers above the protocol
gate, so a client can always read the update instruction. A protocol 10 compatibility answer has the
two lists, and a client expands it (`decodeTeamProtocolSupportExpanded`). The desktop client and the
web client speak 10. The mobile workspace speaks 10 too, for `server-safe-mode-v1`, and keeps 9 for
a host of protocols 1-9. The mobile share extension stays on 9. The
`agent-event-scope` message has no length limit and always sends the full list.

All Team V2 frames of protocols 1 to 10 use one framing (`webrtc-framing.ts`, a released file name;
`v2.ts` only re-exports it). The bodyless request frame of protocols 4 to 10 (a
GET, a DELETE, the routine test POST and the remote viewer routes) is in
`webrtc-bodyless-requests.ts`. Both are current code: deleting an old protocol does not delete them.
`scripts/team-webrtc-wire-parity-e2e.ts --before=<ref>` compares their bytes with a base commit. On
Team V2, the host reads the protocol of an `http.request` from the capability markers. A request
with no marker comes from a release before v0.7.0, and the host refuses it with status 426 and
`client_update_required`, as the HTTP gate refuses a request with no protocol header.

### Server safe mode

A server that stopped its start loop (see [start loop](../self-hosted-server.md#start-loop)) keeps a
minimal Team API up: `src/main/server-safe-mode.ts`, with the routes in
`src/main/team-api/server-safe-mode-api.ts`. It opens no `openbot.db` and starts no service. It reads
the team file without a write, so a client of this computer signs in with its session. Team members cannot reach the safe mode
yet: it serves this computer only, until the central server carries it. It answers:

- `/v1/compatibility`, above the gate: protocol 10 only. A client of protocols 1-9 reads that it must
  update. A protocol 10 client reads the optional capability `server-safe-mode-v1` and no other.
- `GET /v1/server/safe-mode`, for each signed-in member of any role: the reason word
  (`newer_database` or `start_failed`), the app version and the time. No path, no error text, no
  secret.
- Each other request: 426 `client_update_required` below protocol 10, else 503 `server_safe_mode`.
  The events socket gets 503.

The normal `TeamApiServer` never serves `server-safe-mode-v1`. A client that reads it reads the
reason once and shows it with a translated sentence: the desktop as the `server_safe_mode` issue on
`RemoteCompatibilityScreen`, the web client on its incompatible-host screen, and mobile as the
connection error. There is no action: a newer release fixes it, through the normal update path of
the server. `scripts/server-safe-mode-e2e.ts` checks the routes, the roles, the
refusal of protocols 1-9 and that no file of the profile changes.

Capabilities describe additive behavior. The client sends its capability list when it sets the event scope. The host sends optional events only when the client declared the related capability. A missing capability disables only that feature. An unknown optional event is ignored. A malformed known event closes the connection as `protocol_error` because the client cannot safely apply it.

The optional `agent-memories-v1` capability adds three POST routes. `/v1/agent-memories/page`
returns up to 256 memories. `/v1/agent-memories/selection` returns up to 256 selection records,
the agent ID, and essential-memory byte usage. Both use ascending memory IDs and an `after`
cursor (`null` for the first page). Clients validate owner and cursor order. Edits do not move IDs
between pages. Reads across several pages are not an atomic snapshot; the next refresh sees
concurrent changes. `/v1/agent-memories/inclusion` changes up to 25 selections with expected
revisions and returns an empty acknowledgement; the client then reads selection pages again.
Each route requires authentication and a visible agent. Selection writes use the same member
access as existing memory writes. User choices override automatic selection.

The released full-list GET route, memory shapes, and 2 MiB frame limit stay unchanged. The
memory routes leave out the `site` of a memory (see [browser](browser.md)). A new
client connected to an older host keeps text editing and hides selection controls. An older
client can edit text on a new host without changing inclusion. Storage choices remain 64, 128,
256, and 512. Lowering the setting never deletes existing entries.

Only essential memories enter startup instructions, in a block limited to 8,192 UTF-8 bytes.
Claude gets that block with a user turn instead: the full block in the first turn and after a
compaction, and only the change after a memory edit. A memory change then keeps the cached
system prompt and does not restart the Claude query. A profile change still restarts it.
Saved memories stay on the host in SQLite. Agents can use bounded local search and ID-paged
listing to recall other entries. FTS5 uses `unicode61` and BM25. Queries match any literal term.
`unicode61` has no stemming, so a term of 6 or more characters also matches as a prefix of its first
characters, all but the last 3 and at least 4: "closing" also finds "closes". Equal scores use the newest update, then the memory ID. Search returns at most 10 entries,
and maintenance pages return at most 25. Both responses are limited to 8,192 UTF-8 bytes.
The search index stays local. Essential prompt text and requested tool results go to the active
provider through the existing secret-redaction path.

Selection metadata is separate from the released memory shape. Migration 32 preserves memory
text, IDs, and dates, and selects recent manual entries before recent automatic entries. The same
serializer checks the complete prompt block during migration, mutation, and prompt generation.
Automatic text and selection changes stay pending until the turn completes successfully. Commit
checks ownership, revisions, user choices, and capacity again. Agent tools cannot change or delete
a user-controlled selection. The user can release that control without changing its inclusion.

The optional `message-delete-v1` capability (protocol 9 only) adds three POST routes that delete one
message and return an empty acknowledgement: `/v1/messages/delete` (`agentId`, `messageId`),
`/v1/messages/delete-task` (`agentId`, `taskId`, `messageId`) and `/v1/channels/messages/delete`
(`channelId`, `messageId`). The host always advertises it to a protocol 9 peer, because every host
that has the routes can delete. `src/main/team-api/route-message-delete.ts` owns the authorization.
In an agent chat, the agent must be visible to the member (else 404), and the member needs `chat` on
the agent to delete their own messages; `manage` lets them delete any message. In a channel, each
member deletes their own messages, and owners and admins delete any message. A host without channels
answers the channel route with 400 `channelsUnsupported`, as it answers each channel route. A refusal
from the service gets 403 (not the member's message), 404 (no shown message with that ID) or 409 (the
message is in a running turn), with the host's sentence. A delete removes the message from the host's
history, search and attachments; the provider session can still remember it. The host sends its
usual change events (`conversation-invalidated` and `channels-changed`), so other members refresh.

The optional `chat-history-v1` capability (protocol 9 only) adds four POST routes with an empty
acknowledgement: `/v1/agent-history/delete` (`agentId`), `/v1/channels/context/clear`,
`/v1/channels/context/compact` and `/v1/channels/history/delete` (each `channelId`). They do on a
joined server what "Delete history" of an agent chat, and "New conversation", "Compact now" and
"Delete history" of a channel do on this computer. The host always advertises it to a protocol 9
peer. `src/main/team-api/route-chat-history.ts` owns the authorization. An agent history delete needs
a visible agent (else 404) and `manage` on it (else 403). A member who sees a channel starts a new
conversation or compacts it; only owners and admins delete its history (else 403
`membersCannotDeleteChannelHistory`). A host without channels answers the channel routes with 400
`channelsUnsupported`. Work that still runs or waits, an archived channel, or a compaction that no
member session can do, gets 409 with the host's sentence.

The optional `agent-import-v2` capability (protocol 9 only) sends a Grok Bot export of any size in
parts: `/v1/agent-import/v2/open`, `/v1/agent-import/v2/chunk` (raw body, with `upload` and `offset`
in the query) and `/v1/agent-import/v2/stage`. A host that advertises it also serves
`agent-import-v1`, whose `apply` and `discard` routes take the staged token. See
[Agent import from a joined server](servers.md#agent-import-from-a-joined-server).

The optional `agent-welcome-v1` capability (protocol 9 only) changes no route shape. A client that
sends it says that the `initialMessage` of `POST /v1/agents` is a setup message for the new agent. The
host stores that message with `welcome: true` in its mailbox JSON and the item type `agent_welcome`.
No conversation page, live snapshot, read state, search result, queue, runtime `work` item or preview
shows it, for any member. While it waits or runs, the host's local queue snapshot has `welcome: true`, so
the host's own window shows that the agent works and not the empty chat. `GET /v1/agents/:id/queue`
keeps its released keys and does not send the flag: a remote member sees the empty chat until the
welcome turn starts. The agent answers it, and that answer shows as usual. A client sends a setup message only to
a host that advertises the capability; an older host still gets the released role text, which stays
a visible user message there.

The optional `message-pins-v1` capability (protocol 9 only) adds `POST /v1/message-pins/list`
(`agentId`) and `POST /v1/message-pins/set` (`agentId`, `taskId` as a string or `null` for the
agent's own chat, `messageId`, `pinned`). The list holds the pins of all chats of the agent (its own
chat and its side threads, archived ones too), at most 200, the newest pin first. Each pin has its
side thread and title, the first 1,000 characters of its message, and who pinned it: a person (`null`
for the user of the host computer) or the agent. The agent pins with its `pin_message` tool. Both
routes answer the list after the request. A member needs the `chat` level on the agent. A hidden or
unknown agent gets 404, a message that is not in the chat gets 404, and a pin over the limit of 50
for one chat gets 409. All members see the same pins. The host sends `message-pins-changed` with the
agent id after each change, and the client reads the list again. A client opens a pin of another
chat in the tab of that chat, or in the side panel when the thread is open there. When the thread
view does not hold the message, `POST /v1/message-pins/read-thread` (`agentId`, `taskId`,
`messageId`, `limit` 1 to 100) reads one part of the thread around it, oldest first, in the
`agent-tasks-v1` conversation shape, with `hasOlder` and `hasNewer`. A message that the thread does
not hold gives no messages. While the view holds a part with `hasNewer`, it skips live deltas and
read marks, and shows the way to the latest message; a send reads the latest messages first. A host
without the capability gets no part read: the client opens the newest messages. Channels have no
pins. `src/main/team-api/route-message-pins.ts` owns the routes.

The optional `agent-waits-v1` capability (protocol 9 only) adds `POST /v1/agent-waits/list`
(`agentId`) and `POST /v1/agent-waits/cancel` (`agentId`, `waitId`). They show the open waits of an
agent in the composer of a joined server, with Cancel. `src/main/team-api/route-agent-waits.ts` owns
the authorization. A hidden or missing agent gets 404; a cancel needs `chat` on the agent (else 403).
The host cuts each request text to 2,000 characters. A wait that is already closed gets 409 with the
host's sentence. The host sends no event when a wait changes, so a client reads the list again after a
cancel and when a turn of the agent starts or ends.

The optional `pending-approval-v1` capability (protocol 9 only) adds `POST /v1/agent-approvals/read`
(`agentId`, `requestId`). It returns `{ approval }`, the whole copy of one approval that the agent waits
on, as the `approval` event carries it. A runtime snapshot cuts each text of an approval to 240
characters and sets `truncated`, so a client that did not get the event (a phone that connects
later, a desktop after a restart) reads the whole copy here before it offers Allow. Each client keeps
the whole copy when the next snapshot comes (`keepWholeApprovals` in
`packages/team-client/src/runtime-attention.ts`), and shows a cut copy with Deny only.
`src/main/team-api/route-pending-approval.ts` owns the authorization: a hidden or missing agent gets
404, a member needs `chat` on the agent (else 403), and a request that no longer waits, or a request of
another agent, gets 409.

The optional `pending-prompts-v1` capability (protocol 10 only) adds `POST /v1/agent-prompts/list`
(empty body). It returns `{ prompts }`: every question that an agent waits on, oldest first, up to 200
and up to the byte limit of a runtime snapshot (`pendingPromptsWithinLimits`), in the form of a runtime
snapshot entry. A runtime snapshot holds at most 4 questions, approvals and
browser takeovers of all agents together, and sets `attentionComplete: false` when it leaves some out.
A client that gets such a snapshot reads this list. It shows each listed question in its chat, in
place of an older question that the list does not confirm, and keeps the listed questions until a
complete snapshot comes. Without the read, a question that came while the client was away had no card after a restart, a
reload or a reconnect, and the agent waited (#13486). `src/main/team-api/route-pending-prompts.ts`
leaves out the questions of a hidden or missing agent and of an agent that the member cannot see.
The phone draws a question card from the chat messages, so it does not read this list.

The optional `phone-feedback-v1` capability (protocol 9 only) adds
`POST /v1/agent-approvals/send-phone-feedback` (`requestId`, `phone`). `phone` is what only the phone
has: `platform` (`iOS` or `Android`), `appVersion`, `system`, `network` (the kind of connection and
whether a VPN is on, never an address; an older phone also sends the name of the VPN) and `log`, the last redacted lines
of its support log. An agent's bug report with the surface `Phone app` (`openbot.send_feedback`) waits on an
approval whose notice is `status.agent.reportPhoneProblem`. This route answers that approval with
"accept" and gives the phone's data to the report. The agent service refuses a plain "accept" of such
an approval on each path (`POST /v1/respond/approval`, the local IPC), with
`error.backend.feedbackNeedsPhone` and 403, and the approval keeps waiting; a decline works on each
client. So no bug report about the phone app goes out without the phone's version, system and log,
and the account Worker refuses one too (`feedback_needs_phone`), which also stops a host of an older
version. The desktop and web cards of such a report have no Send and tell the user to send it from
the phone app. `src/main/team-api/route-phone-feedback.ts` owns the authorization: `chat` on the
agent of the request (else 403, or 404 for an agent the member cannot see), the owner only (else
403), and 409 for a request that no longer waits or that is not such a report.

The optional `agent-queue-task-v1` capability (protocol 9 only) adds
`POST /v1/agent-tasks/from-queued-message` (`agentId`, `deliveryId`, no other keys). It is "Run as a
new thread" on a message that waits in the queue of the agent's own chat. The host advertises it only
when it has `agent-tasks-v1`, and the answer is the frozen task of an `agent-tasks-v1` start.
`src/main/team-api/route-agent-queue-task.ts` owns the authorization: a visible agent (else 404) and
`chat` on it (else 403). A message that left the queue, or a message of a channel, gets 409 with the
host's sentence. The host then sends `agent-tasks-changed` and the queue change.

The optional `background-processes-v1` capability (protocol 9 only) adds
`POST /v1/admin/background-processes/list` and `POST /v1/admin/background-processes/stop` (`id`).
They show, in Server Settings > Storage, the programs that agents left running on the host, such as a
dev server, with Stop. Only owners and admins can use them (else 403). The host redacts each command
line before it leaves `src/main/background-processes.ts`, cuts it to 500 characters, sends at most
200 programs and 64 ports each, and never sends the environment of a program. `processes` is null on a
Windows host, which cannot find these programs. Stop signals only a program that is in the list at
that time; an unknown id does nothing. This computer shows its own programs in the same place.

The optional `provider-use-v1` capability (protocol 9 only) adds `POST /v1/admin/provider-use/list`
and `POST /v1/admin/provider-use/set` (`provider`, `on`). They are the on/off switch of the host's
built-in providers in Server Settings > Providers. Only owners and admins can use them (else 403). Both
routes answer `off`, the ids of the providers that are off after the call, at most 64. The released
status routes leave out `off`, so a client reads it from this list. The host refuses the custom agent
provider (`acp`) with 400, and a provider that an agent uses or that is busy with 409 and the host's
message. Without the capability a client hides the switch for that host.

The optional `routines-once-v1` capability (protocol 9 only) adds `POST /v1/routines-once/list`
(`owner`), `POST /v1/routines-once/create` (`owner` and the routine, with a `once` schedule) and
`POST /v1/routines-once/update` (`owner`, `id` and the changed fields). `owner` is
`{ kind: "agent" | "channel", id }`. They carry one-time routines (the `once` schedule), which the
frozen routine, channel, event and run-place codecs cannot carry. Those routes still hide and refuse
`once` routines. The list gives only the `once` routines of the owner, so a client adds them to the
released list. The update changes any schedule routine of the owner, so a client with the capability
sends each routine update of an agent or a channel there. An agent routine carries `runIn` on these
routes. Run, test and delete stay on the released routes, which take the id of a `once` routine.
`src/main/team-api/route-routines-once.ts` owns the authorization, which is that of the released
routes: a visible agent (else 404), and `manage` on it for a save (else 403); a channel that the member
sees, on a host with `channel-chats-v1`. An unknown routine or a date that has passed gets 400.
Without the capability the routes answer 400, and a client hides the `once` option for that host.

The optional `routine-run-command-v1` capability (protocol 9 only) adds
`POST /v1/admin/routines/run-command` (`agentId`, `routineId`). It answers `command`, the command that
runs that routine from a script on the host, as Routines > Copy run command gives it on this computer.
Only owners and admins can use it (else 403): the same people who turn on Local scripts for an agent.
A member gets no shell access. The command reads the address and the token of the host's automation
server from their files when it runs, so the token is not in the answer, and the command works only
in a shell on the host. The host refuses an agent without Local scripts and a routine that is gone
with 409 and the host's message. `src/main/team-api/route-routine-run-command.ts` owns it. Without the
capability a client hides Copy run command for that host.

The optional `claude-user-setup-v1` capability (protocol 9 only) adds
`POST /v1/admin/host/claude-user-setup` and `POST /v1/admin/host/claude-user-setup/update`
(`enabled`). They are "Use my Claude Code setup" of the host on the Claude page of Server Settings >
Providers. On, the Claude agents of the server load the Claude Code setup of the host's user
(`~/.claude` and `~/.agents/skills` on the host). Only owners and admins can use them (else 403). The
routes carry only the switch, never a file of that setup. A change applies to the Claude processes
that start after it, and the host sends the provider status event, so open settings pages read it
again. `src/main/team-api/route-claude-user-setup.ts` owns them. Without the capability a client hides
the switch for that host.

The optional `provider-account-models-v1` capability (protocol 9 only) adds
`POST /v1/admin/providers/accounts/models` (empty request). It gives, for each provider, the accounts
after the first that serve models the provider's own sign-in does not, with those models (at most 1,000
for each account; no credential, usage or agent). `provider-accounts-v1` carries no model list, so a
client reads both and puts the models on their account: the model picker of that account then shows
them, as on the host. Only owners and admins can use it (else 403). A client that fails to read it
keeps the accounts without these models. `src/main/team-api/route-provider-accounts.ts` owns it.

The optional `provider-model-source-v1` capability (protocol 9 only) adds
`POST /v1/providers/model-sources` (empty request). It lists, for each provider whose own settings give
its models from another source than the provider's own list, that source: `{ kind: "provider", name }`
for a model provider such as Ollama, or `{ kind: "catalog" }` for a model list file. Today only Codex
reports it, from `model_provider` and `model_catalog_json` in `config/read` (#9956). The path, address
and key of the source stay on the host. Every member reads it: it says no more than the model list. The
released status routes carry no source, so the desktop remote branch and the web client read both and
put the source on its status row. A client that fails to read it shows no source.
`src/main/team-api/route-agents.ts` owns it.

The optional `claude-compact-window-v1` capability (protocol 9 only) adds
`POST /v1/admin/host/claude-compact-window` and `POST /v1/admin/host/claude-compact-window/update`
(`tokens`: a whole number from 100,000 to 1,000,000, or `null` for Claude Code's own size). They are
"Compact chats at" of the host on the Claude page of Server Settings > Providers. Only owners and
admins can use them (else 403); the wire codec refuses a size outside the range with 400. A change
applies to the Claude processes that start after it, and the host sends the provider status event, so
open settings pages read it again. `src/main/team-api/route-claude-compact-window.ts` owns them.
Without the capability a client hides the row for that host.

The optional `provider-environment-v1` capability (protocol 9 only) adds
`POST /v1/admin/host/provider-environment` (`provider`: `claude`, `codex` or `antigravity`) and
`POST /v1/admin/host/provider-environment/update` (`provider`, `variables`: at most 32 of `name`,
`value` or `null`, `sensitive`). The update replaces the whole list; `value: null` keeps a stored
sensitive value. A response has the variables with `stored`, and an empty `value` for a sensitive one.
Only owners and admins can use them (else 403). The host refuses an invalid, reserved or repeated name,
and a kept value that it does not have, with 400 and the reason.
`src/main/team-api/route-provider-environment.ts` owns them. Without the capability a client hides the
Environment section for that host.

The optional `agent-thread-queue-v1` capability (protocol 9 only) adds
`POST /v1/agent-thread-queue/list` (`agentId`) and `POST /v1/agent-thread-queue/reorder` (`agentId`,
`taskId`, `deliveryIds`). The list gives, in full, the waiting messages of each open side thread of
the agent that has one, as the queue panel of a thread shows them on this computer. The released
`agent-tasks-v1` list gives only the start of each message. The reorder route changes the order of
the waiting messages of one thread. Cancel and Send now use the released queue routes of the agent,
by delivery id. A member who can send the agent a message can use them: a visible agent (else 404)
and `chat` on it (else 403). The host sends no preview URL of a file, because it is an address on the
host. A stale order and an order with channel work get 409 and the host's message. A change sends the
released `agent-tasks-changed` event. That event has no full queue, so a client reads the list again
when the waiting messages of a thread change. `src/main/team-api/route-agent-thread-queue.ts` owns
them. Without the capability a client shows the waiting messages of a thread without their actions.

The optional `agent-thread-requests-v1` capability (protocol 9 only) adds
`POST /v1/agent-thread-requests/list` (`agentId`). It gives, for each side thread of the agent that has
one, the requests that the agent sent from that thread to other agents and whose answer has not come
back yet: the message id, the agent it went to, and its state (`queued`, `starting` or `running`). The
thread shows them as "Waiting for replies", as the agent's own chat does. A member who can send the
agent a message can use it: a visible agent (else 404) and `chat` on it (else 403). The released
`agent-tasks-changed` event has no requests, so a client reads the list again when a thread becomes
idle (a turn can have sent a request), when a thread with requests changes its state (an answer or a
note for a failed request starts the thread), and on each event while a request is `queued` (it can
start or be cancelled with no change of the thread's state). `src/main/team-api/route-agent-thread-requests.ts` owns it. Without the
capability a thread shows no requests.

The optional `agent-usage-limit-v1` capability (protocol 9 only) adds `POST /v1/agent-usage-limit/list`
(empty body) and `POST /v1/agent-usage-limit/switch` (`agentId`, `provider`, `model`,
`reasoningEffort`, optional `providerAccountId`). The released `runtime-snapshot` event does not carry
the usage limits. The list gives the agents whose queued message a provider usage limit holds, with the
reset time, and the models and accounts that a usage limit or a provider error holds now. It leaves out
a hidden agent, an agent that the member cannot see, and a model of a provider that the peer's protocol
does not know. The switch route moves the agent to another model and sends the held message there, as
the usage-limit card on the host's computer does. It needs a visible agent (else 404) and `manage` on it
(else 403). A move to a named provider account that is not the agent's account needs an owner or admin
(else 403). A change of a hold sends the released `runtime-snapshot` event, and the client then reads
the list again; the desktop main process adds the list to the snapshot that it forwards.
`src/main/team-api/route-agent-usage-limit.ts` owns them. Without the capability a client does not show
the usage-limit card for that host. Only an owner or admin sees "Next time, switch without asking" on
the card, because the backup models use `agent-backup-models-v1`.

The optional `agent-pending-runtime-v1` capability (protocol 9 only) adds
`POST /v1/agent-pending-runtime/update` (`agentId`, and one or more of `provider`, `model`,
`reasoningEffort` and `providerAccountId`, where `default` is the provider's own sign-in). It changes the
runtime as the pickers on the host's computer do: while the agent works, the host keeps the change as
`pendingRuntime` and applies it before the next turn, where the released `PATCH /v1/agents/:agentId`
refuses a provider change. It needs a visible agent (else 404) and `manage` on it (else 403); another
account needs an owner or admin (else 403), except the new provider's own sign-in on a provider change. For a peer with the
capability, the host also adds `pendingRuntime` to each agent of `GET /v1/agents` and of the
`bots-changed` event, so the "After this turn" badge shows on the client.
`src/main/team-api/route-agent-pending-runtime.ts` owns the route. The desktop with a joined server and
the web client send a runtime change alone on it when the host has the capability; mobile still uses the
released route. Without the capability a provider change during work is refused as before.

The optional `hermes-import-v1` capability (protocol 9 only) adds `POST /v1/hermes-import/read` (empty
body), `POST /v1/hermes-import/apply` (`token`, `profiles` with `key` and `allow`) and
`POST /v1/hermes-import/discard` (`token`). They import the Hermes Agent profiles of the Hermes folder
of the host, as Import > Hermes does on this computer. The host reads only the folder that Hermes uses
on the host: the client cannot name a folder (the wire codec drops a folder field). The read answers the
profiles under a token, or `null` when the host has no Hermes profiles; a new read closes the earlier
one. The answer shows the home folder of the host as `~` and carries no value from `.env` or
`auth.json`. Only owners and admins can use the routes (else 403), because an import adds agents,
skills and MCP servers to the whole server. A stale token gets 409 and the host's message.
`src/main/team-api/route-hermes-import.ts` owns them. Without the capability a client shows no Hermes
source for that host. The folder dialog stays on this computer: it shows the files of this computer,
and the host cannot read them; to import Hermes from this computer to a server, export a `.zip` file.

The optional `provider-detection-v1` capability (protocol 9 only) adds five routes under
`/v1/admin/provider-detection/`: `settings` (empty body), `settings/update` (`enabled`, `addresses`,
`folders`, `hiddenIds`), `scan-model-servers` (empty body), `scan-agents` (empty body) and
`discover-models` (`baseUrl`, `apiKey`, `headers`, optional `savedProviderId`). They find the local
model servers and the ACP agent commands of the host, as Server Settings > Providers does on this
computer. The host makes each request from the host. A scan sends no key. A model list request can
carry a key and headers towards the host; for a saved endpoint, the host uses its stored values only
for the same origin. No answer carries a key or a header value. Only owners and admins can use the
routes (else 403), because a model list request makes the host connect to an address that the client
names, as a custom endpoint does. A refused entry gets 400. The client adds a found row with the
released custom endpoint and custom agent routes, so it shows the rows only when it also manages
those on the host. `src/main/team-api/route-provider-detection.ts` owns them. Without the capability a
client shows no found rows for that host.

The optional `channel-picture-v1` capability (protocol 9 only) adds `icon` and `imageUrl` to the
channel side routes, `icon` to a `save` draft, and `/v1/channels/image?channelId=<id>`:
`GET` with `&v=<version>` answers the image bytes of the current version (else 404), `PUT` with a raw
PNG, JPEG, GIF or WebP body of at most 512 KiB sets the image, and `DELETE` removes it. `PUT` and
`DELETE` answer the channel. Each request needs `channel-chats-v1` and a channel that the member sees
(else 404); owners and admins see all channels. `src/main/team-api/route-channels.ts` owns the route.
The host adds and reads these keys only for a request that advertises the capability, so released
peers see the same `channels-v1` wire. The host's `imageUrl` is an
`openbot-avatar://channel/<id>?v=&type=` URL. The desktop changes it to
`openbot-remote-avatar://<server>/channel/<id>?v=`, the scheme of remote agent avatars, so the CSP does
not change; the main process reads that URL with `GET /v1/channels/image`. The web client reads the
bytes into a data URL. Over Team V2, a `PUT` body and a `GET` answer go as file transfers, as for agent
avatars. Without the capability a client hides the picture control for that host, and the channel
shows its member faces.

The optional `channel-browser-v1` capability (protocol 9 only) adds `browser` to the channel side
routes and to a `save` draft (#4135): `{ kind: "members" }`, `{ kind: "none" }` or
`{ kind: "member", agentId }`. Absent on a draft keeps the stored value; absent on a record is every
member. A present value that a client cannot read reads as `none`. The host adds and reads the key only
for a request that advertises the capability, so released peers see the same `channels-v1` wire, and a
save from such a peer keeps the setting. Without the capability a client hides the Browser select for
that host.

Team API failures use a JSON error envelope with `error` and a stable `code`. Compatibility codes are `client_update_required`, `host_update_required`, and `protocol_error`. Authentication and network failures are projected to `authentication_required` and `network_unavailable` in the desktop connection state. A confirmed compatibility or protocol error stops data-plane requests and automatic reconnect until the user selects `Retry`, restarts, or updates.

Protocol support follows the support window in the root `AGENTS.md`: the releases of the last 60 days. A protocol that no release in the window speaks can be deleted. The PR that deletes it raises the minimum protocol and, when old apps must update, the minimum app version; a CI check refuses a minimum app version that is less than 60 days old. The PR also includes a changelog entry and tests for the old-client/new-host and new-client/old-host directions.
