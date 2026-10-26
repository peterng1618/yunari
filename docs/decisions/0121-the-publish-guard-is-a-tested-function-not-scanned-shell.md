# 0121 — The publish guard is a tested function, not scanned shell

- **Date:** 2026-10-26
- **Status:** accepted 2026-10-26
- **Paths:** `scripts/assert-publish-ref.mjs`, `scripts/check-workflows.mjs`

## The problem

`check-workflows.mjs` tried to decide, by reading lines of bash, whether the
publish workflow's tag guard would actually run and actually refuse. Three
review rounds found a new hole each time: unanchored words, unreachable
statements, then negation, then line continuations and heredocs. Shell is not
a grammar a line scanner can decide, and every fix widened the scanner.

The shape is: one small decision (`refuse this dispatch?`) over three
environment strings, which must be enforced before any other publish work and
must be checkable from a gate with no network.

## Rung 1 — Yunari

Searched: `scripts/check-workflows.mjs` (`guardProblem`, tokenizer, rules),
`scripts/check-third-party.mjs`, `scripts/check-status.mjs`,
`scripts/assert-*`-shaped scripts, `src/web/tests/scripts/*.test.ts`,
`.github/workflows/publish.yml`.

Found: root scripts already use the exported-function + `main()` + guarded
`process.exit` pattern (`check-third-party.mjs`, `check-workflows.mjs`), and
their cases live under `src/web/tests/scripts/`. No existing script decides a
workflow condition or reads GitHub's event variables. The guard's logic was
embedded inside the checker, so it could only be exercised by writing
workflow fixtures, not by asking the decision itself.

## Rung 2 — dependencies

Searched: `src/web/package.json` direct dependencies and devDependencies; the
installed tree; the no-new-dependency ruling for this task.

Found: nothing parses shell. `yaml` is a transitive package and cannot decide
bash semantics either. Adding a dependency would contradict the round's
ruling, and no package turns a shell script into a reachability proof.

## Rung 3 — platform

Searched: Node `process.env`, `process.exit`, module exports, `pathToFileURL`
main guard; GitHub Actions' `GITHUB_EVENT_NAME`/`GITHUB_REF` and the workflow's
own `DRY_RUN`.

Found: the platform gives all three inputs directly. It leaves the decision
itself to the code, which is the point — a three-line predicate can be tested
for every combination, while bash control flow cannot.

## Rung 4 — ecosystem

Searched the npm registry (2026-10-26): `bash-parser` 0.5.0 MIT, `shellcheck`
4.1.0 MIT, `mvdan-sh` 0.10.1 BSD-3-Clause; known practice for GitHub Actions
tag guards is a shell `if` step.

Found: `bash-parser` builds an AST but is dormant at 0.5.0 and still leaves
"is this guard reachable" to the caller; `shellcheck` is a linter, not a
proof, and is not in the toolchain; `mvdan-sh` shells out to a Go binary.
The common `if` step is exactly the shape that three rounds of holes came
from. None of them offers a smaller or more certain check than comparing one
command line.

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| line-scanner in the checker | exact today | already paid 3 rounds | a new shell hole each round | reject |
| `bash-parser` / `mvdan-sh` | AST of the guard | new dependency + parse model | still needs a reachability analysis | reject |
| ShellCheck | lint only | new tool in CI | no answer to "can it fire" | reject |
| script + equality rule | exact by construction | one root script, one one-line step | shell cannot drift without changing the line | **choose** |

## Rung 6 — probe

No probe was run before this decision. What was established then: the scanner in
`check-workflows.mjs` had produced a passing-tree evasion in each review round
(unction-wrapped guard, `exit 0` first, negation, continuation, heredoc), and
the predicate it tried to decide takes three strings. The argument for
extracting it was that such a predicate can be enumerated exhaustively where
bash reachability cannot — a prediction at the time, not a measurement.

The measurement came afterwards, and is the outcome below: the six environment
combinations are asserted in `src/web/tests/scripts/assert-publish-ref.test.ts`,
and the shell mutations are refused by text equality against
`node scripts/assert-publish-ref.mjs` rather than by a scanner that had to grow
to see each one.

## Decision

Create `scripts/assert-publish-ref.mjs` with the pure
`publishRefProblem({ eventName, dryRun, ref })`, run it in `publish.yml` as
`install`'s second step — immediately after the checkout, because the guard is
a repository script and the file has to exist first — as the single line
`node scripts/assert-publish-ref.mjs` with no other step key, and make the
checker require exactly that line, that key set and that position. The specific
reason: the property "this can only refuse a non-dry dispatch off a tag" is then
earned by a tested function and by text equality, not by the checker's
understanding of bash.
