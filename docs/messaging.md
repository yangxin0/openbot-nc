# Messaging connections

The agents of this computer can answer in WhatsApp. The design notes are in
[architecture/channels-and-messaging.md](architecture/channels-and-messaging.md#messaging-connections).
OpenBot-NC has no Slack, Discord or Telegram app: these apps connected through the OpenBot service.
Old chats from these apps stay readable.

## Connect WhatsApp

A WhatsApp number links to this computer as a device, as WhatsApp Web does. The messages go directly
between this computer and WhatsApp: no OpenBot service and no OpenBot account takes part. OpenBot uses
an unofficial client, and WhatsApp can restrict or block a number that it sees as automated. A number
used only by OpenBot is safer than your personal one.

1. Open **Marketplace → Apps → WhatsApp** and select **Link WhatsApp**.
2. Select whose number it is:
   - **My personal number**: only your own "Message yourself" chat, and the contacts and groups you
     allow, reach the agents. OpenBot never writes to anyone else first.
   - **A number only for OpenBot**: a person you did not allow gets one message with a 6-character
     code, and the request shows in OpenBot. Select **Approve** to allow the person.
3. Select **QR code** and scan it in WhatsApp → **Linked devices** → **Link a device**, or select
   **Pairing code**, type the number of the phone, and type the code that OpenBot shows on the phone.
4. Pick the model of the WhatsApp Orchestrator and select **Add agent**. One orchestrator answers every
   linked number. It goes in the **Integrations** section of the sidebar. OpenBot posts a 👋 welcome in
   the number's own "Message yourself" chat, so the chat shows at the top of WhatsApp.
5. Under **Who can write**, add contacts by phone number, and groups from the list of the number's
   groups.

**Disconnect** logs the device out, deletes its keys on this computer, and keeps the conversations,
the workspace memories and the allowed senders, so the same number linked again gets them back. When
OpenBot was off, also remove the device in WhatsApp → **Linked devices**. When it is the last number,
the WhatsApp Orchestrator is deleted with its conversations.

## What happens in WhatsApp

- A direct chat is one conversation. In a group, a mention of the number starts a conversation, and
  a reply to a message of it continues it without a mention. Other messages of the group start nothing.
- 👀 on your message means it arrived. "Working on it…" is replaced by the answer within 15 minutes;
  later, the answer is a new message. ✅ (done), ❌ (failed) or 🫡 (stopped) on your message shows the end.
- An answer or a post that mentions a person as `@<user ID>` (the phone number) pings that person. An
  edit pings nobody, so an answer with a mention is a new message, and "Working on it…" is deleted.
- Personal WhatsApp has no buttons. An approval ends with "Reply 1 to approve or 2 to deny." Only the
  person who wrote the request can answer it. `stop` stops the request.
- Short messages that one person sends within 1.5 seconds become one request.
- Files up to 64 MB go both ways. A voice message arrives as an audio file.
- A message that arrives while OpenBot is off waits on WhatsApp's servers and arrives when the number
  connects again. OpenBot answers messages up to one day old.

## Workspace memories

Each WhatsApp number has its own list of facts. The agent that answers saves a fact with
`openbot.messaging_remember` and deletes one with `openbot.messaging_forget_memory`. Every prompt of
every conversation of that number shows the whole list, with the ID of each fact. The prompt marks
the facts as data, not instructions.

- A number keeps at most 32 facts of 500 characters each.
- The agent's own memories (`openbot.remember`) stay separate. They are private to the OpenBot user.
- A disconnect keeps the facts. When you link the same number again, the agent sees them again.
- OpenBot has no screen for these facts yet. Ask the agent in WhatsApp to forget a fact.

`openbot.messaging_history` reads the newest messages of the conversation's own chat: 30 by default,
100 at most. With `connection` and `place` from `openbot.messaging_list_places`, it reads that place
in the user's own chat or in a routine, for example a routine that summarizes a chat each morning. It
reads only a place that the list shows. A turn that answers an external chat, or a teammate's turn on
a request from it, cannot read a different place: a person there is not the OpenBot user. WhatsApp
keeps the messages of the allowed chats for 90 days, also after a restart and also those that do not
mention the number. It downloads their files when they arrive, and the agent gets the path of each
copy. The copies of one number use at most 2 GB: the oldest go first, and their messages keep only
the file names. A message that its author deletes for everyone goes, and a changed message keeps the
new text. `query` keeps the messages whose text or author has each of its words, and `before` (an
ISO time) reads earlier messages.

## Posts that an agent sends

Any agent can post to a linked chat on its own initiative, in any turn: in the user's own chat, in a
routine run, or in a turn that answers a WhatsApp message.

- `openbot.messaging_list_places` with no arguments lists the enabled connections and their IDs.
  With `connection`, it lists the places that OpenBot can post in.
- `openbot.messaging_post` posts markdown as OpenBot to `place`. The text is redacted before it
  leaves this computer. The result has `messageId`, the ID of the first post.
- A long text goes in more than one post. When a later part fails, the earlier parts stay posted.
- A routine posts only when its run calls the tool. The scheduler does not post the run's answer.
- There is no list of allowed chats and no approval. Anyone who can give the agents work can ask
  them to post in any place that OpenBot can see.

## Limits

- The host must run.
- WhatsApp is an unofficial client. WhatsApp can restrict or block a number that it sees as automated,
  and a protocol change of WhatsApp can stop the connection until OpenBot updates. Use a number only
  for OpenBot when you can.
- WhatsApp removes a linked device after about 14 days without a connection. Link the number again.
- WhatsApp gives a new linked device no history, so the agent sees only what this computer saw after
  the link, for 90 days. Disconnect deletes the saved messages and their files. A message older than one day gets no answer.
- WhatsApp has one session per linked device. A second OpenBot profile that opens the same store
  stops with "locked"; link it as its own device.
- An owner or admin of a joined server links and manages the host's numbers from their own computer
  or the browser client (`whatsapp-connector-v1`). The host's session gets the QR code or the pairing
  code, and the client shows it. The phone app shows no WhatsApp page.

## Adding a platform

A platform is one `MessagingDriver` (`src/backend/messaging/messaging-types.ts`) and nothing in the
core changes:

- `createAdapter` implements `MessagingAdapter`: post, edit, react, upload, download, history,
  recent (for the history tool), author and place names, and mentions.
- `createTransport` implements `MessagingTransport` and turns the platform's events into
  `InboundMessage` and `InboundAction` values. It must not need a public address on the host.
  `InboundMessage.mentionedUserIds` lists the users that the text mentions as `@<id>`, so the core
  can name them.
- `requiredCredential` names the stored value without which a connection does not start.

| Platform | Transport | Conversation key | Notes |
| --- | --- | --- | --- |
| WhatsApp | A linked device: this computer's own socket to WhatsApp (vendored Baileys, `packages/whatsapp`) | `dm` in a direct chat; in a group, the id of the message that mentioned the number | Implemented. No history: the host saves what it saw for 90 days (`projection_messaging_history`). Sender rules in `whatsapp-senders.ts`. |

Then add the platform to `MESSAGING_PLATFORMS`, a page in Marketplace → Apps, and its i18n
keys. The database needs no migration: `platform` has no `CHECK`.
