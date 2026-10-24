# Yunari status

Updated: 2026-10-25
Branch: `main`

## Current objective

The **release-readiness** plan ([`spec`](docs/superpowers/specs/2026-10-25-release-readiness-design.md), [`plan`](docs/superpowers/plans/2026-10-25-release-readiness.md)) makes the first published release possible: semantic product and schema versions with N−1 theme migration, a dependency audit policy that fails closed, and a GitHub Release + npm publish pipeline. Phase A continues with A4.

## Active work

- **Active plan:** `docs/superpowers/plans/2026-10-25-release-readiness.md` — Phases A and B complete; Phase C next.
- **A1 is complete:** decisions 0110 (migrate the previous schema major on open) and 0111 (stage the workspace as `yunari`) claim every watched path later tasks write.
- **A2 is complete:** `schemaVersion` is `"2.0.0"`; the strict validator accepts a semver major and still refuses every integer.
- **A3 is complete:** `readFabricThemeEnvelope` migrates the legacy integer and accepted older majors, then validates.
- **A4 is complete:** every open path reads through the migration; save, snapshot, package write and `requestVersion` stay strict.
- **Probe finding for C1:** the staged manifest needs five runtime deps — `culori`, `fflate`, `ffmpeg-static`, `node-forge`, `systeminformation` — not the three the plan lists.

## Last completed change

- **Audit policy fails closed:** `scripts/audit-policy.mjs` exits 1 on an unallowlisted finding or a stale allowlist row, 2 on unreadable input.
- **Allowlist measured after B2:** the four high findings are `node-forge` GHSA-86w9-cpqp-85rv, `zod` GHSA-mrhx-c7xc-m3w5, and zod reached via `@google/design.md` and `@cloudflare/vitest-pool-workers`.
- **Wired without a network in the gate:** `audit:check`, the policy `--self-test` in `gates:self-test`, and a separate `audit` CI job.
- **Tests:** 9 pass in `tests/scripts/audit-policy.test.ts`; empty and stale allowlists exit 1, unreadable input exits 2.
- **Gate stops only at the known SMTC pair:** 384 of 385 files and 5727 of 5729 tests pass.

## Next

1. C1 — stage the npm package as a workspace-shaped tarball (Phase B complete).

## Blockers / unverified

- **Migration is a forward obligation only:** at `2.0.0` there is no earlier supported major beyond the legacy integer, so no real N−1 migration is exercised by data.
- **No release has happened:** npm names `yunari` and `yunari-dashboard` both return 404 today, and trusted publishing is unconfigured.
- **The staged-package probe ran with `--ignore-scripts`:** `ffmpeg-static`'s download and a full host boot from the installed tarball are unverified.
- **release-please settings and trusted publishing** were not verified against live docs; web search returned no results today.
- **`npm ls` marks the overridden edges `invalid` on npm 11.6.2** because the lockfile keeps each requester's exact pins; `npm ci` exits 0 and the only installed copies are the patched ones, so this is a reported deviation awaiting a controller ruling.
