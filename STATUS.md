# Yunari status

Updated: 2026-10-27
Branch: `peterng1618/fix-font-trio` (worktree `fix-font-trio`)

## Current objective

The [type-token model](docs/superpowers/specs/2026-10-27-type-token-model-design.md) is the active plan: a token names a face — family, weight, declared face — while size, line height and tracking belong to the element. Phases 1–3 are complete; Phase 4 (the token inspector) is in progress.

## Active work

- **Active plan:** `docs/superpowers/plans/2026-10-27-type-token-model.md` — ledger at `.superpowers/sdd/2026-10-27-type-token-model/progress.md`.
- **Phases 1–3 complete:** the shape and validation, the role default, subsets registered by `unicode-range`, the whole family on one apply, cards on role tokens, and every e2e fixture generator rewritten.
- **Task 1.2 absorbed Tasks 3.1 and 3.2:** the strict rules and the starter rewrite had to land together, or the app would refuse its own new theme.
- **Phase 4 in progress:** 4.1 landed the computed names, role-first order and non-removable roles; 4.2 landed the family dropdown, its action rows and the import dialog; 4.3 landed the weight dropdown writing the face; 4.4 next.

## Last completed change

- **Weight is a list on both branches:** the inspector's weight is a `ControlSelect` over `facesOf(family)` for a bound or unbound token alike, and a `ReadOnlyPair` when the family declares no faces; a weight the family does not hold is a disabled `(not in package)` reading, as the family list draws an undeclared family.
- **One write per choice:** choosing a face writes `weight` and `face.assetId` in one `onChange`, so `setTypes` records one history entry; `facesOf` matches the family case-insensitively, as `familiesOf` deduplicates it.
- **Audit moved with the control:** the Playwright label audit now asserts the seeded weight as a reading instead of auditing it as a control; the unit census gains the weight select's value carrier.
- **Proof:** six focused vitest files green (103 tests), `typecheck` exit 0 (e2e tsconfig included), Biome clean; three new cases red-proved; Playwright not run (port 4174, `vg-756`), so `panel-labels.spec.ts` is typechecked but unverified.

## Next

1. Task 4.4 — the finder's requesting-surface target, re-verifying adoption and role protection through both entry points.
2. Task 5.1–5.4 — the element token dropdown and the run's own size/leading/tracking rows.
3. Phase-close e2e pass, including the stale type-token case below.

## Blockers / unverified

- **Two unit files are red on purpose:** `new-object-defaults.test.ts` (Task 5.4) and `selection-inspector/runs.dom.test.ts` (Task 5.2).
- **The rebuilt composition falls back to role defaults** (28 runs, none with `style.fontSize`) until Task 5.2 adds the size row; the authored 46/17/108 return then.
- **`new-object-defaults.ts` still reads `size`/`trioRole` off tokens** until Task 5.4.
- **Three Playwright cases are unverified or stale:** the rewritten reassignment case and `panel-labels.spec.ts`'s weight reading could not run (port 4174, `vg-756`); `editor.spec.ts`'s type-token case still fills family and weight as text and scrolls to the removed `letter-spacing` row, and the phase-close e2e pass must rewrite it.
