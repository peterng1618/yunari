# Chart playback, segmented fill and two chart families — design

- **Date:** 2026-10-25
- **Status:** proposed 2026-10-25; revised to add radar and polar bar; awaiting
  owner review.
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

Three user-visible outcomes:

1. **30 fps mode is smooth on every chart, in the editor and on the phone
   player.** The line must slide without the left/right corrections reported
   repeatedly; gauge, bar and pie must animate between their 1 Hz readings
   instead of stepping once a second.
2. **Bar, gauge and pie gain a segmented fill.** A discrete slider selects how
   many equal segments the fill is split into; 100 keeps today's continuous
   fill, and the authored rounded ends carry into the segments where the engine
   allows it.
3. **Radar and polar bar join the family list.** Radar gives a multi-sensor
   snapshot on one shared scale; polar bar gives the same readings a radial
   form. Both use the existing latest-sample data path and inherit the playback
   model above.

The presentation delay is two sampling intervals (2 s against the host's 1 s
cadence). Charts may trail the measured value by that much; numeric text must
not. One interval was implemented first and the owner still saw the right edge
correct itself: a smoothed segment is drawn from the points either side of it,
so the stretch nearest the edge was reshaped every time a batch arrived. The
line is now drawn linearly and the edge waits two intervals, so an ordinary
1 s gap stays inside the last segment as a slope and only a real stall holds
and steps (A3, A5).

## What this is not

- Not a removal of 30 fps, the View menu's chart-refresh row, the host's
  `chartFps` display setting or the player's rate poll. All stay.
- Not a chart family beyond radar and polar bar. Scatter, heatmap and the other
  families in *Future chart families* are outside this spec.
- Not segmented fill for polar bar. The bar, gauge and pie walk; polar bar ships
  continuous. ECharts rendered no `custom` item under a polar coordinate system
  in the probe, so the only route to segmented polar bars is unproven and is
  deferred rather than guessed.
- Not a per-spoke scale for radar. One shared `min`/`max` is deliberate; mixed
  units are normalised through the binding, not silently rescaled per spoke.
- Not interpolation of numeric text. §122 and §97 keep text on measured
  samples.
- Not a change to acquisition cadence, provider polling or the sample protocol.
- Not a theme format version bump. `segmentDivisor` is additive; the removed
  label keys are a pre-release refusal, not a migration. An older reader that
  refuses an unknown value or key is an accepted pre-release limitation and is
  named under *Risks*.
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
  - Radar with four indicators renders one polygon; an empty `data` array
    leaves the frame and no polygon.
  - Polar bar honours `itemStyle.borderRadius`, `showBackground` with
    `backgroundStyle`, `barWidth` and `barCategoryGap`. A `null` value draws no
    bar and leaves its track.
  - A `custom` series under `coordinateSystem: "polar"` rendered no item at all
    in the SSR probe, which is why segmented polar bars are deferred.

## Design A — playback and animation

### A1. Rates stay; animation is chosen per family

`ChartRefreshRate` and its plumbing remain. The refresh rate decides how often
the scene re-plans; it does not force ECharts to animate at 30 Hz.

- At 30 fps, every family except the line receives `animate: true` — gauge,
  bar and pie now, radar and polar bar once they exist. Their authored
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
has an arrival timestamp after the edge, so it enters to the right of the edge
and slides in as the clock advances.

**The delay is two host cadences, and one cadence was not enough.** Host gaps are
never shorter than the cadence, so at one interval the edge reaches the newest
sample at the instant the next batch is due: every ordinary tick would paint a
flat stretch and then step, and the line would become a staircase. Two intervals
keep a normal 1 s gap inside the last segment, where it reads as a slope, and
reserve the hold-and-step for a real stall. The same two intervals also keep a
smooth line's reshaped segment off-screen, which is why the one-interval build
appeared to correct itself at the edge; smoothing is not offered at all (A5).

### A4. History returns the predecessor

`SampleSource.history(key, seconds)` gains one contract line: it returns the
trailing window **plus the last sample strictly before its cutoff**, when one
exists. `SampleStore`, the fake source and the preview source implement it.

`lineHistorySeconds` becomes the real window plus the playback delay, not two
delays. The chart that draws the left edge then always has the sample before its
axis minimum, regardless of the host's cadence.

### A5. Failure modes are gaps, not invention

- If no batch has arrived, the line is painted with the last measured reading
  from that sample to the axis edge — for as long as the stall lasts, because a
  gap is more jarring than a flat stretch and that reading is still the last
  thing measured.
- When the batch finally arrives after the edge has passed the previous sample,
  the previous reading is repeated at the new sample's timestamp and the line
  steps there. The stretch already painted is therefore drawn again unchanged;
  a frame never revises history the reader has seen.
