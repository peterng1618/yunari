# 0079 — accept three files already past the oversize stop

- **Date:** 2026-11-01
- **Status:** accepted
- **Paths:** `scripts/oversize-files.ceiling.json`

## Problem

`npm run gate` exits 1 on `oversize:check` before any test runs. `main` carries
three tracked `src/web` files over the 800-line stop that the ceiling does not
name, so the failure predates this branch. The ratchet's documented remedy is to
split a breach or add it to the ceiling; leaving it unaccepted makes every
branch red for a reason its change did not cause.

## Rung 1 — internal owner

Searched: `scripts/oversize-files.mjs`, `scripts/oversize-files.ceiling.json`,
`npm run oversize:check`.

Found: the script owns the measurement, the 500 signal, the 800 stop and the
ceiling. The ceiling is the intended accept list, and the script states it is
edited only to accept a breach. No second mechanism exists.

## Rung 2 — installed dependencies

Searched: the script's imports (`node:child_process`, `node:fs`, `node:os`,
`node:path`, `node:url`).

Found: the ceiling is a JSON array read by this one script. Nothing else
consumes it.

## Rung 3 — native platform

Searched: not applicable.

Found: the check is repository policy, not platform behaviour.

## Rung 4 — public solutions

Searched: not applicable.

Found: no external implementation decides this repository's size policy.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Split the three files now | Removes the breach | Three unrelated refactors with their own review cost | Rejected for this change |
| Accept the three paths in the ceiling | The ratchet's own remedy; the set stays visible | Three entries remain over the stop | **Chosen** |
| Leave the gate red | Honest about the cause | No branch can pass the gate for an unrelated reason | Rejected |

## Rung 6 — smallest probe

`git show main:<path> | wc -l` reports `editor-shell.ts` 875,
`envelope-semantics.ts` 833 and `scene.dom.test.ts` 878. The same `main`
ceiling has no entry for any of the three. No file was changed by this branch
to produce those sizes.

## Decision

Add the three exact paths to `scripts/oversize-files.ceiling.json`. No
production code, threshold or script behavior changes. A later split removes
the entry without editing the ceiling again.
