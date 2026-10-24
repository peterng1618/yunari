# Yunari status

Updated: 2026-10-25
Branch: `main`

## Current objective

The **release-readiness** plan ([`spec`](docs/superpowers/specs/2026-10-25-release-readiness-design.md), [`plan`](docs/superpowers/plans/2026-10-25-release-readiness.md)) makes the first published release possible: semantic product and schema versions with N−1 theme migration, a dependency audit policy that fails closed, and a GitHub Release + npm publish pipeline. Phase A continues with A2–A4; no implementation exists yet.

## Active work

- **Active plan:** `docs/superpowers/plans/2026-10-25-release-readiness.md` — Phase A, tasks A1–A4, followed by Phases B–D.
- **A1 is complete:** decisions 0110 (migrate the previous schema major on open) and 0111 (stage the workspace as `yunari`) claim every watched path later tasks write.
- **A2 is complete:** `schemaVersion` is `"2.0.0"`; the strict validator accepts a semver major and still refuses every integer.
- **Next is A3:** one migration dispatcher, then A4 routes every open path through `readFabricThemeEnvelope`.
- **Probe finding for C1:** the staged manifest needs five runtime deps — `culori`, `fflate`, `ffmpeg-static`, `node-forge`, `systeminformation` — not the three the plan lists.

## Last completed change

- **The schema version is `"2.0.0"`:** `SUPPORTED_SCHEMA_VERSION` is a literal string, `SUPPORTED_SCHEMA_MAJOR` and `parseSchemaMajor` derive the major rather than restating it.
- **The strict validator speaks semver and refuses every integer,** including the legacy `2`, which belongs to A3's read path.
- **The published schema names `2.0.0`** in its `$id` and `const`; every writer emits the constant and every fixture carries the string.

## Next

1. A3 — add `migrations.ts` and `readFabricThemeEnvelope`, with the "every accepted older major has a migration" test.
2. A4 — route every open path through the reader; keep save, snapshot and publish-strict writes on the validator.
3. B1 — upgrade `vite` to `8.3.5` and `vitest` to `5.0.5`, then run the gate.
4. B2 — add the `undici`, `sharp` and `jsdom` overrides, each kept only if its suite passes.

## Blockers / unverified

- **Migration is a forward obligation only:** at `2.0.0` there is no earlier supported major beyond the legacy integer, so no real N−1 migration is exercised by data.
- **No release has happened:** npm names `yunari` and `yunari-dashboard` both return 404 today, and trusted publishing is unconfigured.
- **The staged-package probe ran with `--ignore-scripts`:** `ffmpeg-static`'s download and a full host boot from the installed tarball are unverified.
- **release-please settings and trusted publishing** were not verified against live docs; web search returned no results today.
