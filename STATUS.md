# Yunari status

Updated: 2026-10-23
Branch: `peterng1618/Color-and-gradient-picker-rebuild`

## Current objective

The **colour and gradient picker rebuild** ([`spec`](docs/superpowers/specs/2026-10-12-colour-and-gradient-rebuild-design.md), [`plan`](docs/superpowers/plans/2026-10-23-colour-and-gradient-rebuild.md)) replaces the Tokens pane's two paint controls with one culori-backed picker and a gradient track. **Phase 0 — the shared parser and the editor-local preset library — lands on `main` first**, so the asset finder's palettes-and-gradients spec builds against the committed location and data shape.

## Active work

- **Phase 0 and Task 5 of the plan are complete**; Tasks 6–10 are queued under subagent-driven execution.
- **The preset library's contract is public**: `editor/src/preset-library/index.ts` (`addColours`, `addGradient`, `deletePreset`), storage `yunari.editor.presets`, seeded with 12 colours and the 15 cssgradient.io gradients.
- **The picker surface consumes `useColourPicker` and the library**: `components/ui/colour-picker.tsx` and `preset-context-menu.tsx`.

## Last completed change

- **The popover picker**: a trigger in a §5 well, a saturation × brightness area, hue and alpha tracks, one value field, the preset radiogroup and the eyedropper.
- **Preset deletion** by right-click, `Shift+F10`/ContextMenu and `Delete`, through a pointer-anchored controlled `PresetContextMenu`.
- **The old parser is gone**: `parseColor` from `renderer-core` replaces `colour-maths.ts`, and both new sources are on the design-token ratchet (decision 0101).
- **Proof:** 29 focused DOM tests, editor typecheck, `format:check`, `lint` and `design:check` — all exit 0.
- **Build-only call-site change**: `paint-list.tsx` and `gradient-editor.tsx` were renamed to `onValueChange`/`onValueCommit`; their own wiring is Tasks 6 and 8.

## Next

1. Continue the plan at Task 6 (the Tokens pane's one trigger per colour), then undo and the gradient track.
2. Build the asset finder surface against `presetLibrary.addColours` and `addGradient`.

## Blockers / unverified

- **No browser proof of the picker surface yet**: the DOM tests stub pointer capture, rects and `EyeDropper`; Task 10's browser proof is still owed.
- **`tests/e2e/keyboard.spec.ts` reads the old popup readout paragraph**; it is updated when the surface's browser proof runs.
- **Seed data transcribed, not visually reviewed**: the 15 gradients were read from cssgradient.io on 2026-10-23 and normalised to `angle: 0`.

