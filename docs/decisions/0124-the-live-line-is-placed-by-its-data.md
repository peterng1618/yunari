# 0124 — The live line is placed by its data, not by the wall clock

- **Date:** 2026-10-27
- **Status:** accepted
- **Paths:** `src/web/packages/renderer-core/src/charts/line.ts`
  `src/web/packages/renderer-core/src/charts/reading-signature.ts`

## The problem

A live line was placed by `Date.now() − playbackDelay` and redrawn every display
frame. The delay kept the axis edge inside the newest segment, but the edge only
stays inside the data while the delay exceeds the gap between samples. When the
host's batches arrived at the delay's own length — measured below — the edge
passed the newest sample on most ticks and the line became a staircase of flat
stretches and vertical steps. Removing the visible revision (0116) did not make
the picture acceptable; it made the hold visible. At the 1 fps rate the delay was
dropped entirely, so the axis ran ahead of the data and the right edge was blank
on every frame.

The shape of the problem: **a wall-clock axis needs a lag larger than the worst
sample gap, and nothing in this system declares or bounds that gap.** The line
was assuming a cadence the transport does not guarantee.

## Rung 1 — Yunari

Searched: `charts/line.ts` (`buildLineOption`, `toSeriesPoints`, `liveTail`,
`linePlaybackDelayMs`, `lineHistorySeconds`), `charts/reading-signature.ts`,
`scene/plan.ts` (`buildChartPlan`, `buildLinePoints`),
`data/live-source.ts`, `data/store.ts`, `data/source.ts`,
`scene-fabric/chart-animation.ts` (`chartAnimationFor`,
`chartPlaybackDelayFor`), `scene-fabric/chart-refresh.ts`,
`editor/src/chart-manager/index.ts`, `editor/src/live-runtime.ts`,
`player/src/main.ts`, `host/src/transport/sse.ts`, decisions 0068 and 0116.

Found: the whole delayed-clock mechanism, one owner per step, and three
assumptions the transport does not keep — a fixed 2 s delay, a 1 s host cadence
at the display, and a redraw once a second at 1 fps that is phase-locked to
arrival. None is true.

## Rung 2 — dependencies

Searched: `src/web/package.json`, installed `echarts@6.1.0` (option surface and
typings), the package graph.

Found: no installed package owns streamed chart motion or an axis clock. ECharts
places a time axis from `xAxis.min`/`max` and the data; it has no opinion about
which clock those numbers come from. Nothing to adopt; no dependency added.

## Rung 3 — platform

Searched: `requestAnimationFrame` / `setTimeout` (the refresh loop), `Date.now()`,
`EventSource`, Node's `ServerResponse.write` backpressure and `drain`.

Found: a repaint clock, a data clock, and a transport that reports backpressure.
The platform gives the two clocks but no way to keep them in phase; the choice of
which one places the axis is ours.

## Rung 4 — ecosystem

Searched on 2026-10-27 with the Exa search tool (the built-in `WebSearch` tool
returned no results in this environment, so the queries below were run there):

- `chartjs-plugin-streaming delay option onRefresh realtime chart smooth scrolling`
- `Grafana dashboard now delay setting live streaming time series jitter`
- `Highcharts real-time line chart addPoint shift animation`
- `ECharts real-time update animation wiggle time series`
- `uPlot streaming right edge jitter window`

Found, and this decided the question:

- **chartjs-plugin-streaming** documents the exact mechanism we had: a window
  (`duration`), a repaint cadence (`refresh`, default 1000 ms), and a `delay`
  (default 0) whose reference text is *"Delay added to the chart … so that
  upcoming values are known before lines are plotted. This makes the chart look
  like a continual stream rather than very jumpy on the right hand side.
  **Specify the maximum expected delay.**"* Its own sample uses
  `duration: 20000, refresh: 1000, delay: 2000` — the numbers this repo used.
  The premise is delivery at `refresh`; our transport delivered at twice that.
