# Yunari status

Updated: 2026-10-25
Branch: `main`

## Current objective

Land the chart spec [`2026-10-25-chart-playback-and-segmented-fill-design.md`](docs/superpowers/specs/2026-10-25-chart-playback-and-segmented-fill-design.md): Plan 1 playback and label removal is landed; Plans 2 (segmented fill) and 3 (radar and polar bar) remain.

## Active work

- **Active plan:** `docs/superpowers/plans/2026-10-25-chart-segmented-fill.md` — next; the playback plan is landed.
- **Queued plan:** `docs/superpowers/plans/2026-10-25-radar-and-polar-bar.md` — runs after the segmented-fill checkpoint.
- **Playback plan landed:** labels removed, line axis at the delayed clock, history predecessor, and engine animation selected by family and rate.
- **Owner testing follows the run:** each plan merges locally into `main`; nothing is pushed, and the owner tests after the sequence.
- **Decision note:** [0116](docs/decisions/0116-chart-motion-is-the-engines-and-the-line-is-a-clock.md) claims the chart mechanism boundaries.

## Last completed change

- **Engine labels removed:** bar and pie label settings, all axis text, and pie labels are gone; the validator refuses the removed keys.
- **Line edge fixed:** `xAxis.max` is `nowMs − playbackDelay`, the overscan canvas and guard are deleted, and history returns one predecessor.
- **Motion policy:** a shared reading signature gates `setOption` on both surfaces; value families animate at 30 fps and the line stays clock-driven.
- **Animation reaches ECharts:** `YunariChart` no longer forces `animation: false` over a plan that asked for a transition.
- **Evidence:** edge probe read 18,024 live line frames across four lines with canvas equal to visible width, monotonic axis and newest sample, lag 7–1018 ms; gate exit 0 with 408 files and 5,975 tests passing, 1 skipped.

## Next

1. Execute the segmented-fill plan: divisor model, discrete slider, gauge bands, pie spacers, bar custom series.
2. Run its browser evidence, gate, `STATUS.md` update and local `main` merge.
3. Execute the radar and polar-bar plan, then merge it locally into `main`.
4. Capture phone performance and value-chart transition evidence at the owner's test.
5. Keep every checkpoint local; no push until the owner asks.

## Blockers / unverified

- **Value-chart engine transitions are not browser-verified:** the gate proves the option flag and signature, not motion across frames.
- **Phone performance is unmeasured:** thirty applications per second across several charts is unproven on the phone that reported the defect.
- **A late batch leaves a blank right edge:** chosen honest behaviour, not a correction; the next batch grows into the gap.
- **The edge probe is a manual measurement:** it is skipped unless `YUNARI_EDGE_PROBE` is set and is not part of `npm run gate`.
- **Older readers refuse the removed label keys:** accepted pre-release; no converter is written.
