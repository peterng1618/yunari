# Decision notes

One file per mechanism decision. Record current evidence, not a research diary.
`scripts/reuse-gate.mjs` refuses the first write to a watchlisted path until a
note claims that exact file. Tests are exempt; note quality still needs review.

Number files from `0001` upward. Keep the note with the change it authorizes.

```markdown
# NNNN — <decision>

- **Date:** YYYY-MM-DD
- **Status:** accepted | superseded by NNNN
- **Paths:** `src/web/packages/.../owner.ts`

## Problem
What must integrate, and where a wrong choice fails quietly.

## Rung 1 — internal owner
Searched: <CodeGraph queries, owners, callers and prior art>
Found: <what exists and what remains unsolved>

## Rung 2 — installed dependencies
Searched: <relevant source, types and tests>
Found: <donated behavior, lifecycle and edge cases>

## Rung 3 — native platform
Searched: <browser, Node, OS, database or runtime APIs>
Found: <what the platform provides and leaves unsolved>

## Rung 4 — public solutions
Searched: <actual queries, docs, source, issues and comparable implementations>
Found: <what each solution handles under which constraints>

## Rung 5 — integration comparison
| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| <candidate> | | | |

## Rung 6 — smallest probe
What executable probe settled, or why behavior was already established.

## Decision
What to reuse or build, and why rejected options do not fit.
```

A package list is not public-search evidence. A native API is not an integration
decision. Do not use directory claims to license future files.
