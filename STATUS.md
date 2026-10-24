# Yunari status

Updated: 2026-10-25
Branch: `main`

## Current objective

The **release-readiness** plan ([`spec`](docs/superpowers/specs/2026-10-25-release-readiness-design.md), [`plan`](docs/superpowers/plans/2026-10-25-release-readiness.md)) makes the first published release possible: semantic product and schema versions with N−1 theme migration, a dependency audit policy that fails closed, and a GitHub Release + npm publish pipeline. Phase A continues with A4.

## Active work

- **Active plan:** `docs/superpowers/plans/2026-10-25-release-readiness.md` — Phase A, tasks A1–A4, followed by Phases B–D.
- **A1 is complete:** decisions 0110 (migrate the previous schema major on open) and 0111 (stage the workspace as `yunari`) claim every watched path later tasks write.
- **A2 is complete:** `schemaVersion` is `"2.0.0"`; the strict validator accepts a semver major and still refuses every integer.
- **A3 is complete:** `readFabricThemeEnvelope` migrates the legacy integer and accepted older majors, then validates; A4 routes every open path through it.
- **Probe finding for C1:** the staged manifest needs five runtime deps — `culori`, `fflate`, `ffmpeg-static`, `node-forge`, `systeminformation` — not the three the plan lists.

## Last completed change

- **One read path migrates before validating:** `migrateFabricThemeEnvelope` normalises the legacy integer `2` to `"2.0.0"`, chains `SCHEMA_MIGRATIONS` upward, and verifies the chain reached the target.
- **The strict validator is untouched in strictness:** write paths still refuse every integer, and both paths share one sentence per version refusal.
- **The migration table is empty at `2.0.0`,** and an invariant test requires an entry for every major the reader accepts below the current one.

## Next

1. A4 — route every open path through the reader; keep save, snapshot and publish-strict writes on the validator.
2. B1 — upgrade `vite` to `8.3.5` and `vitest` to `5.0.5`, then run the gate.
3. B2 — add the `undici`, `sharp` and `jsdom` overrides, each kept only if its suite passes.

## Blockers / unverified

- **Migration is a forward obligation only:** at `2.0.0` there is no earlier supported major beyond the legacy integer, so no real N−1 migration is exercised by data.
- **No release has happened:** npm names `yunari` and `yunari-dashboard` both return 404 today, and trusted publishing is unconfigured.
- **The staged-package probe ran with `--ignore-scripts`:** `ffmpeg-static`'s download and a full host boot from the installed tarball are unverified.
- **release-please settings and trusted publishing** were not verified against live docs; web search returned no results today.
