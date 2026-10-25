# Chart playback and segmented fill — design

- **Date:** 2026-10-25
- **Status:** proposed 2026-10-25; awaiting owner review.
- **Register:** no row; requested feature. Related: `vg-582` (open; this design
  removes its gutter rather than correcting it), `vg-579` (open, deliberately
  outside this work), `vg-571`, `vg-028`, `vg-572`, `vg-453` (closed, evidence
  for the playback model).
- **Related:** [`docs/architecture/ownership.md`](../../architecture/ownership.md);
  [ADR-0010](../../adr/0010-one-active-plan.md);
  [decisions/0007](../../decisions/0007-unresolvable-chart-paint-is-a-gap-not-a-default.md);
  [decisions/0008](../../decisions/0008-a-gauge-carries-no-datum-when-it-draws-no-arc.md);
  [decisions/0028](../../decisions/0028-the-descriptor-table-gains-the-metadata-the-surface-reads.md);
  [`docs/product/requirements.md`](../../product/requirements.md) §81, §83, §85,
  §87, §91, §97, §105, §122, §124, §126.
- **Reuse gate:** the first write to `renderer-core/src/charts/`,
  `scene-fabric/src/chart-object.ts` and `editor/src/components/ui/` needs one
  decision note claiming those paths.

## Purpose

Two user-visible outcomes:

1. **30 fps mode is smooth on every chart, in the editor and on the phone
   player.** The line must slide without the left/right corrections reported
   repeatedly; gauge, bar and pie must animate between their 1 Hz readings
   instead of stepping once a second.
2. **Bar, gauge and pie gain a segmented fill.** A discrete slider selects how
   many equal segments the fill is split into; 100 keeps today's continuous
   fill, and the authored rounded ends carry into the segments where the engine
   allows it.

The 1 s presentation delay is accepted. Charts may trail the measured value by
about a second; numeric text must not.

## What this is not

- Not a removal of 30 fps, the View menu's chart-refresh row, the host's
  `chartFps` display setting or the player's rate poll. All stay.
- Not a new chart family. Radar, scatter and the other families in *Future
  chart families* are outside this spec.
- Not interpolation of numeric text. §122 and §97 keep text on measured
  samples.
- Not a change to acquisition cadence, provider polling or the sample protocol.
- Not a theme format version bump. `segmentDivisor` is additive; absent means
  100. An older reader that refuses unknown chart settings is an accepted
  pre-release limitation and is named under *Risks*.
- Not the `vg-579` scheduler fix. The 1 fps loop still wakes on animation frames
  after this work; that row owns it.

## Current state

- `scene-fabric/src/chart-refresh.ts` owns `ChartRefreshRate` (`1 | 30`) and one
  rAF loop. `editor-main.ts` exposes it through the View menu;
  `host/src/settings/displays.ts` stores it per display; `publish-follower.ts`
  reports it to the player.
- `player/src/main.ts`'s `hydrateCharts` builds every chart plan with
  `animate: false` and calls `setOption` on every frame. With engine animation
  off, gauge/bar/pie only change when a sample changes. The line looks animated
  because `buildLineOption` places its axis from the clock.
- The line draws its window one playback delay past the visible crop by making
  the ECharts canvas wider than the Fabric object: `renderOverscanRightMs` in
  `renderer-core/src/charts/line.ts` and `_overscanWidth` in
  `scene-fabric/src/chart-object.ts`. `vg-582` measured the resulting crop at
  about `axisMax − 767 ms` rather than the intended −1 000 ms. `vg-571` measured
  the left edge losing its predecessor sample.
- `SampleStore.history` windows on the last ingest and returns only samples at
  or after the cutoff. `lineHistorySeconds` asks for two delays because the
  source does not return the one sample before the window.
- `CHART_SETTINGS_FIELDS` is the one owner of chart scalar settings and their
  document bounds; `fabric-envelope-validate.ts` reads it, and
  `editor/src/chart-manager/panel.ts` projects it. The editor's chart controls
  use `ControlSlider` for bounded numbers.
- ECharts 6.1.0 probes taken for this design:
  - A line with points beyond `xAxis.max` is drawn through them and clipped at
    the grid edge. No overscan canvas is needed to show a segment crossing the
    visible edge.
  - `pictorialBar` honours `symbolRepeat`, but ignores `itemStyle.borderRadius`
    and cannot colour repeated symbols separately. It cannot satisfy authored
    corner radius or a gradient spanning the bar.
  - Gauge `axisLine.lineStyle.color` bands are rendered as separate arcs and
    `roundCap` applies to each band. Transparent bands produce gaps.
  - Pie `borderRadius` applies per data item. `padAngle` is series-level, so a
    separate subsegment gap needs the spacer-item construction in B4.
  - ECharts `custom` series can render the bar geometry and supports shape
    transitions when elements carry stable identity.

