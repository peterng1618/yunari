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

- **Scene export drives the engine's own UI:** the host presses Send to Mobile Device → Export .mpkg, sets Keep original aspect ratio and Original, and leaves the Save dialog to the author.
- **The saved package becomes a video:** the host watches Documents, reads `wallpaper.mp4` out of the `PKGM` table and drops it in `projects/temp`, where the existing watcher and importer take over.
- **The PNG/MP4 guidance is gone:** that editor export exists only in debug builds, so a still scene exports as video too.
- **Three fixes alongside:** web wallpapers hidden, the workshop preview copied on unpack so a project has a thumbnail, and "Open in Wallpaper Engine" starts the app through Steam instead of the refused `-project` flag.
- **Live:** reached the Save dialog for `Tokyo` on 2.8.42; `npm run gate` green.

## Next

1. Owner test of radar and polar bar in the editor, then phone performance and value-chart transition evidence.
2. Owner test of one scene export end to end: press the button, save the package, import the video.
3. Keep every checkpoint local; no push until the owner asks.

## Blockers / unverified

- **The Save click is unverified end to end:** the harvest is unit-tested against a Documents fixture, not against a package the engine wrote after a real Save.
- **A filed project cannot be exported:** a project inside a Wallpaper Engine folder is absent from the filtered grid in 2.8.42, so the route answers `no-tile` for it.
- **Phone performance is unmeasured:** thirty applications per second across several charts is unproven on the phone that reported the defect.
- **Value-chart engine transitions are not browser-verified:** the gate proves the option flag and signature, not motion across frames.
- **Polar bar evidence uses one low reading:** `cpu.load` is 9.28 on a 0–100 scale, so the sector sits at the inner radius (26.7% of the canvas); legibility at realistic 40–80% readings is unverified.
