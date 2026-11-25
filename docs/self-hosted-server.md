# Self-hosted servers

A self-hosted server is the Linux OpenBot-NC build on your own computer with no screen: a VPS, a home
server or a cloud VM. It joins your team through the central server (see
[central server](central-server.md)). You use it from the desktop app, the web client at
`https://<your server>/app`, the Chrome extension or the phone app. You install and control it from a
terminal.

To run it in a container, see [Docker](docker.md).

## Install

OpenBot-NC has no public release feed. Build the AppImage on a computer with the repository, or use
one that your team built:

```sh
bun run dist:linux
```

The build writes `dist/OpenBot-NC-<version>-x86_64.AppImage` (`bun run dist:linux:arm64` for arm64).
Make an identity file for the server on the central server, for example
`ca issue --team "My Team" --user alice --device office-server --out office-server.json`.

Copy the AppImage, `scripts/install-server.sh` and the identity file to the server. On Ubuntu 24.04
or 26.04 (x86_64 or arm64) with systemd, run:

```sh
sudo bash install-server.sh --release OpenBot-NC-<version>-x86_64.AppImage --identity office-server.json
```

The install imports the identity and shares the agents of the server with the team. The service user
must be able to read the identity file. Delete the file after the install. Then connect a provider
from the app: open the server and follow the provider step.