## Design A — playback and animation

### A1. Rates stay; animation is chosen per family

`ChartRefreshRate` and its plumbing remain. The refresh rate decides how often
the scene re-plans; it does not force ECharts to animate at 30 Hz.

- At 30 fps, gauge, bar and pie receive `animate: true`. Their authored
  `durationMs` transition runs between readings.
- At 30 fps, the line receives `animate: false`. Its motion comes from the
  render clock, not from an engine transition; re-applying an animating line
  option every frame would restart the transition.
- At 1 fps, every family receives `animate: false`, preserving the low-power
  mode.
- The caller knows the family and the rate, so the choice is made where the
  plan is built, not guessed inside the option builders.

### A2. A chart is re-applied only when its reading moves

`player/src/main.ts`'s `hydrateCharts` gains the same per-chart gate the editor
already has: compute a reading signature and skip `setOption` when it is
unchanged. This is what lets an engine transition finish instead of being
restarted thirty times a second.

The signature logic currently lives in the editor's chart manager. It moves to
one shared owner in `renderer-core` and both surfaces call it.

- A value family's signature is its bound readings.
- The line's signature includes the render clock, because the line draws a
  window placed from that clock and must be redrawn each frame.
- A chart with no bindings keeps a constant signature and is drawn once.

### A3. The line's visible edge is the axis edge

`buildLineOption` computes `renderNowMs = nowMs − playbackDelay` once and sets:

- `xAxis.max = renderNowMs`;
- `xAxis.min = renderNowMs − windowSeconds × 1000`;
- the series may contain samples after `renderNowMs`, because they have already
  arrived; ECharts clips the crossing segment at the axis edge.

`renderOverscanRightMs`, the overscan canvas in `scene-fabric/src/chart-object.ts`
and the special-case type guard are deleted. The Fabric object's canvas is its
visible box again.

This makes the visible right edge exactly `renderNowMs`. A sample arriving later
has an arrival timestamp at or after `renderNowMs + delay`, so it enters to the
right of the edge and slides in as the clock advances. It cannot appear inside
the window and cannot cause a correction.

### A4. History returns the predecessor

`SampleSource.history(key, seconds)` gains one contract line: it returns the
trailing window **plus the last sample strictly before its cutoff**, when one
exists. `SampleStore`, the fake source and the preview source implement it.

`lineHistorySeconds` becomes the real window plus the playback delay, not two
delays. The chart that draws the left edge then always has the sample before its
axis minimum, regardless of the host's cadence.

### A5. Failure modes are gaps, not invention

- If no batch has arrived for longer than the playback delay, there is no sample
  after `renderNowMs`; the line ends at the last measured sample and the right
  edge is briefly blank. When the batch arrives, the line grows into the gap.
- No frame draws a value that was never measured. Value-chart motion is
  ECharts interpolation between measured samples, which §122 permits as
  presentation animation.
- Numeric text continues to use `latest`; it is neither delayed nor
  interpolated.

### A6. What "30 fps" means here

The line's window and the scene re-plan run at the selected rate. An engine
transition on gauge/bar/pie runs at the display's refresh rate, which is
typically 60 Hz or higher. The mode caps our repaint work, not the engine's
transition. This is deliberate: ECharts has no supported rate cap, and a
smoother value transition costs less than re-implementing that animation.

## Design B — segmented fill

### B1. One setting, one owner

Add `segmentDivisor: number` to `GaugeSettings`, `BarSettings` and
`PieSettings`, default `100`.

- The value is a divisor: segment count is `100 / segmentDivisor`.
- Allowed values, ascending: `1, 2, 4, 5, 10, 20, 25, 50, 100`.
- `100` means one continuous fill and must reproduce today's option exactly.
- `1` means 100 equal segments.

`CHART_SETTINGS_FIELDS` gains one descriptor per family with a `values` list.
The table remains the one owner:

- `fabric-envelope-validate.ts` refuses a present value that is not in the list.
- `editor/src/chart-manager/panel.ts` projects it as a slider.
- `default*Settings` owns the default; the descriptor still declares none.

The editor's `ControlSlider` gains an optional discrete-value list. The track
runs over the list's indices; the well and `aria-valuetext` show the divisor;
the commit writes the divisor, never the index. A typed value outside the list
is refused by the control's existing refusal route rather than snapped.

