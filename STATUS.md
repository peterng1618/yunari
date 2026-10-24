# Yunari status

Updated: 2026-10-25
Branch: `main`

## Current objective

The **release-readiness** plan ([`spec`](docs/superpowers/specs/2026-10-25-release-readiness-design.md), [`plan`](docs/superpowers/plans/2026-10-25-release-readiness.md)) makes the first published release possible: semantic product and schema versions with N−1 theme migration, a dependency audit policy that fails closed, and a GitHub Release + npm publish pipeline. Phase C continues with C3.

## Active work

- **Active plan:** `docs/superpowers/plans/2026-10-25-release-readiness.md` — Phases A and B complete; Phase C in progress, C1 and C2 committed.
- **A1 is complete:** decisions 0110 (migrate the previous schema major on open) and 0111 (stage the workspace as `yunari`) claim every watched path later tasks write.
- **A2 is complete:** `schemaVersion` is `"2.0.0"`; the strict validator accepts a semver major and still refuses every integer.
- **A3 is complete:** `readFabricThemeEnvelope` migrates the legacy integer and accepted older majors, then validates.
- **A4 is complete:** every open path reads through the migration; save, snapshot, package write and `requestVersion` stay strict.

## Last completed change

- **release-please is configured for one package:** `release-please-config.json` releases `src/web` as `node`; `.release-please-manifest.json` starts it at `0.1.0`.
- **`include-component-in-tag: false` makes the tag `vX.Y.Z`;** the release PR bumps `src/web/package.json`, its lockfile and `src/web/CHANGELOG.md`.
- **`.github/workflows/release.yml` runs `googleapis/release-please-action@v5` on push to `main`** with `contents`, `issues` and `pull-requests` write.
- **Verified:** both JSON files parse (exit 0), the workflow YAML parses, and `yunari --version` prints `0.1.0` from `src/web/package.json`.
- **Deferred:** the first release PR can only be inspected after a push to `main`.

## Next

1. C3 — the tag-driven publish workflow.

## Blockers / unverified

- **Migration is a forward obligation only:** at `2.0.0` there is no earlier supported major beyond the legacy integer, so no real N−1 migration is exercised by data.
- **No release has happened:** npm names `yunari` and `yunari-dashboard` both return 404 today, and trusted publishing is unconfigured.
- **`ffmpeg-static` installs with its scripts and the host boots from the tarball;** no media playback was exercised, so a missing binary still degrades only at first media use.
- **The first release PR is unverified:** it needs a push to `main`, and a tag created with `GITHUB_TOKEN` will not trigger the C3 publish workflow, so a PAT or GitHub App token is still needed.
- **`npm ls` marks the overridden edges `invalid` on npm 11.6.2** because the lockfile keeps each requester's exact pins; `npm ci` exits 0 and the only installed copies are the patched ones, so this is a reported deviation awaiting a controller ruling.
