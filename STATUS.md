# Yunari status

Updated: 2026-10-27
Branch: `peterng1618/fix-font-trio` (worktree `fix-font-trio`)

## Current objective

The [type-token model](docs/superpowers/specs/2026-10-27-type-token-model-design.md) plan is complete: a token names a face, and each run owns its size, line height and tracking. What remains is the final whole-branch review and moving local `main` so the user can test.

## Active work

- **Active plan:** `docs/superpowers/plans/2026-10-27-type-token-model.md` — all six phases done; ledger at `.superpowers/sdd/2026-10-27-type-token-model/progress.md`.
- **The branch carries main:** its 69 commits are merged in, and the merged tree typechecks and passes the full suite.
- **The gate is green as one run:** `npm run gate` exit 0 at `79d5140b` — biome, self-tests, status, docs, design, typecheck and both suites.
- **Docs are current:** the decision note is `0128` (main owns `0124`), and `DESIGN.md` §2 plus the architecture map name the token model.
- **Local `main` trails the branch by four documentation and test commits:** a fast-forward after the final review puts it in the user's hands.

## Last completed change

- **The two stale e2e cases describe the controls that exist:** the token case imports a real face and round-trips it, tracking is driven on the run row, and the weight reading is pinned to a span.
- **A real fixture bug was found at the base:** three envelopes declared `two-tone.svg` with no bytes, so Playwright's global setup threw before any test.
- **The gate was red before this task:** eight pre-existing biome errors, fixed mechanically in a separate commit with no behaviour change.
- **Proof:** gate exit 0; an independent `npx vitest run` at `79d5140b` gives 447 files, 6890 passed, 1 skipped; typecheck, `design:check` and `status:check` exit 0.
- **Unverified:** the browser arm — port 4174 is another worktree's preview, and `reuseExistingServer` would measure that bundle.

## Next

1. Final whole-branch review on the most capable model.
2. Apply its findings with one fix round and a scoped re-review.
3. Fast-forward local `main` so the user can test the type-token editor.
4. Finish the branch; pushing and opening a PR need the user.
5. If port 4174 frees, run the editor browser projects and record the visual proof here.

## Blockers / unverified

- **Browser arm unverified:** port 4174 is held by `background-media-becomes-a-layer`'s `vite preview`; nothing was killed and no port was moved.
- **The import flow has never run in a real browser on this branch:** its filechooser, dialog and Create steps match the dom test only.
- **Starter role weights are read-only:** `Segoe UI, sans-serif` and `Consolas, monospace` are undeclared, so a weight changes only after choosing a declared family.
- **Open rows from this plan:** `vg-770` (a corner-scaled Textbox keeps its width), `vg-762` (a `{ref}` fontSize reads as absent), `vg-771` (no production caller requires the three roles).
- **`vg-756`:** the e2e scripts still resolve the Playwright alpha through `.bin`; run specs via `node node_modules/@playwright/test/cli.js`.
