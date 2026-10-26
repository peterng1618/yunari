# Yunari status

Updated: 2026-10-26
Branch: `main`

## Current objective

Land the chart work and the type-and-asset rework: the chart [spec](docs/superpowers/specs/2026-10-25-chart-playback-and-segmented-fill-design.md), the segment [spacing spec](docs/superpowers/specs/2026-10-26-segment-spacing-and-fill-mode-design.md) and the [fonts and assets spec](docs/superpowers/specs/2026-10-25-fonts-and-assets-design.md) are all merged into `main`, and the owner's tests are the remaining gate.

## Active work

- **Segment spacing landed:** plan [`2026-10-26-segment-spacing-and-fill-mode.md`](docs/superpowers/plans/2026-10-26-segment-spacing-and-fill-mode.md), decision [0120](docs/decisions/0120-segment-spacing-is-a-share-of-the-chart.md); gap is a share of the drawn edge, the backing-canvas cap clearance widens it, and gauge and bar carry a whole/partial fill.
- **Fonts and assets landed:** spec landed, plan [archived](docs/superpowers/plans/archive/2026-10-25-fonts-and-assets.md), and `vg-737`–`vg-745` file the evidence gaps it closed with.
- **Chart spec complete:** plans 1 (playback), 2 (segmented fill) and 3 (radar and polar bar) are all landed.
- **Wallpaper Engine export landed:** `docs/superpowers/plans/2026-10-26-wallpaper-engine-mobile-export.md`, decision [0118](docs/decisions/0118-a-scene-is-exported-by-driving-the-engine-ui.md) claims the UI-driving boundary.
- **No plan is running:** the queue resumes at `docs/superpowers/plans/2026-10-12-the-backlog-drain.md`, with 260 rows still `open`.
- **Nothing is pushed:** each plan merged locally into `main`; the owner tests after the sequence.

## Last completed change

- **The gauge's spacing default is the measured reference look:** 9.4% of the drawn edge reproduces the 10.8° gap the owner called right at divisor 20; the first probe had calibrated 2.5 at twenty segments instead of five.
- **The cap clearance is measured where the caps are:** against the backing canvas (scene box × render scale) and only when the ends are round, so a square-ended gauge at zero spacing still draws touching bands.
- **A resize redraws a chart:** the drawn edge is now part of the reading signature, so a static gauge no longer keeps the gap of its old size.
- **The spacing track steps by the tenth it displays,** so a drag can land on the 9.4 default rather than only on whole percents.
- **Gate green on the fourth run:** the first three were red only on the known full-suite flakes (`server.test.ts` deleted-display, then `store.test.ts` asset bounds), each green when run alone.

## Next

1. Owner test of the segment spacing and fill mode, then radar and polar bar, then phone performance and value-chart transition evidence.
2. Owner test of one scene export end to end: press the button, save the package, import the video.
3. Owner test of the fonts and assets rework: import a face, place a result, and clean up on save.
4. Work `vg-724`'s art half and `vg-727`, `vg-728`, `vg-729`.
5. Resume the backlog-drain plan at Phase 0 now that nothing else is running.

## Blockers / unverified

- **Owner tests pending:** the segment spacing checkpoint, the engine's Save click and the folder fallback are unverified live, phone performance is unmeasured, and no live fullscreen game check ran.
- **Chart evidence is thin:** value-chart transitions are not browser-verified, and polar bar uses one low reading (`cpu.load` 9.28).
- **The publish path is unverified end to end:** no workflow dispatch, no trusted-publisher run and no first publish, which stays a one-time local token publish.
- **Readers are fixture-tested only:** Epic, itch, Xbox and Store, both live Steam reads, and no real N−1 migration is exercised.
- **Two dependency deviations remain:** `ffmpeg-static` installs with scripts but no playback was exercised, and `npm ls` marks the overridden edges `invalid`.
