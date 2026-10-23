# Yunari status

Updated: 2026-10-24
Branch: `peterng1618/Color-and-gradient-picker-rebuild`

## Current objective

The **colour and gradient picker rebuild** ([`spec`](docs/superpowers/specs/2026-10-12-colour-and-gradient-rebuild-design.md), [`plan`](docs/superpowers/plans/2026-10-23-colour-and-gradient-rebuild.md)) is complete through Task 10; the plan closes with this task's second commit.

## Active work

- **Nothing is dispatched.** The rebuild's final task is committed; the queue waits on a named plan.

## Last completed change

- **Task 10 proves both surfaces in Chromium**: `tests/e2e/colour-picker.spec.ts` covers one undo entry per drag, gradient drag/number agreement, preset application, preset deletion across reload, and the focus boundary in all six palettes (5.68–18.39:1).
- **The one trigger and its popover are what the drivers drive**: `rebuild-driver.addColour`, `editor.spec.ts`, `keyboard.spec.ts`, `panel-labels.spec.ts` and `glass-authoring.spec.ts` open `[data-yunari-palette-picker]` and read `[data-yunari-palette-color]` there.
- **The gradient editor inserts a new stop where its offset sorts**, so a press on the track no longer appends a lower offset after a higher one and writes a theme the validator refuses.
- **Evidence**: `editor-colour-picker` and `editor-gradient-editor` are captured and registered; `npm run gate` exits 0.

## Next

1. Name the next plan; the queued work is the asset finder's palette-and-gradient surface and the backlog drain.
2. Close `vg-405` and `vg-439` from this branch's work and Task 1's parser commit in the same task's second commit.

## Blockers / unverified

- **The picker popup is 630px tall with twelve seeded presets** (Task 5's deferred finding): it fits neither above nor below the Tokens well at 720px, so Base UI places it to the right, clamped inside the viewport; the capture shows no clipping, but the unbounded height is unchanged.
- **The gradient capture's fixed status footer overlaps the last preset row** in the scoped element screenshot; the track and the preset row the checklist names are both visible.
