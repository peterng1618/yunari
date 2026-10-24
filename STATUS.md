# Yunari status

Updated: 2026-10-25
Branch: `main`

## Current objective

The **release-readiness** plan ([`spec`](docs/superpowers/specs/2026-10-25-release-readiness-design.md), [`plan`](docs/superpowers/plans/2026-10-25-release-readiness.md)) makes the first published release possible: semantic product and schema versions with N−1 theme migration, a dependency audit policy that fails closed, and a GitHub Release + npm publish pipeline. Phase A continues with A4.

## Active work

- **Active plan:** `docs/superpowers/plans/2026-10-25-release-readiness.md` — Phases A and B complete; Phase C in progress, C1 committed.
- **A1 is complete:** decisions 0110 (migrate the previous schema major on open) and 0111 (stage the workspace as `yunari`) claim every watched path later tasks write.
- **A2 is complete:** `schemaVersion` is `"2.0.0"`; the strict validator accepts a semver major and still refuses every integer.
- **A3 is complete:** `readFabricThemeEnvelope` migrates the legacy integer and accepted older majors, then validates.
- **A4 is complete:** every open path reads through the migration; save, snapshot, package write and `requestVersion` stay strict.

## Last completed change

- **The npm package stages with no production path change:** `scripts/stage-npm-package.mjs` copies the workspace layout outside the repo and refuses a non-empty or in-repo `--out`.
- **The staged manifest declares five runtime deps** as ranges read from `src/web/package-lock.json`: `culori`, `fflate`, `ffmpeg-static`, `node-forge`, `systeminformation`.
- **A real install boots:** 35-file tarball, 6,878,647 bytes packed and 26,757,424 unpacked; installed `yunari --version` prints `0.1.0`; `/api/health`, `/editor` and `/` answer 200 on port 4321.
- **Tests:** 7 pass in `tests/scripts/stage-npm-package.test.ts`; a missing `host/dist/main.js` and a mismatched `--expect-version` both exit non-zero.

## Next

1. C2 — wire release-please and the tag-driven publish workflow (Phase C continues).

## Blockers / unverified

- **Migration is a forward obligation only:** at `2.0.0` there is no earlier supported major beyond the legacy integer, so no real N−1 migration is exercised by data.
- **No release has happened:** npm names `yunari` and `yunari-dashboard` both return 404 today, and trusted publishing is unconfigured.
- **`ffmpeg-static` installs with its scripts and the host boots from the tarball;** no media playback was exercised, so a missing binary still degrades only at first media use.
- **release-please settings and trusted publishing** were not verified against live docs; web search returned no results today.
- **`npm ls` marks the overridden edges `invalid` on npm 11.6.2** because the lockfile keeps each requester's exact pins; `npm ci` exits 0 and the only installed copies are the patched ones, so this is a reported deviation awaiting a controller ruling.