- A line is **never smoothed**. ECharts draws a smooth segment from the points
  either side of it, so a smoothed tail bends as the edge advances and bends
  again when the next batch arrives; a smoothed line cannot keep a painted
  stretch. Interpolation therefore offers `linear` and `step` only, and a theme
  declaring `smooth` is refused rather than loaded and silently straightened.
- A reported non-`ok` sample is still an explicit `null` gap, never a held
  reading: the sensor said it had no value, which is not a late tick. The
  stretch painted before it is kept and the line breaks at that sample.
- No frame invents a value: a held reading repeats one that was measured, and
  nothing is drawn as zero or as a default in a gap's place. Value-chart motion
  is ECharts interpolation between measured samples, which §122 permits as
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
- No slice label or leader line is drawn (Design C), so segmentation never
  repeats a name.
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

## Design C — charts draw no text

The engine label settings are removed rather than left unstyleable.

- `BarSettings.showCategoryLabels` and `PieSettings.showLabels` are deleted,
  with their descriptors. The new families declare no label setting either.
- `showAxes` stays and keeps drawing axis lines and gridlines; every engine text
  label is off. This covers the line's time and value axes, the bar's value
  axis, radar's spoke names and polar bar's angle and radius axes. The gauge
  already draws none.
- Pie `label` and `labelLine` are always `show: false`.
- Category and series `name` fields remain engine data identity, never drawn
  text.
- Every `showAxes` hint says "axes and gridlines", not "labels".

**Why:** chart text has no editor surface for type, size, colour or placement,
so a theme can only inherit whatever the engine chose. §91 gives typography to
text objects, and a fixed caption is one the author can already place, style and
repeat. Removing the property also removes label layout from every segmented
path.

This is a pre-release settings break: a document carrying a removed key is
refused by the descriptor-driven validator, and the starter cards and tests are
updated in the same plan. No converter is written.

## Design D — Radar

### D1. One polygon over the bound readings

`radar` joins `ChartFamily`. Each binding is one indicator, and the editor caps
a radar at 12 bindings because more spokes than that collapse the polygon at
theme sizes. A radar draws only when **at least three** bindings exist and
**every** bound reading is plottable. Fewer spokes, or any missing reading,
leaves the frame with no polygon. A missing reading is never drawn as zero.

Each spoke's value is `applyTransform(latest, binding)`, so a binding's `scale`
and `offset` normalise a reading onto the radar's scale.

### D2. One shared scale

`min` and `max` (defaults 0 and 100) are the scale of every indicator. This is
deliberate: with a single data item ECharts would scale each spoke to its own
value, so every reading would draw as a full radius. The cost is that spokes
must be commensurable or normalised through the binding transform; the `max`
hint says so. Per-spoke maxima are deferred because they would need a per-binding
setting, and bindings do not own chart settings.

Values are clamped to `min..max` for drawing, as bar and gauge clamp theirs; the
raw sample is untouched elsewhere.

### D3. Settings, paint and option

Settings: `min`, `max`, `shape` (`polygon | circle`), `splitNumber` (1–10),
`lineWidth` (bounded by the drawn box), `showMarkers`, `markerSize` (bounded by
the drawn box), `showAxes` (frame lines and split rings), `stroke`, `area` and
`animation`. There is no label setting (Design C); `radar.axisName.show` is
false.

One polygon cannot carry a colour per spoke, so `stroke` and `area` resolve once
at position 1. A solid paint is exact; a threshold paint takes its last band and
a gradient its last stop. Per-spoke colour is recorded as a known limit rather
than approximated with a second series.

```ts
interface RadarOption extends EngineAnimation {
  radar: {
    shape: "polygon" | "circle";
    indicator: { name: string; min: number; max: number }[];
    splitNumber: number;
    axisName: { show: false };
    axisLine: { show: boolean };
    splitLine: { show: boolean };
    splitArea: { show: boolean };
  };
  series: [
    {
      type: "radar";
      data: { value: number[] }[];
      symbol: "circle" | "none";
      symbolSize: number;
      lineStyle: { width: number; color: EngineColor };
      areaStyle?: { color: EngineColor };
      silent: true;
    },
  ];
}
```

`data` is empty when the polygon cannot be drawn. Indicators are built from the
bindings in order; `name` carries the semantic key for engine identity only.

## Design E — Polar bar

### E1. A bar around an angle axis, as its own family

`polarBar` is a family rather than a `bar` coordinate-system setting because the
settings differ (no orientation; a start angle and two radii) and the Add pane's
tile is the discovery surface. It reuses the bar's data and paint semantics:

```ts
type PolarBarSettings = Omit<
  BarSettings,
  "orientation" | "segmentDivisor"
> & {
  readonly startAngle: number;
  readonly innerRadiusPercent: number;
  readonly outerRadiusPercent: number;
};
```

