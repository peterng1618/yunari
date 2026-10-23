# Yunari status

Updated: 2026-10-23
Branch: `peterng1618/asset-finder-hub`

## Current objective

The **colour and gradient picker rebuild** ([`spec`](docs/superpowers/specs/2026-10-12-colour-and-gradient-rebuild-design.md), [`plan`](docs/superpowers/plans/2026-10-23-colour-and-gradient-rebuild.md)) replaces the Tokens pane's two paint controls with one culori-backed picker and a gradient track. **Phase 0 — the shared parser and the editor-local preset library — lands on `main` first**, so the asset finder's palettes-and-gradients spec builds against the committed location and data shape.

## Active work

- **Phase 0 of the plan is complete** — Tasks 1 and 3; Tasks 2 and 4–10 run next on `peterng1618/Color-and-gradient-picker-rebuild` under subagent-driven execution.
- **The preset library's contract is public**: `editor/src/preset-library/index.ts` (`addColours`, `addGradient`, `deletePreset`), storage `yunari.editor.presets`, seeded with 12 colours and the 15 cssgradient.io gradients.
- **The asset finder surface is a separate spec** and calls into that library; it does not write the key.

## Last completed change

- **The finder branch is synced with `main`**: page numbers and the joined icon path merge with the Wallpaper Engine import, the background layer, the culori parser and the preset library.
- **One colour parser on culori**: `renderer-core/src/color.ts` owns `parseColor`/`formatColor`/`toHsv`/`fromHsv`; `parseHex` and its 3-tuple retire.
- **The editor-local preset library lands**: seed-once storage under `yunari.editor.presets`, validated adds, exact-duplicate skips, delete, and a `usePresetLibrary` subscription.
- **Ownership moves with it**: `docs/architecture/ownership.md` names both owners; culori 4.0.2 and its types are in the notices and dependency record.
- **Proof:** renderer-core 642 tests, preset-library 14 tests, both package typechecks, `design:check` and `gates:self-test` — all exit 0.

## Next

1. Continue the plan at Task 2 on the rebuild branch, then the picker, undo and gradient tasks.
2. Build the asset finder surface against `presetLibrary.addColours` and `addGradient`.

## Blockers / unverified

- **No browser proof yet**: parser and library are unit-tested only; the picker and gradient surfaces do not exist until Tasks 4–8.
- **Seed data transcribed, not visually reviewed**: the 15 gradients were read from cssgradient.io on 2026-10-23 and normalised to `angle: 0`.
