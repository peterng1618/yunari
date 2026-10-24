# Yunari status

Updated: 2026-10-25
Branch: `main`

## Current objective

The **release-readiness** plan ([`spec`](docs/superpowers/specs/2026-10-25-release-readiness-design.md), [`plan`](docs/superpowers/plans/2026-10-25-release-readiness.md)) makes the first published release possible: semantic product and schema versions with N−1 theme migration, a dependency audit policy that fails closed, and a GitHub Release + npm publish pipeline. Phase C is complete; Phase D continues with D1.

## Active work

- **Active plan:** `docs/superpowers/plans/2026-10-25-release-readiness.md` — Phases A, B and C complete; C1, C2 and C3 committed.
- **A1 is complete:** decisions 0110 (migrate the previous schema major on open) and 0111 (stage the workspace as `yunari`) claim every watched path later tasks write.
- **A2 is complete:** `schemaVersion` is `"2.0.0"`; the strict validator accepts a semver major and still refuses every integer.
- **A3 is complete:** `readFabricThemeEnvelope` migrates the legacy integer and accepted older majors, then validates.
- **A4 is complete:** every open path reads through the migration; save, snapshot, package write and `requestVersion` stay strict.

## Last completed change

- **`.github/workflows/publish.yml` runs on `release: published` and manual `workflow_dispatch`** with a `dry_run` input defaulting to true, `contents: write` and `id-token: write`.
- **It gates and builds player, editor and host on Node 24,** stages with `--expect-version "${GITHUB_REF_NAME#v}"`, then packs the tarball and asserts the load-bearing entries.
- **The smoke step installs the tarball in a temp directory,** checks `yunari --version`, boots the host on port 4319 with `--no-browser` and requires 200 from `/api/health`, `/editor` and `/`.
- **Publish uses `--provenance --access public` and `--tag next` for a prerelease;** manual dispatch adds `--dry-run`, and assets upload only on a real release run.
- **Verified locally:** workflow YAML parses (exit 0), the staged pack is 35 files / 6.9 MB with every required entry, install-and-smoke passed, and `npm publish --dry-run` exited 0.

## Next

1. D1 — release documentation and ownership, including the trusted-publisher runbook.
2. D2 — rewrite the README to current state.
3. D3 — close the plan.

## Blockers / unverified

- **The publish workflow is unverified end to end:** no dispatch was authorised, so only its parse and its stage/pack/smoke/publish-dry-run commands were exercised, locally.
- **The first publish needs token auth:** trusted publishing is configured on an existing package, so the first `yunari` publish needs `NPM_TOKEN` or a manual token-seeded publish; the trusted publisher for `peterng1618/yunari`, workflow `publish.yml` applies from the second publish and needs that file on the default branch.
- **The release-token choice is open:** a `RELEASE_PLEASE_TOKEN` PAT or App token makes publication automatic, while a `GITHUB_TOKEN` release cannot trigger this workflow, leaving a manual dispatch on the tag.
- **Migration is a forward obligation only:** at `2.0.0` there is no earlier supported major beyond the legacy integer, so no real N−1 migration is exercised by data.
- **Two dependency deviations remain:** `ffmpeg-static` installs with scripts but no media playback was exercised, and `npm ls` marks the overridden edges `invalid` awaiting a controller ruling.
