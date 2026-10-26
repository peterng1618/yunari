# Yunari status

Updated: 2026-10-26
Branch: `main`

## Current objective

Land the chart work, the segment spacing follow-up and the type-and-asset rework: the chart [spec](docs/superpowers/specs/2026-10-25-chart-playback-and-segmented-fill-design.md), the spacing [spec](docs/superpowers/specs/2026-10-26-segment-spacing-and-fill-mode-design.md) and the [fonts and assets spec](docs/superpowers/specs/2026-10-25-fonts-and-assets-design.md) are all merged into `main`, and the owner's tests are the remaining gate.

## Active work

- **Segment spacing landed:** plan [`2026-10-26-segment-spacing-and-fill-mode.md`](docs/superpowers/plans/2026-10-26-segment-spacing-and-fill-mode.md), decision [0121](docs/decisions/0121-segment-spacing-is-a-share-of-the-segment.md); spacing is a whole percent of the painted segment, and gauge and bar carry a whole/partial fill.
- **Fonts and assets landed:** spec landed, plan [archived](docs/superpowers/plans/archive/2026-10-25-fonts-and-assets.md), and `vg-737`–`vg-745` file the evidence gaps it closed with.
- **Chart spec complete:** plans 1 (playback), 2 (segmented fill) and 3 (radar and polar bar) are all landed.
- **Wallpaper Engine export landed:** `docs/superpowers/plans/2026-10-26-wallpaper-engine-mobile-export.md`, decision [0118](docs/decisions/0118-a-scene-is-exported-by-driving-the-engine-ui.md) claims the UI-driving boundary.
- **No plan is running:** the queue resumes at `docs/superpowers/plans/2026-10-12-the-backlog-drain.md`, with 260 rows still `open`.
- **`main` is pushed:** `origin/main` carries the spacing follow-up; the owner tests next.

## Last completed change

- **Spacing is a share of the segment:** the gap is solved as `(q(b+c)+c)/(1+q)` with the round-cap clearance `c`, so 100% leaves as much space as painted slice and 0% closes exactly on the caps (ADR 0121 supersedes 0120).
- **The slider is 1–100 whole percents:** the descriptor refuses a fraction, the envelope refuses an out-of-range or fractional value, and all three families default to 10.
- **A partial bar fill follows the reading:** each band is painted up to the reading, clamped to its own visible length, so the next band starts only after this one is full.
- **Pie gaps scale with their piece:** each internal spacer is the authored share of the piece it follows, and the ring still sums to a full turn.
- **Browser evidence on the rebuilt bundle:** large, half-size, 100% and partial captures show the gap staying a tenth of the band, halving with the chart, and widening to 1:1 at 100%.

## Next

1. Owner test of the spacing follow-up: drag 1–100 and toggle fill mode on a gauge and a bar.
2. Owner test of radar and polar bar in the editor, then phone performance and value-chart transition evidence.
3. Owner test of one scene export end to end: press the button, save the package, import the video.
4. Owner test of the fonts and assets rework: import a face, place a result, and clean up on save.
5. Resume the backlog-drain plan at Phase 0 now that nothing else is running.

## Blockers / unverified

- **Owner tests pending:** the segment spacing checkpoint, the engine's Save click and the folder fallback are unverified live, phone performance is unmeasured, and no live fullscreen game check ran.
- **Chart evidence is thin:** value-chart transitions are not browser-verified, and polar bar uses one low reading (`cpu.load` 9.28).
- **The publish path is unverified end to end:** no workflow dispatch, no trusted-publisher run and no first publish, which stays a one-time local token publish.
- **Readers are fixture-tested only:** Epic, itch, Xbox and Store, both live Steam reads, and no real N−1 migration is exercised.
- **Two dependency deviations remain:** `ffmpeg-static` installs with scripts but no playback was exercised, and `npm ls` marks the overridden edges `invalid`.
