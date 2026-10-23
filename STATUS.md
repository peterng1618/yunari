# Yunari status

Updated: 2026-10-23
Branch: `peterng1618/Color-and-gradient-picker-rebuild`

## Current objective

The **colour and gradient picker rebuild** ([`spec`](docs/superpowers/specs/2026-10-12-colour-and-gradient-rebuild-design.md), [`plan`](docs/superpowers/plans/2026-10-23-colour-and-gradient-rebuild.md)) replaces the Tokens pane's two paint controls with one culori-backed picker and a gradient track. **Phase 0 — the shared parser and the editor-local preset library — lands on `main` first**, so the asset finder's palettes-and-gradients spec builds against the committed location and data shape.

## Active work

- **Phase 0 of the plan is complete** — Tasks 1 and 3; Task 2's channel model and gradient formula have landed on this branch; Tasks 4–10 follow under subagent-driven execution.
- **The preset library's contract is public**: `editor/src/preset-library/index.ts` (`addColours`, `addGradient`, `deletePreset`), storage `yunari.editor.presets`, seeded with 12 colours and the 15 cssgradient.io gradients.
- **The asset finder surface is a separate spec** and calls into that library; it does not write the key.

## Last completed change

- **One channel model**: `colour-picker-model.ts` owns the channel table, read/write, ratios, keyboard stepping and the area's point mapping plus its `aria-valuetext`.
- **One gradient formula**: `gradient-css.ts` holds the sort/round/angle string, and `paint-list.tsx` calls it instead of its local copy.
- **Gated write**: `docs/decisions/0099-the-picker-channel-maths-and-one-gradient-formula.md` claims both new `components/ui` owners.
- **Proof:** the two new test files plus `paint-list.dom.test.tsx` (26 tests), editor typecheck, `format:check` and the design-token ratchet — all exit 0.
- **Not browser-proven**: the maths is unit-tested; no picker surface renders it until Tasks 4–8.

## Next

1. Continue the plan at Task 2 on the rebuild branch, then the picker, undo and gradient tasks.
2. Build the asset finder surface against `presetLibrary.addColours` and `addGradient`.

## Blockers / unverified

- **No browser proof yet**: parser and library are unit-tested only; the picker and gradient surfaces do not exist until Tasks 4–8.
- **Seed data transcribed, not visually reviewed**: the 15 gradients were read from cssgradient.io on 2026-10-23 and normalised to `angle: 0`.
