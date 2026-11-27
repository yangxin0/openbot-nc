# Merging upstream OpenBot into OpenBot-NC

OpenBot-NC is a fork of OpenBot (`nightly-labs/openbot`). Upstream keeps improving agents, providers,
workflows and the interface. Use this guide to decide, for each upstream commit, whether to take it,
adapt it or skip it, and to keep the fork's rules after each merge.

## Sync state

Update this section after each merge.

| | |
| --- | --- |
| Upstream remote and branch | `openbot` → `nightly-labs/openbot`, branch `main` |
| Fork remote and branch | `origin` → `yangxin0/openbot-nc`, branch `main` |
| Fork base | `61645b885` (2026-11-25) |
| Last upstream commit reviewed | `61645b885` (no upstream commit merged yet) |
| Backlog (2026-11-27) | 191 commits up to `100c60e89`: about 144 take, 46 adapt, 1 skip (sorted by the paths they touch) |

## Procedure

1. Get the new upstream commits. Only the developer starts this step:

   ```sh
   git fetch openbot
   git log --oneline --reverse <last reviewed>..openbot/main
   ```

2. Sort each commit with [Decision rules](#decision-rules). The paths it touches decide most cases:

   ```sh
   git show --stat --format='%h %s' <commit>
   ```

3. Make a branch from `main` and apply the commits that you take or adapt, oldest first:

   ```sh
   git switch -c merge/upstream-<date> main
   git cherry-pick -x <commit>
   ```

   Resolve conflicts with [Conflict rules](#conflict-rules). For an adapted commit, change the code so
   that it fits the fork (see [Area reference](#area-reference)) before you commit.

4. Check the result against [Invariants](#invariants), then run the checks:

   ```sh
   bun run check:vendor-endpoints
   bun run typecheck:node
   bun run typecheck:renderer
   bun run test:relay-hub
   ```

   Add the typecheck and the tests of each area that the merged commits touch.

5. Merge the branch into `main`, then update [Sync state](#sync-state) and [Merge log](#merge-log).

## Decision rules

| Decision | When | What to do |
| --- | --- | --- |
| **Skip** | The commit only touches [removed areas](#removed), or it is an upstream release step (version bump, `CHANGELOG.md`, release notes moved into a tag section) | Do not apply it. Record it in the merge log. |
| **Adapt** | The commit touches a [rebuilt area](#rebuilt) or a [changed area](#changed), or mixes kept and removed paths | Apply only the parts that fit the fork. Rewrite the parts that depend on WebRTC, the account service, paid features or vendor services. Drop the parts in removed paths. |
| **Take** | The commit only touches [kept areas](#kept) | Apply it. Then apply the text rule (product name) and run the checks. |

Upstream fixes and features in removed areas can still be useful as ideas. Rebuild such a feature on
the fork's design only when the developer asks for it.

## Invariants

Every merge must keep these. Do not merge a commit that breaks one; adapt it instead.

- **No vendor service.** No address of the vendor (`openbot.run`, `api.openbot.run`, `openbot.site`,
  `updates.openbot.run`, analytics or status hosts). `bun run check:vendor-endpoints` must pass.
- **Only the central server.** All traffic between devices goes through the central server hub
  (`remote/api/src/relay`). No WebRTC, Signal, TURN, tunnel, session or direct connection between
  devices. No second socket type. See `docs/central-server.md`.
- **End-to-end encryption.** Messages between apps stay encrypted for the recipient
  (`packages/contracts/src/relay-protocol/message-crypto.ts`). The central server must not get
  plaintext.
- **No paid features and no telemetry.** No billing, credits, licenses, seats, plans, paywall,
  referrals, analytics events, failure reports or feedback sent to a vendor.
- **No account service.** No sign-in, account session, invitation, owner transfer or member list from
  a vendor. Members come from the certificates of the central server.
- **Identity of the fork.** Keep `packages/contracts/src/app-identity.ts` (`OpenBot-NC`,
  `app.openbotnc.desktop`, `OpenBot-NC` data folders, `openbot-nc://`), the phone bundle ID
  `app.openbotnc.mobile`, and the Apple team `HRQ4QNY8PW` in the build files.
- **No self-update from the vendor.** Do not add release feeds or update checks that point to the
  vendor repository or servers.
- **Product name in texts.** Text values say `OpenBot-NC` where they name the product (see
  [Text rule](#text-rule)).
- **Repository rules.** Follow `AGENTS.md`: no comments in code, no type assertions to pass a check,
  English texts as i18n keys, end-to-end tests only.

## Conflict rules

- **Modify/delete conflict** (upstream changed a file that the fork deleted): keep it deleted
  (`git rm <path>`). If the change matters, rebuild it in the fork's own code.
- **Release files:** keep the fork's version in `package.json` and `apps/mobile/package.json`. Do not
  take upstream changes to `CHANGELOG.md` or upstream `changelog.d/*.md` files. Write the fork's own
  release note in `changelog.d/<branch>.md` when the merged change is visible to users.
- **IPC and contracts:** do not bring back removed IPC groups, preload methods or contract modules
  (see [Removed](#removed)). When an upstream change adds a field to a removed endpoint, drop it.
- **Team protocol:** keep the capability registry. The host does not serve `owner-transfer-v1`,
  `host-key-rotation-v1`, `browser-egress-v1`, `host-signal-home-v1` or live voice. Skip upstream
  changes that need them.
- **Texts:** take new and changed keys, then apply the [Text rule](#text-rule). Do not take back keys
  that the fork removed.
- **Build and CI:** keep the fork's `electron-builder.yml`, `build/entitlements*.plist`,
  `.github/workflows/ci.yml` and `release.yml` settings (no vendor team, no vendor feeds, relay test
  jobs).

### Text rule

In `packages/i18n/src/messages/*`, replace the product name `OpenBot` with `OpenBot-NC` in text
values, not in keys. Keep these as they are: the vault and folder name "Shared with OpenBot", the bot
display names in Slack and Discord texts, file names, paths, commands and identifiers. Fix grammar
after the name where a language needs it (Korean particles, Turkish suffixes, Polish forms).

## Area reference

### Removed

Skip upstream changes here. These paths no longer exist in the fork.

- **Vendor apps:** `apps/auth-api` (account service and public site), `apps/site-router`,
  `apps/mobile-updates`, `apps/status`, `apps/slack-app`, `apps/discord-app`, `apps/telegram-app`.
- **Signal and TURN:** `remote/api/src/*` except `remote/api/src/relay`, `remote/coturn`,
  `remote/nginx`, `remote/acme`, `remote/bin`, `packages/contracts/src/signal-protocol`.
- **WebRTC and remote access through the vendor:** `src/main/team-webrtc-*`, `src/main/remote-desktop-*`,
  `src/main/remote-screen-gateway.ts`, `src/main/sunshine-moonlight-runtime.ts`,
  `src/main/browser-egress-*`, `src/main/host-signal-home.ts`, `src/main/remote-session-cache.ts`,
  `src/preload/team-webrtc.ts`, `src/renderer/team-webrtc.html`,
  `src/renderer/src/features/remote-desktop`, `packages/team-client/src/{ed25519,ice-diagnostics,remote-path-check,remote-account-refresh}.ts`,
  `vendor/remote-desktop`.
- **Account service clients:** `src/main/central-auth-*`, `src/main/account-service-*`,
  `src/main/mobile-connect-host.ts`, `src/main/remote-server-host-directory.ts`,
  `src/main/ipc/account-handlers.ts`, `src/renderer/src/preview/mock-auth.ts`.
- **Paid features:** `src/main/{billing,credits,license,referral}-service.ts`,
  `src/main/hosted-server-*`, `src/main/credit-media-gateway.ts`, their IPC handlers,
  `src/backend/workflows/credit-media.ts`, `packages/contracts/src/{billing-details,credit-media,promotion-code,referral}.ts`,
  `packages/ui/src/features/referral`.
- **Marketplaces and sharing:** `src/main/agent-marketplace-service.ts`,
  `src/main/agent-template-service.ts`, `src/main/hosted-site-*`, `src/backend/agent/hosted-site-*`,
  `src/renderer/src/features/agent-templates`, `marketplace/production-catalog`,
  `resources/managed-skills/openbot-site-hosting`.
- **Chat apps through the vendor:** `src/backend/messaging/{slack,discord,telegram}`,
  `packages/contracts/src/{slack-app,discord-app,telegram-app,slack-workspace-grant,discord-guild-grant,web-messaging-install}.ts`.
  WhatsApp stays.
- **GitHub App and webhooks:** `src/main/github-*`, `src/main/webhook-*`, `src/main/signal-ingress.ts`,
  `scripts/github-app`.
- **Telemetry and feedback:** `src/main/analytics*`, `src/main/feedback.ts`,
  `src/renderer/src/analytics.ts`, `src/renderer/src/error-reports.ts`,
  `packages/telemetry/src/{transport,queue,install-id,analytics-region,browser,node}.ts`,
  `packages/ui/src/features/{github-star,social-follow}`.
- **Live voice and push:** `src/backend/agent/live-voice.ts`, `src/main/live-voice-choice.ts`,
  `src/main/push-notification*`, `src/main/live-activity-push.ts`,
  `packages/contracts/src/team-protocol/live-voice*.ts`.
- **Phone vendor parts:** `apps/mobile/src/features/{analytics,app-update,links,live-activity,marketplace,push-notifications,rating-ask,remote-desktop,shortcuts}`,
  `apps/mobile/src/features/share/extension`, `apps/mobile/modules/{android-notifications,remote-viewer-proxy,share-extension,shortcuts}`,
  `apps/mobile/plugins/{notification-service,share-extension,shortcuts}`, `apps/mobile/certs`,
  `apps/mobile/assets/sounds`, the routes `hosted-server`, `install-agent`, `marketplace-listing`,
  `remote-desktop*` and `server-marketplace`.
- **Vendor release and hosting:** `nix`, `flake.*`, `docker/umbrel`, `docs/store-assets`, the store,
  over-the-air, Chrome Web Store, status and announcement workflows in `.github/workflows`, the
  paid hosting scripts in `scripts/hosting` (boat, Leaseweb, pool, account server), vendor scripts in
  `scripts` (Stripe, OpenPanel, marketplace, catalog publishing, store releases), and the skills
  `babysit`, `custom-server`, `custom-server-plan`, `openpanel`, `release-extension-safely`,
  `signal-deploy`.

### Rebuilt

These features exist in the fork, but on a different design. Upstream code for them does not apply.
Port the intent of an upstream fix by hand, in the fork's code.

| Feature | Upstream design | Fork design and code |
| --- | --- | --- |
| Connection between devices | WebRTC with Signal and TURN | Central server hub: `remote/api/src/relay`, `packages/contracts/src/relay-protocol/{hub,message-crypto}.ts`, `packages/team-client/src/relay-*.ts` |
| Client to host requests | V2 frames over WebRTC data channels (`remote-peer.ts`), HTTP over WebRTC on the desktop | V2 frames over hub messages: `packages/team-client/src/remote-peer.ts`, `src/main/relay/hub-client.ts`, `src/main/remote-server-manager.ts` |
| Host side | `team-webrtc-host-peer.ts` per WebRTC session | `src/main/team-v2-host-peer.ts` per sender, `src/main/relay/host-relay.ts` |
| Sign-in and members | Account service sign-in, sessions, invitations, member directory | Certificates of the central server, join codes, local profile: `src/main/relay/*`, `src/main/local-profile-store.ts`, `remote/api/src/relay/enrollment.ts` |
| Phone connection | Account sign-in, Mobile Connect pairing, WebRTC bridge | Identity in the keychain, hub client: `apps/mobile/src/features/identity`, `apps/mobile/src/features/workspace/components/remote-team-transport.tsx` |
| Web client | Account sign-in, WebRTC | Identity in the browser, hub client: `src/renderer/src/features/web-client` |
| Browser extension | Account sign-in, WebRTC | Identity in the extension, hub client: `apps/browser-extension/src/{App.tsx,host-connection.ts,extension-identity.ts}` |
| Updates | Self-update from vendor feeds, phone over-the-air updates | No self-update; releases from your own build |

### Changed

Upstream changes here usually apply, but these files carry fork edits. Expect conflicts, and keep the
fork's version of the edited parts.

- **Desktop main:** `src/main/application-services.ts`, `src/main/index.ts`, `src/main/host-service.ts`
  (relay hosting, local profile, no account), `src/main/team-store.ts` (certificate sign-in),
  `src/main/team-api-server.ts` and `src/main/team-api/*` (no account and no removed routes),
  `src/main/local-servers/*`, `src/main/ipc/*` (removed groups, new `relay` and `profile` groups),
  `src/main/content-security-policy.ts` (no vendor origins), `src/main/main-window.ts`.
- **Contracts and preload:** `packages/contracts/src/ipc-endpoints.ts` and `ipc-*.ts` (removed
  endpoints; new relay and profile endpoints), `packages/contracts/src/app-identity.ts`,
  `packages/contracts/src/team-protocol/current.ts` (capability `relay-v2-tunnels-v1` and served
  set), `src/preload/*` (removed decoders, relay decoders).
- **Backend:** `src/backend/agent/openbot-tool-router.ts` (no marketplace, hosted site, feedback or
  webhook tools), `src/backend/messaging/messaging-service.ts` (WhatsApp only), workflows (no credit
  models, webhook or GitHub triggers), `src/main/skill-marketplace-service.ts` (local and GitHub
  skills only).
- **Interface:** `src/renderer/src` settings, sidebar, onboarding and `WorkspaceOverlays.tsx` (no
  account, billing, marketplace agents, Mobile Connect or invitations), `packages/ui` (no billing,
  credits or marketplace agents; `SettingsTeamTab.tsx`, `RelayJoinCode.tsx` added),
  `packages/ui/src/features/conversation/styles/side-panel.css` (the side panel padding rule moved
  here from the removed remote desktop styles).
- **Texts:** `packages/i18n/src/messages/*` (product name, removed keys, new relay keys),
  `packages/i18n/untranslated.json`.
- **Phone:** `apps/mobile/app.json` (name, bundle ID, Apple team, no updates or push),
  `apps/mobile/src/features/workspace/*`, `apps/mobile/src/features/servers/*` (members over the host
  Team API), `apps/mobile/src/features/settings/*`.
- **Build and CI:** `package.json` (scripts, repository fields), `electron-builder.yml`,
  `build/entitlements.mac.plist`, `build/entitlements.mac.development.plist`,
  `.github/workflows/ci.yml` (relay jobs), `.github/workflows/release.yml` (no vendor team or feeds),
  `scripts/check-vendor-endpoints.ts`, `scripts/hosting/*` (self-hosted server only).
- **Documents:** `README.md`, `PRIVACY.md`, `CONTRIBUTING.md`, `AGENTS.md` and the other
  `AGENTS.md` files, `docs/*`.

### Kept

Upstream changes here apply. Most upstream work lands here: agent runtimes and providers
(`src/backend/agent`, except the files listed above), conversations and chat views, workflows (engine
and steps other than the removed triggers and credit models), WhatsApp, local browser automation,
computer use, voice transcription and speech on this computer, skills, the database and its
migrations (`src/backend`), and new interface texts.

## Merge log

| Date | Upstream range | Taken | Adapted | Skipped | Notes |
| --- | --- | --- | --- | --- | --- |
| | | | | | |

## History of the fork's own changes

The fork's own commits are `git log 61645b885..main`. The user-visible changes are in
`changelog.d/fork-central-relay.md` and `apps/mobile/changelog.d/fork-central-relay.md`. The design
of the central server is in `docs/central-server.md`.
