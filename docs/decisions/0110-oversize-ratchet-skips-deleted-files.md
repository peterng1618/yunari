# 0110 — A tracked file deleted in the working tree is skipped, not measured

- **Date:** 2026-11-05
- **Status:** accepted
- **Paths:** `scripts/oversize-files.mjs`

## Problem

The oversize ratchet enumerates `git ls-files src/web` and reads each path.
A file deleted in the working tree is still listed until the deletion is
committed, so the next run throws ENOENT and reports "not run" — the gate goes
red for a removal that is exactly what the ratchet should accept.

## Rung 1 — internal owner
Searched: `scripts/oversize-files.mjs` (`trackedFiles`, `measure`, `report`).
Found: the ceiling already tolerates a split file ("no longer over the stop"),
so removal is an accepted outcome; only the read assumed presence.

## Rung 2 — installed dependencies
Found: no dependency owns the tracked-file walk; the script uses the `git`
executable it already spawns.

## Rung 3 — native platform
Found: Node exposes `existsSync` from `node:fs`; no platform change needed.

## Rung 4 — public solutions
Searched: `git ls-files` documentation for deleted-but-tracked entries.
Found: `git ls-files --deleted` is the explicit filter; a presence check covers
the same case without a second git invocation.

## Rung 5 — integration comparison
| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| `git ls-files --deleted` subtraction | Exact | A second process per run | Reject |
| `existsSync` per entry | Same walk, one stat | A stat per file | Chosen |
| Fail on a missing entry | Signals a real break | Treats every removal as a break | Reject |

## Rung 6 — smallest probe
The failure was reproduced by deleting `editor/src/lib/utils.ts` and running
`npm run oversize:check`; the run exited with the ENOENT above.

## Decision
Skip any tracked path that is absent from the working tree. The file count and
the ceiling report describe the files that exist; a deletion stays the commit's
own record.
