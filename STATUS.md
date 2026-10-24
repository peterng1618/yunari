# Yunari status

Updated: 2026-10-25
Branch: `main`

## Current objective

Drain `docs/product/backlog.jsonl`: the queued [`spec`](docs/superpowers/specs/2026-10-12-the-backlog-drain-design.md) and [`plan`](docs/superpowers/plans/2026-10-12-the-backlog-drain.md) close the rows the reproduction pass proved discharged, take the rulings the register waits on, then do the real work; 245 rows carry `state: "open"`.

## Active work

- **Active plan:** `docs/superpowers/plans/2026-10-12-the-backlog-drain.md` — queued, not started; no task dispatched.
- **Release readiness is closed:** spec `2026-10-25-release-readiness-design.md` is landed, plan archived, and nothing in it waits on a task.

## Last completed change

- **Plan closed:** the release-readiness plan moved to `docs/superpowers/plans/archive/`, and its spec records `landed 2026-10-25` with the commit range.
- **Bump rule consistent:** the spec's patch row now names `fix` and `deps` only; `docs`, `refactor`, `perf` and `chore` open no release.
- **Audit evidence:** `npm run audit:check` exits 0 with the four allowlisted high findings and no stale rows.
- **Gate evidence at `c24a166b`:** 385 of 386 files and 5739 of 5741 tests pass; both failures are the known live-SMTC cases.
- **`status:check` and `docs:check` exit 0** after the move; STATUS replaced, not appended.

## Next

1. Start the backlog-drain plan at Phase 0: prove the close mechanics on one row, then work Task 0.2–0.5.
2. Run the ruling sessions (Phase 1), then the spec's W1–W9 work rows (Phase 2 onward).

## Blockers / unverified

- **The publish workflow is unverified end to end:** no dispatch was authorised, so only its parse and its stage/pack/smoke/publish-dry-run commands were exercised, locally.
- **The first publish is a one-time local publish:** the owner packs locally and runs `npm publish <tarball>` with their own token; trusted publishing for `peterng1618/yunari`, workflow `publish.yml`, applies from the second release.
- **The release-token choice is open:** a `RELEASE_PLEASE_TOKEN` PAT or App token makes publication automatic, while a `GITHUB_TOKEN` release cannot trigger this workflow, leaving a manual dispatch on the tag.
- **No real N−1 migration is exercised:** at `2.0.0` there is no earlier supported major beyond the legacy integer; the dispatch seam is a forward obligation.
- **Two dependency deviations remain:** `ffmpeg-static` installs with scripts but no media playback was exercised, and `npm ls` marks the overridden edges `invalid`, accepted in `docs/engineering/dependencies.md`.
