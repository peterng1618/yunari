# Yunari status

Updated: 2026-10-24
Branch: `main`

## Current objective

The **colour and gradient picker rebuild** ([`spec`](docs/superpowers/specs/2026-10-12-colour-and-gradient-rebuild-design.md), [`plan`](docs/superpowers/plans/archive/2026-10-23-colour-and-gradient-rebuild.md)) is complete and merged; no plan is active.

## Active work

- **Nothing is dispatched.** The rebuild's plan is closed and the queue waits on a named plan.
- **Sources:** the preset library is editor-local (`yunari.editor.presets`, version 1); the Colours tab adds palettes and gradients to it.

## Last completed change

- **The picker is rebuilt on culori and the ReUI contract**: one popover trigger per colour, area/hue/alpha controls, an exact-value field and presets, with asset-finder palette and gradient adds landing in the same library.
- **The gradient editor draws its own track**: stops are sliders with drag, typed and keyboard input and a live `linear-gradient` preview; the old angle and per-stop rows are gone.
- **Undo owns globals**: palette and type commits are their own history entries, and a restored globals bag repaints every consumer.
- **Proof:** `npm run gate` exited 0 (346 unit files / 4805 tests; worker 12 / 72) and the colour-picker browser spec passed 8/8.

## Next

1. Drain the backlog register: `2026-10-12-the-backlog-drain.md` is queued.
2. Then `2026-10-21-theme-store-origin-and-style.md` and `2026-10-23-r2-store-backend.md`.
3. The owner's R2 Task 5.2 deploy and the Wallpaper Engine live export wait outside any plan.

## Blockers / unverified

- **The picker popup is 630px tall with twelve seeded presets** at a 720px viewport, so Base UI side-places it; no clipping is captured, but the unbounded height is unchanged.
- **A gradient stop moved past its neighbour writes descending offsets** and the validator refuses the document (`vg-712`, issue #52).
- **The gradient capture's fixed status footer overlaps the last preset row** in the scoped element screenshot; the track, the `25 %` position and the preset row are visible.
- **The Colours sources are routed fixtures in the browser proof**, the store Worker is not deployed, and a theme's `credits.json` does not survive the host library (`vg-698`).
- **The compact editor header stays wider than a phone** (`vg-707`), and `server.test.ts` flakes pre-existing (`vg-695`).
