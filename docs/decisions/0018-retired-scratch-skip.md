# 0018 — Dead-selectors stops excluding the retired scratch name

- **Date:** 2026-10-31
- **Status:** accepted
- **Paths:** `scripts/dead-selectors.mjs`

## Problem

`dead-selectors.mjs` keeps a `SKIP_DIRS` set of directory names it must not walk.
`.agent-scratch` was one of them. Decision 0081's cleanup relocated that
directory out of the tree, and `scripts/scratch-gate.mjs` now refuses any path
ending in `scratch` anywhere it appears, so the entry names a directory that
cannot exist. The question was whether an exclusion that is now unreachable
should be removed or kept as a second lock (#181).

## Rung 1 — internal owner

Searched: every `agent-scratch` occurrence in the tree
(`grep -rn agent-scratch`), plus each cited path in the issue.

Found: the issue's five sites have since shrunk. `docs/architecture/*` no
longer exists, `.gitignore` no longer carries the entry, and `design-md.mjs`
carries no mention. What remains is:

- `scripts/dead-selectors.mjs` — the `SKIP_DIRS` entry. It is inert: a sweep
  cannot reach a directory nothing can create.
- `scripts/scratch-gate.mjs` — the comment listing the historical spellings
  behind its `-scratch` suffix rule, and a synthetic probe path in its
  self-test. Both are evidence the rule works, not exclusions.

The second lock is therefore already present and stronger: it is a rule over
every path, not a name in one walker's skip set.

## Rung 2 — installed dependencies

Searched: nothing to reuse. `dead-selectors.mjs` is a repository script with no
dependency that models skip lists.

Found: not applicable.

## Rung 3 — native platform

Searched: Node's filesystem walk used by the script (`readdir` recursion over
`WORKSPACE_EXTS`).

Found: a nonexistent directory is simply never yielded. No platform behaviour
needs the entry.

## Rung 4 — public solutions

Searched: how ignore lists in comparable tools treat entries whose target no
longer exists — git's documented ignore semantics (a pattern that matches
nothing is not an error), and Biome/ESLint ignore configuration, which likewise
accept unmatched patterns silently.

Found: an unmatched exclusion is silently permitted everywhere; nothing turns it
into a diagnostic. So keeping the entry buys no enforcement and produces no
error if it drifts — it is dead compensation by construction.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Keep the skip entry as a second lock | None — the scratch gate already refuses the path shape | none | rejected: a lock that cannot fire is not a lock |
| Remove only the entry | Exact; the walker keeps its other skips | none | chosen |
| Remove the `-scratch` rule too | Loses the refusal that guards the name | recreate the gate rule | rejected |

## Rung 6 — smallest probe

No probe needed: the claim is that no path can satisfy the entry and the gate.
`scripts/scratch-gate.mjs --self-test` already proves the suffix rule flags
`src/web/.agent-scratch/p1-repro.mjs`; `npm run gate` runs that self-test.

## Decision

Delete the `.agent-scratch` entry from `SKIP_DIRS`. Its only job was to keep the
walker out of a directory that the scratch gate refuses to let exist, and a skip
list entry that can never match is a reader's wrong turn rather than a guard.
The scratch gate's suffix rule remains the one owner of that refusal.