### B2. Bar

Segmented bars use a `custom` series. The current `bar` series remains the
non-segmented path.

`renderItem` draws, per category:

- `N = 100 / segmentDivisor` equal bands across the authored `min..max` range;
- a transparent gap of 20% of each band, so the visible part of a band is 80% of
  its length;
- the unfilled bands in track paint when a track is authored, with
  `trackCornerRadius`;
- the filled bands in fill paint, with `cornerRadius` clamped to the band's
  geometry;
- a partially filled final band, so the bar still shows the reading rather than
  rounding it up to a whole segment;
- both orientations, the authored `barWidth`, and `categoryGapPercent`;
- nothing filled for a missing sample, while the track remains.

Paint semantics:

- Solid fill and threshold fill resolve to one colour for the bar, as today.
- A gradient fill is sampled at each band's midpoint, so the gradient runs
  across the whole bar rather than repeating inside each band.
- A paint that resolves to nothing draws no fill, preserving 0007.

The series returns stable element identities and requests shape transitions, so
the filled extent moves with the engine update. If verification shows ECharts
does not animate the custom shapes, the plan stops and asks the owner rather
than silently shipping a stepped bar.

### B3. Gauge

Segmented gauges use ECharts' native `axisLine.lineStyle.color` bands. `progress`
is not drawn; the band's colour is the progress paint for bands the reading
reaches, and the track paint for the rest.

- The sweep is divided into `N` equal bands.
- Each visible band occupies 80% of its sweep; the remaining 20% is a
  transparent entry, producing the gap.
- `roundCap` remains the authored value. Each band is its own arc, so the
  segment ends inherit it.
- A gradient fill is sampled at each band's midpoint. A threshold fill stays one
  flat colour at the current reading, as the gauge does today.
- A missing sample leaves every band in track paint, never a false zero.
- `gradientSegments` keeps its current role only in the non-segmented path. In
  segmented mode the band count is the subdivision.

Known limit: with a thick round-capped ring, the caps extend into the gap.
Above a few dozen segments the caps meet and the ring reads as continuous. The
segments still exist; the visual separation degrades. Turning `roundCap` off
restores visible gaps at high counts.

### B4. Pie

Each slice, and the remainder slice, is split into `N` equal-value real data
items, with transparent spacer items between them.

- Each subsegment keeps the slice's colour.
- `borderRadius` applies to every real subsegment, inheriting the authored corner
  radius; ECharts clamps it to the subsegment's geometry.
- The gap between slices stays the authored `padAngle` degrees. The gap between
  subsegments is 20% of the subsegment's sweep.
- Gaps are **spacer data items**, not the series-level `padAngle`, so the two
  gap sizes can differ. A spacer's value is solved from the desired gap angle
  and the real total, and scales every real slice by the same denominator, so
  composition shares are preserved exactly. In segmented mode the series
  `padAngle` is 0; in the continuous path it is unchanged.
- Spacers are transparent, carry no label, and are not interactive.
- Labels, when enabled, are shown on the first real subsegment only, so a slice
  does not repeat its name N times.
- Composition, remainder and overflow rules are unchanged.

### B5. Shared constants and limitations

The 20% gap is one shared chart constant, owned beside the segment helpers. The
three adapters use it for their own axis: band length for bar, sweep for gauge,
sub-sweep for pie.

Gauge segmentation quantises the fill to whole bands; the band containing the
reading is not partially drawn. At `segmentDivisor: 1` this is a 1%
quantisation; at `5` it is 20%. Bar keeps a partial final band, and pie's
subsegments are whole by construction because a slice's share is divided into
equal parts. The gauge quantisation is recorded rather than hidden.

## Decisions

1. **Keep 30 fps.** Value families animate through ECharts; the line is
   clock-driven. No source delay is added to value charts.
2. **The player must stop re-applying identical options.** Without the gate,
   transitions are restarted and value charts remain visually 1 fps.
3. **The line's axis ends at the delayed render clock.** The overscan canvas is
   deleted, not corrected. This supersedes `vg-582`.
4. **`history` owns the predecessor sample.** The chart does not ask for two
   delays to compensate.
5. **`segmentDivisor` is the persisted value.** UI shows the divisor; segment
   count is derived.
6. **100 is the no-regression path.** The continuous option builders and their
   tests remain the reference.
7. **Bar segmentation is a custom series.** `pictorialBar` is rejected because it
   cannot honour authored corner radius or a gradient spanning the bar.
8. **Gauge segmentation is native colour bands.** No second gauge series per
   segment.