- **Grafana** ships the same knob as dashboard "Now delay" ("override the `now`
  time … to accommodate known delays in data aggregation to avoid null values"),
  and `grafana/scenes#509` added it to avoid dropped data in charts. It is a
  lag, universally, and it is configured from the observed arrival delay.
- **Highcharts' live-data guide** plots what arrived: `addPoint(point, redraw,
  shift)` on a timer, with the visible window shifted when a point is added, and
  animation disabled when the interval is short. No interpolation toward a
  future edge.
- **uPlot's streaming demo** redraws a fixed window every frame and offers
  "disable pixel alignment" only to stop pixel jitter; smoothness is the sliding
  window, not data animation. Its issue #273 asks for a relative time range and
  a rAF loop — again a window over data that exists.
- **ECharts issue #12167** ("how to avoid wiggling animation for real-time time
  series charts") is closed as stale with no maintainer ruling; the community
  workaround (per-point `name` identity so the diff animates points instead of
  morphing them) is unverified. Its goal — animating points into new positions —
  also moves history the reader has already seen, which 0116 forbids for the
  line.
- Community reports (Grafana, Home Assistant) agree that fill-previous draws a
  staircase and that linear interpolation toward an unarrived point fabricates a
  reading. Neither is acceptable here.

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| Keep the wall clock, raise the delay | continuous slide | one constant | the delay must exceed an undeclared, unbounded gap; staircase returns on any stall | rejected — that is the defect |
| Keep the wall clock, stop at the newest sample (freeze) | no gap, no revision | freeze + jump after a stall | still assumes a cadence for smoothness; adds a mode | rejected — two behaviours to explain |
| Data clock: axis ends at the newest reading | no gap, no revision, no delay | motion in sample-sized steps | step size grows with the window shrinks / gap | **chosen** |
| Interpolate or hold to the edge | visually continuous | invents or repeats readings | violates §83's no-fabrication intent; staircase | rejected |
| ECharts update animation with point ids | engine animates the shift | unverified workaround | moves painted history | rejected |

## Rung 6 — probe

Per-frame browser readings of the editor against real machine sensors, recorded
to `%TEMP%/yunari-live-edge/` (the `live-chart-edge` probe):

- **Host emission:** 21 batches over 20 s, gaps 997–1019 ms — the host is 1 Hz.
- **Editor receipt:** p50 1 992 ms (34 batches over 61.9 s); 16 of 33 gaps
  exceeded the 2 s delay. `SseConnection` kept one pending frame and replaced it
  under backpressure (`KeepLatestSlot`), so every other batch never arrived and
  its readings were lost, not merely late.
- **Before the painted-history fix:** 15 right-edge revisions per line chart in
  2 632 frame pairs. **After it:** 0 revisions in 2 470 pairs — the correction
  was gone and the remaining staircase was the honest hold and step.
- **1 fps:** the delay is `0`, the axis ends at `Date.now()`, and the newest
  sample is up to a cadence older; the right edge is blank between the last
  sample and the axis end on every frame.

## Decision

A line's axis ends at its newest plottable reading, and the option is rebuilt
only when that reading changes. There is no playback delay, no hold, no step and
no clock term in the line's reading signature; the per-frame loop continues to
own text and value-chart repaint. A missing reading is skipped, joining the
readings either side, so a line has no gap at either edge (amends §83 for line
series only).

**The specific reason:** every smooth implementation in rung 4 buys smoothness
with a lag sized from an *observed* arrival delay, and ours had no observation —
it assumed 1 s delivery while the transport dropped every other frame. Placing
the axis on the data makes the picture independent of arrival jitter and
backpressure by construction, at the cost of moving in one step per batch. The
owner chose that step over a lag (2026-10-27).

Two supporting changes are part of the same decision:

- **Sample frames are queued, not replaced, at the transport.** Each batch is a
  measurement centre, not a superseding snapshot, so a slow connection must not
  lose it. The queue is bounded (120 frames ≈ 2 minutes at 1 Hz); beyond the
  bound the oldest is dropped and counted, which is §122's "bound queues".
- **A line's x comes from the sample's own `timestamp`**, not the browser's
  receive time. A burst delivered after a stall must not collapse a minute of
  readings into a vertical stack at the edge.

## Consequences

- The line moves once per batch — about 1.7 % of a 60 s window per second — and
  not at all between batches. This is the accepted look.
- A series whose newest reading is older than the chart's newest stops before
  the right edge by that difference. It is left visible rather than held
  forward.
- A long outage becomes a straight segment between the readings either side; the
  chart no longer shows it as a break. §83 records this as a line-only
  exception.
- `linePlaybackDelayMs`, `liveTail`, `lineHistorySeconds`,
  `chartPlaybackDelayFor`, `LIVE_SOURCE_CHART_PLAYBACK_DELAY_MS` and
  `SampleSource.chartPlaybackDelayMs` are deleted.
- A line still never uses `smooth`: a smooth segment is drawn from its
  neighbours, so it changes when the next batch changes the shape of the
  stretch already painted (0116, unchanged).
