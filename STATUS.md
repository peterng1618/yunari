# Yunari status

Updated: 2026-10-26
Branch: `main`

## Current objective

Land the chart spec [`2026-10-25-chart-playback-and-segmented-fill-design.md`](docs/superpowers/specs/2026-10-25-chart-playback-and-segmented-fill-design.md): plans 1 (playback), 2 (segmented fill) and 3 (radar and polar bar) are all landed; the owner's test is the remaining gate.

## Active work

- **Chart spec complete:** `docs/superpowers/plans/2026-10-25-radar-and-polar-bar.md` merged locally into `main`; no queued plan.
- **Wallpaper Engine export landed:** `docs/superpowers/plans/2026-10-26-wallpaper-engine-mobile-export.md`; decision [0118](docs/decisions/0118-a-scene-is-exported-by-driving-the-engine-ui.md) claims the UI-driving boundary.
- **Segmented-fill plan landed:** divisor setting, discrete slider, gauge bands, pie spacers and bar custom series.
- **Live-line policy:** the delay is two host cadences at 30 fps and zero at 1 fps; the line never smooths — Interpolation offers Linear and Step — and a stall holds the last reading to the edge and steps at the next batch.
- **Owner testing follows the run:** each plan merges locally into `main`; nothing is pushed, and the owner tests after the sequence.
- **Decision note:** [0116](docs/decisions/0116-chart-motion-is-the-engines-and-the-line-is-a-clock.md) claims the chart mechanism boundaries.

## Last completed change

- **The export leaves the author's library alone:** the grid's Source filter is persisted in the engine's own config and is never touched; its rows ignore synthetic clicks, so the old `Set-Local-Source` was a no-op and is gone.
- **A click needs the foreground and the current layout:** the engine is taken to the foreground through `AttachThreadInput` and maximised to force the web layer to reflow, then restored on every exit, failures included.
- **The local project is picked by its authoring note:** a workshop item that shares the title has none, and `no-tile` now names the Source filter.
- **Verified live:** `Tokyo` reached the engine's Save dialog through the real runner, and the config's `sourcetags` were identical before and after.

## Next

1. Owner test of radar and polar bar in the editor, then phone performance and value-chart transition evidence.
2. Owner test of one scene export end to end: press the button, save the package, import the video.
3. Keep every checkpoint local; no push until the owner asks.

## Blockers / unverified

- **The Save click is unverified end to end:** the harvest is unit-tested against a Documents fixture, not against a package the engine wrote after a real Save.
- **The folder fallback is unverified live:** a project filed into a Wallpaper Engine folder is absent from the root grid, and the route that enters `yunari-background` first has not run against a filed project.
- **Phone performance is unmeasured:** thirty applications per second across several charts is unproven on the phone that reported the defect.
- **Value-chart engine transitions are not browser-verified:** the gate proves the option flag and signature, not motion across frames.
- **Polar bar evidence uses one low reading:** `cpu.load` is 9.28 on a 0–100 scale, so the sector sits at the inner radius (26.7% of the canvas); legibility at realistic 40–80% readings is unverified.
