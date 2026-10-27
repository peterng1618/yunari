# 0068 — The line owns how much history it needs, and it needs one cadence more than its axis

- **Date:** 2026-10-18
- **Status:** amended by 0124 (the playback-delay term is gone; the line asks
  for its window, and the source still returns the predecessor)
- **Paths:** `src/web/packages/renderer-core/src/charts/line.ts`

## The problem

`vg-571`: on a phone display against a live source, the lines look as though
they correct themselves at the right edge and as though points leave about half
a second early at the left. The row's source reading blamed the shared
`presentationTimestamp`; **that reading was never measured, and the measurement
(§Rung 6) does not support it.**

What the measurement does show is that the drawn line does not cover its own
axis window at the left edge: on 72 % of steady-state frames the series carries
no sample at or before `xAxis.min`, so the line begins *inside* the plot — by a
mean of 0.2 s, up to 1.0 s, over the 60 s window the starter authors.

The shape of that problem is not "draw a line". It is **who owns the number that
says how much history a chart must be handed**. Two callers need it and today
both spell it out: `buildChartPlan` (`renderer-core/src/scene/plan.ts`) and the
editor's own reading signature (`editor/src/chart-manager/index.ts`). Both write
`windowSeconds + linePlaybackDelayMs(source.chartPlaybackDelayMs) / 1000` — a
number that is exactly the *axis* window, and therefore leaves nothing below
`toSeriesPoints`' window start for the one predecessor it keeps.

## Rung 1 — Yunari

Searched: `createLiveSource` (`data/live-source.ts`), `SampleStore.history` /
`sampleTimeMs` (`data/store.ts`), `buildChartPlan` (`scene/plan.ts`),
`buildLineOption` / `toSeriesPoints` / `sampleTimeMs` / `linePlaybackDelayMs`
(`charts/line.ts`), `startChartRefresh` (`scene-fabric/chart-refresh.ts`),
`YunariChart._render` / `_overscanWidth` / `_backingSize`
(`scene-fabric/chart-object.ts`).

Found: the whole mechanism, and **no owner for the requested history**. The
window arithmetic exists three times — the axis (`line.ts`), the request
(`plan.ts`), and the editor's signature mirror (`chart-manager/index.ts`) — and
the two requests agree with each other and disagree with what `toSeriesPoints`
needs to draw the left edge.

## Rung 2 — dependencies

Searched: the installed tree. `echarts@6.1.0` is the only charting dependency
(`node_modules/echarts/package.json`); `echarts/types/dist/shared.d.ts` carries
`appendData` (both the series method and the `dataZoom`-facing one) and the
comment on its `dataZoom` coupling.

Found: **nothing that owns the window.** `appendData` appends to a series and
lets `xAxis.min`/`max` — whatever they are — place it; `dataZoom` is a view over
data that is already there. Neither has an opinion about a window that slides
under a frame clock while data arrives in batches, which is the whole shape
here.

## Rung 3 — platform

Searched: `EventSource` (the transport), `requestAnimationFrame` (the cadence),
`Date.now()` (the only clock the renderer has), and the canvas crop in
`YunariChart._render`.

Found: a clock and a repaint hook, and nothing that places a trailing window.
**This rung discharges nothing**, which is the case the gate exists for.

## Rung 4 — ecosystem

Searched: the ECharts handbook's *Dynamic Data* page
(`echarts.apache.org/handbook/en/how-to/data/dynamic-data/`) and the
chartjs-plugin-streaming options reference
(`nagix.github.io/chartjs-plugin-streaming/latest/guide/options.html`).

Found — and this is the rung that answers the question — **chartjs-plugin-streaming
has exactly this shape**: `duration` (the window), `delay`, `refresh` and
`frameRate`, i.e. a smooth axis, a batch cadence and a playback delay, the three
things we have. Its own documentation gives `delay`'s reason in the same words
our comments use: *"Delay added to the chart in milliseconds so that upcoming
values are known before lines are plotted … This makes the chart look like a
continual stream rather than very jumpy on the right hand side."* So the right
edge is a solved, shared problem and our delay is the standard answer to it.

Its answer to the **left** edge is `ttl`, default *"old data will be
automatically deleted as it disappears off the chart"* — a cull at the window
edge with **no predecessor rule**. That is the difference: we keep one sample
before the window so a line is drawn reaching the clip edge, and a rule that
keeps one sample needs a sample to exist. **Nobody in this rung solves that half**,
because nobody else draws the line to the edge.

