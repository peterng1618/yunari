# Yunari status

Updated: 2026-10-27
Branch: `peterng1618/fix-font-trio` (worktree `fix-font-trio`)

## Current objective

The [type-token model](docs/superpowers/specs/2026-10-27-type-token-model-design.md) is the active plan: a token names a face — family, weight, declared face — while size, line height and tracking belong to the element. Phase 1 is complete; Phase 2 (faces and subsets) is next.

## Active work

- **Active plan:** `docs/superpowers/plans/2026-10-27-type-token-model.md` — ledger at `.superpowers/sdd/2026-10-27-type-token-model/progress.md`.
- **Phase 1 complete:** the shape, the keys, the starter theme, the role default and the published schema all speak `typeTokens`.
- **Task 1.2 absorbed Tasks 3.1 and 3.2:** the strict rules and the starter rewrite had to land together, or the app would refuse its own new theme.
- **Phase 2 now:** persist the face's subset, register faces by `unicode-range`, and let one apply bring the whole family.
- **Queued after that:** cards and fixtures, the token inspector, the element inspector and canvas resize.

## Last completed change

- **Every e2e theme is written in the new shape:** the seeded host library carries heading/body/mono and each run's old size in its own style, and no tracked spec names a `size-weight` token id.
- **A retained old-shape fixture proves the refusal:** `tests/e2e/fixtures/e2e-old-shape/theme.json` is never seeded, and the new test asserts `typePresets` is named in the issue.
- **Proof:** rebuild 9/9 and display 1/1 after rebuilding bundles, fixtures 15/15, `typecheck` exit 0; the unit suite is the same 4 files / 7 tests owned by Task 4.1 and 5.4.

## Next

1. Phase 2 — `subset` on the declaration, `unicode-range` registration, one apply per family.
2. Phases 3–5 — cards and fixtures, the token inspector, the element inspector and canvas resize.
3. Local merge to `main` once the token inspector no longer writes removed fields (Task 4.1), so the branch is testable rather than save-blocking.

## Blockers / unverified

- **Four test files are red on purpose,** owned by Task 4.1 (renamed-token fixture, runs tracking, token inspector) and Task 5.4 (new-object defaults).
- **`new-object-defaults.ts` still reads `size`/`trioRole` off tokens,** so the body-token preference is dead until Task 5.4.
- **The token inspector no longer renders size, leading or tracking,** but its dom test still expects them — owned by Task 4.1.
- **The main Playwright suite is unrun here:** port 4174 is owned by another worktree, and the npm e2e scripts resolve playwright 1.64.0-alpha over `@playwright/test` 1.63.0 (`vg-756`).
