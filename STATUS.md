# Yunari status

Updated: 2026-10-23
Branch: `peterng1618/Color-and-gradient-picker-rebuild`

## Current objective

The **colour and gradient picker rebuild** ([`spec`](docs/superpowers/specs/2026-10-12-colour-and-gradient-rebuild-design.md), [`plan`](docs/superpowers/plans/2026-10-23-colour-and-gradient-rebuild.md)) replaces the Tokens pane's two paint controls with one culori-backed picker and a gradient track. **Phase 0 — the shared parser and the editor-local preset library — lands on `main` first**, so the asset finder's palettes-and-gradients spec builds against the committed location and data shape.

## Active work

- **Phase 0 of the plan is complete** — Tasks 1–4; Task 4's live/settled hook has landed on this branch; Tasks 5–10 follow under subagent-driven execution.
- **The preset library's contract is public**: `editor/src/preset-library/index.ts` (`addColours`, `addGradient`, `deletePreset`), storage `yunari.editor.presets`, seeded with 12 colours and the 15 cssgradient.io gradients.
- **The asset finder surface is a separate spec** and calls into that library; it does not write the key.

## Last completed change

- **One picker state owner**: `use-colour-picker.ts` holds the live `Hsva`, the shown text, a refusal that survives an outside write, and a `latest` ref so `commit()` settles on the last emitted hex.
- **A rejected draft survives `ControlText`**: `commitText` writes the refused input back to the hook's own `text`, which is the only place it can live after the field clears its draft.
- **Gated write**: `docs/decisions/0100-the-live-settled-picker-state-is-one-hook.md` claims the new `components/ui` owner.
- **Proof:** 6 DOM tests in `use-colour-picker.dom.test.tsx`, editor typecheck, `format:check`, `lint` and the design-token ratchet — all exit 0.
- **Not browser-proven**: no picker surface consumes the hook until Task 5.

## Next

1. Continue the plan at Task 5 (the popover picker surface), then the undo and gradient tasks.
2. Build the asset finder surface against `presetLibrary.addColours` and `addGradient`.

## Blockers / unverified

- **No browser proof yet**: parser and library are unit-tested only; the picker and gradient surfaces do not exist until Tasks 4–8.
- **Seed data transcribed, not visually reviewed**: the 15 gradients were read from cssgradient.io on 2026-10-23 and normalised to `angle: 0`.
