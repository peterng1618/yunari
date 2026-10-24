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

- `placeText`'s default point is the artboard centre from `viewport.artboardScreenRect()`; explicit scene points use `viewportTransform`.
- `insertTextBox` drag-places a Textbox, and `addText` uses it, so the rebuild journey authors boxes again.

## Next

1. Phase 3 / Task 3.2: prove click, drag, cancel, reload and player parity.

## Blockers / unverified

- No browser proof yet for drag, cancel, reload or player parity; Task 3.2 owns them.
- Outside this plan: the store Worker is undeployed, and the live catalogue's smoke theme still carries the old media shape.
