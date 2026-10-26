# Yunari status

Updated: 2026-10-27
Branch: `peterng1618/fix-font-trio` (worktree `fix-font-trio`)

## Current objective

The [type-token model](docs/superpowers/specs/2026-10-27-type-token-model-design.md) is the active plan: a token names a face — family, weight, declared face — while size, line height and tracking belong to the element. Phase 1 is under way.

## Active work

- **Active plan:** `docs/superpowers/plans/2026-10-27-type-token-model.md` — ledger at `.superpowers/sdd/2026-10-27-type-token-model/progress.md`.
- **Phase 1 tasks 1.1 and 1.2 are complete:** the shape, the keys and the starter theme speak `typeTokens`.
- **Task 1.2 absorbed Tasks 3.1 and 3.2:** the strict rules and the starter rewrite had to land together, or the app would refuse its own new theme.
- **Remaining Phase 1:** `defaultTypeSize` from the artboard (1.3), then the published JSON schema (1.4).
- **Queued after Phase 1:** `unicode-range` subsets, cards and fixtures, the token inspector, the element inspector and canvas resize.

## Last completed change

- **A theme speaks `typeTokens`:** `TypeToken` is `{family, weight?, face?}`, role is the token id (`heading`/`body`/`mono`), and a run references `typeTokens.<id>`.
- **The validator refuses the old shape by its keys:** `typePresets` is an unknown global group, and a token admits only family/weight/face — `size`, leading, tracking and `trioRole` are refused with the key named.
- **The starter theme is three role tokens** (Segoe UI 600/400, Consolas 400); each starter run carries its old size, line height and tracking in its own style.
- **Proof:** focused validator suites 136/136, `npm run typecheck` exit 0, Biome clean; ten red files remain, each owned by a later task (1.3, 1.4, 3.3, 3.4, 4.1, 5.4) and mapped in `task-1.2-review.md`.

## Next

1. Task 1.3 — `defaultTypeSize` and a token that contributes no size; then 1.4, the published schema.
2. Phase 2 — persist the subset, register by `unicode-range`, and let one apply bring the whole family.
3. Local merge to `main` at the Phase 1 boundary, so the face-only token can be tested.

## Blockers / unverified

- **Ten test files are red on purpose,** each owned by a later task; the review mapped every one.
- **`new-object-defaults.ts` still reads `size`/`trioRole` off tokens,** so the body-token preference is dead until Task 5.4.
- **`card-token-mapping.ts` `trioRoleOf` reads a removed field,** so role matching falls to the first candidate until Task 3.3.
- **This branch's status supersedes the plan-B text on `main`** until the branch merges.
