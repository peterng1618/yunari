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

- All nine e2e cases now assert the live contract: Text exposes `tl`/`tr`/`bl`/`br`/`mtr` only, Textbox keeps all nine, and no case is pinned `test.fail`.
- A Text's resize proof is a `br` corner drag: `scaleX`/`scaleY` rise, measured `width` holds, and no authored `yunariText.box` is written.
- New case: words typed into a placed Text are the run's authored text, the repaint keeps the width they grew to, and Save to library + reopen keeps them.
- Two clean `--workers=1` runs: expected 9, skipped 9, unexpected 0, flaky 0.

## Next

1. Phase 3 / Task 3.3: ownership docs, status and the full gate.

## Blockers / unverified

- Outside this plan: the store Worker is undeployed, and the live catalogue's smoke theme still carries the old media shape.
