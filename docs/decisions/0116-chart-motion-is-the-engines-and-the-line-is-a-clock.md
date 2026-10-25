# 0116 — Chart motion is the engine's; the line's is a clock

- **Date:** 2026-10-25
- **Status:** accepted
- **Paths:** `src/web/packages/renderer-core/src/charts/bar.ts`
  `src/web/packages/renderer-core/src/charts/line.ts`
  `src/web/packages/renderer-core/src/charts/pie.ts`
  `src/web/packages/renderer-core/src/charts/gauge.ts`
  `src/web/packages/renderer-core/src/charts/settings-fields.ts`
  `src/web/packages/renderer-core/src/charts/engine-option.ts`
  `src/web/packages/renderer-core/src/charts/reading-signature.ts`
  `src/web/packages/renderer-core/src/charts/segments.ts`
  `src/web/packages/renderer-core/src/charts/radar.ts`
  `src/web/packages/renderer-core/src/charts/polar-bar.ts`
  `src/web/packages/renderer-core/src/theme/document.ts`
  `src/web/packages/renderer-core/src/theme/fabric-envelope-validate.ts`
  `src/web/packages/scene-fabric/src/chart-object.ts`
  `src/web/packages/editor/src/components/ui/control-slider.tsx`
  `src/web/packages/editor/src/components/ui/control-number.tsx`
  `src/web/packages/editor/src/editor-session.ts`

## The problem

Thirty-fps playback must be smooth on every chart in the editor and the phone
player. The line was placed by a wall clock inside an overscan canvas and
corrected at the right edge; value charts were re-applied with `animate: false`
every frame, so they stepped at 1 Hz. Segmented fill and two new families
(radar, polar bar) need mechanisms that animate and inherit authored corners.
Each is a mechanism boundary: a wrong choice renders wrong without failing.

## Rung 1 — Yunari

Searched: `renderer-core/src/charts/line.ts`, `bar.ts`, `pie.ts`,
`scene-fabric/src/chart-refresh.ts`, `scene-fabric/src/chart-object.ts`,
`editor/src/chart-manager/index.ts`, `renderer-core/src/data/store.ts`,
`docs/decisions/0068`.

Found: one `ChartRefreshRate` owner and one rAF loop; a line axis placed by
wall time; an edit-time reading signature; a history window that excludes the
sample before its cutoff; an overscan canvas and crop guard; no segment model.

## Rung 2 — dependencies

Searched: `src/web/package.json`, `src/web/packages/*/package.json`,
`node_modules/echarts`.

Found: ECharts 6.1.0 is the only chart engine. No animation, tween, segment or
radar library is installed, and no dependency owns scene repaint.

## Rung 3 — platform

Searched: the installed ECharts option surface and type definitions for
`animation`, `animationDurationUpdate`, `setOption`, `custom.renderItem`,
gauge `axisLine.lineStyle.color`, pie `padAngle`/`borderRadius`, radar and
polar `bar`.

Found: ECharts can merge options without a full rebuild, animate value changes
when `animate` is true, draw gauge colour bands as separate arcs, split pie
items, and render polar bars natively. It does not provide a documented 30 Hz
cap, a segment primitive, or a working polar `custom` series.

## Rung 4 — ecosystem

Searched: the installed ECharts source and exported option names for
`setOption` merge/update animation, `custom` series, gauge bands, pie
`padAngle`, radar, and polar bar; attempted a web search on 2026-10-25, but this
environment has no search backend.

Found: no installed library solves streamed chart motion. ECharts' own merge
path plus `animationDurationUpdate` is the documented route; the known failure
mode is calling `setOption` with a fresh full option each frame, which restarts
the update transition. No maintained package supplies segmented cartesian bars,
gauge gaps or a polar custom series. The probes below were the comparison.

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| Keep overscan, fix the crop | Keeps a wall-clock axis | Low | Already failed repeatedly; `vg-582` measured 767 ms instead of 1 000 ms | Rejected |
| Delayed clock, axis edge at render time | Exact edge; later samples clip | Delete overscan and one delay from history | Late batch leaves a blank edge | Chosen for the line |
| Interpolate every family ourselves | Literal 30 Hz | Per-frame work and a second animation model | Duplicates ECharts and can invent values | Rejected |
| Engine transitions + reading signature | Smooth value charts; no restart | Shared signature owner on both surfaces | Display-rate transition, not 30 Hz | Chosen for value families |
| `pictorialBar` segments | Native-ish | Ignores corner radius; cannot vary symbols | Authored corners lost | Rejected |
| Custom cartesian bar | Honours corners, track, gradient | Custom renderer and transition proof | Animation unproven | Chosen for segmented bar |
| Gauge second series per segment | Full control | Many series and geometry duplication | More ownership, more layout | Rejected |
| Gauge native colour bands | No new geometry; per-band caps | Quantised fill | Caps close gaps at high counts | Chosen for segmented gauge |
| Pie custom geometry | Full control | Reimplements layout and composition | High risk, no need | Rejected |
| Pie data-item splitting | Native layout, corners, shares | Spacer items | Spacer arithmetic | Chosen for segmented pie |
| Radar with one data item | One polygon, one shared scale | Spokes must be commensurable | Mixed units draw wrong | Chosen |
| Polar bar as a bar setting | One family | Settings diverge; no Add-pane tile | Discovery and orientation confusion | Rejected |
| Polar bar as its own family | Reuses bar paint/data helpers | One more family across every `Record<ChartFamily, …>` | Compile-enforced sites | Chosen |

## Rung 6 — probe

ECharts 6.1.0 SSR probes, recorded in the spec:

- Line points beyond `xAxis.max` draw through the edge and clip at the grid;
  no overscan canvas is needed.
- A gradient gauge `axisLine` band is a separate arc; `roundCap` applies per
  band; transparent bands produce gaps.
- Pie `borderRadius` is per item and `padAngle` is series-level.
- `custom` on a cartesian grid renders grouped rects and supports shape
  transitions.
- Radar with empty data leaves the frame and draws no polygon.
- Polar `bar` honours `borderRadius`, `backgroundStyle`, `barWidth` and
  `barCategoryGap`; `null` leaves the track.
- Polar `custom` rendered no item, so segmented polar bar is deferred.

## Decision

Value families animate through ECharts at 30 fps and are re-applied only when a
shared reading signature moves. The line stays `animate: false` and is placed by
`nowMs − playbackDelay`; its axis ends at that render clock, the overscan canvas
and guard are deleted, and history returns one predecessor sample. **Amended
after owner testing:** the delay is two host cadences, and the line is never
smoothed — `smooth` is removed from the interpolation setting, leaving `linear`
and `step`, and a theme declaring it is refused. A flat stretch held at the
edge, and the batch that ends a stall, must not reshape anything the reader has
already seen, and ECharts can only promise that for straight segments. **At
1 fps the delay is zero:** that mode redraws once a second, so the delay cannot
keep its edge inside a segment and would only make each reading two seconds
late. Segmented fill uses custom cartesian bars,
native gauge bands and pie spacer items. Radar and polar bar are families, radar
with one shared scale and polar bar with no segmentation. The reason is the
probes: each chosen mechanism already owns the geometry and corner behaviour,
while the rejected ones either duplicate layout or cannot honour the authored
settings.
