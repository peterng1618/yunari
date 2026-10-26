# Yunari status

Updated: 2026-10-26
Branch: `main`

## Current objective

Land the chart work and the type-and-asset rework: the chart [spec](docs/superpowers/specs/2026-10-25-chart-playback-and-segmented-fill-design.md), the segment [spacing spec](docs/superpowers/specs/2026-10-26-segment-spacing-and-fill-mode-design.md) and the [fonts and assets spec](docs/superpowers/specs/2026-10-25-fonts-and-assets-design.md) are all merged into `main`, and the owner's tests are the remaining gate.

## Active work

- **Segment spacing landed:** plan [`2026-10-26-segment-spacing-and-fill-mode.md`](docs/superpowers/plans/2026-10-26-segment-spacing-and-fill-mode.md), decision [0120](docs/decisions/0120-segment-spacing-is-a-share-of-the-chart.md); gap is a share of the drawn edge, caps widen it, and gauge and bar carry a whole/partial fill.
- **Fonts and assets landed:** spec landed, plan [archived](docs/superpowers/plans/archive/2026-10-25-fonts-and-assets.md), and `vg-737`–`vg-745` file the evidence gaps it closed with.
- **Chart spec complete:** plans 1 (playback), 2 (segmented fill) and 3 (radar and polar bar) are all landed.
- **Wallpaper Engine export landed:** `docs/superpowers/plans/2026-10-26-wallpaper-engine-mobile-export.md`, decision [0118](docs/decisions/0118-a-scene-is-exported-by-driving-the-engine-ui.md) claims the UI-driving boundary.
- **No plan is running:** the queue resumes at `docs/superpowers/plans/2026-10-12-the-backlog-drain.md`, with 260 rows still `open`.
- **Nothing is pushed:** each plan merged locally into `main`; the owner tests after the sequence.

## Last completed change

- **Spacing is a share of the chart, not of the slot:** gauge, bar and pie all measure the gap against the smaller drawn edge, with the gauge's cap clearance widening it on a small chart and a 45% band clamp.
- **Fill mode is authorable:** gauge and bar switch between whole and partial segments; partial stops the fill at the reading, and the defaults keep the look from before the change.
- **Browser evidence:** the gauge at five bands keeps its gaps at half size, and switching to partial moves the fill edge; three captures under `C:/tmp/yunari-segment-spacing`.
- **Gate green on the third run:** the first was red on biome formatting, the second on the known `store.test.ts` asset-bounds timeout (72/72 when run alone), the third passed.
- **ADR renumbered to 0120** after main took 0119 for the fonts and assets note while this branch was open.

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
