# Yunari status

Updated: 2026-10-25
Branch: `main`

## Current objective

The **release-readiness** plan ([`spec`](docs/superpowers/specs/2026-10-25-release-readiness-design.md), [`plan`](docs/superpowers/plans/2026-10-25-release-readiness.md)) makes the first published release possible: semantic product and schema versions with N−1 theme migration, a dependency audit policy that fails closed, and a GitHub Release + npm publish pipeline. Phase A continues with A4.

## Active work

- **Active plan:** `docs/superpowers/plans/2026-10-25-release-readiness.md` — Phase A complete, Phase B next.
- **A1 is complete:** decisions 0110 (migrate the previous schema major on open) and 0111 (stage the workspace as `yunari`) claim every watched path later tasks write.
- **A2 is complete:** `schemaVersion` is `"2.0.0"`; the strict validator accepts a semver major and still refuses every integer.
- **A3 is complete:** `readFabricThemeEnvelope` migrates the legacy integer and accepted older majors, then validates.
- **A4 is complete:** every open path reads through the migration; save, snapshot, package write and `requestVersion` stay strict.
- **Probe finding for C1:** the staged manifest needs five runtime deps — `culori`, `fflate`, `ffmpeg-static`, `node-forge`, `systeminformation` — not the three the plan lists.

## Last completed change

- **Opens migrate, writes stay strict:** the editor mount, store read, player loader, both catalogue readers, the package reader and the publish route call `readFabricThemeEnvelope`.
- **Publish serves the migrated envelope:** a legacy-integer document is published as `"2.0.0"`, and `"1.0.0"` is refused with the unsupported sentence.
- **Strict write paths unchanged:** `checked()`, the editor `snapshot`, `writeThemePackage` and `requestVersion` still call the validator and refuse the integer.
- **Seventeen cases added** across the six existing suites (16 open-path, one strict-writer); affected suites pass and typecheck is clean.

## Next

1. B1 — upgrade `vite` to `8.3.5` and `vitest` to `5.0.5`, then run the gate.
2. B2 — add the `undici`, `sharp` and `jsdom` overrides, each kept only if its suite passes.

## Blockers / unverified

- **Migration is a forward obligation only:** at `2.0.0` there is no earlier supported major beyond the legacy integer, so no real N−1 migration is exercised by data.
- **No release has happened:** npm names `yunari` and `yunari-dashboard` both return 404 today, and trusted publishing is unconfigured.
- **The staged-package probe ran with `--ignore-scripts`:** `ffmpeg-static`'s download and a full host boot from the installed tarball are unverified.
- **release-please settings and trusted publishing** were not verified against live docs; web search returned no results today.
