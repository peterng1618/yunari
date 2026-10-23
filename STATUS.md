# Yunari status

Updated: 2026-10-24
Branch: `peterng1618/Color-and-gradient-picker-rebuild`

## Current objective

The **colour and gradient picker rebuild** ([`spec`](docs/superpowers/specs/2026-10-12-colour-and-gradient-rebuild-design.md), [`plan`](docs/superpowers/plans/2026-10-23-colour-and-gradient-rebuild.md)) replaces the Tokens pane's two paint controls with one culori-backed picker and a gradient track. **Phase 0 — the shared parser and the editor-local preset library — lands on `main` first**, so the asset finder's palettes-and-gradients spec builds against the committed location and data shape.

## Active work

- **Tasks 1–8 of the plan are complete**; Tasks 9 (DESIGN.md §5 and the token gate) and 10 (browser proof) are queued under subagent-driven execution.
- **The preset library's contract is public**: `editor/src/preset-library/index.ts` (`addColours`, `addGradient`, `deletePreset`), storage `yunari.editor.presets`, seeded with 12 colours and the 15 cssgradient.io gradients.
- **The picker surface consumes `useColourPicker` and the library**: `components/ui/colour-picker.tsx` and `preset-context-menu.tsx`; the Tokens pane mounts it as its only solid-colour control.
- **The gradient is one track**: `components/ui/gradient-editor.tsx` is the preview and the manipulator, editing the selected stop through one picker and one percent well, with the library's gradients in a labelled preset row.

## Last completed change

- **The gradient track is the preview and the manipulator**: one sorted-free stop list, drag and keyboard on each `role="slider"` mark, add on the bare track and at the selected stop's midpoint, and Delete/remove refusing below two stops.
- **One picker and one percent well edit the selected stop**, and the angle well sits beside the track; every gesture is one `onCommit` at its boundary.
- **The library's gradients are a labelled preset row**, with the same right-click/`Shift+F10`/Delete menu the colour presets use.
- **The pane's angle row and per-stop sliders are gone**, forwarding `onCommit={onSettled}` instead; the stop's accessible name comes from `uiCopy` and the copy net now reads it by its own attribute route.
- **Proof:** gradient editor 16/16 and paint-list + copy net 37 green; typecheck, `format:check`, `lint`, `design:check` and `status:check` exit 0.

## Next

1. Run Task 9: add the colour-area and gradient-track rows to DESIGN.md §5, join the gated list, and prove the gate.
2. Run Task 10: the browser cases, drivers and capture rows, including the undo-after-drag case.
3. Build the asset finder surface against `presetLibrary.addColours` and `addGradient`.

## Blockers / unverified

- **No browser proof of the picker or the gradient track yet**: the DOM tests stub pointer capture, rects and `EyeDropper`; Task 10's browser proof is still owed.
- **`tests/e2e` still targets removed DOM**: `editor.spec.ts`, `glass-authoring.spec.ts` and `rebuild-driver.ts` name the old pane fields, `panel-labels.spec.ts` names the removed angle/stop rows, and the keyboard readout is stale; Task 10 owns all of them.
- **Seed data transcribed, not visually reviewed**: the 15 gradients were read from cssgradient.io on 2026-10-23 and normalised to `angle: 0`.

