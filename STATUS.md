# Yunari status

Updated: 2026-10-24
Branch: `peterng1618/Fixing-the-text-element`

## Current objective

The **Text and text box elements** plan ([`spec`](docs/superpowers/specs/2026-10-24-text-elements-design.md), [`plan`](docs/superpowers/plans/2026-10-24-text-elements.md)) is active: split one text element into `IText` and `Textbox`, chosen by a click-or-drag gesture, with the authored `wrap` flag removed.

## Active work

- **Active plan:** `docs/superpowers/plans/2026-10-24-text-elements.md`
- Phase 1 — the class is the width model: layout derived from the class, legacy `"Text"` revives as `IText`, `addText` constructs the chosen class, the placement gesture lands.
- Phase 2 — one arming route across Add, context and footer, and an inspector that shows only the selected class's controls.
- Phase 3 — e2e text placement through the gesture, browser proof, ownership docs, full gate.

## Last completed change

- `IText` gets corners and rotation only: its own control set omits `ml`/`mr`/`mt`/`mb`, built from the shared object set so the overrides still apply.
- `Textbox` keeps all nine handles and every other object keeps Fabric's full set; unit and dom tests pin all three.

## Next

1. Phase 2 / Task 2.5: typing into a just-placed text is kept.
2. Rewrite then unpin the `text-elements.spec.ts` control test: a Text now has no `ml`/`mr` either, so its expectation is stale.
3. Phase 3 / Task 3.3: ownership docs, status and the full gate.

## Blockers / unverified

- The e2e control test is still pinned `test.fail` and now fails on its stale `ml`/`mr` expectation, so the browser proof of the new contract has not run.
- Outside this plan: the store Worker is undeployed, and the live catalogue's smoke theme still carries the old media shape.
