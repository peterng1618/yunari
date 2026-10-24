# Releasing Yunari

Operational runbook for one release: how the version moves, what publishes it,
what ships, and what a mistake costs. The rules behind it are spec decisions D1,
D6 and D7 in
[`../superpowers/specs/2026-10-25-release-readiness-design.md`](../superpowers/specs/2026-10-25-release-readiness-design.md);
the packaging choice is
[`../decisions/0111-release-scripts-stage-the-workspace.md`](../decisions/0111-release-scripts-stage-the-workspace.md).

## One version, moved by release-please

`version` in `src/web/package.json` is the product version and its only owner.
The host CLI reads it at run time and the editor bundle is given it by Vite's
`define`, so both follow one edit. No schema number, theme version or other
package version is the product version.

Conventional Commit titles pick the level: `feat` → minor, `fix`/`perf`/
`refactor` → patch, `!` or `BREAKING CHANGE` → major. Before 1.0 semver allows a
breaking change in a minor bump, and release-please applies that rule.

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

- **With a `RELEASE_PLEASE_TOKEN`** secret (a PAT or GitHub App token supplied to
  `release.yml`) the release PR runs CI like any other PR, and merging it fires
  the publish workflow automatically.
- **Without one**, gate the release PR by hand — run the same checks CI would —
  and start the publish workflow yourself with `workflow_dispatch` on the tag
  (`gh workflow run publish.yml --ref vX.Y.Z`). Nothing else changes.

Pick one and keep it: a token added later changes who starts a publish, not what
a publish does.

## Publishing

`publish.yml` triggers on `release: published` and on `workflow_dispatch`. One
publish runs at a time (workflow-wide `concurrency: publish`), because the
version is only known inside the job.

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

## npm authentication: token first, OIDC after

npm trusted publishing is configured in an **existing package's** settings on
npmjs.com, so it cannot be set up before `yunari` exists. That forces an order:

1. **First publish is token-authenticated.** The package owner either exports an
   `NPM_TOKEN` secret as `NODE_AUTH_TOKEN` for that one run, or performs a
   manual token-seeded publish. No token is wired into the workflow; do not add
   one for later releases.
2. **Then configure the trusted publisher** for repository
   `peterng1618/yunari`, workflow `publish.yml`. `publish.yml` must exist on the
   default branch for npm to offer that binding.
3. **Second publish onward uses OIDC.** Provenance needs a public repository,
   `id-token: write` (already granted) and npm >= 11.5.1 — Node 24 ships newer.

If trusted publishing turns out to be unavailable, the `NPM_TOKEN` fallback
covers every release; record which one is in use before the next release.

## Version integrity

The tag and the packaged version must agree. Three checks enforce it and none is
advisory: `--expect-version` refuses a manifest version that differs from the
tag, the staging script independently refuses a manifest mismatch, and the
smoke test requires the installed `yunari --version` to print the tag version.
A mismatch fails the run before anything is published.

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
