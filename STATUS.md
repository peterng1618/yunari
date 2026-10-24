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

- The edit records the display Fabric captured before the authoring view painted, separately from the painted token.
- Typing that display back now saves its authored run even though Fabric fires no `object:modified`; every other change is still saved there, and the two conditions are complementary so one edit commits once.
- The placement test's save pin now states it guards against a second commit, not the write itself.

## Next

1. Phase 3 / Task 3.2 (resumed): remove the stale `test.fail` pin and prove a placed text keeps typed words across a reload.
2. Phase 3 / Task 3.3: ownership docs, status and the full gate.

## Blockers / unverified

- The e2e control test is still pinned `test.fail` and now fails on its stale `ml`/`mr` expectation, so the browser proof of the new contract has not run.
- Outside this plan: the store Worker is undeployed, and the live catalogue's smoke theme still carries the old media shape.
