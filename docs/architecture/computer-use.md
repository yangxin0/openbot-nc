# Computer Use

## Computer Use

Computer Use is `cua-driver`, a third-party MIT binary, and OpenBot owns how it runs.
`cua-driver-runtime.ts` in the main process starts one long-lived `serve` daemon and holds it; each
provider CLI spawns its own short-lived `cua-driver mcp --socket` proxy against that daemon. All
screen capture, accessibility reads, and input posting happen inside the daemon, so the proxy's own
identity does not matter.

The daemon is spawned directly, and never through `open(1)` or `NSWorkspace`. macOS finds the
responsible process by walking up the launch chain, so a direct spawn puts OpenBot at the top of it
and the user grants Screen Recording and Accessibility to OpenBot rather than to somebody else's
helper. `CUA_DRIVER_EMBEDDED=1` tells the driver to stay on that path instead of relaunching itself
as its own application. Anything that launches the daemon another way breaks the attribution, which
is the reason the earlier Codex helper was replaced.

Startup calls `warmUp()`, which reads the state once and keeps the daemon only when both grants are
there. A user who granted them keeps the tools after a restart, and a remote request or a scheduled
task — neither of which opens a window — reaches them too. A user who granted nothing keeps no
process, and no prompt is raised either way: only using the driver asks for a grant. Every other
start is lazy, on a state read from the panel.

The control socket lives in the private per-user runtime directory, mode `0o700`, not in `/tmp`:
whoever reaches it can drive the whole desktop. It cannot live under `userData`, because
`sockaddr_un.sun_path` holds 104 bytes on macOS and an isolated development profile spends most of
them on the worktree hash. Windows uses a named pipe, which has no such limit; its name is random,
because Windows lets a second process add an instance to a name it can guess, and it is kept in the
profile so that it is random once rather than once per launch. The endpoint has to hold still: it
reaches each proxy as an argument, and the arguments are folded into the stored Codex tool
fingerprint, so a name that moves at each launch replaces every session after a restart. The command
has to hold still for the same reason: the packaged Linux build is an AppImage, whose resources are
mounted somewhere else at each launch, so there the proxies are given a link below the profile that
the runtime points at this run's driver.

One MCP entry reaches every provider. `CuaDriverRuntime.mcpServerConfig()` returns a config only
while the daemon runs, and `AgentService.enabledMcpServers()` appends it, which is the one function
Codex, Claude, and ACP all read. Two properties keep it there: the name is not in
`RESERVED_MCP_SERVER_NAMES`, which is a drop filter rather than a marker, and `workingDirectory`
stays empty, because ACP has no field for one, so an entry with one would vanish for ACP providers
with no error. Codex staleness needs no separate signal, because
`toolFingerprint` already folds the MCP entries and a changed fingerprint forces a replacement
session. `onMcpServerChanged` is what refreshes the agent runtimes, which deactivates every
stored provider session: the next turn starts a new one, which keeps the public thread and loses
what the provider held privately. So it reports two moments only — the entry appearing on a start a
user asked for, and the daemon dying under OpenBot. It is quiet for a grant given while the daemon
serves, which changes the state and not the tool set; for the startup warm-up, which settles the
entry the stored sessions already had; and for the stop at teardown, which happens at order 55,
before the agent service at 110, and would otherwise deactivate on every quit the sessions the next
run is meant to resume.

`capabilities.computerUse` is pushed by main from the daemon's own permission answer. It is no
longer probed from Codex `plugin/list`, which is why the capability now reports the same state for
every provider.

