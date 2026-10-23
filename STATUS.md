# Yunari status

Updated: 2026-10-23
Branch: `peterng1618/Color-and-gradient-picker-rebuild`

## Current objective

The **colour and gradient picker rebuild** ([`spec`](docs/superpowers/specs/2026-10-12-colour-and-gradient-rebuild-design.md), [`plan`](docs/superpowers/plans/2026-10-23-colour-and-gradient-rebuild.md)) replaces the Tokens pane's two paint controls with one culori-backed picker and a gradient track. **Phase 0 — the shared parser and the editor-local preset library — lands on `main` first**, so the asset finder's palettes-and-gradients spec builds against the committed location and data shape.

## Active work

- **Phase 0 and Tasks 1–7 of the plan are complete**; Tasks 8–10 are queued under subagent-driven execution.
- **The preset library's contract is public**: `editor/src/preset-library/index.ts` (`addColours`, `addGradient`, `deletePreset`), storage `yunari.editor.presets`, seeded with 12 colours and the 15 cssgradient.io gradients.
- **The picker surface consumes `useColourPicker` and the library**: `components/ui/colour-picker.tsx` and `preset-context-menu.tsx`; the Tokens pane mounts it as its only solid-colour control.

## Last completed change

- **Undo carries the palette with the scene**: `EditorHistory` stores `{ scene, globals }` and compares both, so a palette-only edit records one entry.
- **The document lends history the envelope**: `attachGlobals` reads `envelope.globals`, and a restore writes them back through `#restoreGlobals` with no `saveState()`, so undo appends nothing.
- **Attaching after the shell's `reset()` patches entry 0**, so undo to the opening state restores the palette it opened with.
- **An undo also repaints the types panel**: `#restoreGlobals` re-renders `types().render(typePresets)`, since a preset edit is an undo entry too.
- **Proof:** 4 new history cases plus a document undo case (RED before each fix, GREEN after) and 181 editor test files — exit 0; typecheck, `format:check`, `lint`, `design:check`, `status:check` exit 0.

## Next

1. Continue the plan at Task 8 (the gradient track), then §5 and Task 10's browser proof.
2. Build the asset finder surface against `presetLibrary.addColours` and `addGradient`.

## Blockers / unverified

- **No browser proof of the picker surface yet**: the DOM tests stub pointer capture, rects and `EyeDropper`; Task 10's browser proof is still owed.
- **`tests/e2e` still targets the removed pane field** (`editor.spec.ts`, `glass-authoring.spec.ts`, `rebuild-driver.ts`) and the old keyboard readout; Task 10 teaches them the trigger-first path.
- **Seed data transcribed, not visually reviewed**: the 15 gradients were read from cssgradient.io on 2026-10-23 and normalised to `angle: 0`.