| Option | Default | Use |
| --- | --- | --- |
| `--release <file or URL>` | none (required) | The AppImage to install: a local file or an https URL. The install downloads nothing else. |
| `--sha512 <base64>` | none | The SHA-512 of the AppImage. The install stops when the file does not match. |
| `--user <name>` | the installed user, else `openbot-nc` | The user that runs OpenBot and its agents. The install makes it when it does not exist, with its home folder in `/var/lib/<name>`. |
| `--display-size <W>x<H>` | the installed one, else `1280x800` | The size of the virtual display that computer use reads (see [Display size](#display-size)). |
| `--name <name>` | `OpenBot` | The server name. |
| `--identity <file>` | none | The identity file of this server. Without it, import one later with `openbot-nc import-identity`. |

Run the install again to reinstall or upgrade. The data stays in the home folder of the service
user. A reinstall keeps the user and refuses another `--user`. A reinstall without `--display-size`
keeps the display size. The install refuses an older release than the installed one, because an
older OpenBot cannot open a database that a newer one migrated.

### Hermes Agent

OpenBot uses the Hermes Agent of the service user, as it uses the user's own Hermes on a desktop
(see [Hermes](architecture/providers.md#hermes)). Open the server's provider settings and select
Download on the Hermes row. OpenBot runs the official Hermes installer as the service user, then the
row shows Connect. To install Hermes from a terminal instead, run the installer as that user, then
restart OpenBot:

```sh
sudo -u openbot-nc -i bash -c 'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash -s -- --non-interactive'
sudo openbot-nc restart
```

In Docker, the service user is the image user, and its home folder is the data volume:

```sh
docker exec openbot bash -c 'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash -s -- --non-interactive'
docker restart openbot
```

Hermes keeps its settings, sign-ins and memories in `~/.hermes` of that user. Then select Connect on
the Hermes row of the server's provider settings: it shows a Nous Portal code. Alternatively, run
`hermes setup` or `hermes model` as that user. OpenBot sees a change to `config.yaml`, `.env` or
`auth.json` with no restart. A Hermes that another user installed is not used.

The Hermes installer needs `git` and `curl`, and downloads Node.js, which needs `libatomic1`. The
service user has no sudo, so the server packages include them. `bun run test:hermes-server` checks this setup in Docker.

## Commands

| Command | Use |
| --- | --- |
| `openbot-nc status` | Show the identity, the connection to the central server and the server. |
| `openbot-nc import-identity <file> [--replace] [--hosting on\|off]` | Import the identity file of `ca issue`. The server then joins its team. `--replace` changes an identity that the server has already. |
| `openbot-nc hosting on\|off` | Share the agents of this server with the team, or stop. |
| `openbot-nc name <name>` | Change the server name. |
| `openbot-nc logs [-f]` | Show the journal of `openbot-nc.service`. |
| `sudo openbot-nc start\|stop\|restart` | Control `openbot-nc.service`. |
| `sudo openbot-nc update <file or URL> [sha512]` | Install an AppImage that you give. The SHA-512 in base64 is optional. |
| `sudo openbot-nc uninstall` | Remove OpenBot. The data stays (see [Remove](#remove)). |
| `openbot-nc version` | Show the installed version. |

An owner or admin can also restart the server from the app: select Restart server in the server
menu, or in Server settings on the phone. OpenBot closes, and `openbot-nc.service` starts it again after
about 10 seconds. In Docker, the container must have a restart policy, such as `--restart
unless-stopped`; without one, the container stays stopped. When the server does not answer, use
`sudo openbot-nc restart`.

When the start of OpenBot fails again and again, the service stops, and systemd does not start it again
(see [Start loop](#start-loop)). `openbot-nc status` then says so. Read the reason with
`openbot-nc logs`. Install a newer release with `sudo openbot-nc update <file or URL>`, or try again
with `sudo openbot-nc restart`. The update timer also starts the service again about each hour, with a
staged release when there is one.

Run the identity commands with `sudo` or as the service user. Other users cannot open the control
socket.

## Memory

A self-hosted server guards its memory. When free memory is low, new turns wait in the queue and start
again when memory is available. A message from a person starts first. The browser opens no new tab
and unloads idle pages sooner. By default, a fixed number of turns run at the same time: 2 up to
5 GiB of memory, 8 up to 10 GiB, and 16 above. An owner or admin can choose another number, 1 to 128, or
Unlimited, in Server Settings > Agent defaults > Threads at the same time. Low memory still holds a new turn.

The memory ceiling is the smaller of the machine memory and the limit of `openbot-nc.service`
(`MemoryMax=90%`). To give OpenBot less memory, lower the limit with
`sudo systemctl edit openbot-nc.service`, for example `MemoryMax=2G`, and restart the service. The
turn limit and the low-memory levels then use the new ceiling. `openbot-nc status` shows the ceiling,
the free memory, the level (`ok`, `low` or `critical`) and the turn limit:

```text
Memory: 1228 MiB free of 3481 MiB (ok)
Turns at the same time: at most 2
```

The guard reads cgroup v2. On a system with cgroup v1, it uses the machine memory and the log has
one warning.

Agent processes run at nice 10 with an OOM value of 500, also a job that an agent detaches. At the
`critical` level, OpenBot stops leftover agent processes first. Node programs of agents see the CPU
limit of the unit in `os.cpus()`.

## Watchdog

Before it starts OpenBot, `openbot-hosted-server` starts itself again with `--watchdog` in the
background. Main rewrites `~/.config/OpenBot-NC/openbot-run-marker-v1.json` every 60 s from its event
loop (`src/main/run-marker.ts`). The watchdog reads the file every 30 s. When the content does not
change in 20 reads (10 minutes) after it changed once in this run, the watchdog logs "OpenBot did not
update its heartbeat for 600 seconds" and sends `SIGKILL` to the process in
`/run/openbot-nc/openbot.pid`. `Restart=always` starts the service again 10 s later. The watchdog does
nothing:

- before the first change of the file in this run;
- until the start finishes: `openbot-start-attempts-v1.json` in the same folder has
  `"attempt":null` only after the migrations, the services and the renderer load. Migrations and the
  database `quick_check` run on the main thread and can take longer than 10 minutes on a large
  database;
- while the run marker does not have `"state":"running"`. Quitting and the server safe mode stop the
  heartbeat, and the safe mode stays alive to keep the host reachable;
- when the folder of the file has less than 1 MB free, because main ignores a failed write;
- when the process in the pid file is not `openbot` in the cgroup of the service.

The watchdog counts reads and does not compare clock times, so a resume that moves the clock forward
does not stop OpenBot. It does not help when the whole machine stops responding; that needs a
reboot of the VM.

`scripts/hosted-watchdog-e2e.ts` (`bun run test:hosted-watchdog`) runs the watchdog with a 1 s
interval against fake apps that write, stop writing or never write the file, that did not finish
their start, that quit, or that are not `openbot`.

## Start loop

A server has no window for the recovery window of the desktop. A server whose start
failed started again each 10 seconds, without an end, in earlier releases. Now main stops the loop
(`src/main/server-start-halt.ts`):

- at the first failure when the database is from a newer OpenBot (`newer_database`): a restart
  cannot help;
- for all other failures, at the third failed start in a row of the same version (`start_failed`).
  A failed migration rolls back and counts as a failed start, because its cause can be temporary
  (a full disk, a lock). A start that fails with an error stops the loop at once; after a crash,
  the next start stops it. This is the count of the desktop recovery window (`start-attempts.ts`).

Main then writes `openbot-start-halt-v1.json` in its user data folder. The file has the reason
word, the app version and a time only. The journal shows the reason. Then main runs its safe mode
(`src/main/server-safe-mode.ts`): it keeps a minimal Team API up, so each member's app shows why
the server does not start and which version it runs. The safe mode opens no database and changes
no user data. It writes the empty file `/run/openbot-nc/server-safe-mode` while it runs. See
[Team API](architecture/team-api.md#server-safe-mode).

When the safe mode cannot start, main exits with 78 as before.
`openbot-nc.service` has `RestartPreventExitStatus=78`, so systemd does not start it again.

The next start reads and removes the file, logs the reason, and tries once more. A failure of that
start stops the loop again. These start OpenBot again:

- a restart or a resume of the server, or `sudo openbot-nc restart` or `start`;
- `sudo openbot-nc update <file or URL>`;
- `check` of `openbot-nc-update.timer`, about each hour: when `openbot-nc.service` is stopped with
  status 78, or runs its safe mode, it runs `stage`, stops the safe mode, and starts the service
  again, after `apply` when a newer release is staged. A failure can be temporary (a full disk, no
  network), so each run tries once more. It reads only the state of the unit (`ActiveState`, `ExecMainStatus`) and the
  existence of the empty safe-mode file, never the content of a file of the service user.

When OpenBot is not running or runs its safe mode, `openbot` commands that need the control socket
say that the start loop stopped it, and name `openbot-nc logs`, `sudo openbot-nc update <file or URL>` and
`sudo openbot-nc restart`. The safe mode has no control socket.

A Docker container has no systemd and no `openbot-nc-update.timer`. There the safe mode ends after one
hour with exit 78, and the restart policy starts the container again, with the backoff of Docker.
Each second start after a halt tries again.

There is no install or rollback action in the safe mode: a newer release is the fix, through the
update paths above.

## Display size

A self-hosted server gives the agents a virtual display (Xvfb), and computer use reads that display.
The default size is 1280x800. A [Docker](docker.md#environment) container uses the same setting
and the same default.

The display size does not change the OpenBot browser (`openbot_browser`). Its pages have their own
size, 1200x800 when no panel shows them, and its clicks go to page elements.

To use another size, give it at the install with `--display-size 1920x1080`, or write this line in
`/opt/OpenBot-NC/hosted/openbot.env` and run `sudo openbot-nc restart`:

```text
OPENBOT_DISPLAY_SIZE=1920x1080
```

The value is `WIDTHxHEIGHT` in digits, from 640x480 to 2576x2576. The install refuses a value that is
not valid. At a start, a value that is not valid writes this warning in `openbot-nc logs`, and the
server starts with 1280x800:

```text
OPENBOT_DISPLAY_SIZE is not WIDTHxHEIGHT from 640x480 to 2576x2576. The display is 1280x800.
```

### Which size to use

Keep 1280x800 unless the apps that agents use need more space. At 1280x800, computer use clicks
more accurately, and a screenshot costs fewer tokens. Use 1920x1080 only with a model that reads a
1920x1080 image at its full size (see [Screenshots and clicks](#screenshots-and-clicks)).

A click test compared the two sizes. A model clicked a 26x17 px button in an `xmessage` window that
almost filled the display, once from a full-display screenshot and once from a window screenshot.
The models were the free OpenCode models with image input (OpenCode 1.18.30, Docker image 0.42.0,
arm64):

| Model | 1920x1080, full display | 1920x1080, window | 1280x800, full display | 1280x800, window |
| --- | --- | --- | --- | --- |
| MiMo v2.6 Flash | Hit | Miss | Hit | Hit |
| DeepSeek v4.1 Flash | Miss | Miss | Hit | Hit |
| GLM 5.3 Flash | Hit | Miss | Hit | Not tested (429) |
| LongCat 2.5 Preview | Miss | Miss | Hit | Hit |
| Muse Spark 1.3 | Miss | Miss | Miss | Hit |
| Nemotron 3.5 Super VL | Miss | Miss | Hit | Hit |
| Space Bunny | Hit | Hit | Hit | Hit |
| **Hits** | **3 of 7** | **1 of 7** | **6 of 7** | **6 of 6** |

Claude and Codex models were not in the test.

An image costs `⌈width / 28⌉ × ⌈height / 28⌉` visual tokens on Claude. A full-display screenshot at
1920x1080 costs about 2 times the tokens of one at 1280x800:

| Display size | Visual tokens of one full-display screenshot |
| --- | --- |
| 1280x720 | 1196 |
| 1280x800 | 1334 |
| 1366x768 | 1372 |
| 1920x1080 | 2691 |
| 2560x1440 | 4784 |

### Screenshots and clicks

The computer use driver (cua-driver, `cua-driver-rs-v0.52.9`) has two screenshots on Linux:

- **One window** (`get_window_state`). The driver makes the image 1.15 megapixels or less, with a long
  edge of 1568 px or less, and changes the x and y of each click back to screen pixels. A 1260x780
  window gets to the model at its full size. A 1900x1060 window gets to the model at 1435x801. Then
  small controls are harder to hit, and some models send the x and y in screen pixels, so the click
  lands outside the control. A window that goes past the edge of the display gives no screenshot.
- **The full display** (`get_desktop_state`). The driver sends the image at its full size and uses
  the x and y of a click as screen pixels. The clicks land correctly only when the model reads the
  image at its full size.

What a model reads of a full-display screenshot at 1920x1080:

| Provider | Image |
| --- | --- |
| Claude 4.7 and later, all Claude 5 models | Full size, up to 2576 px on the long edge and 4784 visual tokens ([Vision](https://platform.claude.com/docs/en/build-with-claude/vision#resolution-and-token-cost)) |
| Codex | Full size: the limit is 2048 px and 2,500 tiles of 32x32 px, and 1920x1080 is 2,040 tiles |
| Grok, Gemini, OpenCode, Cursor, Cline, Pi | Not known |

A 1280x800 screenshot is not made smaller by any Claude or Codex model.

## Phone app

The phone app connects to the servers of the team through the central server. Issue an identity for
the phone only (`ca issue ... --device phone`) and import it in the app. The server needs no extra
step and publishes no port. See [central server](central-server.md#phone-app).

## Remove

`sudo openbot-nc uninstall` removes the service, the units, the AppArmor profile, the `openbot-nc`
command and the server files in `/opt/OpenBot-NC`. It keeps the home folder of the service user and
the keyring in `/srv/openbot-nc-hosted`. The keyring has the key of the encrypted data in that home
folder, so keep or delete the two together. An install with the same `--user` uses them again. To
delete the data too:

```sh
sudo userdel --remove openbot-nc && sudo rm -rf /srv/openbot-nc-hosted
```

To keep the server out of the team, revoke its certificate on the central server with `ca revoke`.

## How it works

`install-server.sh` takes the AppImage that you give (a local file or an https URL), checks its
SHA-512 when you give one, unpacks it and runs `resources/hosting/openbot-server-setup` from that
release. So the
install steps always match the build that they install. A release before this feature has no setup
file, and the install stops with a message.

`openbot-server-setup` uses the install steps of `openbot-hosted-update`: it
installs the packages in `packages.txt` and `optional-packages.txt`, copies the release to
`/opt/OpenBot-NC/app`, and installs the scripts, the AppArmor profile and the units. It writes `self`
to `/opt/OpenBot-NC/hosted/mode` and links `/usr/local/bin/openbot-nc`.

apt never removes a package of the computer for OpenBot (`--no-remove`). When a package in
`packages.txt` needs a removal, the install stops. A package in `optional-packages.txt` is skipped
when a command with its name already exists, or when it needs a removal. For example, on Raspberry
Pi OS `pcmanfm-pi` gives the `pcmanfm` command, and the `pcmanfm` package would remove the desktop
of the Pi.

The AppArmor profile (`/etc/apparmor.d/openbot-nc-hosted`) needs AppArmor 4 (`abi <abi/4.0>` and the
`userns` rule). When `/etc/apparmor.d/abi/4.0` does not exist and `apparmor_parser` cannot read the
profile, for example on Debian 12 with AppArmor 3.0, the install does not write the profile and
removes an old copy. These systems do not restrict user namespaces by default, so OpenBot does not need it.

When Ubuntu's `bwrap-userns-restrict` profile is loaded (the default on Ubuntu 26.04), the install
and each start of OpenBot add one rule to `/etc/apparmor.d/local/bwrap-userns-restrict`:
`priority=1 allow pix /** -> &bwrap,`. The Ubuntu profile of `/usr/bin/bwrap` removes all
capabilities from the programs that `bwrap` starts, and the Claude sandbox ("Workspace only") needs
`CAP_SYS_ADMIN` there. With the rule, those programs keep the profile of `bwrap`, for all users of
the computer. `sudo openbot-nc uninstall` removes the rule.

With `mode` set to `self`, `openbot-hosted-server` starts a D-Bus session with an unlocked keyring
and runs OpenBot under
Xvfb with `OPENBOT_SERVER=1`. Main (`src/main/server-mode.ts`) then opens the control socket
`/run/openbot-nc/control.sock` and connects to the central server when it has an identity. The
[watchdog](#watchdog) also runs: when main stops updating its heartbeat file for 10
minutes, the watchdog stops OpenBot and systemd starts it again.

The server has two Xvfb displays, one in each of two nested `xvfb-run` commands that share one
authority file. The outer one starts the agent display, at the [display size](#display-size), and
the script names it in `OPENBOT_AGENT_DISPLAY`. The inner one starts the display that OpenBot shows
its windows on, at 1280x800. Main gives the agent display to Computer Use and to the agent
processes, so an agent's screenshot does not show the OpenBot window. The agent
display has a window manager (Openbox) and a dark background with the OpenBot logo: windows have
title bars, and a right-click on the empty screen opens a menu with a terminal and a file manager. See
[Computer Use](architecture/computer-use.md#agent-display-on-a-server).

Updates: the server never downloads a release. `sudo openbot-nc update <file or URL>` or
`sudo /opt/OpenBot-NC/hosted/openbot-hosted-update stage <file or URL>` stages the AppImage that you
give. A staged release starts at the next boot, or when an owner, an admin or a permitted member
installs it in Server Settings > Updates. When an owner turns on the automatic update switch (it is
off by default), the server also installs it when it is idle. `sudo openbot-nc update` stages, stops
the service, applies and starts the service again. When a step fails or a signal stops it, the
command completes an interrupted copy, starts the service, and exits with an error.

## Control socket

The `openbot` command talks to main over HTTP on a Unix socket, with form bodies and `key=value`
text answers, so it needs only `curl`. The routes are `GET /v1/status`, `POST /v1/identity` (the path of an
identity file), `POST /v1/hosting` and `POST /v1/name`.

Threat model:

- systemd makes `/run/openbot-nc` for the service user with mode 0700, and main makes the socket 0600.
  Main refuses to listen when the directory belongs to another user or other users can enter it. It
  never removes a file at the socket path that is not a socket.
- Only the service user and root can connect. Agents run as the service user and already have full
  access to its files, its keyring and the OpenBot database, so the socket gives them nothing new.
- The socket answers a closed list of requests. An answer has the identity state, the team, the
  user, the device, the relay state and the sharing state, never a key. A value cannot add a line to
  an answer. A body is at most 4 KiB.
- Server mode starts only in a packaged Linux build with `OPENBOT_SERVER=1`.

## Not confirmed

- The full install runs only on Ubuntu 24.04 in tests. On Debian 12 and Debian 13, only the package
  step is tested (`apt-get --dry-run`). Debian 12 names some libraries without the `t64` suffix, and
  the install uses those names.
- Ubuntu 26.04: release 0.48.1 was tested on Ubuntu 26.04.1 arm64 in the Docker image, with
  `BASE=ubuntu:26.04` and the package list without `libminiupnpc17` (the 0.48.1 list stops that
  build). The server started with the Electron sandbox on, `openbot-nc status` answered, and it stopped
  with exit code 0. The install with systemd and a native x86_64 run were not tested.
- The full install was not run on a Linux computer before the first release that has the setup
  file. It needs a release build.
- [Display size](#display-size): the display sizes, the warning and the start with a value that is
  not valid were tested in the Docker image. An install with `--display-size` was not run. The click
  test ran only on arm64, with one `xmessage` button and one run for each model, size and screenshot.
  Claude and Codex were not in it. A window past the edge of the display was tested only with
  `xmessage`. The window screenshot limits come from the cua-driver source
  (`platform-linux/src/tools/impl_.rs`, `get_window_state` and `get_desktop_state`), and the Claude
  limits from the Claude docs. The Codex limit comes from `codex-rs/utils/image` and was not checked
  again. It is not known if Claude Code or Codex makes a screenshot smaller before it sends it to
  the model.
- The two displays were tested in an Ubuntu 24.04 container with a stand-in for OpenBot: OpenBot
  gets 1280x800, the agent display the display size, and a process without the authority file cannot
  open the agent display. Computer Use on the agent display was not tested on a server.
