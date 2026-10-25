# Yunari status

Updated: 2026-10-26
Branch: `main`

## Current objective

Land the chart spec [`2026-10-25-chart-playback-and-segmented-fill-design.md`](docs/superpowers/specs/2026-10-25-chart-playback-and-segmented-fill-design.md): plans 1 (playback), 2 (segmented fill) and 3 (radar and polar bar) are all landed; the owner's test is the remaining gate.

## Active work

- **Chart spec complete:** `docs/superpowers/plans/2026-10-25-radar-and-polar-bar.md` merged locally into `main`; no queued plan.
- **Segmented-fill plan landed:** divisor setting, discrete slider, gauge bands, pie spacers and bar custom series.
- **Live-line policy:** the delay is two host cadences at 30 fps and zero at 1 fps; the line never smooths — Interpolation offers Linear and Step — and a stall holds the last reading to the edge and steps at the next batch.
- **Owner testing follows the run:** each plan merges locally into `main`; nothing is pushed, and the owner tests after the sequence.
- **Decision note:** [0116](docs/decisions/0116-chart-motion-is-the-engines-and-the-line-is-a-clock.md) claims the chart mechanism boundaries.

## Last completed change

- **Radar and polar bar:** two new families; radar draws one polygon over a shared 0–100 scale and draws none with fewer than three plottable readings.
- **Polar bar reuses the bar:** category angle axis, the bar's paint and data helpers, `to-top` gradients, no engine text; segmented polar bars are deferred.
- **Engine views registered:** `RadarChart`, `RadarComponent` and `PolarComponent` were never registered, so both families built an option and painted nothing.
- **Browser evidence:** the canvas check now counts painted pixels; a blank canvas hashed to `"0"`, which is truthy, so it passed on nothing.
- **Editor:** six chart tiles, a twelve-spoke radar cap, "Polar bar" label and glyphs.

## Next

1. Owner test of radar and polar bar in the editor, then phone performance and value-chart transition evidence.
2. Keep every checkpoint local; no push until the owner asks.

## Blockers / unverified

- **Polar bar evidence uses one low reading:** `cpu.load` is 9.28 on a 0–100 scale, so the sector sits at the inner radius (26.7% of the canvas); legibility at realistic 40–80% readings is unverified.
- **Value-chart engine transitions are not browser-verified:** the gate proves the option flag and signature, not motion across frames.
- **Phone performance is unmeasured:** thirty applications per second across several charts is unproven on the phone that reported the defect.
- **Capture evidence is opt-in:** `YUNARI_CAPTURE=1` writes the PNGs; the gate runs without them.
- **Older readers refuse the removed label keys:** accepted pre-release; no converter is written.