The driver is packaged, not downloaded on demand, so it is pinned in `native-runtime.lock.json` like
the other native runtimes rather than managed like a provider CLI. The pinned file list is an
allowlist: `scripts/install-cua-driver.ts` copies only the named paths and checks each digest, so an
upstream layout change fails the build instead of shipping a surprise file. Each installer carries
only its own target. On macOS `mac.signIgnore` keeps the vendor's Developer ID signature, because
re-signing under OpenBot's inherited entitlements would drop the Automation entitlement the driver
needs. A packaged build reads the copy under `resources/cua-driver` and nothing else, because the release
is pinned and signed against that build and an environment variable must not decide which program
drives the user's desktop; a release without the binary reports no driver. In a checkout
`resolveCuaDriver` also reads an override, an install directory and `PATH`, so a developer can point
`OPENBOT_CUA_DRIVER_PATH` at another build.

OpenBot draws the agent cursor in its own per-display overlays for every display layout. The
runtime starts `serve` with `--no-overlay`. The driver's overlay covers only the main display and
cannot follow a display connected after startup. Keeping cursor ownership in OpenBot lets the
highlight controller add, resize, and remove display overlays without restarting the daemon or
changing provider sessions. The tap removes the driver's own cursor tools (`set_agent_cursor_*`
and `get_agent_cursor_state`) from the tool list: with `--no-overlay` they change nothing on the
screen, and on macOS they refuse. `move_cursor` stays, because OpenBot draws its cursor at the
point of that call. A `click` or a `scroll` aimed at a window names a pixel of that window's last
`get_window_state` screenshot, not a desktop point. The tap keeps the `screenshot_width` of each
window from that answer and saves it with the point when the click passes. The cursor goes to the
window's top-left corner plus the point times the window width divided by that screenshot width,
as the driver computes it. A click that OpenBot cannot place (no `window_id`, a point in a `zoom`
image, or no screenshot width yet) removes the cursor. A window that is not in `list_windows` gets
no cursor.
The driver tells agents to act through `run_steps`, which runs its steps inside the daemon, so the
tap reads the steps of that call in order, each as its own call. A step without a window gets the
window of the batch or of the last step that named one, as in the driver. A step that names its
window only by `app` or `window` title removes the cursor, because only the driver resolves it.
The driver skips the reads between the steps of a batch and does one read at the end. The tap keeps
the `screenshot_width` of that end read (`observation.state` in the answer) as of a direct read.

