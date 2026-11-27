# OpenBot-NC phone app

React Native app built with Expo SDK 58, Expo Router, TypeScript 7, Biome, and Bun. The app uses Expo
Continuous Native Generation, so native `ios/` and `android/` directories are intentionally not
committed.

The app connects to the servers of a team only through the central server of that team (see
[central server](../../docs/central-server.md#phone-app)). Each phone imports its own identity file by
paste or file pick. The app has no account, no sign-in with an email code, no push notifications, no
over-the-air updates, no analytics and no store release workflow. A new version comes only with a new
build.

## Requirements

- Node.js 24 or newer (the repository pins 24 in `.nvmrc`)
- Bun 1.4.2 (the version in the root `packageManager`)
- Expo Go for device testing

## Development

The repository uses Bun’s hoisted linker so native Expo modules resolve to one installation.
React Native Skia 2.14 needs no install step. CocoaPods copies its prebuilt libraries from the
`react-native-skia-apple-*` packages, and Gradle reads them from `react-native-skia-android`.

EAS profiles pin Bun 1.4.2 to match the root `packageManager`. Use the same Bun version
locally. After switching from the isolated linker to the hoisted linker, move the old
`apps/mobile/node_modules` directory out of the app and run `bun install --frozen-lockfile`
from the repository root. A normal install can retain old workspace symlinks and make the
local build differ from a clean EAS installation.

Expo 58.0.25 is patched in `patches/expo@58.0.25.patch` so a DOM component ignores a props
message that it sends before Android mounts its web view, or after Android removes it. Android
rejects these calls, and the rejection shows as a console error. The DOM component asks for the
props again when it is ready.

expo-splash-screen 58.0.14 is patched in `patches/expo-splash-screen@58.0.14.patch` so Android 12
and 13 get no splash exit animation listener. With the listener, the platform hides the starting
window on the first draw, and the app crashes when that window is already gone. Gradle links the
prebuilt AAR of an Expo module and ignores a patch to its Kotlin source, so
`expo.autolinking.android.buildFromSource` in `package.json` builds `expo-splash-screen` from source.
A patch to the native code of another Expo module needs the same entry. iOS also links precompiled
Expo modules by default, so a patch to Expo Swift code needs `expo.autolinking.ios.buildFromSource`.

@react-native-masked-view/masked-view 0.3.2 is patched in
`patches/@react-native-masked-view%2Fmasked-view@0.3.2.patch` to change only its TypeScript types. They
extend `NativeMethods`, which React Native 0.87 removed from its types, so `MaskedView` was not a
valid JSX component. Remove the patch when a release fixes the types.

react-native-screens 4.30.1 is patched in `patches/react-native-screens@4.30.1.patch` so the full
screen swipe back of a chat waits for a gesture handler pan in the top screen to fail. The swipe back
starts anywhere in the chat, and a swipe to the right on a message bubble still replies. Without
the patch, no rule sets which of the two recognizers gets the swipe. Remove the patch when a
release sets this failure requirement.
If a row or pinned avatar is tapped during the native return transition, the app retains that
tap until the list is focused and `transitionEnd` fires. It then invokes the original Link
handler once, without a fixed delay.
Focus is read from the route's live `isFocused()` state; nested navigators do not always emit
an initial `focus` event, so a first tap must not depend on receiving one.

Keyboard Controller 1.22.7 is the version that Expo SDK 58 pins for Expo Go. Custom development clients and
standalone apps must be rebuilt after adding this native dependency; a JavaScript reload alone
cannot add it to an existing binary.

Run commands from the repository root:

```bash
bun run mobile
bun run mobile:ios
bun run mobile:android
```

Choose an iOS command:

| Repository root | `apps/mobile` | Integration |
| --- | --- | --- |
| `bun mobile:ios` | `bun ios` | No RocketSim installation required |
| `bun mobile:ios:rocketsim` | `bun ios:rocketsim` | Start RocketSim and enable Connect |

Both commands apply the iOS config plugins without clearing the native directory,
then build and launch the app with Expo. Expo arguments such as `--device` and
`--port` pass through. The RocketSim command requires the app in `/Applications`
or `~/Applications`, or `ROCKETSIM_APP_PATH` set to its `.app` directory. If it is
missing, the command stops with setup instructions. The standard command does not
look for RocketSim, even if `ROCKETSIM_APP_PATH` or the old `OPENBOT_ROCKETSIM`
variable is set.

A build for an iPhone signs all targets with the Apple team of `ios.appleTeamId` in `app.json`. The
repository leaves it unset: set your own team ID before `expo prebuild`, or select the team in Xcode.

The iOS commands keep the Xcode build in `ios/DerivedData`, not in
`~/Library/Developer/Xcode/DerivedData`, so removing a worktree removes its build. Do not remove
`ios/build`: CocoaPods writes codegen output there. When that output is missing, `bun mobile:ios`
installs the pods again. Metro keeps its file map cache in `.expo/metro-file-map` of the worktree.

`bun mobile:android` also applies the config plugins without clearing `android/`, then runs
`expo run:android`. Three local settings make a build in a new worktree faster:

- A release variant builds native code only for the ABIs of the connected devices and running
  emulators, not for all four. Pass `--all-arch` to build every ABI.
- The local `android/gradle.properties` gets `org.gradle.caching=true`. Worktrees share Gradle task
  outputs in `~/.gradle/caches/build-cache-1`. The app config and EAS builds stay the same.
- `CCACHE_BASEDIR` and `CCACHE_NOHASHDIR` let ccache share C++ results between worktrees. Install
  ccache with `brew install ccache`. React Native uses it for the app CMake project when it is on
  `PATH`, and `CMAKE_C_COMPILER_LAUNCHER` and `CMAKE_CXX_COMPILER_LAUNCHER` add it to the CMake
  projects of the libraries, such as Reanimated, Worklets, Expo modules and Skia.

The first build in a new worktree also reuses the work of other worktrees through two shared caches
in `openbot-mobile-cache.noindex` of the common git directory (`git rev-parse --git-common-dir`), on
the disk of the main checkout. `OPENBOT_MOBILE_BUILD_CACHE=<directory>` puts them in another
directory; a relative path starts at the checkout root. `OPENBOT_MOBILE_BUILD_CACHE=off` turns them
off. You can remove the directory at any time.

- `metro/`: Metro transforms of all mobile commands (`metro-cache.js`). Each set of mobile
  dependencies in `bun.lock` and their patches has its own namespace, because the Metro cache key
  does not include the versions of the Babel plugins. Packages that only other workspaces or the dev
  dependencies of the app use are not in the namespace. When `bun.lock` or a patch is newer than the
  last `bun install` (`node_modules/.openbot-install-stamp`), Metro warns and does not use the shared
  cache. A namespace that no worktree used for 14 days is removed. A transform that contains the
  path of the checkout, such as a `use dom` component, stays in `.expo/metro-cache` of the worktree.
  The entries use the file store of `@expo/metro-config`, which writes each entry to a temporary file
  and renames it, so several Metro processes can use one namespace. The store is not a public export
  of Expo: when Expo moves it, Metro warns and does not use the shared cache. Uniwind replaces the
  Metro cache stores with one in the system temporary directory, so `metro.config.js` sets them
  again; EAS builds keep the store of Uniwind. React Native's build scripts and the early bundle of
  `expo run` clear the Metro cache before each release bundle; `bun mobile:ios` and
  `bun mobile:android` keep it. `bun mobile -- --clear` clears the namespace for all worktrees.
- `xcode/`: the Xcode compilation cache of `bun mobile:ios` (Swift, Objective-C and C++). Prefix
  mapping replaces the checkout path and its real path with `/^openbot` in the cache keys, in the
  debug info and in `__FILE__`. Only the `xcodebuild` build command (with `-destination`) gets these
  settings. Xcode removes old entries above 20 GB.

The local launcher enables RocketSim Connect in the local native project. The config plugin
loads it before React Native starts, only in Debug builds on the iOS Simulator.
It does not copy the framework into the app. Release builds and physical devices
cannot load it. A normal prebuild without the launcher removes the hook, as does
`bun ios`. Switching back to the standard command removes the previous Connect
hook before building. It does not close the RocketSim Mac app. The installed Debug
simulator app built with `ios:rocketsim` can also reconnect
when opened from its icon while RocketSim is running.

In RocketSim, select a camera source and allow camera access when macOS asks.
Allow local network access if requested. Camera and Network Monitor need Connect;
network speed control also needs RocketSim Pro and approval of the Network Extension
in RocketSim's Networking window. These OS approvals require user interaction.
See [RocketSim Connect setup](https://www.rocketsim.app/docs/getting-started/setting-up-rocketsim-connect/).

Verified with RocketSim 16.4.6 (332), Expo SDK 57, and the iOS 26.5 iPhone 17 Pro
simulator: the app builds, starts Metro, and loads the Connect framework. Camera
startup then hit an uncaught exception inside RocketSim's `AVCaptureSession rs_stopRunning`:
`stopRunning may not be called between calls to beginConfiguration and commitConfiguration`.
Camera operation is therefore not verified with this combination. Use
`bun ios` if this occurs. The CLI also rejects network speed
control with `pro_required` when RocketSim Pro is unavailable.

For an Expo Go device outside the computer's trusted local network context, start Metro with a secure
tunnel:

```bash
bun run mobile -- --tunnel
```

The phone connects through the central server with the identity in its keychain. It speaks Team
protocol V2 over relay tunnels (`createRelayTeamPeer` in `@openbot/team-client`). Each member of the
team that hosts is one server in the drawer. A server that went offline stays in the list until the
user removes it from this phone. When the certificate expires or the server admin revokes it, the
app deletes the identity and its saved copy of the servers and chats, and asks for a new identity.

Chat links use a local link icon, with a smaller icon in thought-process text. Rendering links
or Markdown images does not contact their destinations; they open only on tap.

The Bloub loading overlay first renders a single idle pose. After commit, the animation provider
prepares one shared 30 fps sequence in idle batches of at most four frames. Hidden loaders and
reduced-motion mode do not start that work. Exit geometry is prepared the same way while holding
the current pose, then settles to idle before scaling down; unfinished preparation is cancelled
when no longer needed.

Working avatars also prepare their sequences in idle batches of at most four frames, sharing
both pending work and cached geometry across presentations. They hold the idle pose until ready;
leaving the screen or ending activity unsubscribes, cancelling preparation when no player needs it.
Returning to idle uses the same bounded scheduler and holds the displayed pose until ready;
resuming activity or unmounting cancels the pending return.

Streaming Markdown reveals words only for messages up to 2,000 characters. Longer responses
show incoming text directly, avoiding a full Markdown parse for every additional word reveal.

Structured question forms appear inline in mobile chat, including when reopening downloaded history.
They support option selection, multiple questions, skipping and cancellation. Custom answers are typed
in the main chat composer and sent to the current form question, rather than posted as chat messages. Responses
use the existing `/v1/prompts/respond` endpoint over the authenticated desktop connection; conversation
updates synchronize their resolution across devices. Offline forms are disabled, failed submissions
can be retried, and completed or expired forms cannot be submitted again. Private answers use a
secure input and are omitted from the local completion summary; unsent drafts stay in component memory.

When no agents have loaded and the selected server is connecting or offline, the agent list shows
`Waiting for connection`. The empty-server prompt appears only once the server is online; agents
already loaded remain visible during reconnection.
The phone keeps an encrypted copy of the agents, hidden agents, sections, latest chat pages,
channels with the latest 50 messages of each opened channel, capabilities and last drawer values (`drawer-snapshot.ts`) of each server (`workspace-cache.ts`),
and writes it when a server load ends and when the app goes to the background. A server shows its
copy at once, and its first connection attempt is quiet for 5 seconds, as a return to the app is. The
first workspace reads go out with the compatibility read when the copy has the capabilities. The UI
does not mark the copy: a server that takes longer shows the usual reconnect status and faded
avatars. Its own reads then replace the copy. Remove identity, an expired or revoked certificate and
the removal of a server delete it.

While a server is disconnected, its agent avatars and colored chat bubbles fade locally with the same
280 ms transition. Voice controls and suggested prompts are disabled until the server is online. The
chat input and attachments stay usable: a sent message goes to the phone's outbox and is drawn
lighter. One line under the last waiting message says `Sends when the server is online`, and touch
and hold on a waiting message opens the native context menu with Edit and Don't send. While the
history waits for the server, `Waiting for connection` shows under the reconnect status above the
composer; in the chat that status shows only the attempt and the countdown. The outbox is saved in the app's documents,
so it survives a restart. Each chat sends its messages one at a time and in order while its server is
online. An agent message carries a `clientMessageId` when the host advertises `message-client-id-v1`,
and a channel message uses the same id as its `operationId`, so a repeat after a lost reply stores
the message once. A message that the host refused shows `Not sent`, and its menu adds Retry; it holds
the later messages of its chat, which show `Waits for the message that was not sent`. A refused message writes its failure kind,
its file count and its size to the support log, without the error text, which can name a file. A message that the host may have stored is not repeated when
the host cannot drop a repeat, or 12 hours after its first attempt; it shows `Not confirmed`. This
visual state is derived only in the mobile UI: it never changes the agent's synced avatar profile or
sends appearance updates.

The app lock (Settings > App lock) uses a 4-digit PIN, the phone's biometrics with the phone
passcode as fallback (`expo-local-authentication`, Android strong biometrics only), or both. The
settings are in the after-first-unlock Keychain items, so a start in the background reads them and
starts locked. The PIN is stored as a salted PBKDF2-SHA256 hash, and the failed attempts are stored
before each check, both in when-unlocked, this-device-only items. A 4-digit PIN cannot resist a
person who reads the Keychain; the Keychain and the attempt limit protect it. After 4 failures each
attempt waits longer, and the 10th failure removes the identity. Every change in App lock asks the owner to
unlock first, unless the owner unlocked in the last 5 minutes. The local `modules/app-lock` native module
measures the time away with a clock that counts during sleep and ignores changes of the phone's time.
It reports a phone lock: iOS posts `protectedDataWillBecomeUnavailable` about 10 seconds after the lock,
and only with a passcode, so the module asks for the short background time while it waits for that
notification. Android reports `ACTION_SCREEN_OFF`. Android counts the app as away only when no activity
of the app is visible, so permission and biometric dialogs do not lock it. On Android 13 and later the
recent apps show a blank card. The lock screen draws in `FullWindowOverlay` on iOS and in a `Modal` on
Android, above sheets. Quick action and share navigation waits until
the user unlocks. Expo Go does not have the module: it measures with the phone clock and cannot see a phone lock.

## Background refresh

While the phone has an identity, it asks the system for a background refresh at most once every
15 minutes. The system decides when it runs. In a refresh, the workspace makes the server connections
active for at most 25 seconds. It waits until each server loads with its channels and open chats, or
stops at the retry cooldown, then saves the encrypted workspace copy and makes the connections
inactive again. A chat on
screen is not marked as read.

- iOS uses `BGAppRefreshTask` with the identifier `app.openbotnc.mobile.refresh` (`UIBackgroundModes`
  `fetch` in `app.json`). The local `modules/background-refresh` module registers the task at launch
  and gives each run to JavaScript. iOS lists the app in Settings > General > Background App Refresh.
- Android uses `expo-background-task` (WorkManager). `package.json` excludes it, `expo-task-manager`
  and `unimodules-app-loader` from iOS autolinking, because that package schedules only an idle
  processing task on iOS.
- The server connections run in a web view, so a refresh needs the React tree. When the system
  starts the app in the background with no window, React Native does not start (iOS) or no component
  mounts (Android). The run then ends with no network work, and the refresh stops until the user
  opens the app again.
- The support log shows `Background refresh: available` (or the iOS status), and for each run the
  number of servers that loaded, or why the run did nothing (`Background refresh skipped: ...`). On
  iOS, the device log (subsystem `app.openbotnc.mobile`, category `BackgroundRefresh`) shows when iOS
  started the task and when it ended.
- Test on a device. iOS has no background tasks in the Simulator. Attach Xcode to `OpenBot`, put
  the app in the background and pause it. Select a thread that is not the main thread
  (`thread select <n>`): on the main thread the command does not return. Then run
  `e -l objc -- @import Foundation`, `e -l objc -- @import BackgroundTasks` and
  `e -l objc -- (void)[[BGTaskScheduler sharedScheduler] performSelector:NSSelectorFromString(@"_simulateLaunchForTaskWithIdentifier:") withObject:@"app.openbotnc.mobile.refresh"]`,
  and continue. Wait before you open the app: a run with the app in the foreground does nothing.
  On Android, `adb shell cmd jobscheduler run -f app.openbotnc.mobile <job id>` starts the job.

## Source structure

The mobile app uses a feature-first structure. Expo Router files stay deliberately thin: `src/app`
defines URLs, route groups, guards, and navigator options, while screen implementations live with
the feature that owns them.

```text
src/
  app/                  Expo Router routes and layouts only
    (app)/              routes available to an authenticated session
  features/
    auth/               session storage and session context
    identity/           identity file import (paste or file pick) and Settings > Team identity
    agents/             agent list, agent actions, and pin transitions
    chat/               chat screen and its focused UI sections
    search/             search model, controls, results, and screen
    servers/            server drawer and joining a server
    settings/           settings screens
    workspace/          relay directory, relay transport, live events, and workspace state
  shared/
    components/         UI used by more than one feature
    lib/                platform and infrastructure helpers
```

Keep code inside a feature until a second feature needs it. Move it to `shared` only when it has no
feature-specific behavior. Shared code must not import from features; direct feature-to-feature reuse
should stay explicit so it cannot turn into an accidental circular dependency.
Split screens into focused sections when they combine navigation, local state, and multiple distinct
UI regions; for example, chat owns separate header, message-list, and composer components.

## Design development

The mobile design system is documented in [`DESIGN.md`](./DESIGN.md). Read it before implementing or reviewing UI.

In short, use HeroUI Native for application content and reusable product components. Use native Expo Router and `@expo/ui` surfaces for navigation, headers, tabs, toolbars, search, menus, and route-level sheets so each platform owns its chrome and iOS can render Liquid Glass where the operating system supports it.

## Verification

Chat follows the [v0 chat interaction model](https://vercel.com/blog/how-we-built-the-v0-ios-app).
`use-chat-motion.ts` owns measurements, native blank-space insets, initial positioning, and send
animation sequencing. Message groups keep stable keys. Responses fill the blank space without
autoscrolling; the down-arrow returns to the latest content. Keyboard Controller absorbs keyboard
and composer growth into the blank space before shifting content at the end of the chat.

Streaming Markdown uses a bounded reveal pool (four active nodes, batches every 32 ms). It renders
the complete received text without a second typewriter queue. Reduced motion skips movement.
The floating composer uses the existing Expo glass components with an opaque accessibility fallback.
Mobile file attachments are currently disabled by `CHAT_ATTACHMENTS_ENABLED` in
`use-chat-attachments.ts`. The plus button shows a native Coming soon dialog; large pasted text
stays in the input. When enabled, the native menu on the plus button opens Files. The plus button and input share one row; there is
no separate paste button. The native multiline input grows to five lines, then scrolls internally;
its height limit follows the system font scale. Large text pasted into the input becomes a text attachment.
Photos, videos and other files pasted into the input become attachments through the local
`modules/composer-paste` native module; Expo Go does not have it and pastes text only. Mobile uploads
use the released file-transfer protocol and are limited to 10 MB per file. Sending dismisses the
keyboard. The gesture area covers the chat and uses the measured composer height for dismissal.
The installed Keyboard Controller content-inset hit-test workaround enables scrolling in blank space.

Device verification must cover: first send with the keyboard open/closed; subsequent sends; short
and long responses; initial history position; scrolling up while streaming; down-arrow; multiline
composer growth at the end and in history; interactive keyboard dismissal and swipe-to-focus;
background/foreground; reduced motion/transparency; text/image/file paste; upload failure and retry.
Code blocks show the fence language and a Copy action. They use the same syntax tokenizer as
desktop, render native text, and retain plain text for unknown languages. Highlighting does not
change source whitespace. Copy writes only the source to the system clipboard.
The local model and protocol tests do not establish native animation quality.

```bash
bun run mobile:lint
bun run mobile:typecheck
bun run mobile:doctor
```

## Build for a device

Build the app with your own Apple team and Android signing key, as
[central server](../../docs/central-server.md#phone-app) says. The developer runs these builds; the
repository does not run them in CI.

`eas.json` has development, preview and production build profiles and no project of the original
vendor. To build with EAS, link your own EAS account first (`bunx eas-cli init`), then build locally
or in the cloud:

```bash
cd apps/mobile
bunx eas-cli@latest build --profile development --platform ios
bunx eas-cli@latest build --profile development --platform android
```

Cloud builds require your final `ios.bundleIdentifier` and `android.package` values in `app.json`.
`fastlane/Fastfile` can upload a signed build to your own TestFlight or Google Play testing track with
your own App Store Connect and Google Play keys.
