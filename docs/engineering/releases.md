# Releasing Yunari

Operational runbook for one release: how the version moves, what publishes it,
what ships, and what a mistake costs. The rules behind it are spec decisions D1,
D6 and D7 in
[`../superpowers/specs/2026-10-25-release-readiness-design.md`](../superpowers/specs/2026-10-25-release-readiness-design.md);
the packaging choice is
[`../decisions/0113-release-scripts-stage-the-workspace.md`](../decisions/0113-release-scripts-stage-the-workspace.md).

## One version, moved by release-please

`version` in `src/web/package.json` is the product version and its only owner.
The host CLI reads it at run time and the editor bundle is given it by Vite's
`define`, so both follow one edit. No schema number, theme version or other
package version is the product version.

Conventional Commit titles pick the level: `feat` → minor, `fix` (and `deps`) →
patch, `!` or `BREAKING CHANGE` → major. A non-breaking `refactor`, `perf`,
`chore`, `docs` or `build` is not a releasable unit and does not open a release
at all. `release-please-config.json` sets `bump-minor-pre-major: true` (its own
default is `false`), so a breaking change before 1.0 bumps minor — `0.1.0` to
`0.2.0` — rather than jumping to `1.0.0`, which is the pre-1.0 rule semver
allows.

`.github/workflows/release.yml` runs release-please on every push to `main` and
opens (or updates) one release PR that bumps `src/web/package.json`, its
lockfile entry and `src/web/CHANGELOG.md`. Merging that PR writes the `vX.Y.Z`
tag — `include-component-in-tag: false` — and creates the GitHub Release with
generated notes. Release-please does not publish to npm; that stays a separate
job.

The first public release is **`0.1.0`**, and `.release-please-manifest.json`
holds that baseline. Contingency: if the first release PR proposes any other
version, set the manifest's `src/web` value to `0.0.0` — the first computed
release is then `0.1.0` when the history holds a `feat` (a fix-only history
computes `0.0.1`).

## Release token: two supported modes

A PR or release created with the default `GITHUB_TOKEN` does not trigger further
workflows. With no further setup that means the **release PR gets no CI** and
the `release: published` event **does not fire `publish.yml`**.

- **With a `RELEASE_PLEASE_TOKEN`** — add `token: ${{ secrets.RELEASE_PLEASE_TOKEN }}`
  under `with:` in `release.yml`, backed by a PAT or GitHub App token. The
  release PR then runs CI like any other PR, and merging it fires the publish
  workflow automatically. **No such secret exists today and `release.yml` passes
  no `token:`**, so the mode below is the one in use.
- **Without one (current)**, gate the release PR by hand — run the same checks CI
  would — and start the publish workflow yourself with `workflow_dispatch` on the
  tag (`gh workflow run publish.yml --ref vX.Y.Z`). Nothing else changes.

Pick one and keep it: a token added later changes who starts a publish, not what
a publish does.

## Publishing

`publish.yml` publishes every release **after the first**; the first is a
one-time local publish by the owner (see npm authentication below). It triggers
on `release: published` and on `workflow_dispatch`. One publish runs at a time
(workflow-wide `concurrency: publish`), because the version is only known inside
the job.

Always dispatch a dry run first. It gates, builds, stages, packs, installs and
smokes the tarball, and runs `npm publish --dry-run`, but publishes nothing and
uploads no asset:

```bash
gh workflow run publish.yml --ref vX.Y.Z -f dry_run=true
```

A real manual run needs the GitHub Release for that tag to exist already,
because the asset upload targets it, and must pass `dry_run=false` explicitly —
`dry_run` defaults to true and any dispatch that does not say `false` stays a
dry run. A run started by `release: published` is never a dry run.

What the job does, in order:

1. Checkout at full depth (the gate dates licence rules by commit history),
   Node 24, `npm ci`.
2. `npm run gate`.
3. Build `@yunari/player`, `@yunari/editor` and `@yunari/host`.
4. Derive the version from the tag (`${GITHUB_REF_NAME#v}`) and the dist-tag:
   a version containing `-` goes to `next`, everything else to `latest`.
5. Stage the package outside the repository with
   `node scripts/stage-npm-package.mjs --out "$STAGE" --expect-version "$VERSION"`.
6. `npm pack` the staged directory and check the tarball holds the entry points
   a working install needs — the bin shim, `host/dist/main.js`, the three host
   pages, both app `index.html` files, the published schema, `LICENSE` and
   `THIRD-PARTY-NOTICES.md`.
7. Install the packed tarball into a fresh directory with no workspace above it,
   require `yunari --version` to equal the tag version, boot the host with
   `--no-browser`, and require `/api/health`, `/editor` and `/` to answer 200.
8. `npm publish` **that tarball** with `--provenance --access public --tag
   <dist-tag>` (`--dry-run` added for a dry run). Publishing the exact file that
   was installed and smoked is the point.
9. On a real run, attach `yunari-X.Y.Z.tgz` and `yunari-X.Y.Z.zip` (the staged
   directory, zipped) to the GitHub Release with `gh release upload --clobber`.

## npm authentication: first release local, later releases OIDC

