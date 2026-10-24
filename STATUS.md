# Yunari status

Updated: 2026-10-25
Branch: `main`

## Current objective

The **release-readiness** plan ([`spec`](docs/superpowers/specs/2026-10-25-release-readiness-design.md), [`plan`](docs/superpowers/plans/2026-10-25-release-readiness.md)) makes the first published release possible: semantic product and schema versions with N−1 theme migration, a dependency audit policy that fails closed, and a GitHub Release + npm publish pipeline. Phase A continues with A4.

## Active work

- **Active plan:** `docs/superpowers/plans/2026-10-25-release-readiness.md` — Phase A complete, Phase B in progress.
- **A1 is complete:** decisions 0110 (migrate the previous schema major on open) and 0111 (stage the workspace as `yunari`) claim every watched path later tasks write.
- **A2 is complete:** `schemaVersion` is `"2.0.0"`; the strict validator accepts a semver major and still refuses every integer.
- **A3 is complete:** `readFabricThemeEnvelope` migrates the legacy integer and accepted older majors, then validates.
- **A4 is complete:** every open path reads through the migration; save, snapshot, package write and `requestVersion` stay strict.
- **Probe finding for C1:** the staged manifest needs five runtime deps — `culori`, `fflate`, `ffmpeg-static`, `node-forge`, `systeminformation` — not the three the plan lists.

## Last completed change

- **`undici` 7.30.1 and `sharp` 0.35.5 overrides:** keep the Cloudflare toolchain's transitive copies patched; `npm audit` falls from eight high findings to four.
- **The kept overrides are proven by the Worker suite:** `npm run test:worker` exits 0 with 12 files and 72 tests.
- **The `jsdom` 30 override was removed:** eight editor DOM cases failed on its changed CSS serialisation and DOM-removal semantics; `whatwg-encoding` 3.1.1 stays, and the three-package DOM run exits 0 with 254 files and 3672 tests.
- **Four high findings remain, recorded in `docs/engineering/dependencies.md`:** `node-forge` (ADR 0070), and `zod` below 4.6.6 via `@google/design.md`'s v3 and `@cloudflare/vitest-pool-workers`'s 4.4.3.
- **Gate stops only at the known SMTC pair:** 383 of 384 files and 5718 of 5720 tests pass, and the Worker suite exits 0 outside the gate.

## Next

1. B3 — make the audit policy fail closed over the findings that remain after B2.

## Blockers / unverified

- **Migration is a forward obligation only:** at `2.0.0` there is no earlier supported major beyond the legacy integer, so no real N−1 migration is exercised by data.
- **No release has happened:** npm names `yunari` and `yunari-dashboard` both return 404 today, and trusted publishing is unconfigured.
- **The staged-package probe ran with `--ignore-scripts`:** `ffmpeg-static`'s download and a full host boot from the installed tarball are unverified.
- **release-please settings and trusted publishing** were not verified against live docs; web search returned no results today.
- **`npm ls` marks the overridden edges `invalid` on npm 11.6.2** because the lockfile keeps each requester's exact pins; `npm ci` exits 0 and the only installed copies are the patched ones, so this is a reported deviation awaiting a controller ruling.