9. **Pie segmentation is data-item splitting.** No custom geometry.
10. **No new chart family in this spec.**

## Risks and unverified behaviour

- **Custom-series animation is unproven.** The bar design depends on ECharts
  transitioning shape changes. Verification must show the fill extents moving;
  otherwise the fallback is a stepped segmented bar and the owner decides.
- **Gauge round caps close the gaps at high counts.** Physical consequence of
  cap radius versus segment sweep; recorded above.
- **Engine transitions are not rate-capped.** They run at display refresh. If
  the owner requires literal 30 Hz, the alternative is a delayed clock plus
  interpolation for every family, which is more code and more per-frame work.
- **Late batches produce a blank right edge, not a correction.** This is the
  chosen honest failure; the host cadence can exceed the 1 s delay.
- **Phone performance is not measured.** Thirty option updates per second across
  several charts may be expensive on a phone; the browser/phone pass must report
  frame timing.
- **Forward compatibility of the new setting.** A reader older than this change
  refuses an unknown chart-settings key. Pre-release, this is accepted; it is
  not a theme-format version bump because absent means 100 and the schema does
  not spell chart settings.
- **Bound text leads the charts by about a second.** Accepted; text must remain
  measured and a clock must not lag.

## Verification

### Unit

- Line option: axis ends at `nowMs − playbackDelay`; samples after that instant
  remain in the series; no overscan key exists.
- History: `SampleStore`, fake and preview sources return one sample before the
  cutoff; `lineHistorySeconds` is window plus one delay.
- Player gate: identical signatures skip `setOption`; a moved reading applies
  once; line signatures include the render clock.
- Animation policy: 30 fps gives value families `animate: true` and the line
  `false`; 1 fps gives all `false`.
- Settings: absent `segmentDivisor` renders as 100; the validator refuses a
  non-member; the editor projects the discrete list; the well and aria value
  show the divisor; a typed non-member is refused.
- Bar: segment count, gap ratio, corner-radius clamp, track, missing sample,
  both orientations, gradient sampling, threshold flatness.
- Gauge: band count, gaps, colour split at the reading, `roundCap` inheritance,
  gradient sampling, 100 path identical.
- Pie: subsegment count, shares preserved with spacers, remainder segmented,
  label once per slice, slice gap still the authored `padAngle`, subsegment gap
  20% of the sub-sweep.
- Red-proof each regression test by disabling its fix and observing the failure.

### Browser

- Built player against the real host, per frame: line axis maximum equals the
  render clock; no newest point appears inside the visible right edge; the
  artboard transform and chart rect do not move.
- Value charts: one option application per sample change; an engine transition
  is visible across frames between samples; frames with unchanged readings do
  not re-apply.
- Segmented fill: rendered evidence at divisors 100, 50, 10, 2 and 1, with
  rounded and square ends, track, gradient, and a missing sample, for all three
  families.
- Editor: the discrete slider, its well and its disabled/refused states render
  and commit the divisor.
- Screenshots are evidence, not golden files.

### Phone and performance

- The owner tests the built player on the phone that reported the defect and
  records device and browser. This is evidence for this defect, not a release
  gate (§126).
- Count chart option applications and report frame timing at 30 fps and 1 fps.
  No numerical budget is claimed before measurement.

## Process

- One decision note claims `renderer-core/src/charts/`,
  `scene-fabric/src/chart-object.ts` and `editor/src/components/ui/` before the
  first write, with the seven reuse rungs including what was searched.
- `STATUS.md` currently names the backlog-drain plan as active. Starting this
  work changes the active plan; do that at plan approval, not at spec approval.
- The plan is phased: playback model and line first, value-chart animation and
  its gate second, segmented fill per family third, editor control and
  verification last.

## Future chart families

Recorded as product direction, not implemented here:

1. **Radar** — compact multi-sensor snapshot from latest readings. Best fit for
   the existing 1 Hz, latest-only data; no history plumbing.
2. **Scatter** — sensor against sensor over history (GPU temperature against
   load, FPS against GPU load). Needs timestamp pairing.
3. **Polar/radial bar** — a cheap visual variant of bar; reuses the same data and
   settings.
4. **Heatmap** — only after history bucketing exists; otherwise noisy and
   expensive.
5. **Treemap / Sunburst** — blocked: the host exposes aggregate disk usage, not
   per-volume or per-folder keys.

Not beneficial for this data model: sankey, graph, funnel, calendar,
themeRiver, parallel, boxplot, candlestick, map, effectScatter.
`pictorialBar` is better used as an implementation detail than a family.
