# Yunari status

Updated: 2026-10-25
Branch: `main`

## Current objective

The **release-readiness** plan ([`spec`](docs/superpowers/specs/2026-10-25-release-readiness-design.md), [`plan`](docs/superpowers/plans/2026-10-25-release-readiness.md)) makes the first published release possible: semantic product and schema versions with N−1 theme migration, a dependency audit policy that fails closed, and a GitHub Release + npm publish pipeline. Phase C is complete; Phase D continues with D1.

## Active work

- **Active plan:** `docs/superpowers/plans/2026-10-25-release-readiness.md` — Phases A, B and C complete; D1–D2 committed, D3 remains.
- **A1 is complete:** decisions 0110 (migrate the previous schema major on open) and 0111 (stage the workspace as `yunari`) claim every watched path later tasks write.
- **A2 is complete:** `schemaVersion` is `"2.0.0"`; the strict validator accepts a semver major and still refuses every integer.
- **A3 is complete:** `readFabricThemeEnvelope` migrates the legacy integer and accepted older majors, then validates.
- **A4 is complete:** every open path reads through the migration; save, snapshot, package write and `requestVersion` stay strict.

## Last completed change

- **`README.md` rewritten to current state:** three processes, pre-release `0.x` status, the N−1 migration promise, Windows/Node requirements, build-from-source, first-phone steps, the feature set, CLI flags from `--help`, and the package table.
- **Stale claims deleted:** the "`yunari` on npm is unrelated" line and the 12-hour token/`curl -X DELETE` revocation; pairing is a six-character code for a durable display credential.
- **Releases are documented as pending:** package `yunari`, GitHub Releases, `npm i -g yunari@latest` as the post-publish path, the runbook link, and winget not supported.
- **`docs:check` exits 0;** the gate's only failures are the two known live-SMTC cases.

## Next

1. D3 — close the plan.

## Blockers / unverified

- **The publish workflow is unverified end to end:** no dispatch was authorised, so only its parse and its stage/pack/smoke/publish-dry-run commands were exercised, locally.
- **The first publish is a one-time local publish:** trusted publishing is configured on an existing package, so the owner builds and packs locally and runs `npm publish <tarball>` with their own token; the trusted publisher for `peterng1618/yunari`, workflow `publish.yml` applies from the second release, when the workflow takes over OIDC.
- **The release-token choice is open:** a `RELEASE_PLEASE_TOKEN` PAT or App token makes publication automatic, while a `GITHUB_TOKEN` release cannot trigger this workflow, leaving a manual dispatch on the tag.
- **Migration is a forward obligation only:** at `2.0.0` there is no earlier supported major beyond the legacy integer, so no real N−1 migration is exercised by data.
- **Two dependency deviations remain:** `ffmpeg-static` installs with scripts but no media playback was exercised, and `npm ls` marks the overridden edges `invalid` awaiting a controller ruling.