The bar paint helpers take a gradient direction instead of reading an
orientation polar bar does not have. `toBarDataItem`, `toBarColor` and
`toBackgroundStyle` remain the one owner of fill, threshold, track and corner
radius.

Every binding is one category around the angle axis; its reading is the radius.

- `startAngle` defaults to 90 and is drawn clockwise, so 90 is twelve o'clock.
- `innerRadiusPercent` (20) and `outerRadiusPercent` (80) are percentages of
  half the smaller drawn side; the validator refuses `inner >= outer`.
- `barWidth` is the angular thickness in pixels; leaving it empty lets
  `categoryGapPercent` (40) size the bar.
- `cornerRadius` (7) and `trackCornerRadius` (7) round the bar and its track
  independently, as they do on a cartesian bar.
- `showAxes` draws the radius axis, angle axis, ticks and gridlines with no
  labels; `showCategoryLabels` does not exist (Design C).
- A missing sample is a `null` value: its bar is absent and its track remains.
- A gradient paint is linear in screen space (`to-top`), not radial, because a
  polar bar has no authored growth direction.

**No segmented fill.** ECharts rendered no `custom` item under a polar
coordinate system in the probe, so a segmented polar bar is deferred rather than
built on an unproven path. `segmentDivisor` is not added to this family.

```ts
interface PolarBarOption extends EngineAnimation {
  polar: { radius: [string, string] };
  angleAxis: {
    type: "category";
    data: string[];
    startAngle: number;
    show: boolean;
    axisLabel: { show: false };
  };
  radiusAxis: {
    type: "value";
    min: number;
    max: number;
    show: boolean;
    axisLabel: { show: false };
  };
  series: [
    {
      type: "bar";
      coordinateSystem: "polar";
      data: BarDataItem[];
      barWidth?: number;
      barCategoryGap: string;
      showBackground: boolean;
      backgroundStyle?: { color: EngineColor; borderRadius?: number };
      silent: true;
    },
  ];
}
```

### E2. What adding either family touches

`ChartFamily` gains both names, and every `Record<ChartFamily, …>` then fails to
compile until it is filled. That is the guard; the sites are:

- `theme/document.ts`: `CHART_FAMILIES` and the `ChartContent` union.
- `charts/settings-fields.ts`: scalar descriptors and paint descriptors.
- `charts/engine-option.ts`: `ChartOptionByFamily`.
- `scene/plan.ts`: a `buildChartPlan` case reading `latest` through
  `applyTransform`.
- `theme/fabric-envelope-validate.ts`: scalar pairs for polar radii; radar's
  `min`/`max` pair is already derived from the descriptors.
- Editor: new-chart defaults, `uiCopy.chartFamilies`, the glyph table, the chart
  manager's insert switch, and `panel.ts`'s `defaultsOf` and `MAX_BINDINGS`
  (radar 12, polar bar unbounded).
- The Add pane and layer marks read `CHART_FAMILIES`, so they pick up both tiles
  and marks once a label and glyph exist.
- The published schema does not enumerate chart families, so it needs no change.

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
10. **Charts draw no text.** The bar and pie label settings are deleted, no new
    family gains one, and axis labels stay off while axes and gridlines remain.
    A caption is a text object.
11. **Radar and polar bar are new families.** No other family enters this spec.
12. **Radar uses one shared scale.** Per-spoke maxima would need a per-binding
    setting; mixed units are normalised through the binding instead.
13. **Radar draws only complete polygons.** Fewer than three spokes or any
    missing reading means no polygon, never a fabricated zero.
14. **Polar bar is its own family** rather than a bar setting, because its
    settings and its Add-pane tile differ.
15. **Polar bar ships continuous.** Segmented polar bars wait for a supported
    custom-polar route; the probe found none.
16. **Three sequential plans, one local merge each.** Playback and animation;
    segmented fill; radar and polar bar. After each lands, merge locally into
    `main` and stop for the owner's test. Nothing is pushed. `STATUS.md` still
    names exactly one active plan; the next two are queued.

## Risks and unverified behaviour

- **Radar's shared scale can hide a unit mistake.** A radar binding a
  temperature and a percentage draws both against 0–100. The `max` hint says to
  normalise through the binding, but nothing refuses the document. A per-spoke
  warning needs an owner in the plan-issue path and is not built here.
- **Removing labels makes a radar's spokes unnamed.** Deliberate: the author
  places text objects. Until they do, a radar is a shape without a legend.
- **The removed label keys break older documents.** A theme carrying
  `showCategoryLabels` or `showLabels` is refused by the validator. Pre-release
  accepted; starter cards and fixtures are updated in the same plan.
