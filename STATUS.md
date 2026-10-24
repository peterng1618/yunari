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

- Editing entry and exit are canvas-level: the words typed into a constructed text become its authored run on `text:editing:exited`, whichever route entered editing.
- The double-click's per-object `once` handler is gone, so one edit saves once on either route; the unchanged-edit guard and the multi-run refusal stay.

## Next

1. Phase 3 / Task 3.2 (resumed): remove the stale `test.fail` pin and prove a placed text keeps typed words across a reload.
2. Phase 3 / Task 3.3: ownership docs, status and the full gate.

## Blockers / unverified

- The e2e control test is still pinned `test.fail` and now fails on its stale `ml`/`mr` expectation, so the browser proof of the new contract has not run.
- Outside this plan: the store Worker is undeployed, and the live catalogue's smoke theme still carries the old media shape.
