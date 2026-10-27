# Yunari status

Updated: 2026-10-27
Branch: `peterng1618/fix-font-trio` (worktree `fix-font-trio`)

## Current objective

The [type-token model](docs/superpowers/specs/2026-10-27-type-token-model-design.md) is the active plan: a token names a face — family, weight, declared face — while size, line height and tracking belong to the element. Phases 1–5 are complete; Phase 6 (close-out) is next.

## Active work

- **Active plan:** `docs/superpowers/plans/2026-10-27-type-token-model.md` — ledger at `.superpowers/sdd/2026-10-27-type-token-model/progress.md`.
- **Phases 1–3 complete:** the token shape and validation, role default sizes, `unicode-range` subsets, the whole family on one apply, and every fixture generator rewritten.
- **Phase 4 complete:** the token inspector edits a face only — computed `[Role] Family Weight` names, role-first order, non-removable roles, a family dropdown ending in `Import local font…` / `Font finder…`, and one weight dropdown.
- **Phase 5 complete:** each run has its own size, line-height and tracking rows; a canvas resize commits each run's painted size and resets the object's scale; a new text writes no size, so the role default shows.
- **The composition renders its authored sizes again:** 46 / 17 / 108 come from run styles, not from tokens.
- **Local merge to main is the next boundary action:** this is the first point where the user can test the feature without a role-default regression.

## Last completed change

- **A new text takes the role default:** `createNewTextDefaults` writes no `fontSize` or `lineHeight`; `firstTypeToken` is the first entry, body first by producer order.
- **The first-entry rule is pinned:** a `{ mono, body }` fixture fails under the old body-preferring rule.
- **A canvas resize commits each run's size:** painted size × `scaleY`, both scales reset, and one undo restores size and scale together.
- **Boundary suite green:** 6821 passed / 2 skipped of 446 files, exit 0, after repairing a stale `editor-session.dom.test.ts` fixture (49/49).
- **Unverified:** no Playwright run — port 4174 is held elsewhere (`vg-756`).

## Next

1. Local merge to main so the user can test the type-token editor.
2. Task 6.1 — docs, ADR and ownership close-out; sweep the surviving `preset` identifiers.
3. Task 6.2 — full gate, browser proof, rewrite the stale e2e cases.
4. Final whole-branch review on the most capable model.
5. Finish the branch.

## Blockers / unverified

- **`tests/e2e/editor.spec.ts` and `panel-labels.spec.ts` are stale:** typechecked only; Task 6.2 rewrites them.
- **No browser proof since Phase 3:** port 4174 is owned by another process (`vg-756`), so every visible claim is object-level only.
- **Main is 69 commits ahead:** its chart and editor refactors must be merged in and the full gate re-run before the branch lands.
- **Starter role weights are read-only:** `Segoe UI, sans-serif` and `Consolas, monospace` are undeclared, so a weight changes only after picking a declared family.
- **Open rows:** `vg-761` (a corner-scaled Textbox keeps its width) and `vg-762` (a `{ref}` fontSize reads as absent in the row).
