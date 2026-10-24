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

- New `tests/e2e/text-elements.spec.ts` proves click/drag classes, growth, wrap, cancel, save/reload, legacy load, player parity and run tabs.
- Text `ml`/`mr` scale and W/H are read-only; Text box `ml`/`mr` change the width and W/H stay editable.
- The no-`mt`/`mb` case is pinned `test.fail`: `controls-manager` still gives `IText` the six default edges.

## Next

1. Phase 3 / Task 3.3: ownership docs, status and the full gate.
2. Drop the `text-elements.spec.ts` `test.fail` pin once the `mt`/`mb` edges are Textbox-only.

## Blockers / unverified

- `IText` still carries Fabric's `mt`/`mb` scaleY edges; the Text contract says height edges are Textbox-only, and the fix is outside Task 3.2's evidence-only scope.
- Outside this plan: the store Worker is undeployed, and the live catalogue's smoke theme still carries the old media shape.
