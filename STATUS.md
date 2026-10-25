# Yunari status

Updated: 2026-10-26
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

- **Main merged before the picker branch closes:** chart playback, segmented fill and the extracted `chartReadingSignature` are in, and the palette half of a chart's reading now lives in that shared signature.
- **Colour and gradient presets are chips:** both libraries draw a small swatch chip with the name as its programmatic label, wrapped in reading order (decision 0117, DESIGN §5).
- **A gradient stop shows its selection and opens its picker:** the chosen mark takes the accent border; a press that does not travel opens its picker while a drag still adjusts it.
- **Rotated gradient paint follows its angle:** `gradientLine` flips the y component for the stored `90 - cssDegrees` convention, fixing the canvas plate and the glass backdrop sampling together.
- **Picker sampling costs less:** one channel change per pointer sample, one dirty reading per document change, and a chart redraw only when a palette token its settings name moves.

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
