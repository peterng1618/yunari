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

- **The published schema describes the new shape:** `typeTokens` with `family`/`weight`/`face`, `typePresets` gone, and a run's style admits size, leading and tracking; a document carrying `typePresets` fails it.
- **A run with no size takes its role's default:** heading 72 / body 16 / mono 14 at a 1080 artboard, unroled takes body, never below 1.
- **The role default reaches every repaint,** including the textbox release gesture, pinned by a test that goes red when the artboard height is dropped.
- **Proof:** theme suites 285/285, `typecheck` exit 0, `design:check` exit 0; the full suite is 4 failed files / 7 tests, every one owned by Task 4.1 or 5.4.

## Next

1. Phase 2 — `subset` on the declaration, `unicode-range` registration, one apply per family.
2. Phases 3–5 — cards and fixtures, the token inspector, the element inspector and canvas resize.
3. Local merge to `main` once the token inspector no longer writes removed fields (Task 4.1), so the branch is testable rather than save-blocking.

## Blockers / unverified

- **Four test files are red on purpose,** owned by Task 4.1 (renamed-token fixture, runs tracking, token inspector) and Task 5.4 (new-object defaults).
- **`new-object-defaults.ts` still reads `size`/`trioRole` off tokens,** so the body-token preference is dead until Task 5.4.
- **`card-token-mapping.ts` `trioRoleOf` reads a removed field,** so role matching falls to the first candidate until Task 3.3.
- **The token inspector still offers size, leading and tracking fields** the validator now refuses; Task 4.1–4.3 replace them.
- **The full unit suite was not a green gate at this boundary** — 7 failures, all mapped above; no e2e run yet.
