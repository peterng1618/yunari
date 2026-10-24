# 0111 — The release stages a workspace-shaped package instead of publishing the host member

- **Date:** 2026-10-25
- **Status:** accepted
- **Paths:** `scripts/audit-policy.mjs` `scripts/stage-npm-package.mjs`

## The problem

Yunari has no release path: no git tag, no publish workflow, no artifact that
expiry of this tree would not break. `src/web/packages/host` is a **private**
workspace member named `@yunari/host` at version `0.0.0`, and its built bundle
expects a workspace around it: the bin shim loads `../dist/main.js`, the
launcher computes `packagesDir = path.resolve(here, "..", "..")` and serves the
player, editor and admin bundles from it, and `productVersion()` reads
`../../../package.json`. Publishing that member as it stands would publish name
and version nobody wants and none of the bundles the launcher serves.

The shape is: **a multi-package workspace whose runnable artifact is one
member, and whose member assumes its siblings at fixed relative paths.** The
question is whether to reshape the runtime for packaging, add a second published
package, or build an artifact that carries the existing layout.

## Rung 1 — Yunari

Searched: read `src/web/packages/host/bin/yunari.js`, `packages/host/vite.config.ts`,
`packages/host/src/main.ts`, and every workspace manifest (`src/web/package.json`
plus each `packages/*/package.json`, summarised with a Node script).

Found: **all eight workspace members are `private: true` at `0.0.0`; the only
version a release owns is `src/web/package.json`'s `0.1.0`** (`//version` records
the `vg-279` ruling). The host build is an SSR bundle
(`vite.config.ts`: `ssr: "src/main.ts"`, `target: "node22"`, `format: "esm"`,
`entryFileNames: "main.js"`) whose aliases point at `renderer-core` and
`theme-package` **source**, so those two packages are compiled in, not published.
`main.ts` uses `packagesDir` for `player/dist`, `editor/dist` and
`host/public` (`:370–375`), and `productVersion()` reads `../../../package.json`
(`:73–77`). The bin shim refuses a missing build and names the build command.

So the layout the launcher needs — `packages/host/{bin,dist,public}`,
`packages/player/dist`, `packages/editor/dist`, a root `package.json` — is
**already the tarball layout** if staging mirrors it. Nothing in production code
has to move.

## Rung 2 — dependencies

Searched: every workspace manifest's dependency list; the lockfile for a
packaging library (`git grep -n -E '"node_modules/(pacote|libnpmpublish|npm-packlist|arborist)"'
-- src/web/package-lock.json`, exit 1); the npm CLI's own pack and publish
support (`npm --version` → 11.6.2, `npm publish --help`).

Found: **no packaging dependency exists, direct or transitive, and none is
needed.** The only archive library in the tree is `fflate` in `theme-package`,
which zips `.yunari-theme` files — unrelated to npm packaging. `npm pack` was
exercised directly in the probe below; `npm publish` support was read from
`npm publish --help`, not run. A staging script needs `node:fs` and `node:path`
only.

## Rung 3 — platform

Searched: `npm pack` (run, measured), `npm publish --help`
(`--tag`, `--access`, `--dry-run`, `--provenance` all present), GitHub Release
assets (`gh release upload`), and npm trusted publishing (OIDC).

Found: **the platform supplies every step.** `npm pack` produced a tarball with
no extra tooling; `npm publish` supports provenance and dist-tags, which is what
a release needs; a GitHub Release can carry the `.tgz` and a `.zip` of the staged
directory. The parts it leaves to us are the ones the probe exposed: which files
the tarball contains, which dependencies the staged manifest must declare, and
that the version the manifest states matches the tag. Trusted publishing is a
publisher-side setting, not something the workflow can grant itself, and it was
**not verified against live docs** on 2026-10-25 (web search returned no
results); it is a risk carried into C3.

## Rung 4 — ecosystem

Searched: npm registry metadata and the upstream READMEs for the three release
automation tools (`npm view … version`, `release-please` README fetched); the
WinGet manifest for pnpm as the portable-zip prior art
(`manifests/p/pnpm/pnpm/10.10.0` in `microsoft/winget-pkgs`).

Found:

- **release-please 17.11.2** parses Conventional Commits and *"creates release
  PRs"*; its README says it *"does not handle publication to package managers"* —
  publication stays a separate step, which is the split this plan uses.
- **semantic-release 25.0.9** publishes on merge with no reviewable PR surface.
- **`@changesets/cli` 3.0.3** requires a hand-written changeset per change.
- **pnpm's WinGet entry uses `InstallerType: portable` with a real `.exe`**
  asset (`pnpm-win-x64.exe`), confirming the spec's claim that a `.cmd` shim is
  not a valid portable target; winget is therefore deferred until an executable
  exists.