- **Polar bar's gradient is screen-space.** It runs bottom-to-top rather than
  along the radius. A radial gradient is not authored by this family.
- **Segmented polar bars are deferred.** Recorded with the probe; the rest of
  the segmented system does not wait on it.
- **Older readers do not know the new families.** Pre-release accepted: the
  document validator does not refuse an unknown family, so such a reader keeps
  the object but cannot draw its own option. This is not a version bump.
- **The family list doubles the surfaces tests assume are four.** Tests and
  fixtures that enumerate gauge/line/bar/pie are updated in the family plan,
  not left to fail one at a time.
- **Custom-series animation is unproven.** The bar design depends on ECharts
  transitioning shape changes. Verification must show the fill extents moving;
  otherwise the fallback is a stepped segmented bar and the owner decides.
- **Gauge round caps close the gaps at high counts.** Physical consequence of
  cap radius versus segment sweep; recorded above.
- **Engine transitions are not rate-capped.** They run at display refresh. If
  the owner requires literal 30 Hz, the alternative is a delayed clock plus
  interpolation for every family, which is more code and more per-frame work.
- **A stall is held, not left blank.** The edge runs past the newest sample and
  `liveTail` paints the last reading to it for as long as the stall lasts; the
  batch that ends the stall repeats that reading at its own timestamp and steps,
  so the stretch already painted is not revised. The cost is that a held reading
  and a measured one look the same; only a reported `null` is drawn as a gap.
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
  no slice label drawn, slice gap still the authored `padAngle`, subsegment gap
  20% of the sub-sweep.
- Labels: neither `showCategoryLabels` nor `showLabels` is declared or accepted;
  the line, bar and polar builders emit `axisLabel.show: false`; pie emits
  `label.show: false` and `labelLine.show: false`; radar emits
  `axisName.show: false`.
- Radar: indicator order follows bindings; every indicator carries the shared
  `min`/`max`; values clamp for drawing; fewer than three bindings or one
  missing reading yields empty series data; stroke and area resolve at position
  1; the option declares no axis name.
- Radar settings: `shape`, `splitNumber`, `lineWidth`, markers, frame and
  animation reach the option; the validator refuses a crossed `min`/`max`.
- Polar bar: category order follows bindings; `startAngle`, both radii,
  `barWidth`, category gap, corner radius and track reach the option; a missing
  sample is `null` while its track remains; the validator refuses
  `innerRadiusPercent >= outerRadiusPercent`; no `segmentDivisor` is accepted.
- Family addition: every `Record<ChartFamily, …>` is filled; new-chart defaults,
  labels, glyphs, panel defaults and binding caps exist for both families.
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
- Labels: no chart rect contains engine-drawn text; axes and gridlines still
  render; the inspector offers no label row.
- Radar: with four complete readings a polygon renders inside its frame; with
  two readings or one missing reading the frame remains and no polygon is
  drawn; resizing the chart keeps the shared scale.
- Polar bar: arcs render at the authored start angle and radii, with rounded
  corners, a track, a missing bar that leaves its track, and no labels.
- Family addition: the Add pane offers both tiles; each inserts, binds and
  renders; the layer row wears its family glyph.
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
- **Three plans, executed in order, each with a test checkpoint:**
  1. **Playback and animation** — Design A, plus the label removal in Design C.
  2. **Segmented fill** — Design B, with its editor slider.
  3. **Radar and polar bar** — Designs D and E, including the family-addition
     touchpoints, with no engine labels.
- After a plan lands, merge the worktree branch locally into `main`, record the
  merge in `STATUS.md`, and stop so the owner can test before the next plan
  starts. The merge is local; nothing is pushed. A defect found at a checkpoint
  is fixed in the plan that caused it, or filed, before the next plan begins.
- `STATUS.md` names exactly one active plan (ADR-0010); plans 2 and 3 stay
  queued until their predecessor's merge checkpoint. This is one plan at a
  time, not three parallel plans.
- Each plan is phased into 3–5 tasks, with its own focused verification. The
  broad gate runs at each plan's boundary, before its local merge.

## Future chart families

Recorded as product direction, not implemented here:

1. **Scatter** — sensor against sensor over history (GPU temperature against
   load, FPS against GPU load). Needs timestamp pairing.
2. **Heatmap** — only after history bucketing exists; otherwise noisy and
   expensive.
3. **Treemap / Sunburst** — blocked: the host exposes aggregate disk usage, not
   per-volume or per-folder keys.
4. **Segmented polar bar** — deferred until a polar custom-series route renders;
   the 2026-10-25 probe produced no item.

Not beneficial for this data model: sankey, graph, funnel, calendar,
themeRiver, parallel, boxplot, candlestick, map, effectScatter.
`pictorialBar` is better used as an implementation detail than a family.
