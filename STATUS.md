# Yunari status

Updated: 2026-10-27
Branch: `peterng1618/fix-font-trio` (worktree `fix-font-trio`)

## Current objective

The [type-token model](docs/superpowers/specs/2026-10-27-type-token-model-design.md) is the active plan: a token names a face — family, weight, declared face — while size, line height and tracking belong to the element. Phases 1–3 are complete; Phase 4 (the token inspector) is in progress.

## Active work

- **Active plan:** `docs/superpowers/plans/2026-10-27-type-token-model.md` — ledger at `.superpowers/sdd/2026-10-27-type-token-model/progress.md`.
- **Phases 1–3 complete:** the shape and validation, the role default, subsets registered by `unicode-range`, the whole family on one apply, cards on role tokens, and every e2e fixture generator rewritten.
- **Task 1.2 absorbed Tasks 3.1 and 3.2:** the strict rules and the starter rewrite had to land together, or the app would refuse its own new theme.
- **Phase 4 in progress:** 4.1 landed the computed names, role-first order and non-removable roles; 4.2 landed the family dropdown, its action rows and the import dialog; 4.3–4.4 next.

## Last completed change

- **Family list with action rows:** the inspector's family is a `ControlSelect` over the declared families, with the current family appended as a not-in-package reading and `Import local font…` / `Font finder…` as trailing options that dispatch their port and write nothing; a bound token keeps its read-only family plus both rows as buttons.
- **One import surface:** the import row picks a file through a hidden input, then opens `components/font-import-dialog.tsx` through `openModal`, drawing `FontMetadataForm` with `showRole={false}`.
- **Commit reuses `#commitFont`:** Create declares the file with an unroled token and its credit, Cancel declares the file with neither; a role token is never rewritten and a repeated family+weight reuses its token.
- **Ports:** `familiesOf` deduplicates and sorts the declared families case-insensitively, and `openFontFinder` goes through `options.onFindFontPicker`.
- **Proof:** three focused vitest files green (32 tests) plus `editor-session.dom.test.ts` (49), `typecheck` exit 0, Biome clean; two new cases red-proved (see the task report); Playwright not run (port 4174, `vg-756`).

## Next

1. Task 4.3 — the weight dropdown writing `weight` and `face.assetId` together.
2. Task 4.4 — the finder's requesting-surface target, re-verifying adoption and role protection through both entry points.
3. Task 5.1–5.4 — the element token dropdown and the run's own size/leading/tracking rows.

## Blockers / unverified

- **Two unit files are red on purpose:** `new-object-defaults.test.ts` (Task 5.4) and `selection-inspector/runs.dom.test.ts` (Task 5.2).
- **The rebuilt composition falls back to role defaults** (28 runs, none with `style.fontSize`) until Task 5.2 adds the size row; the authored 46/17/108 return then.
- **`new-object-defaults.ts` still reads `size`/`trioRole` off tokens** until Task 5.4.
- **The rewritten e2e reassignment case is unverified:** Playwright's main config could not run (port 4174 owned elsewhere, `vg-756`).
- **`tests/e2e/editor.spec.ts`'s type-token case is stale:** it fills `[data-yunari-token-family]` as text and a removed `[data-yunari-token-letter-spacing]` row; the phase-close e2e pass must rewrite it.
