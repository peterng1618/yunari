# Yunari status

Updated: 2026-10-27
Branch: `peterng1618/fix-font-trio` (worktree `fix-font-trio`)

## Current objective

The [type-token model](docs/superpowers/specs/2026-10-27-type-token-model-design.md) is the active plan: a token names a face — family, weight, declared face — while size, line height and tracking belong to the element. Phase 1 is under way.

## Active work

- **Active plan:** `docs/superpowers/plans/2026-10-27-type-token-model.md` — ledger at `.superpowers/sdd/2026-10-27-type-token-model/progress.md`.
- **Phase 1 tasks 1.1–1.3 are complete:** the shape, the keys, the starter theme and the role default all speak `typeTokens`.
- **Task 1.2 absorbed Tasks 3.1 and 3.2:** the strict rules and the starter rewrite had to land together, or the app would refuse its own new theme.
- **Remaining Phase 1:** the published JSON schema (1.4), which still names `typePresets`.
- **Queued after Phase 1:** `unicode-range` subsets, cards and fixtures, the token inspector, the element inspector and canvas resize.

## Last completed change

- **A run with no size takes its role's default:** `defaultTypeSize(id, artboardHeight)` gives heading 72 / body 16 / mono 14 at 1080, unroled takes body, never below 1.
- **The token contributes no size:** run style resolves after it, so an authored `fontSize` wins and the role default fills only the absent case.
- **The apply layer paints object-level type from the first run:** `applyAuthoredText`/`refreshBoundText` carry size, leading and `charSpacing`; editor and player pass the artboard height.
- **Proof:** the four red files owned here are green (151 tests across five touched files), `npm run typecheck` exit 0, Biome clean; six red files remain.

## Next

1. Task 1.4 — the published schema, then close Phase 1.
2. Phase 2 — persist the subset, register by `unicode-range`, and let one apply bring the whole family.
3. Local merge to `main` at the Phase 1 boundary, so the face-only token can be tested.

## Blockers / unverified

- **Six test files are red on purpose,** owned by 1.4, Phase 4 and 5.4; the reviews map every one.
- **`new-object-defaults.ts` still reads `size`/`trioRole` off tokens,** so the body-token preference is dead until Task 5.4.
- **`card-token-mapping.ts` `trioRoleOf` reads a removed field,** so role matching falls to the first candidate until Task 3.3.
- **This branch's status supersedes the plan-B text on `main`** until the branch merges.
