# Yunari status

Updated: 2026-10-23
Branch: `peterng1618/asset-finder-hub`

## Current objective

Implement the **Colours tab** ([`plan`](docs/superpowers/plans/2026-10-23-colours-tab.md), [`spec`](docs/superpowers/specs/2026-10-23-colours-tab-design.md)): palettes and gradients from four live sources become presets in the editor-local library.

## Active work

- **The Colours tab plan is the one active implementation plan**; every other incomplete plan is queued.
- **Phase 1 (Tasks 1–5)** adds the `colour` category, the optional `preset` wire member and the four host adapters.
- **Phase 2 (Tasks 6–8)** adds the tab and kind filter, the Add-to-presets action and the browser proof.
- **Sources:** Color Hunt and ColorSwoop (palettes), UI Gradients and WebGradients (gradients); Coolors is excluded by its terms.
- **Dispatch records:** `.superpowers/sdd/2026-10-23-colours-tab/`, deleted when a task completes.
- **Open register findings:** `vg-699` stale `vite preview` reuse on a shared port, `vg-701` biome never reads `.mjs`, `vg-695` a pre-existing `server.test.ts` flake, `vg-708` a theme's credits are written but never drawn.

## Last completed change

- **The Colours tab spec and plan are committed**: four live sources, one `preset` payload, one preset-library action, and colour-neighbour search deferred to phase two.
- **One colour parser on culori**: `renderer-core/src/color.ts` owns `parseColor`/`formatColor`/`toHsv`/`fromHsv`; `parseHex` and its 3-tuple retire.
- **The editor-local preset library lands**: seed-once storage under `yunari.editor.presets`, validated adds, exact-duplicate skips, delete, and a `usePresetLibrary` subscription.
- **Ownership moves with it**: `docs/architecture/ownership.md` names both owners; culori 4.0.2 and its types are in the notices and dependency record.
- **Proof:** renderer-core 642 tests, preset-library 14 tests, both package typechecks, `design:check` and `gates:self-test` — all exit 0.

## Next

1. Execute Phase 1 Tasks 1–5 through subagents, one task and one review at a time.
2. Execute Phase 2 Tasks 6–8, then the whole-branch review and `npm run gate`.
3. The owner's R2 Task 5.2 deploy and the Wallpaper Engine live export still wait outside this plan.

## Blockers / unverified

- **No Colours-tab browser proof yet**: the tab, the filter and the preset write are unbuilt until Phase 2.
- **The store Worker is not deployed and no live store path has run**; `CATALOGUE_ORIGIN` is still the placeholder and no normalized video has played in a browser.
- **No live Wallpaper Engine export has been offered by the sheet**, and the compact editor header stays wider than a phone (`vg-707` waits on a ruling).
- **A theme's `credits.json` does not survive the host library** (`vg-698`), and `server.test.ts` flakes pre-existing (`vg-695`).
- **Colour-neighbour search is deferred** to phase two, after the picker rebuild merges.
