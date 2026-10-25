# Yunari status

Updated: 2026-10-25
Branch: `main`

## Current objective

Land the chart spec [`2026-10-25-chart-playback-and-segmented-fill-design.md`](docs/superpowers/specs/2026-10-25-chart-playback-and-segmented-fill-design.md): Plans 1 (playback) and 2 (segmented fill) are landed; Plan 3 (radar and polar bar) remains.

## Active work

- **Queued plan:** `docs/superpowers/plans/2026-10-25-radar-and-polar-bar.md` — next; the chart already holds a theme per display.
- **Segmented-fill plan landed:** divisor setting, discrete slider, gauge bands, pie spacers and bar custom series.
- **Live-line policy:** the delay is two host cadences and a delayed line draws straight; a stall holds the last reading to the edge and steps at the next batch.
- **Owner testing follows the run:** each plan merges locally into `main`; nothing is pushed, and the owner tests after the sequence.
- **Decision note:** [0116](docs/decisions/0116-chart-motion-is-the-engines-and-the-line-is-a-clock.md) claims the chart mechanism boundaries.

## Last completed change

- **Delay:** `LIVE_SOURCE_CHART_PLAYBACK_DELAY_MS` is 2,000 ms — two host cadences, so an ordinary 1 s gap stays a slope and only a real stall holds.
- **Stall:** the last reading paints to the axis edge for as long as the stall lasts; the batch that ends it repeats that reading at its own timestamp and steps, so painted history is not revised.
- **Linearity:** a delayed line draws straight, because a smoothed tail cannot hold a stretch still; `step` stays available and the Interpolation hint says so.
- **Tests:** the line suite pins the two-cadence edge, the hold, the step and a frame-identical stall ending; a host test pins the cadence-to-delay ratio.
- **Spec and ADR:** A3/A5/A6 and decision 0116 record the two-cadence rule and the straight live line.

## Next

1. Execute the radar and polar-bar plan, then merge it locally into `main`.
2. Capture phone performance and value-chart transition evidence at the owner's test.
3. Keep every checkpoint local; no push until the owner asks.

## Blockers / unverified

- **Value-chart engine transitions are not browser-verified:** the gate proves the option flag and signature, not motion across frames.
- **Phone performance is unmeasured:** thirty applications per second across several charts is unproven on the phone that reported the defect.
- **Segmented captures are opt-in:** the browser case calls the capture helper per divisor, and writes PNGs only under `YUNARI_CAPTURE=1`.
- **The edge probe is a manual measurement:** it is skipped unless `YUNARI_EDGE_PROBE` is set and is not part of `npm run gate`.
- **Older readers refuse the removed label keys:** accepted pre-release; no converter is written.
