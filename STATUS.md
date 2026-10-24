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

- The canvas's next primary press places text: a click makes an `IText` at the press point, a drag of 4 CSS pixels or more makes a `Textbox` from the normalised rectangle.
- Escape, a non-primary press and a press outside the artboard cancel; arming saves and restores `skipTargetFind`, `selection` and `defaultCursor`.
- The dashed drag outline is painted on `after:render` and is never canvas content; the gesture itself never saves, so construction owns the one history entry.

## Next

1. Task 2.1: arm the one placement route from the Add tile, context menu and footer, constructing at the gesture.

## Blockers / unverified

- No browser proof yet for the click-or-drag gesture; Phase 3 owns it.
- Outside this plan: the store Worker is undeployed, and the live catalogue's smoke theme still carries the old media shape.
