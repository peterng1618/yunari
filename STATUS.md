# Yunari status

Updated: 2026-10-27
Branch: `peterng1618/fix-font-trio` (worktree `fix-font-trio`)

## Current objective

The [type-token model](docs/superpowers/specs/2026-10-27-type-token-model-design.md) is the active plan: a token names a face — family, weight, declared face — while size, line height and tracking belong to the element. Phases 1–4 are complete; Phase 5 (element inspector and canvas) is next.

## Active work

- **Active plan:** `docs/superpowers/plans/2026-10-27-type-token-model.md` — ledger at `.superpowers/sdd/2026-10-27-type-token-model/progress.md`.
- **Phases 1–3 complete:** the shape and validation, role defaults, `unicode-range` subsets, the whole family on one apply, cards on role tokens, and every fixture generator rewritten.
- **Phase 4 complete:** the token inspector edits a face only — computed names, role-first order, non-removable roles, a family dropdown ending in `Import local font…` / `Font finder…`, and one weight dropdown.
- **One import surface:** a session-owned `FontMetadataForm` dialog adopts or creates an unroled token; role tokens are never rewritten by an import.
- **Merge to main deferred to the Phase 5 close:** the rebuilt composition still renders role default sizes until Task 5.2 restores the authored ones.

## Last completed change

- **Names and order have one owner:** `type-token-manager/name.ts` `tokenName` and `orderedTokens` feed the Tokens list, the inspector and every reassignment list.
- **Family and weight are package dropdowns:** declared families first, the current one marked not-in-package, and an unheld weight reads as a disabled option rather than pretending a face is chosen.
- **The finder names its target:** a token selected in the Tokens pane wins over the canvas selection, and a paint token never becomes the target.
- **Imports keep roles intact:** the dialog commits with no role, and the composition's role faces stay byte-identical after an import.
- **Proof:** focused suites and `npm run typecheck` exit 0; no Playwright run — port 4174 is held elsewhere (`vg-756`).

## Next

1. Task 5.1 — the element token dropdown, role tokens first, with both action rows.
2. Task 5.2 — size, line-height and tracking rows on the run, restoring the authored 46/17/108.
3. Task 5.3 — a canvas resize writes the run's size and resets the object's scale.
4. Task 5.4 — new text writes no size; remove `new-object-defaults.ts`'s legacy reads.
5. Phase 6 — docs close-out, the full gate, browser proof and the local merge to main.

## Blockers / unverified

- **Two unit files are red on purpose:** `new-object-defaults.test.ts` (Task 5.4) and `selection-inspector/runs.dom.test.ts` (Task 5.2).
- **The rebuilt composition falls back to role defaults** (28 runs, none with `style.fontSize`) until Task 5.2.
- **`tests/e2e/editor.spec.ts`'s type-token case is stale:** family and weight are selects now and the tracking row is gone; Phase 6 owns the rewrite.
- **No Playwright run since Phase 3:** port 4174 is owned by another process (`vg-756`), so the reassignment and `panel-labels` edits are typechecked only.
- **Starter role weights are read-only:** `Segoe UI, sans-serif` and `Consolas, monospace` are undeclared, so a weight can change only after picking or importing a declared family.
