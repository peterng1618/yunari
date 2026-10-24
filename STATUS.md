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

- Every text surface now arms one session route: the Add tile, canvas context menu and footer carry no placement of their own, and `addText` no longer constructs at the click.
- At the gesture's end a click constructs an `IText` at the point and a drag a `Textbox` from the drawn box, named `Text`/`Text box`, reported once if the theme refuses.
- Shapes, charts and cards keep their cascade placement; text no longer calls `nextNewObjectPlacement`.

## Next

1. Task 2.2: the inspector states the class's remaining contract.

## Blockers / unverified

- No browser proof yet for the click-or-drag gesture; Phase 3 owns it.
- Outside this plan: the store Worker is undeployed, and the live catalogue's smoke theme still carries the old media shape.
