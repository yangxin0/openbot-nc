# Contributing to OpenBot-NC

OpenBot-NC is a non-commercial fork of OpenBot. Thanks for helping improve it. Pull requests with clear verification are the easiest to
review.

## What you can send

These rules apply to people outside the organization that owns the fork. Organization members and
users with write access to the repository skip them.

You can open a pull request without an issue for:

- Bug fixes.
- Small improvements, alignments, and clean-ups that do not change how a feature works.
- Translations and documentation.
- A new provider, MCP app, or connector. Follow
  [Integrations](docs/architecture/integrations.md) ("Add a provider", "Add an application",
  "Add a connector").

These need an issue with the `approved` label before you write code:

- New features.
- Changes to how an existing feature works or looks.
- Large refactors, new dependencies, and changes to migrations, IPC contracts, the Team API,
  security boundaries, or CI.

To propose one, open an issue with the feature request form and wait. A maintainer adds `approved`
when the change fits OpenBot-NC. A change must keep the fork non-commercial: no paid features, no
vendor service and no WebRTC. Then link the issue in your
pull request with `Closes #<number>`.

The `Contribution policy` workflow applies these labels:

| Label | Meaning |
| --- | --- |
| `external` | The author is outside the organization. The workflow adds it. |
| `needs-approved-issue` | A maintainer decided that the pull request needs an approved issue. The `Contribution policy` check fails until the pull request closes an issue with the `approved` label. If it does not do this in 7 days, the workflow closes the pull request. |
| `approved` | A maintainer accepts the issue. Pull requests that close it pass the check. |
| `policy-exempt` | A maintainer turned off the check for this pull request. |

A maintainer who reopens a closed pull request starts a new 7-day period.

## Before opening an issue

- Use an issue form. The workflow closes an issue from outside the organization that does not
  come from a form or that has an empty required answer.
- Search existing issues first.
- Use Discussions for questions and for ideas that are not yet a specific request.
- Use the security process in `SECURITY.md` for vulnerabilities.
- Remove credentials, private file paths, conversation contents, and personal data from diagnostics.
- For a bug, give the platform, the OpenBot version, the operating system, the provider and its CLI
  version, the exact steps, and the expected and actual results. The bug form asks for each one.

## Development setup

```bash
git clone <repository URL of the fork> openbot
cd openbot
bun install --frozen-lockfile
bun run check
bun run dev
```

Coding agents skip `bun run check`: see [AGENTS.md, Checks](AGENTS.md#checks).

The supported toolchain is pinned in `package.json`. Use stable Bun 1.4.2, TypeScript 7, Vite 7, and the
existing Biome configuration. Biome is the only lint and format tool. Do not add a second linter,
Prettier, a second state library, or a UI kit without first discussing the architectural cost.
The Biome configuration also loads the repository-owned GritQL rules in
`tools/biome/anti-slop/rules`. Fix these findings at the domain boundary. Do not suppress a rule or
replace a concrete contract with a broad dictionary type.

Biome's `suspicious/noImportCycles` rejects circular imports across the whole repository, so runtime
imports point in one direction. When two modules need each other, move the shared piece into a third
module both can import — as `features/conversation/conversation-controller-context.tsx` does for the
conversation controller, and `features/team/team-typing.ts` for the one IPC call two differently
scoped owners both need.
Type-only imports (`import type`) are erased by the compiler and stay allowed in both directions.

## Pull requests

1. Make sure that the change is one you can send: see [What you can send](#what-you-can-send).
2. Create a branch from `main`.
3. Test behavior changes and reproduced bugs as [AGENTS.md, Tests](AGENTS.md#tests) describes.
4. Run `bun run check`. Coding agents do not: see [AGENTS.md, Checks](AGENTS.md#checks).
5. Describe user-visible changes, risks, and manual verification in the pull request. Link the
   issue that the pull request closes.

Do not commit generated `out`, `dist`, coverage, local browser profiles, Electron `userData`, CLI
state, `.env` files, credentials, real conversations, or user attachments.

## Security-sensitive changes

Preserve the following boundaries, and their tests where they exist:

- Electron sandboxing, context isolation, navigation policy, and IPC sender validation.
- Attachment realpath, MIME, size, quota, and managed-protocol checks.
- Queue serialization, idempotency, crash reconciliation, and atomic persistence.
- The browser tabs' page preload (`src/preload/browser-page.ts`): it only changes page values in the
  page world. It has no IPC and exposes no world, so a page gets no `window.openbot` and no path to
  main. `scripts/verify-preload-bundle.ts` checks this.
- Secret redaction and agent child-process cleanup.

Full agent access is intentional today, but new privileges or network surfaces still require an
explicit threat-model note in the pull request.

## Translations

English is the source text. A French or Japanese catalog can be partial: a key it does not have
shows in English. To add a key, a translation or a language, follow [docs/i18n.md](docs/i18n.md) and
run `bun run i18n:check`.

## Dependencies

Prefer the platform and existing dependencies. A new runtime dependency should remove more
complexity than it adds, have a compatible open-source license, and be justified in the pull request.

Bun does not resolve a version that is less than 3 days old (`minimumReleaseAge` in `bunfig.toml`),
and Dependabot waits the same time. Only `@norbert_bodziony/bloub`, which the maintainer publishes,
is excluded. Only the packages in `trustedDependencies` in `package.json` can
run install scripts. If a new dependency needs its install script, add it to that list and give the
reason in the pull request. `bun pm untrusted` shows the blocked scripts.

## Licensing

OpenBot-NC stays under the PolyForm Noncommercial License 1.0.0 (see [LICENSE](LICENSE)). The fork
has no Contributor License Agreement. Do not add a dependency or a file under a license that does not
permit this.

A contribution must be your original work, or you must identify the source and the license of the
material that you did not write. Do not submit copied UI assets, proprietary code, private plugin
binaries, or material whose license is unclear.
