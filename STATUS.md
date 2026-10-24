# Yunari status

Updated: 2026-10-25
Branch: `main`

## Current objective

The **release-readiness** plan ([`spec`](docs/superpowers/specs/2026-10-25-release-readiness-design.md), [`plan`](docs/superpowers/plans/2026-10-25-release-readiness.md)) makes the first published release possible: semantic product and schema versions with N−1 theme migration, a dependency audit policy that fails closed, and a GitHub Release + npm publish pipeline. Phase A continues with A2–A4; no implementation exists yet.

## Active work

- **Active plan:** `docs/superpowers/plans/2026-10-25-release-readiness.md` — Phase A, tasks A1–A4, followed by Phases B–D.
- **A1 is complete:** decisions 0110 (migrate the previous schema major on open) and 0111 (stage the workspace as `yunari`) claim every watched path later tasks write.
- **Next is A2:** `schemaVersion` becomes `"2.0.0"`, while the integer `2` stays refused on the write path.
- **A3 and A4 follow:** one migration dispatcher, then every open path routed through `readFabricThemeEnvelope`.
- **Probe finding for C1:** the staged manifest needs five runtime deps — `culori`, `fflate`, `ffmpeg-static`, `node-forge`, `systeminformation` — not the three the plan lists.
- **No production code changed yet:** the design, plan and decision notes are the only landed work.

## Last completed change

- **Decision 0110** records the migration dispatcher: one conversion before validation, strict writers, legacy integer `2` normalised to `"2.0.0"`.
- **Decision 0111** records staging the workspace as `yunari`; the probe packed 6.4 MB / 28 files and `yunari --version` printed `0.1.0`.
- **The probe found the staged manifest needs `culori` and `fflate`** beside the host's three, because the host bundle externalises them.
- **This plan is now the one active plan** in `STATUS.md`.
- **No production code changed:** later tasks A2–A4 and B3/C1 write the claimed paths.

## Next

1. A2 — make the schema version a semver string (`"2.0.0"`) and update the schema file, fixtures and tests.
2. A3 — add `migrations.ts` and `readFabricThemeEnvelope`, with the "every accepted older major has a migration" test.
3. A4 — route every open path through the reader; keep save, snapshot and publish-strict writes on the validator.
4. B1 — upgrade `vite` to `8.3.5` and `vitest` to `5.0.5`, then run the gate.
5. B2 — add the `undici`, `sharp` and `jsdom` overrides, each kept only if its suite passes.

## Blockers / unverified

- **Migration is a forward obligation only:** at `2.0.0` there is no earlier supported major beyond the legacy integer, so no real N−1 migration is exercised by data.
- **No release has happened:** npm names `yunari` and `yunari-dashboard` both return 404 today, and trusted publishing is unconfigured.
- **The staged-package probe ran with `--ignore-scripts`:** `ffmpeg-static`'s download and a full host boot from the installed tarball are unverified.
- **release-please settings and trusted publishing** were not verified against live docs; web search returned no results today.
