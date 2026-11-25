# Releasing OpenBot-NC

A version tag runs `.github/workflows/release.yml` in your own GitHub repository. It builds the
desktop app for macOS, Windows and Linux, the macOS Host package and the Docker images, and publishes
them in the GitHub Releases of that repository and in its container registry. OpenBot-NC does not
update itself: people install a new build by hand. Release packages are not built on a developer
machine.

The phone app has no release workflow. Build it as [central server](central-server.md#phone-app)
says.

Codex, Claude, and Grok runtimes are optional downloads. They are not part of the application package.
Release CI downloads the pinned macOS, Windows, and Linux provider artifacts as control artifacts. It
checks their SHA-256 values, versions, licenses, and vendor signatures without copying them into
OpenBot. Linux has no code-signature contract to check, so its provider artifacts are verified by
SHA-256 and version only.

Installed apps offer the latest upstream release of a provider CLI (see
[Provider CLI updates](architecture/providers.md#provider-cli-updates)). The pinned version is the
first-install fallback. To stop a broken upstream release, add its version to the provider's list in
`provider-runtime-blocklist.json`. The list comes with the app, so a new release carries the change.

## One-time GitHub setup

Create the `release` environment in your repository, then add these environment secrets:

- `CSC_LINK` — a base64-encoded Developer ID Application `.p12` file.
- `MAC_PROVISIONING_PROFILE` — the base64-encoded Developer ID provisioning profile for
  `app.openbotnc.desktop`.
- `CSC_KEY_PASSWORD` — the application `.p12` export password.
- `CSC_INSTALLER_LINK` — a base64-encoded **Developer ID Installer** `.p12` file of the same team.
- `CSC_INSTALLER_KEY_PASSWORD` — the installer `.p12` export password.
- `APPLE_ID` — the Apple Account used for notarization.
- `APPLE_APP_SPECIFIC_PASSWORD` — a dedicated app-specific password for `notarytool`.
- `APPLE_TEAM_ID` — the Apple Developer team ID.

The macOS job stops when one of these secrets is missing. The workflow compares the team of the built
app with `APPLE_TEAM_ID`. These files still hold the team ID `ZTRDTUL87R` of the original vendor.
Replace it with your team ID before the first tag:

- `electron-builder.yml` (`mac.extendInfo.ElectronTeamID`);
- `build/entitlements.mac.plist` (`com.apple.developer.team-identifier`);
- `scripts/host-installation.ts` (`HOST_TEAM_ID`);
- `scripts/host-manager-macos.ts` (`SIGNING_REQUIREMENT`);
- `scripts/verify-macos-package.ts` (the expected `ElectronTeamID`).

Do not use an Apple Development certificate. Direct distribution requires a Developer ID Application
certificate. Never commit signing credentials to the repository.

### Windows signing

The Windows installer is unsigned unless the repository variable `AZURE_CLIENT_ID` is set. To sign
with Azure Artifact Signing, set the repository variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID` and
`AZURE_SUBSCRIPTION_ID` of an app registration whose federated credential trusts the `release`
environment of your repository. Then replace the publisher name, endpoint, account and certificate
profile in `electron-builder.windows-signing.yml`, which still name the signing account of the
original vendor. The `windows` job logs in with `azure/login` and runs
`bun run dist:win --config electron-builder.windows-signing.yml`.

### Docker package access

The Docker image needs no secret: the `docker-publish` job pushes to `ghcr.io/<owner>/<repository>`
with `GITHUB_TOKEN`.
[GHCR makes new packages private](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).
After the first push, a package administrator opens **Package settings** and sets
**Change visibility** to **Public**, or leaves it private and signs in to pull. The release workflow
checks anonymous access to the version, `v<version>` and `latest` tags. A failure leaves the GitHub
Release and the pushed images in place. Correct the package settings, then run the failed job again.

## Pin the Gemini CLI

`native-runtime.lock.json` pins Google's Antigravity CLI for the Gemini provider by hand. Read the
tag of `https://api.github.com/repos/google-antigravity/antigravity-cli/releases/latest` and set
`version` to it (the tags have no `v`). For each target, download `agy_cli_<target>.tar.gz`
(`agy_cli_windows_x64.zip` on Windows) from that release, and check its SHA-256 against the asset
`digest`. Set `url`, `assetSha256`, `downloadBytes`, `installedBytes` (the size of the extracted
`antigravity` or `antigravity.exe`) and the SHA-256 of `bin/antigravity` (`bin/antigravity.exe` on
Windows). Do not commit an archive: Google's license does not allow redistribution.

## Pin the Cursor CLI

`native-runtime.lock.json` pins the Cursor CLI by hand. Read the ACP registry entry `cursor`: its
`version` is the date, and each `archive` URL has the build, a date and a commit such as
`2026.09.28-64d2043`. Set `version` to the build. For each target, download
`downloads.cursor.com/lab/<build>/<os>/<arch>/agent-cli-package.tar.gz` (`.zip` on Windows), and
set the archive SHA-256 and size, `installedBytes` above the extracted size, and the SHA-256 of
each file in `files`. The paths in `files` are relative to `dist-package/`. Do not commit the
archives: Cursor's terms do not allow redistribution.

## Pin the Cline CLI

`native-runtime.lock.json` pins the Cline CLI by hand. Read the npm `latest` version of
`@cline/cli-darwin-arm64` and set `version`. For each target, download the platform package
`@cline/cli-<os>-<arch>` (`windows-x64` for Windows) from `registry.npmjs.org`, and set the tarball
SHA-256 and size, the SHA-256 of `bin/cline` (`bin/cline.exe` on Windows) and of
`extensions/plugin-sandbox-bootstrap.js`, and `installedBytes` above the extracted size. The npm
packages have no license file, so set `licenseSha256` to the SHA-256 of `LICENSE` at the
`cli-v<version>` tag of `github.com/cline/cline`.

## Pin the Kimi CLI

`native-runtime.lock.json` pins the Kimi Code CLI by hand. Read the `releases/latest` tag of
`github.com/MoonshotAI/kimi-cli` and set `version` and `tag` (the tag has no `v`). For each target,
download `kimi-<version>-<triple>-onedir.tar.gz` (`.zip` on Windows) from that release, and set the
asset SHA-256 and size, `installedBytes` above the extracted size, and the SHA-256 of each file in
`files`: `kimi` (`kimi.exe` on Windows), `_internal/base_library.zip` and the Python library. The
paths in `files` are relative to the archive's `kimi/` folder. Do not follow or copy the symbolic
links in the archive. Set `licenseSha256` to the SHA-256 of `LICENSE` at the version tag.

## Pin the Devin CLI

`native-runtime.lock.json` pins the Devin CLI by hand. Read `version` from
`https://static.devin.ai/cli/current/manifest.json` and set `version`. For each target, download
`devin-<version>-<triple>.tar.gz` (`.zip` on Windows) from `https://static.devin.ai/cli/<version>/`,
and check its SHA-256 against the manifest `sha256`. Set `url`, `assetSha256`, `downloadBytes`,
`installedBytes` (the size of the extracted `bin/` and `share/` folders), and the SHA-256 of
`bin/devin` (`bin/devin.exe` on Windows). `share/` holds only documentation, so it is not in
`files`.

## Pin the GitHub Copilot CLI

`native-runtime.lock.json` pins the GitHub Copilot CLI by hand. Read the tag of
`https://api.github.com/repos/github/copilot-cli/releases/latest` and set `version` without its
`v`. For each target, download `copilot-<target>.tar.gz` (`copilot-win32-x64.zip` on Windows) from
that release, and check its SHA-256 against the asset `digest`. Set `url`, `assetSha256`,
`downloadBytes`, `installedBytes` (the size of the extracted `copilot` or `copilot.exe`) and the
SHA-256 of `bin/copilot` (`bin/copilot.exe` on Windows).

## Pin Mistral Vibe

`native-runtime.lock.json` pins Mistral Vibe's ACP server by hand. Read the tag of
`https://api.github.com/repos/mistralai/mistral-vibe/releases/latest` and set `version` without its
`v`, and `licenseUrl` to `LICENSE` at that tag. For each target, download
`vibe-acp-<triple>-<version>.tar.gz` (`.zip` on Windows) from that release, and check its SHA-256
against the asset `digest`. Set `url`, `assetSha256`, `downloadBytes`, `installedBytes` above the
extracted size, and the SHA-256 of each file in `files`: `bin/vibe-acp` (`bin/vibe-acp.exe` on
Windows), `bin/_internal/base_library.zip`, the Python library, and
`bin/_internal/mistral_vibe-<version>.dist-info/licenses/LICENSE`. Do not follow or copy the symbolic
links in the archive.

## Pin the OpenCode CLI

`native-runtime.lock.json` also pins the OpenCode CLI that OpenBot downloads for the OpenCode
provider before its first update check answers, by `@opencode/cli-*` npm platform package (OpenCode 2), asset SHA-256,
extracted binary SHA-256, byte counts, and the MIT license file. The OpenCode 2 tarballs carry no license, so the lock
names an `opencode-ai` (OpenCode 1) release in `licensePackage` and the app installs the same MIT file from it. Codex,
Claude, and Grok are pinned in the same file by hand; OpenCode has a script, because the version, all five platform
packages, and the license have to agree:

```bash
bun run pin:opencode-runtime                # the newest published release
bun run pin:opencode-runtime 2.1.1          # one exact version
bun run pin:opencode-runtime 2.1.1 1.19.3   # and one exact `opencode-ai` release for the license
```

The script downloads all five platform tarballs, checks that `package/package.json` names the package
and version the lock claims, hashes the extracted binary and the license, and runs the extracted
binary of the target that matches the host with `--version` and refuses a value that is not the pinned one. That last check is
what protects `verifyInstalledRuntime`, which compares the installed version for exact equality. The
script prints the block for review instead of rewriting the lock, so paste it over the `opencode`
entry and re-run it with that exact version: the command reports `already pins OpenCode <version>`
when the committed block matches byte for byte.

Run it on a version bump only. A bump also needs the Windows checks in
[the OpenCode notes](architecture/providers.md#opencode-and-acp): the `win32-x64` values come from the
published tarball read on macOS, so a staged `opencode.exe --version` must be confirmed on Windows
before release.

## Pin the Computer Use driver

`native-runtime.lock.json` pins `cua-driver`, the third-party binary that gives every provider
Computer Use, by release tag, asset SHA-256, and one SHA-256 for each file OpenBot ships. Unlike the
provider CLIs, the driver is packaged rather than downloaded on demand, so the release carries it and
the user installs nothing.

```bash
bun run pin:cua-driver 0.34.0
```

The script downloads all four `-binary` release assets, hashes each shipped file, and refuses a
release that renamed an asset or dropped a file. It prints the block for review instead of rewriting
the lock, so paste it over the `cuaDriver` entry. Use the versioned `cua-driver-rs-v*` tags; the
`nightly-cua-driver-rs-v*` tags are rebuilt daily and are not a pin.

`bun run prepare:cua-driver` then writes `build/cua-driver/<platform>/<arch>` from the pin, verifying
every digest before and after it installs, and `electron-builder.yml` copies that directory to
`resources/cua-driver/<platform>/<arch>`. Every `package`, `package:*`, `dist:*` and `dist:release`
run does this first. Each installer carries only its own target's driver, and the package verifiers
check both that the driver is present and that no other platform's is. The macOS release job calls
`electron-builder` directly rather than through `dist:mac`, so it installs the driver in its own
`Install and verify native runtimes` step; the Windows and Linux jobs get it from `dist:win` and
`dist:linux`.

On macOS the driver arrives signed by Cua AI with the hardened runtime, a secure timestamp, and the
Automation entitlement. `mac.signIgnore` keeps that signature: re-signing it under OpenBot's
inherited entitlements would drop the entitlement and break the driver's Automation route.
Notarization accepts a nested binary signed by another Developer ID team, and
`verify-macos-package.ts` fails if the Cua AI authority or the hardened runtime flag is ever lost.

## Pin the Bun tool runtime

`native-runtime.lock.json` also pins Bun, which is not a provider CLI: it is the runtime a STDIO MCP
server is started with on a computer that has no Node, and the staged layout puts a second name
`bunx` beside it so that `npx -y <package>` has something to answer it. The pin has its own script
for the same reason OpenCode does - the version, five platform packages, and the MIT license have
to agree:

```bash
bun run pin:bun-runtime         # the newest published release
bun run pin:bun-runtime 1.4.2   # one exact version
```

It works like the OpenCode script: it downloads all five platform tarballs, checks
`package/package.json` against the registry metadata, hashes the extracted binary and
`LICENSE.md`, runs `--version` on the target that matches the host, and prints the block for review
instead of rewriting the lock. Paste it over the `bun` entry and re-run it with that exact version
to get `already pins Bun <version>`.

The x64 entries are the `baseline` builds. Bun's plain x64 build needs AVX2 and answers a spawn on
an older machine with an illegal instruction and no message, which would reach the user as an MCP
server that never starts.

Move this pin at release preparation, with the release-upgrade-safety audit, and not on a schedule:
a pinned runtime is OpenBot's supply chain, and a Bun security release only reaches users through an
OpenBot release. One reviewed commit per release.

## Release notes

`CHANGELOG.md` holds the release notes. Each pull request writes its
notes in its own file, `changelog.d/<branch>.md` with `-` for `/`, so two pull requests never change
the same lines. The version bump moves the items of every file into `CHANGELOG.md`, in the order
that the pull requests merged, and deletes the files. Items that are still under `## [Unreleased]`
in `CHANGELOG.md` go first.

- Put each change that a user can see in the file, in one of these groups:
  `### Added`, `### Changed`, `### Deprecated`, `### Removed`, `### Fixed`, `### Security`.
- Write one `- ` item for each change, for a user and not for a developer. Say what changed. For a
  fix, say what happened before.
- Write a step that the user must do after the upgrade as a bold sentence that ends with a full
  stop, for example `**Sign in again after you upgrade.**`. The page shows these items under "Action
  needed after you upgrade". Do not use bold for other sentences.

Write the notes of a change to the phone app in `apps/mobile/changelog.d/<branch>.md`, with the same
rules. `bun run mobile:release:patch`, `mobile:release:minor` and `mobile:release:major` move these
files into `apps/mobile/CHANGELOG.md` and set the version of the phone app.

`scripts/check-release-notes.ts` stops a release when the section is missing, empty or appears two
times, or when it has an unknown group, a group with no items, an item with no text or outside a
group, a placeholder such as `TODO`, or a heading with no real date. These steps run it:

- `bun run release:patch`, `release:minor` and `release:major` check the new section before they
  write it. They stop, and delete no file, when a line is not in an item.
- The pre-commit hook checks each staged `changelog.d` file with `--fragments`, and the staged
  `CHANGELOG.md` when a commit changes the `package.json` version.
- The `Changelog` workflow checks each `changelog.d` file. It fails a pull request that adds no
  `changelog.d` file and does not change `CHANGELOG.md`, unless the pull request has the
  `no-changelog` label. Use the label when a user sees no change.
- `bun run release:preflight` and the tag workflow check the section of the `package.json` version.

### Post-update notes

The desktop dialog uses edited excerpts of the published `CHANGELOG.md` in
`src/renderer/src/features/updates/whats-new-releases.json`. Before publishing a desktop release,
add its version, date, and selected notes there. Keep earlier entries for users who skip releases.
Use short, plain sentences that explain what the user can do. Put required upgrade steps in
`notices`. Use `added`, `changed`, and `fixed` for the other entries. Do not copy commit messages,
developer setup, internal paths, credentials, or unpublished plans. Review this text with the
release notes before tagging. A release can have no dialog entry when it has nothing to show.

The dialog shows the notes in the app language. Each translated language has
`src/renderer/src/features/updates/whats-new/<locale>.json` in the shape of the English file. When
you add a release to the English file, add its translation to each of these files: the same version
and date, the same notices, groups and item order, and one item for each English item. Write the
first sentence of each item as its headline, as in English; Chinese and Japanese end it with `。`.
Use the tone, the terms, and the screen names of the app catalogs in [i18n.md](i18n.md#terms).
An agent gives these translations to small-model subagents, as the
[release-upgrade-safety skill](../.agents/skills/release-upgrade-safety/SKILL.md#subagents-and-models) says.
`bun scripts/whats-new-translations.ts <version>` checks the files; `release:preflight` and the
tag workflow run it and stop a release that has no translation. A release that a file does not
have shows in English, so an older release that was never translated keeps its English text.

The app bundles this text and loads it when needed, so reading it does not send data or require
network access. The full changelog button opens the existing public page. Changing the bundled
text requires a new app release. Missing entries do not cause a network fallback.

The installed desktop version comes from `AppInfo`, not an available update or a remote server.
In development, `AppInfo` uses `package.json`; Electron otherwise reports its own version.
The local app profile keeps the highest consumed version in `openbot:whats-new-version`. On the
first launch of this feature, an existing `openbot:analytics-app-version` can supply the previous
version; the dialog does not enable analytics. A profile with no previous version gets a silent
baseline, so onboarding is not covered by release notes. Stable `x.y.z` releases participate;
unknown versions and prerelease builds do not advance the marker. Downgrades do not lower it.
The marker is saved before automatic display, including a load error; Settings > Updates can
open the notes again. Empty updates are consumed without opening. If the marker cannot be saved,
automatic display is disabled; manual opening still works.

Mobile has its own store version and `apps/mobile/CHANGELOG.md`. It must use a native screen and
its own local marker when post-update notes are added there. Desktop notes must not use a mobile
version or the version of a connected server. This desktop feature does not change mobile,
the central server, database schemas, or Team API contracts.

## Publish a version

Start from a clean, up-to-date `main` branch. The release notes are in `changelog.d/`. Choose the
semantic version bump:

```bash
bun run release:patch
# or: bun run release:minor
# or: bun run release:major
```

The command updates `package.json`, moves the `changelog.d` items and the items under `Unreleased`
under the new dated version heading, and deletes the `changelog.d` files. Review and publish that
preparation before you create the tag:

```bash
git add package.json CHANGELOG.md changelog.d
git commit -m "release: prepare vX.Y.Z"
git push origin main
bun run release:preflight
git tag -a vX.Y.Z -m "OpenBot-NC vX.Y.Z"
git push origin vX.Y.Z
```

Before the merge of the preparation, the release-upgrade-safety skill can start the
`Provider live E2E` workflow on that branch. It sends one real message to each provider
([Live provider test](provider-live-e2e.md)). Do not push the tag when it has a stop.

The workflow:

1. verifies that the tag matches `package.json`;
2. runs the offline repository check on its own macOS runner, in parallel with the builds;
3. builds signed and notarized ARM64 DMG and ZIP artifacts and a signed and notarized Host PKG on an
   Apple silicon runner, and signed and notarized x64 DMG and ZIP artifacts on an Intel runner;
4. builds a Windows x64 NSIS installer, signed when [Windows signing](#windows-signing) is set up;
5. builds unsigned Linux x64 and arm64 AppImages, with the launch check under `xvfb-run`;
6. verifies the unpacked applications, included runtimes, provider control artifacts, licenses,
   checksums, platform signing contracts, launch behavior, and artifact size limits;
7. generates SPDX SBOMs and GitHub build-provenance attestations;
8. publishes one GitHub Release only after all platform jobs pass. The update manifests get the
   percentage of the `RELEASE_STAGING_PERCENTAGE` repository variable (100 when it is not set). The
   app does not read them;
9. builds a Docker image (`docker/Dockerfile`) from each Linux AppImage, starts it with
   `docker/seccomp.json`, waits for `openbot-nc status`, and stops it;
10. after the GitHub Release is published, pushes both images to `ghcr.io/<owner>/<repository>`
    with the tags `<version>-amd64` and `<version>-arm64`, joins them under `<version>`,
    `v<version>`, `latest` and `sha-<commit>`, and attests the build provenance of that image.

Users can verify a downloaded artifact with
`gh attestation verify <file> --repo <owner>/<repository>`.

Before a tag, run the release path without publishing:

```sh
gh workflow run release.yml --ref <branch> -f mode=dry-run
```

The dry run runs the tag validation (without the tag and `main` checks), the Windows, Linux and
Docker builds, and all their verification steps. It does not run the macOS job or the publish jobs,
and it makes no attestation.

Each build job also runs `scripts/release-upgrade-e2e.ts` before `publish`. It installs the previous
release of your repository, starts it on a new profile, seeds data, and quits it. It then installs
the new build over it, starts it on the same profile, and checks the version, the schema version,
every migration, table and column, `PRAGMA integrity_check`, the foreign keys, and the seeded data. A
failure stops the release before `publish`. Not confirmed: the first release of a repository has no
previous release, and this step then fails; publish the first release with this step removed, or
give it `--previous-artifact`.

which recognizes English only, is no longer offered: Settings > Voice shows it only while it is in
use or downloaded, and a saved choice of it still works. Its four pinned files go in
`runtimes/bark-3.0-plus-int8`. They come from an
unofficial sherpa-onnx conversion; the license is in `build/licenses/Underdog-Bark-3.0-Plus-LICENSE`.
The optional NVIDIA Parakeet Unified EN 0.6B int8 model, which recognizes English only, is downloaded
the same way when the user selects Download in Settings > Voice. Its four pinned files go in
`runtimes/parakeet-unified-en-0.6b-int8`. It is under the NVIDIA Open Model License; the license and
its notice are in `build/licenses/NVIDIA-Parakeet-Unified-EN-0.6B-LICENSE`. The optional Cohere
Transcribe int8 model, which takes one of its 14 languages, is downloaded the same way when the user
selects Download in Settings > Voice. Its four pinned files (about 2.9 GB) go in
`runtimes/cohere-transcribe-14-lang-int8`. Its license is in `build/licenses/Cohere-Transcribe-LICENSE`.
At startup, a packaged application removes the old `runtimes/whisper` directory if it exists. The
Supertonic 3 int8 voice model, which reads replies aloud, is downloaded the same way only when the
user turns on Read replies aloud or selects Download in the Spoken replies section. Its eight pinned
files go in `runtimes/supertonic-3-int8`. The speech host, `voice-speech-host.js`, is a separate
utility process that loads the same addon. Its weights are under OpenRAIL-M; the license is in
`build/licenses/Supertone-Supertonic-3-LICENSE`.

The release workflow stops if the macOS update ZIP, the Windows NSIS installer, or the Linux AppImage
is larger than 700 MiB, or if the DMG is larger than 750 MiB. It also stops if update metadata has a wrong size or SHA-512, if
a voice model is present, or if the application contains a second native Claude runtime.

## Preflight checklist

Before a tag:

1. run the Team API compatibility matrix for every protocol that remains in the adapter registry;
2. run `bun run release:preflight` and resolve every reported release-secret or repository gate;
3. confirm the `release` environment contains all eight macOS secrets above and that the Apple team
   ID is replaced in the files above;
4. run `bun install --frozen-lockfile` and `bun run check` from a clean clone;
5. run `bun run package:verify` on macOS; Windows and Linux packaging and launch verification run on
   the release runners;
6. confirm that the lock file contains all six provider artifacts, their download and install sizes,
   and that their install checks pass;
7. smoke-test setup, the identity import, chat streaming, queues, attachments, agent messaging,
   browser control and context compaction;
8. on macOS ARM64, macOS x64, Windows x64, and Linux x64, install the new build over the previous one
   and confirm that local agents, conversations, and queues stay;
9. test first voice use, download progress, retry after a stopped download, transcription, and cached
   offline use;
10. on Ubuntu 24.04 x64 with the AppArmor profile from `build/linux/openbot.apparmor` installed,
    confirm the AppImage starts with the sandbox on, that a provider downloads in-app, and that the
    microphone control is absent;
11. confirm `CHANGELOG.md` describes the version and the working tree is clean;
12. create and push the version commit, and create the tag locally, only after CI passes on `main`;
13. when the change needs a new central server, update the central server before people install the
    new build;
14. push the tag.

The unsigned local macOS package is a development artifact. It does not prove Gatekeeper or
notarization. Only the `codesign`, `spctl`, and `stapler` checks of the signed release workflow prove
them.

## Managed-host release package

The normal DMG remains the desktop application. The optional Host PKG installs managed-host
infrastructure only. Both use the validated `v<VERSION>` tag and the exact same source commit.
The macOS job fails if Host compilation, signing, payload verification, notarization, stapling,
or checksum generation fails; it never publishes a release with the Host package silently omitted.

Expected macOS assets:

```text
OpenBot-NC-<VERSION>-arm64.dmg
OpenBot-NC-<VERSION>-arm64.zip
OpenBot-Host-<VERSION>-arm64.pkg
latest-mac.yml
SHA256SUMS-macos.txt
OpenBot-<VERSION>-macos.spdx.json
OpenBot-Host-<VERSION>-macos.spdx.json
OpenBot-<VERSION>-macos.sigstore.json
OpenBot-NC-<VERSION>-x64.dmg
OpenBot-NC-<VERSION>-x64.zip
SHA256SUMS-macos-x64.txt
OpenBot-<VERSION>-macos-x64.spdx.json
OpenBot-<VERSION>-macos-x64.sigstore.json
```

The macOS checksum file covers the DMG, ZIP, and Host PKG. The existing provenance step consumes
that file, so all three artifacts are attested against the same tag, commit, and release run.
The publish job downloads `release-macos` and `release-macos-x64` and publishes the PKG with the
other assets. `SHA256SUMS-macos-x64.txt` covers the x64 DMG and ZIP.
`latest-mac.yml` still describes only Electron application updates; a `.pkg` reference is rejected.

After verifying OpenBot-NC.app, the macOS job:

1. runs native account tests without creating users;
2. imports the application and installer certificates into a temporary, isolated keychain;
3. compiles standalone ARM64 `host-manager` and `openbot-host` executables with Bun, and the native
   account helper with Swift; no target-machine runtime or compiler is required;
4. signs all executables with **Developer ID Application**, hardened runtime and timestamp, and
   checks their fixed identifiers and the team in `HOST_TEAM_ID` (`scripts/host-installation.ts`);
5. creates the fixed root:wheel package payload and signs the PKG with **Developer ID Installer**;
6. expands it and rejects extra files, symlinks, unsafe modes/owners, version mismatches, changed
   installer scripts, unexpected destinations, or non-system dynamic runtime dependencies;
7. submits the PKG through `notarytool`, waits for `Accepted`, staples it, then requires successful
   `pkgutil --check-signature`, `spctl --assess --type install`, and `stapler validate`;
8. generates checksums and the Host payload SBOM, attests provenance, and uploads the PKG.

The Bun executables need only `com.apple.security.cs.allow-jit` for JavaScriptCore's ARM64 JIT.
The native account helper has no special entitlements. Library validation, executable-page
protection, and the hardened runtime remain enabled. CI launches the signed standalone binaries
with a system-only PATH and exercises a hot JavaScript loop before publication. Do not copy broad
example Bun entitlements that disable these protections. If the pinned Bun version cannot pass
these checks, stop the release and investigate; do not weaken the flags to obtain a signature.

The release keychain and imported `.p12` files are deleted at step exit. The installer identity is
mandatory and distinct from the application identity; add both new secrets before tagging. Never
publish an unsigned Host package. The test fixture package is temporary, unsigned, never installed,
and never uploaded as a release asset.

CI does not install the root daemon or create tenant accounts on the runner. Package expansion,
BOM ownership/mode verification, plist/signature checks, standalone smoke checks, and mocked CLI
checks run there. Actual signed PKG installation/upgrade, new-account login, private-home isolation,
and two-user Aqua relaunch remain the [target-host acceptance gate](multi-tenant-hosting.md#target-host-acceptance-required-before-tenants-use-the-host).
No tenant-data backup is made. Infrastructure updates require administrator installation of a
newer signed Host PKG; the daemon never replaces itself.

