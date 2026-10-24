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

- `reviveScene` takes an editor-only `editableText` option that revives nested serialised `type: "Text"` as `IText` on a copy, leaving geometry, runs and styles untouched.
- The editor's mount and its history revive both pass it, so a legacy display text opens editable and stays editable after undo; the player's revive is unchanged.

## Next

1. Task 1.3: `addText` constructs the chosen class (`IText` for a click, `Textbox` for a drag).
2. Task 1.4: place text by click or drag through the one text route.

## Blockers / unverified

- No browser proof yet for the click-or-drag gesture; Phase 3 owns it.
- Outside this plan: the store Worker is undeployed, and the live catalogue's smoke theme still carries the old media shape.