Dead end, recorded because it cost time: `WebSearch` in this environment
returned its own tool-call text instead of results for every query, so this rung
is two fetched documentation pages plus the installed typings rather than a
survey. uPlot and Plotly were not searched and are not installed.

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| Do nothing; let the line start inside the edge | the display is wrong by up to a cadence, and the row stays open | 0 | the defect is invisible in every unit test we have | rejected |
| `appendData` / `dataZoom` | appends and zooms; owns neither edge | a renderer rewrite | the axis is still ours to place | rejected |
| Cull one cadence earlier in `toSeriesPoints` | it cannot: the sample was never handed over | 0 | none | rejected — wrong layer |
| Widen the request where it is asked | the axis window and the request already agree by construction; the number just needs its own owner | one helper, two call sites | none | **chosen** |
| Clamp `xAxis.min` to the series' first point | removes the empty strip | the axis minimum then jumps by a cadence per batch, so the whole chart jumps with it | worse than the defect | rejected |

## Rung 6 — probe

A per-frame reader (`src/web/tests/e2e/live-chart-edge.spec.ts`, run under the
`phone-host` project at the Pixel 7 viewport with `--workers=1`, against the real
host on 4175) recorded, on every frame, `xAxis.min`/`max`, the series'
timestamps, `convertToPixel` for the axis ends and the newest sample, the
chart's rect, the ECharts canvas width and the crop edge. Readings:
`%TEMP%/yunari-live-edge/{before,after}.json`, 2 129 and 2 054 frames of the
starter's 963 × 215 `trends-chart`. "Steady state" below means the series covers
at least 59 s of its 61 s axis: 504 frames before, 501 after.

- **Left edge — the defect the row is about.** `firstT - axisMin` is positive on
  **364 of 504 steady frames (72 %)** before the change, by a mean of 199 ms and
  up to 990 ms: the line's left end floats inside the plot. After it, two
  independent runs give 80 of 501 (16 %) and 94 of 481 (19.5 %), mean −367 ms and
  −320 ms — the line starts at or before the axis and is clipped by the left
  edge, as `toSeriesPoints`' predecessor rule intends. The residual is
  the host's own cadence: the predecessor is dropped when the gap *straddling*
  the window start is longer than the delay band, and the measured inter-batch
  gaps ran to 3 243 ms under provider polling.
- **Right edge — measured, and a different defect.** `axisMax - lastT`: mean
  461 ms, max 1 052 ms before; the newest sample therefore trails the axis's
  right end by up to one batch cadence, which is what the delay band is for. But
  the crop lands at `axisMax − 767 ms` (median), not the 1 000 ms the gutter
  claims: `_overscanWidth` sizes the canvas from `grid.left/right`, while ECharts
  widens the plot to `outerBoundsContain: "axisLabel"` — and the last axis
  label's width moves that inset frame to frame (offset p05 357 ms, p50 767 ms).
  So the newest point is *inside* the visible right edge on ~20 % of frames, by up
  to 285 ms ≈ 4.5 CSS px on a narrow-label frame and 1 244 ms ≈ 19.5 px on a
  wide-label one. **Not fixed here:** it is `scene-fabric/chart-object.ts`'s to size, it needs the
  engine's own grid rect rather than `grid.right`, and that is a design decision
  this row's fix does not reach. Filed as a `Discovered, not fixed:` trailer.
- Cadence: mean 1 018 ms, min 227 ms, max 2 152 ms — the host's `setInterval`
  coalescing under provider polling.
- Repeated timestamps (a batch sharing one x): a connect-time burst only, ~1
  collision per frame once the window is full. **The row's shared
  `presentationTimestamp` is real and is not this defect**: the host sends one
  sample per key per batch, so a batch's samples cannot share an x in steady
  state.

## Decision

`renderer-core/src/charts/line.ts` exports `lineHistorySeconds(windowSeconds,
chartPlaybackDelayMs)`, and both callers ask it instead of spelling the window
out. It returns `windowSeconds + 2 × delay`.

**The specific reason it is two, not one.** `toSeriesPoints` culls at the axis
window's start and keeps one sample *before* it. A source answers a trailing
window at its own cadence, so the oldest sample it returns can be up to one
cadence *above* the cutoff it was given — and the cutoff a request of
`windowSeconds + delay` produces is exactly `xAxis.min`. One extra delay puts a
sample below the window start for any gap up to that delay. **The delay is not a
declared bound, and this is the part of the fix that is a guess:**
`LIVE_SOURCE_CHART_PLAYBACK_DELAY_MS` is a fixed 1 000 ms standing in for a
cadence no source declares, and the host's measured inter-batch gaps were p50
1 006–1 021 ms with a maximum of 3 243 ms — more than half of them already past
the number. Two delays is the most this file can ask for without a cadence to ask
for, and the 16–19.5 % of frames that still begin inside the plot are the gaps
that outrun it. The number therefore belongs beside `linePlaybackDelayMs`, in the
file that places the axis it has to cover.
