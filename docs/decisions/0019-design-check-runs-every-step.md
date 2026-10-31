# 0019 — One design-check runner, so no step hides another

- **Date:** 2026-10-31
- **Status:** accepted
- **Paths:** `scripts/design-check.mjs`

## Problem

`npm run design:check` was `node scripts/design-tokens.mjs && npm run design:md`.
`&&` stops at the first red step, so a token-audit failure meant the DESIGN.md
lint and token-sync half never ran — the gate's own citation check was invisible
in exactly the run that needed it (#169). Two checks must both report, and the
combined exit code must be red if either is.

## Rung 1 — internal owner

Searched: every `design-tokens.mjs` / `design-md.mjs` caller — `src/web/package.json`
(`design:check`, `design:md`, `gates:self-test`), the scripts' own docblocks, and
CI workflow references.

Found: each check is already one owner of its own rules and both carry
`--self-test`; only the *sequencing* lives in the npm chain. Nothing in the repo
already aggregates several checks, and every other gate step is a single script.

## Rung 2 — installed dependencies

Searched: `npm-run-all`, `concurrently`, `npm-run-all2` in the lockfile.

Found: none installed. Adding a dependency to sequence three local commands is
not a fit for a project that keeps its runtime dependency list deliberately
small.

## Rung 3 — native platform

Searched: npm's own script chaining on both platforms. npm scripts run through
`cmd.exe` on Windows and `sh` on Unix.

Found: no cross-platform "run all, aggregate status" operator exists — `&&`
short-circuits on both, `;` chains on `sh` but not on `cmd.exe`, and `&`
backgrounds on `sh`. Node's `child_process.spawnSync` is the native answer and
is already used by the repository's other checks.

## Rung 4 — public solutions

Searched: how npm-run-all and concurrently model this — both spawn every script
and exit non-zero if any failed.

Found: the behaviour is a dozen lines of `spawnSync`; the packages add argument
parsing and parallelism the three sequential steps do not need.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| `design-tokens && design:md` | Hides the md half | none | rejected: the defect |
| Reversed `&&` | Hides the tokens half | none | rejected: same defect, other side |
| `;` chain | Runs both on `sh` only | Windows path is a different script | rejected: platform-forked behaviour |
| A runner script | Runs both, aggregates | one small file | chosen |
| npm-run-all | Same behaviour | new dependency | rejected: dependency for three calls |

## Rung 6 — smallest probe

`node scripts/design-check.mjs --self-test` runs a failing step followed by a
marker-writing one and checks both the exit code and the marker. The npm script
itself is exercised by `npm run gate`, which chains `design:check`.

## Decision

`scripts/design-check.mjs` runs the token audit, the DESIGN.md lint and the token
sync in that order, remembering any failure and still running the next step; it
exits red if any step was red. `design:check` becomes that one command, and
`gates:self-test` chains its `--self-test` like every other script's, so the
repository's "every script proves its rules still fire" rule keeps holding.
