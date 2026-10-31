# 0067 — The oversize ratchet runs in the gate and accepts today's set

- **Date:** 2026-11-01
- **Status:** accepted
- **Paths:**
  - `scripts/oversize-files.ceiling.json`

## Problem

`scripts/oversize-files.mjs` implements the 500-line signal and 800-line stop,
and it is self-tested by `gates:self-test`, but no gate step ever ran the check
itself: `npm run gate` can be green with any file past the stop. The ceiling
listing the tolerated files had drifted to 43 entries while 96 tracked
`src/web` files were over the stop, so 53 offenders sat outside the ratchet
that is supposed to notice exactly that regrowth (#174, ruling 2026-11-01:
"wire the ratchet into `npm run gate` … make the oversize check fail on
regrowth").

## Rung 1 — internal owner

Searched: `scripts/oversize-files.mjs`, `scripts/oversize-files.ceiling.json`,
`src/web/package.json`'s `gate` and `gates:self-test` chains, `AGENTS.md`'s
"one command that means green".

Found: the check, its fixture-based self-test, its ceiling file and its
`--root`/`--ceiling` flags all already exist; the only missing wiring is the
`gate` chain and the ceiling brought up to date. No second policy is needed.

## Rung 2 — installed dependencies

Searched: the repository's own scripts — `design-check.mjs` and
`scratch-gate.mjs` follow the same shape (a standalone check plus an entry in
the gate chain plus a self-test in `gates:self-test`).

Found: adding a step is the established pattern; no dependency provides a
repository line-count policy.

## Rung 3 — native platform

Searched: Node's `git ls-files` invocation inside the script (the tracked set is
the row's method) and `process.exitCode` behaviour.

Found: nothing native is missing; the script already exits `1` when a file is
over the stop and absent from the ceiling, and `2` when the ceiling cannot be
read.

## Rung 4 — public solutions

Searched: no external package is involved — this is repository policy over
`git ls-files`, and the script's own self-test already covers the ceiling
semantics (over, added, gone, generated, unreadable ceiling).

Found: nothing to reuse; a lint rule in Biome cannot express a per-file
tolerated set.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Leave the check outside the gate | Nothing fails on regrowth — the state the row records | None | Rejected |
| Split all 96 files first, then wire | Correct end state, but a multi-week refactor and the gate stays blind the whole time | Every split needs its own review | Not this change |
| Wire the check, accept today's 96 in the ceiling | Fails on any new over-800 file; the script's `gone` check forces an entry out when a file is split | Debt stays recorded in one file, named per path | Accepted |

## Rung 6 — smallest probe

`node scripts/oversize-files.mjs` at `754443f8` exits `1` with
`53 over the stop and not in the ceiling`; after merging the report into the
ceiling it must exit `0`, and deleting any one entry must make it exit `1`
again (the red proof run before the commit).

## Decision

Regenerate `scripts/oversize-files.ceiling.json` from the script's own report
(96 entries) and add `node ../../scripts/oversize-files.mjs` to `npm run gate`
as `oversize:check`. The splits stay their own rows (#225, #260, #233); the
`gone` check makes each of them delete its ceiling line as it lands.
