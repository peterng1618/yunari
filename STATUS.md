# Yunari status

Updated: 2026-10-27
Branch: `peterng1618/fix-font-trio` (worktree `fix-font-trio`)

## Current objective

The [type-token model](docs/superpowers/specs/2026-10-27-type-token-model-design.md) is complete: a token names a face, and each run owns its size, line height and tracking. The final whole-branch review's one blocking defect is fixed and re-reviewed; local `main` carries it so the user can test.

## Active work

- **Active plan:** `docs/superpowers/plans/2026-10-27-type-token-model.md` — all six phases done plus one final-review fix; ledger at `.superpowers/sdd/2026-10-27-type-token-model/progress.md`.
- **The branch carries main:** its 70 commits are merged in, and the merged tree typechecks and passes the full suite.
- **The gate is green as one run:** `npm run gate` exit 0 at `a84f7d90` — biome, self-tests, status, docs, design, typecheck, 447 test files (6891 passed, 1 skipped) and the store-worker suite.
- **Final review discharged:** verdict FIXED on a scoped re-review, no blocking or should-fix findings; one low recorded with no fix needed.
- **Local `main` is at this branch's tip:** the user can test the type-token editor while the branch is finished.

## Last completed change

- **A new text now paints its role default before the author types:** `addText` asks the session's authoring-view port to paint the object before returning, so the canvas shows 16 (body at 1080) instead of Fabric's 40 for the whole first edit.
- **Red-proved:** with the paint line removed the new case reads 40, restored it reads 16; the line is a no-op for objects with no authored runs and for a manager with no port installed.
- **The review's should-fix is filed, not fixed:** a whole-family import binds one face, so save-cleanup offers the other declared weights and subsets for removal (`vg-772`, from the commit trailer).
- **Proof:** gate exit 0 at `a84f7d90`; scoped re-review re-ran focused suites, typecheck, biome and `backlog-check` (772 items) at 0.
- **Unverified:** the browser arm — port 4174 is another worktree's preview, and `reuseExistingServer` would measure that bundle.

## Next

1. Finish the branch; pushing and opening a PR need the user.
2. If port 4174 frees, run the editor browser projects and record the visual proof here.
3. Drain `vg-772` (font-family reachability) when the register is next worked.

## Blockers / unverified

- **Browser arm unverified:** port 4174 is held by `background-media-becomes-a-layer`'s `vite preview`; nothing was killed and no port was moved.
- **The import flow has never run in a real browser on this branch:** its filechooser, dialog and Create steps match the dom test only.
- **Starter role weights are read-only:** `Segoe UI, sans-serif` and `Consolas, monospace` are undeclared, so a weight changes only after choosing a declared family.
- **Open rows from this plan:** `vg-770`, `vg-762`, `vg-771`, `vg-772`.
- **`vg-756`:** the e2e scripts still resolve the Playwright alpha through `.bin`; run specs via `node node_modules/@playwright/test/cli.js`.
