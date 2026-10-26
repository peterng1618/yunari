# Yunari status

Updated: 2026-10-27
Branch: `peterng1618/fix-font-trio` (worktree `fix-font-trio`)

## Current objective

The [type-token model](docs/superpowers/specs/2026-10-27-type-token-model-design.md) is the active plan: a token names a face — family, weight, declared face — while size, line height and tracking belong to the element. Phases 1–3 are complete; Phase 4 (the token inspector) is next.

## Active work

- **Active plan:** `docs/superpowers/plans/2026-10-27-type-token-model.md` — ledger at `.superpowers/sdd/2026-10-27-type-token-model/progress.md`.
- **Phases 1–3 complete:** the shape and validation, the role default, subsets registered by `unicode-range`, the whole family on one apply, cards on role tokens, and every e2e fixture generator rewritten.
- **Task 1.2 absorbed Tasks 3.1 and 3.2:** the strict rules and the starter rewrite had to land together, or the app would refuse its own new theme.
- **Phase 4 in progress:** 4.1 landed the computed names, role-first order, non-removable roles and the copy sweep; 4.2–4.4 next.

## Last completed change

- **Computed names and role-first order:** `type-token-manager/name.ts` owns `tokenName` and `orderedTokens`, and the Tokens list and inspector read them.
- **Role tokens are not removable:** the inspector draws reassignment and delete only for an unroled token, and its stored name/role/size/leading/tracking fields are gone.
- **Adds are unique and deduplicated:** `freePresetId` mints `type`, `type-2`, never a role suffix; a duplicate family+weight is refused and its existing token selected.
- **Copy says type token,** including the validator's run-reference message and the assets/save-cleanup strings; the `preset-list` files are renamed `token-list`.
- **Proof:** focused unit files green; full vitest 6735 passed with only the two Task 5.2/5.4 files red, `typecheck` exit 0, `docs:check` exit 0; the main Playwright suite did not run (port 4174, `vg-756`).

## Next

1. Task 4.2 — the family dropdown with its import/finder action rows.
2. Task 4.3 — the weight dropdown writing `weight` and `face.assetId` together.
3. Task 4.4 — one import surface for both entry points.
4. Task 5.1–5.4 — the element token dropdown and the run's own size/leading/tracking rows.

## Blockers / unverified

- **Two unit files are red on purpose:** `new-object-defaults.test.ts` (Task 5.4) and `selection-inspector/runs.dom.test.ts` (Task 5.2).
- **The rebuilt composition falls back to role defaults** (28 runs, none with `style.fontSize`) until Task 5.2 adds the size row; the authored 46/17/108 return then.
- **`new-object-defaults.ts` still reads `size`/`trioRole` off tokens** until Task 5.4.
- **The rewritten e2e reassignment case is unverified:** Playwright's main config could not run (port 4174 owned elsewhere, `vg-756`).
