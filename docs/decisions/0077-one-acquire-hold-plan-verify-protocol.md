# 0077 — One acquire-hold-plan-verify protocol

- **Date:** 2026-11-01
- **Status:** accepted
- **Paths:** `src/web/packages/editor/src/snap-manager/protocol/session.ts`, `src/web/packages/editor/src/snap-manager/protocol/intent.ts`, `src/web/packages/editor/src/snap-manager/protocol/hold.ts`, `src/web/packages/editor/src/snap-manager/protocol/candidates.ts`, `src/web/packages/editor/src/snap-manager/movement-snapping-runtime.ts`, `src/web/packages/editor/src/snap-manager/scaling/scale-snapping-runtime.ts`, `src/web/packages/editor/src/snap-manager/movement-snapping-resolver.ts`, `src/web/packages/editor/src/snap-manager/movement-snap-plan.ts`, `src/web/packages/editor/src/snap-manager/movement-snap-verification.ts`, `src/web/packages/editor/src/snap-manager/movement-snap-intent.ts`, `src/web/packages/editor/src/snap-manager/movement-snap-hold.ts`, `src/web/packages/editor/src/snap-manager/movement-snap-candidates.ts`, `src/web/packages/editor/src/snap-manager/scaling/scale-snapping-resolver.ts`, `src/web/packages/editor/src/snap-manager/scaling/scale-snap-plan.ts`, `src/web/packages/editor/src/snap-manager/scaling/scale-snap-proposals.ts`, `src/web/packages/editor/src/snap-manager/scaling/scale-snap-verification.ts`, `src/web/packages/editor/src/snap-manager/scaling/scale-snap-geometry.ts`, `src/web/packages/editor/src/snap-manager/scaling/scale-snap-candidates.ts`, `scripts/oversize-files.ceiling.json`

## Problem
`movement-snapping-resolver.ts` (1452 lines) and
`scaling/scale-snapping-resolver.ts` (1509) both carry the same
acquire-hold-plan-verify lifecycle: free hold states, zoom-scaled threshold
records, token issuance, marker duplicate records, pending-step verification and
the same hold guard that a held candidate belongs to the baseline snapshot.
Their runtimes repeat the five-method session protocol. The split that grew
around the duplication follows movement versus scale rather than the genuinely
separate sub-domains (intent, hold, projection), so a change to the lifecycle
must be made twice and can drift silently.

## Rung 1 — internal owner
Searched: source of both resolvers, both runtimes, both candidate builders,
`index.ts`, `scaling/scale-snapping-controller.ts`,
`scaling/text-width-resize-controller.ts`, `movement-spacing-*` and the tests
that import the resolver surface.
Found: the protocol has no owner outside the two families. `spacing.ts`,
`spacing-chains.ts`, `spacing-patterns.ts`, `movement-spacing-correction.ts` and
`movement-spacing-verification.ts` are the movement family's spacing sub-domain;
`scaling/scale-projection.ts` and
`scaling/rectangular-scale-gesture-projection.ts` are the projection sub-domain.
Both stay. The candidate line table and the candidate tie-break are identical
between `movement-snap-candidates.ts` and `scaling/scale-snap-candidates.ts`,
but their outer builders differ: movement emits one candidate per line, scale
emits one per moving edge and source line.

## Rung 2 — installed dependencies
Searched: no package is involved. TypeScript generics and `WeakMap`/`WeakSet`
supply the parameterisation and the token identity.
Found: no dependency is added or removed; the extraction is in-repo.

## Rung 3 — native platform
Searched: `WeakMap`, `WeakSet`, `Object.freeze` semantics used by the existing
runtimes.
Found: the platform donates exactly what the current code already uses. No
platform API changes the decomposition.

## Rung 4 — public solutions
Searched: the existing repo pattern for shared pure modules and generic
collaborators (for example `renderer-core`'s shared scene contracts), and the
two runtimes' own shape.
Found: the repo convention is one named export family per sibling module with
explicit parameters. A base class or a runtime registry would add a second
ownership model; generic functions and one session class parameterised by the
family's plan/verify callbacks fit the existing style.

## Rung 5 — integration comparison
| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Keep two protocols | Preserves the drift and the double edit; both files stay over the stop | None | Rejected |
| Generic session class plus shared intent/hold/candidate helpers | One lifecycle owner; family callbacks keep movement/scale differences explicit | Type-only imports keep the resolver API stable | Chosen |
| Base classes for each resolver | Couples two large families through inheritance and still duplicates the guards | Refine only exists on scale | Rejected |
| Move spacing/projection into the protocol | Forced agreement; spacing and projection behave differently | Behaviour risk | Rejected |

## Rung 6 — smallest probe
The existing `movement-snapping-resolver.test.ts` (1252 lines, 167 tests across
the snap-manager suite) pins both public surfaces, including the movement
baseline-translation guard and the scale bounds messages. Running
`npx vitest run packages/editor/src/snap-manager` unchanged is the executable
proof that the extraction preserves behaviour. `scripts/oversize-files.mjs`
proves the two resolvers leave the over-stop set.

## Decision
Extract the session lifecycle, token ledger, duplicate record and verification
application into `protocol/session.ts`; the free hold state and the held
candidate/baseline guard into `protocol/hold.ts`; the shared threshold record
into `protocol/intent.ts`; and the source-line table plus candidate tie-break
into `protocol/candidates.ts`. Both runtimes and both resolvers consume those
modules. The movement resolver is split into intent geometry, plan and
verification modules; the scale resolver into geometry, plan and verification
modules. Movement spacing and scale projection stay their own sub-domains and
are not folded into the protocol. Resolver public exports are preserved so
consumers and tests import the same paths.

The two exact-bounds validators stay separate: their rejection wording differs
(`values` versus `edges`, and movement validates the centres in the same pass),
so unifying them would change observable error messages. The movement and scale
raw-intent guards also stay separate because movement proves a translation of
the baseline while scale validates canonical values against a projection.

## The ceiling entries this change clears

- **Paths:** `scripts/oversize-files.ceiling.json`

Only the two snap-manager resolver entries removed by this split are deleted.
`spacing.ts`, `scaling/rectangular-scale-gesture-projection.ts` and the two
large test files remain over the stop and remain in the ceiling.
