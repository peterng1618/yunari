# Yunari status

Updated: 2026-10-24
Branch: `main`

## Current objective

The **Text and text box elements** plan ([`spec`](docs/superpowers/specs/2026-10-24-text-elements-design.md), [`plan`](docs/superpowers/plans/2026-10-24-text-elements.md)) is complete and merged; no plan is active. The colour and gradient picker rebuild is also merged.

## Active work

- **Nothing is dispatched.** The queue waits on a named plan.
- **Text is two Fabric classes:** `IText` is placed by a click, `Textbox` by a drag, and the persisted Fabric `type` is the only width-mode discriminator.
- **Sources:** the preset library is editor-local (`yunari.editor.presets`, version 1); the Colours tab adds palettes and gradients to it.

## Last completed change

- **Text and text box are separate classes**: one click-or-drag placement gesture arms from every creation surface, and authored `wrap` is gone and ignored on load.
- **Legacy `"Text"` revives as editable `IText`** in the editor only; the player renders whichever class the scene carries.
- **The Runs inspector shows one run at a time** behind numbered tabs, with a lucide `+` that adds and selects the run.
- **Proof:** `npm run gate` exited 0 (342 unit files / 4804 tests; worker 12 / 72) and the text browser spec passed 9 desktop cases with 0 unexpected; the six e2e suites the gesture touched were re-run green.

## Next

1. Drain the backlog register: `2026-10-12-the-backlog-drain.md` is queued.
2. Then `2026-10-21-theme-store-origin-and-style.md` and `2026-10-23-r2-store-backend.md`.
3. The owner's R2 Task 5.2 deploy and the Wallpaper Engine live export wait outside any plan.

## Blockers / unverified

- **A gradient stop moved past its neighbour writes descending offsets** and the validator refuses the document (`vg-712`, issue #52).
- **Arming text placement survives inserting a shape** (`vg-714`), so the next canvas press places text instead of selecting.
- **The picker popup is 630px tall** with twelve seeded presets at a 720px viewport, so Base UI side-places it.
- **The compact editor header stays wider than a phone** (`vg-707`), and `server.test.ts` flakes pre-existing (`vg-695`).
- **The text e2e cases skip on `phone-chromium` by design**, so the phone surface is unproven for the new gesture.