npm trusted publishing is configured in an **existing package's** settings on
npmjs.com, so it cannot be set up before `yunari` exists. The publish workflow
cannot cover that gap either: it passes no `registry-url` to `actions/setup-node`
and no `NODE_AUTH_TOKEN` to the publish step, so exporting a secret on its own
would be inert and the publish would fail `E401`. The first publish is therefore
a one-time, token-authenticated publish run by the owner locally, and the
workflow takes over after the trusted publisher exists. **This bootstrap has not
been run yet.**

1. **Build and pack the release locally**, on the release commit, from `src/web`.
   The block is POSIX shell: run it in Git Bash or WSL. On Windows use
   `%TEMP%\yunari-assets` (and a `%TEMP%\yunari-package` staging path) instead of
   `/tmp/...` — the staging directory must be outside the repository and empty.

   ```bash
   cd src/web
   npm ci
   npm run gate
   npm run build -w @yunari/player
   npm run build -w @yunari/editor
   npm run build -w @yunari/host
   cd ../..
   mkdir -p /tmp/yunari-assets
   node scripts/stage-npm-package.mjs --out /tmp/yunari-package --expect-version 0.1.0
   (cd /tmp/yunari-package && npm pack --pack-destination /tmp/yunari-assets)
   ```

   `mkdir` comes first because `npm pack --pack-destination` fails with `ENOENT`
   when the destination directory does not exist — the publish workflow creates
   it the same way. The `.tgz` produced here is the artifact that ships.

2. **Publish that tarball with the owner's npm token** — `npm login` on the
   owner's account, or the token in the environment for this one command. Run it
   with `--dry-run` once, then for real:

   ```bash
   npm publish /tmp/yunari-assets/yunari-0.1.0.tgz --access public
   ```

   No `--provenance`: provenance is issued by the OIDC workflow, and a local run
   has no OIDC identity to issue it from.

3. **Upload the same `.tgz` and a `.zip` of the staged directory** to the GitHub
   Release for the tag by hand (`gh release upload v0.1.0 <files>`). This is what
   the workflow does automatically for later releases.

4. **Configure the trusted publisher** for repository `peterng1618/yunari`,
   workflow `publish.yml`. `publish.yml` must exist on the default branch for npm
   to offer that binding.

5. **From the second release on, the workflow publishes over OIDC** — no token
   and no secret. Provenance needs a public repository, `id-token: write`
   (already granted) and npm >= 11.5.1; the Node 24 the workflow pins resolves an
   npm newer than that.

Keep the tracked workflow token-free: no `NPM_TOKEN`, no `registry-url`. If the
trusted publisher cannot be configured, the local publish in step 2 is the only
publication path — the workflow cannot authenticate — and that has to be said
before the next release rather than discovered by it.

## Version integrity

The tag and the packaged version must agree. Two checks enforce it and neither is
advisory: `--expect-version` refuses a manifest version that differs from the
tag, and the smoke test requires the installed `yunari --version` to print the
tag version. A mismatch fails the run before anything is published. (The staging
script's own manifest comparison is the same check as `--expect-version`, not a
third one.)

## Installing and updating

```bash
npm i -g yunari@latest
```

`npx yunari` also works, but this is a long-running host and a global install is
the intended path. A prerelease is published under `next` and is not reachable
from `@latest`.

The first release's notes should state the package size: the staged tarball
measured about **6.9 MB packed / 26.8 MB unpacked**, and it includes
sourcemaps.

## A bad release

npm allows unpublishing a version **only within 72 hours** of publication. After
that window the only lever is `npm deprecate yunari@X.Y.Z "<reason>"`, which
leaves the version installable and merely warns.

**Never reuse a version number.** npm refuses to publish a version that has ever
existed, and a machine that already installed it keeps those bytes until
something moves it. The cost of a bad release is therefore not a re-publish: it
is a deprecated version users keep, a lockfile pin that still resolves, and a
new patch version to carry the fix — plus every install in between serving the
bad bytes with only a warning.

So the dry run is cheap and the mistake is not: dispatch it before every real
release.

## winget is deferred

winget is not supported and must not be claimed. WinGet's `zip` +
`NestedInstallerType: portable` needs a real `.exe` at the nested path, and a
`.cmd` wrapper is not a valid portable target. The choices when this becomes
work: a Node single-executable application (`node --experimental-sea-config`)
embedding the built host, a ZIP whose root holds an executable plus the app, or
an Inno Setup/MSI installer with a dependency on `OpenJS.NodeJS.LTS`.

The submission inputs already exist: the GitHub Release asset URL and the
asset's SHA256. Later versions then go through `wingetcreate update`. Nothing
else about winget is in scope before a packaged executable does.

## What a release changes, and where it is recorded

- The version bump and notes: the release PR (`src/web/package.json`,
  `src/web/CHANGELOG.md`, `.release-please-manifest.json`).
- Published bytes: the staged tree and tarball built from that commit — never
  from a working tree.
- Dependency and licence re-audit before release, and the accepted findings:
  [`dependencies.md`](dependencies.md). The audit policy is its own CI job and
  fails on a finding outside the allowlist.
- Who owns each release concept: [`../architecture/ownership.md`](../architecture/ownership.md).
