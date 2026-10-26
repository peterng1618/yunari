# Yunari status

Updated: 2026-10-27
Branch: `peterng1618/fix-font-trio` (worktree `fix-font-trio`)

## Current objective

The [type-token model](docs/superpowers/specs/2026-10-27-type-token-model-design.md) is the active plan: a token names a face — family, weight, declared face — while size, line height and tracking belong to the element. Phases 1–3 are complete; Phase 4 (the token inspector) is next.

## Active work

- **Active plan:** `docs/superpowers/plans/2026-10-27-type-token-model.md` — ledger at `.superpowers/sdd/2026-10-27-type-token-model/progress.md`.
- **Phases 1–3 complete:** the shape and validation, the role default, subsets registered by `unicode-range`, the whole family on one apply, cards on role tokens, and every e2e fixture generator rewritten.
- **Task 1.2 absorbed Tasks 3.1 and 3.2:** the strict rules and the starter rewrite had to land together, or the app would refuse its own new theme.
- **Phase 4 now:** computed names and role-first order, the family and weight dropdowns, and one import surface for the two action rows.

## Last completed change

- **Every e2e theme generator writes the new shape:** `host-theme.ts` and `rebuild-composition.ts` seed heading/body/mono with each run's own style, and no tracked spec names a `size-weight` token id.
- **The retained old-shape fixture proves the refusal:** `tests/e2e/fixtures/e2e-old-shape/theme.json` is never seeded, and the fixture test asserts `typePresets` is named in the issue.
- **The fixture test now requires the three roles,** and five envelopes that carried an empty token bag now carry them.
- **Proof:** fixtures 15/15 with a red-proof that removing `mono` fails 13/15, rebuild 9/9, display 1/1, `typecheck` exit 0, `backlog-check` exit 0 (757 rows).
- **Not verified:** the seeded `.e2e-host-app` themes are written at seed time and were not regenerated here; the main Playwright suite did not run (port 4174 owned elsewhere, and `vg-756` records the npm scripts resolving the wrong Playwright).

## Next

1. Task 4.1 — computed names, role-first order, non-removable roles, the copy sweep; then 4.2–4.4.
2. Local merge to `main` after 4.1, once the token inspector no longer writes fields the validator refuses.
3. Phase 5 — element size/leading/tracking rows and canvas resize, which restore the authored sizes the rebuilt composition lost.

## Blockers / unverified

- **Four unit files are red on purpose:** `editor-session.dom.test.ts`, `new-object-defaults.test.ts`, `selection-inspector/runs.dom.test.ts`, `panes/tokens/token-inspector.dom.test.tsx` — Tasks 4.1 and 5.4.
- **The rebuilt composition falls back to role defaults** (28 runs, none with `style.fontSize`) until Task 5.2 adds the size row; the authored 46/17/108 return then.
- **`new-object-defaults.ts` still reads `size`/`trioRole` off tokens** until Task 5.4.
- **`editor.spec.ts` deletes the role token `body`** in its reassign case; Task 4.1 must rewrite it around an unroled token.
