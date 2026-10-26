# Yunari status

Updated: 2026-10-26
Branch: `peterng1618/improve-charts`

## Current objective

Land the owner's follow-up to the segment spacing plan: spacing is a whole percent of the painted segment (1–100, 100 leaves a gap as wide as the segment), and a partial bar fill reaches its band's end before the next band starts.

## Active work

- **No plan is running:** the spacing plan is landed; this branch carries the owner's follow-up, decision [0121](docs/decisions/0121-segment-spacing-is-a-share-of-the-segment.md).
- **Wallpaper Engine export landed:** `docs/superpowers/plans/2026-10-26-wallpaper-engine-mobile-export.md`; decision [0118](docs/decisions/0118-a-scene-is-exported-by-driving-the-engine-ui.md) claims the UI-driving boundary.
- **Segmented-fill plan landed:** divisor setting, discrete slider, gauge bands, pie spacers and bar custom series.
- **Live-line policy:** the delay is two host cadences at 30 fps and zero at 1 fps; the line never smooths — Interpolation offers Linear and Step — and a stall holds the last reading to the edge and steps at the next batch.
- **Owner testing follows the run:** each plan merges locally into `main`; the owner tests after the sequence.
- **Decision note:** [0116](docs/decisions/0116-chart-motion-is-the-engines-and-the-line-is-a-clock.md) claims the chart mechanism boundaries.

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
4. Keep every checkpoint local; no push until the owner asks.

## Blockers / unverified

- **The Save click is unverified end to end:** the harvest is unit-tested against a Documents fixture, not against a package the engine wrote after a real Save.
- **A filed project cannot be exported:** a project inside a Wallpaper Engine folder is absent from the filtered grid in 2.8.42, so the route answers `no-tile` for it.
- **Phone performance is unmeasured:** thirty applications per second across several charts is unproven on the phone that reported the defect.
- **Value-chart engine transitions are not browser-verified:** the gate proves the option flag and signature, not motion across frames.
- **Polar bar evidence uses one low reading:** `cpu.load` is 9.28 on a 0–100 scale, so the sector sits at the inner radius (26.7% of the canvas); legibility at realistic 40–80% readings is unverified.
