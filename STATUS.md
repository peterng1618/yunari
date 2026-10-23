# Yunari status

Updated: 2026-10-24
Branch: `peterng1618/Color-and-gradient-picker-rebuild`

## Current objective

The **colour and gradient picker rebuild** ([`spec`](docs/superpowers/specs/2026-10-12-colour-and-gradient-rebuild-design.md), [`plan`](docs/superpowers/plans/2026-10-23-colour-and-gradient-rebuild.md)) replaces the Tokens pane's two paint controls with one culori-backed picker and a gradient track. **Phase 0 — the shared parser and the editor-local preset library — lands on `main` first**, so the asset finder's palettes-and-gradients spec builds against the committed location and data shape.

## Active work

- **Tasks 1–9 of the plan are complete**; Task 10 (browser proof) is queued under subagent-driven execution.
- **The preset library's contract is public**: `editor/src/preset-library/index.ts` (`addColours`, `addGradient`, `deletePreset`), storage `yunari.editor.presets`, seeded with 12 colours and the 15 cssgradient.io gradients.
- **The picker surface consumes `useColourPicker` and the library**: `components/ui/colour-picker.tsx` and `preset-context-menu.tsx`; the Tokens pane mounts it as its only solid-colour control.
- **The gradient is one track**: `components/ui/gradient-editor.tsx` is the preview and the manipulator, editing the selected stop through one picker and one percent well, with the library's gradients in a labelled preset row.

## Last completed change

- **§5 names the two new controls as built**: the 2-D colour area and the gradient track join the closed vocabulary at `--radius-sm` with their slider, keyboard and focus-boundary rules beside the table.
- **Both picker surfaces join the token gate**: `colour-picker.tsx` and `gradient-editor.tsx` are gated, with the derived `.dom.test.tsx` halves still selected by rule.
- **Proof:** `design:check`, `gates:self-test`, `format:check`, `lint` and `status:check` exit 0; the remainder holds at 2 against its ceiling of 2.

## Next

1. Run Task 10: the browser cases, drivers and capture rows, including the undo-after-drag case.
2. Build the asset finder surface against `presetLibrary.addColours` and `addGradient`.

## Blockers / unverified

- **No browser proof of the picker or the gradient track yet**: the DOM tests stub pointer capture, rects and `EyeDropper`; Task 10's browser proof is still owed.
- **`tests/e2e` still targets removed DOM**: `editor.spec.ts`, `glass-authoring.spec.ts` and `rebuild-driver.ts` name the old pane fields, `panel-labels.spec.ts` names the removed angle/stop rows, and the keyboard readout is stale; Task 10 owns all of them.
- **Seed data transcribed, not visually reviewed**: the 15 gradients were read from cssgradient.io on 2026-10-23 and normalised to `angle: 0`.