A web search for release-tooling prior art returned no results on 2026-10-25,
consistent with the design's recorded unavailability; the registry metadata and
the fetched README are the evidence.

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| Publish `@yunari/host` as-is | None: private name, `0.0.0`, and no player/editor/public bundles in the member | Rename, version and file-list work in a private package | Publishing a member whose siblings live only in this repo | **Rejected** |
| A separate publish package (`src/publish/…`) | Workable | A second manifest that duplicates the version and dependency facts | Two owners for one version; a release that updates one and not the other | **Rejected** |
| **Stage a workspace-shaped package outside the repo** | Complete: `packages/…` layout is what the launcher already resolves | One script and a CI step | The staged manifest must match what the bundle actually imports — proved by the probe | **Chosen** |
| Bundle the host into a single SEA executable | Fits winget later | Out of scope; no SEA config, no signing | Slower to first release, and it defeats the npm install path that is the primary distribution | **Deferred** (spec D7) |

Staging wins because it needs **no production path change**, and the probe
separates what it proved from what it did not. It copied
`packages/host/{bin,dist}`, `packages/player/dist` and `packages/editor/dist`
(no `host/public`, no `schema/`), and proved two of the three assumptions:
`bin/yunari.js`'s `../dist/main.js` and `productVersion()`'s
`../../../package.json` resolve inside the tarball, because the installed
command printed `0.1.0`. It did **not** exercise `packagesDir` /
`host/public`, because `--version` exits before the server starts; C1's Step 5
(boot the installed host, fetch `/api/health`, `/editor` and `/`) owns that
proof.

## Rung 6 — probe

Staged outside the repository in
`C:\Users\peter\AppData\Local\Temp\yunari-a1-probe`:

1. Built the three bundles from `src/web/` (`npx vite build packages/player`,
   `… packages/editor`, `… packages/host`; exit 0).
2. Copied the four bundle paths — `packages/host/bin`, `packages/host/dist`,
   `packages/player/dist`, `packages/editor/dist` — plus `LICENSE` and
   `THIRD-PARTY-NOTICES.md` into a new temp directory.
3. Wrote a root manifest: `name: "yunari"`, `version: "0.1.0"`,
   `bin: { yunari: "packages/host/bin/yunari.js" }`, `type: "module"`,
   `engines.node: ">=22"`, `license: "MIT"`.
4. `npm pack` there, then `npm init -y` and `npm install <tarball>` in a second
   temp directory, then `./node_modules/.bin/yunari --version`.

Measured: `npm pack` → **6.4 MB package, 25.8 MB unpacked, 28 files,
shasum 965d43261465fde48d9b5db9bc8cba3511b405bc**.

**First run failed, and the failure is the useful number.** With the three
runtime dependencies the spec lists (`ffmpeg-static`, `node-forge`,
`systeminformation`) the installed command exited 1:
`ERR_MODULE_NOT_FOUND: Cannot find package 'culori' imported from
…/node_modules/yunari/packages/host/dist/main.js`. Scanning the built bundle's
bare imports gives `culori/fn`, `fflate`, `ffmpeg-static`, `node-forge`, plus a
dynamic `systeminformation`. Adding `culori@4.0.2` and `fflate@0.8.3` to the
staged manifest (both are dependencies of `renderer-core`/`theme-package`, not
of the host member) fixed it.

**Second run:** `added 25 packages`, then

```text
0.1.0
EXIT=0
```

Installed with `--ignore-scripts` (so `ffmpeg-static`'s download does not run);
`--version` does not need the binary. The staged manifest must therefore declare
**five** dependencies, not three — a fact C1 has to carry.

## Rung 7 — build

The plan's Phase C: C1 lands `scripts/stage-npm-package.mjs` and its test, C3
wires `publish.yml` around the staged directory as the publish root, and D1
writes the runbook. `scripts/audit-policy.mjs` in B3 is claimed here because
`scripts/` is a watched kind of path (decision 0025), and its own decision is
D5's fail-closed policy rather than a separate build question.

## Decision

**Stage the workspace into a `yunari` package outside the repository, then
`npm pack` and publish that directory.**

The specific reason: the launcher's three path assumptions are already the
workspace layout, so staging is the only option that ships a working command
with **no production code change** — and the probe proved the command, not just
the file list. The probe also fixes the one thing staging must get right: the
manifest declares every bare import in `dist/main.js` (`culori`, `fflate`,
`ffmpeg-static`, `node-forge`, `systeminformation`), because the host bundle
externalises them rather than bundling them.

Related decision in the same release path: B3's audit policy claims only the
`scripts/audit-policy.mjs` path, and fails closed on an unallowlisted finding
and on a stale allowlist entry, as the spec's D5 requires.