On macOS, driver 0.52.9 keeps no screenshot frame after a read that ends in
`ax_window_unresolved`: the window exists, but no accessibility window claims it, as with Premiere
Pro. Every pixel action on that window is then refused as `window_never_read`, also in the
foreground, and a new full read does the same again (#14480, upstream trycua/cua#6755). A
screenshot-only read (`include_accessibility_tree: false`, `include_screenshot: true`) has no
accessibility result to fail, so the driver keeps its frame. The agent instructions name that read
on macOS. When a driver release with trycua/cua#8117 is pinned, the rule can go.

iPhone Mirroring (`com.apple.ScreenContinuity`) drops the window routes of driver 0.52.9 on macOS 26,
and the driver answers `unverifiable` (#14837). A background click stamps the screen point, which
the mirror does not map to the phone (upstream trycua/cua#4920; #5492 changes this only on macOS 27).
A foreground window click is posted to the pid, and the mirror takes no pid-posted tap. Only the
desktop scope reaches it: a click and a scroll at a `get_desktop_state` point go through the global
HID queue, and a scroll first posts real `MouseMoved` events at the point. So the macOS agent
instructions name the desktop scope for iPhone Mirroring, with `bring_to_front` before each click
or scroll, because desktop input goes to the window in front. `get_desktop_state` captures only the
main display, so the agent first moves a mirror on another display there. The mirror samples
HID report state and misses a press shorter than one report, so the daemon gets
`CUA_DRIVER_CLICK_GAP_MS=60` on macOS, in place of the driver's 28 ms. oh-my-pi holds 60 ms and
mirroir-mcp 50 ms for the same reason. A longer hold also suits an `NSButton` tracking loop, which
the driver's own note says can miss a shorter one. When a driver release fixes the window routes,
the rule can go.

### Agent display on a server

A self-hosted server and the container start two Xvfb displays, and name the agent display in
`OPENBOT_AGENT_DISPLAY`. The agent display has a white root (Xvfb `-wr`). `xsetroot` gives it an
arrow pointer, because the default "×" of an empty display looks like an error, and `-noreset` keeps
the arrow.

`scripts/hosting/openbot-desktop` starts Openbox on the agent display, with the configuration and
the flat light theme in `scripts/hosting/desktop/`. Before Openbox starts, `hsetroot` draws the
background: the dark color of the app (`#1a1a1a`) with the OpenBot logo (`desktop/openbot-logo.png`,
the lilac logo with a light name from `@openbot/brand`) in the center, at each display size. Without
`hsetroot`, the white root stays, because a dark screen with no logo looks like no video.

Windows get title bars, and a click focuses and raises a window. A right-click on the empty screen or
on a title bar opens a menu: Terminal (`lxterminal`), Files (`pcmanfm`) and the open windows. A
maximized window thus does not hide the menu. Openbox takes only Alt+Tab, Alt+Shift+Tab and Alt+F4;
all other keys and mouse actions go to the window, so Computer Use input arrives as before. The
configuration has one desktop and no iconify action, so nothing moves the windows of an agent out of
view. The script starts Openbox again when it stops, and exits when the display stops or when
Openbox fails 5 times in a row. When the `openbox` package is missing, it does nothing, so a server
with the old package list keeps the bare display.

Programs from the menu run as the service user, as the agents do, so the Terminal item gives a shell
as that user.
Openbox and the menu programs get the OOM value (500) and the nice value (10) of agent processes, so
a build in that terminal does not take memory or CPU from main. The menu labels are in the Openbox
configuration and are not translated.

A boat hosted server names its desktop `:0`, and OpenBot
runs on an Xvfb display. Electron keeps its own `DISPLAY`: the built-in browser draws its tabs in
the OpenBot window, and under Xvfb a hidden view gives no capture and no clicks, so OpenBot cannot
only hide its window. On Linux, `agent-display.ts` sets `DISPLAY` to the agent display for the
driver daemon and in `agentEnvironment` for every agent process. The driver opens the display that
`DISPLAY` names, so a screenshot and an input event use the agent display, and a program that an
agent starts opens there. The
per-display overlays are OpenBot windows, so with an agent display they are not started: nothing
draws the agent cursor or the rim there. `capture_screen` and `list_capture_sources` use Electron's
`desktopCapturer`, which sees only the OpenBot display, so with an agent display they are not
available, and agents take screenshots with the driver.

`openbot-nc.service` holds the Xvfb displays too, and a stop signals each process of the unit at the
same time. An Xvfb that stops first ends OpenBot before it closes its database. So the unit's
`ExecStop` runs `openbot-hosted-server --stop`: it sends `SIGTERM` to OpenBot only, whose PID the
script writes to `$XDG_RUNTIME_DIR/openbot.pid`, and waits for it. Then it waits at most 10 s for
the main process of the unit, so that `xvfb-run` completes its `xauth remove`. An `xauth` that the
stop signal ended left the `~/.Xauthority-c` lock, and each later start failed after 20 to 40 s.
The start also removes these lock files when no `xauth` of the user runs. The container does not
need this: tini signals only OpenBot.

Because the driver draws no cursor, its motion styles do not apply. The renderer plays the driver's
`adaptive` style itself (`agent-cursor-motion.ts`, a port of the driver's `trajectory.rs`): a Fitts
min-jerk glide, or a wide swoop for a move over 900 points. The tap does not delay a request, so the
cursor shows where an action went, from 180 ms to about 1.1 s after the driver acts.

On macOS the daemon gets `CUA_DRIVER_KEEP_DISPLAY_AWAKE=0`, and OpenBot keeps the display awake
itself. The tap starts before the daemon, and the daemon gets the variable only when the tap listens:
without the tap, provider calls go to the daemon directly and OpenBot cannot see them, so the
driver's guard stays on. The driver's own guard holds `PreventUserIdleDisplaySleep` until 600 s after the last tool
call, and `end_session` counts as a call, so the display stayed on for up to 10 minutes after the
agent stopped, against the user's display sleep setting. The tap reports each provider tool call.
`ComputerUseDisplayAwake` (`computer-use-display-awake.ts`) then holds Electron's
`prevent-display-sleep` blocker, the same assertion, from each call. A `turn-completed` event
without `continues` releases it when no turn runs, so the hold stays between the turns of one task, and it is always released 600 s after the last call, as the driver's
guard was. A call outside a turn, such as background provider work, thus keeps the driver's hold
time, and the display never stays on longer than before. The guard exists because display sleep locks the
session, and a locked session gives Computer Use no windows and no input. OpenBot's own
`list_windows` reads for the highlight go to the daemon socket, not to the tap, so they take no hold.

Every copy OpenBot starts gets `CUA_DRIVER_RS_TELEMETRY_ENABLED=0` and
`CUA_DRIVER_RS_UPDATE_CHECK=0`. OpenBot ships the driver, so its vendor analytics are not something
a user chose, and OpenBot pins the version, so a release check could only offer an update OpenBot
would refuse.

### Codex tool approvals

Codex saves an “Always allow” tool decision only when the MCP server is in a file-backed
configuration layer. A thread configuration alone does not satisfy this check. Before starting or
resuming a thread with Computer Use, OpenBot registers `computer_use` in the Codex user
configuration through `config/batchWrite`. The new entry contains only a placeholder command
(`openbot-mcp`) and `enabled = false`. The write uses the user layer's version, and an existing entry is left unchanged.
OpenBot does not save the driver socket, environment, or credentials in that entry.

The thread configuration enables the running driver and supplies its current command, arguments,
and environment. It also carries the saved per-tool settings, including `set_value.approval_mode`.
Saved tool settings are also in the session fingerprint. When an approval changes, the next turn
replaces a loaded provider session that holds the old policy.
An agent with Full access does not ask: OpenBot accepts each Computer Use tool consent once and
saves nothing, as it does for other MCP tools. A Workspace only or Ask first agent shows the card,
and Codex keeps "Always allow" per tool and per provider account.
When Computer Use is off for the agent or the driver is unavailable, the thread keeps the saved
entry disabled. A registration failure stops the thread with steps to repair the configuration or
turn off Computer Use. The application-access questions from the driver still use their existing
approval flow.

### Codex's own Computer Use

Codex loads its bundled Computer Use plugins by default (`computer-use@openai-bundled`, which starts
`node_repl` and `cua_node`, and `unified-computer-use@openai-bundled`). A session without Computer
Use sets `plugins.<id>.enabled = false` for both in the thread configuration: an agent with the
setting off, or a task thread beside the agent's own chat. Routine and channel threads keep the
agent's setting. The thread value wins over the
user's own Codex file. Codex (0.160 to 0.170) does not read `features.computer_use`, so OpenBot does not use it.
A loaded session keeps the plugins of its start, so the session fingerprint has a value for a
session without Computer Use. The next turn replaces a session from before, and a session whose
setting changed, with the usual handoff.

Every Codex session also sets `plugins.<id>.enabled = false` for Codex's bundled browser plugins
(`browser`, `chrome`, `chrome-dev` and `chrome-internal`, all `@openai-bundled`). These plugins need a
browser access host that only the ChatGPT desktop app gives to the sessions that it starts. In an
OpenBot session, each call fails with "The browser access host is unavailable" (openai/codex#57641).
Agents use the OpenBot browser, or the user's Chrome through the OpenBot extension. The value does
not change, so it is not in the session fingerprint: a resumed session gets it, and no session is
replaced.
