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

- Text layout derives from the Fabric class: `IText` measures itself, `Textbox` wraps; the authored `wrap` key is deleted and an old one is ignored.
- The inspector's Wrap control and its copy are gone; the runs projection carries `wraps` for later class-specific controls.
- Decision 0098 records why the persisted class, not a flag, owns the width mode.

## Next

1. Task 1.2: revive a legacy `"Text"` as `IText` in the editor only.
2. Tasks 1.3–1.4: construct the chosen class, then place text by click or drag.

## Blockers / unverified

- No browser proof yet for the click-or-drag gesture; Phase 3 owns it.
- Outside this plan: the store Worker is undeployed, and the live catalogue's smoke theme still carries the old media shape.
