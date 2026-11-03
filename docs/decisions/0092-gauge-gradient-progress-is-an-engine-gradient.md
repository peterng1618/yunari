# 0092 — A gauge's gradient progress is an engine gradient object

- **Date:** 2026-11-03
- **Status:** accepted
- **Paths:** `src/web/packages/renderer-core/src/charts/gauge.ts`

## Problem

A gauge whose `progress` resolves to a gradient paints its track and no value
arc. The continuous path emits `progress.itemStyle.color` as the
`[proportion, colour]` segment array that ECharts accepts on
`axisLine.lineStyle.color`, so the fill is silently dropped rather than
mis-coloured. A wrong choice here fails quietly: the option object looks
painted and the canvas is empty.

## Rung 1 — internal owner

Searched: CodeGraph for `progressItemStyle`, `segmentedBands`, `toColorSegments`,
`toLinearGradient`.

Found: `buildGaugeOption` is the one gauge adapter. It already switches on
`segmentDivisor`: at or below 100 the ring is continuous and the fill lives in
`progress`; below 100 `segmentedBands` paints the whole ring through
`axisLine` and `progress.show` is false. So a gradient on the continuous path
has exactly one owner to change, and the segmented path is unaffected. The
shared cartesian converter `toLinearGradient` already exists in `fill.ts`.

## Rung 2 — installed dependencies

Searched: `node_modules/echarts/lib/chart/gauge/GaugeView.js` and
`node_modules/echarts/types/dist/shared.d.ts` (`ProgressOption`, `ItemStyleOption`),
plus `node_modules/zrender/lib/canvas/graphic.js` and `canvas/helper.js`.

Found: `GaugeView` applies the progress model's item style directly to the
sector/sausage element (`progress.setStyle(itemModel.getModel(["progress",
"itemStyle"]).getItemStyle())`). `ProgressOption.itemStyle` is an
`ItemStyleOption`, whose `color` is `ZRColor`: a colour string, a linear or
radial gradient object, or a pattern. An array is not one of those. zrender's
canvas painter only takes a gradient branch when the style value carries
`colorStops`, and builds it from normalised `x/y/x2/y2`; an array has neither,
so the shape is drawn with no fill. ECharts donates the fix itself: a gradient
object on this field is a supported value.

## Rung 3 — native platform

Searched: Canvas 2D `createLinearGradient`/`addColorStop`, which is what
zrender calls for a gradient style.

Found: the browser can paint a linear gradient, but Yunari does not hand-paint
chart elements. Using it directly would mean a second painter for gauge arcs,
which is the parallel path this adapter exists to avoid. The renderer's
gradient branch is the platform integration already in place.

## Rung 4 — public solutions

Searched: ECharts gauge examples and issue discussions for gradient progress
(`echarts gauge progress gradient itemStyle`), and comparable chart adapters
(Chart.js radial gradients, Recharts `LinearGradient` fills).

Found: ECharts' own gauge examples pass a `LinearGradient` object to
`progress.itemStyle.color`; the segment array is documented for
`axisLine.lineStyle.color` only. Chart.js solves the same sweep by creating a
`CanvasGradient` itself; that is the hand-painting route rejected above.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Emit `toLinearGradient(stops, "to-right")` on the continuous path | Uses the existing converter and ECharts' documented gradient field | Gradient follows the chart rect, not the arc's angular sweep | Chosen |
| Keep arc segments on `progress.itemStyle.color` | Looks right in the option, paints nothing | None fixes it; the field rejects arrays | Rejected |
| Paint segments on every gauge, including `segmentDivisor: 100` | Arc-following colour | Changes the meaning of the continuous divisor and forces a segment count the author did not ask for | Rejected |
| Radial gradient object | Supported field | Colour varies by radius, not along the value; not the authored ramp | Rejected |
| Hand-paint the arc on canvas | Exact sweep | A second painter, and the glass/thumbnail paths would diverge | Rejected |

## Rung 6 — smallest probe

The existing `gauge.test.ts` "follows the arc for a gradient fill" asserts the
segment array, which is the defect restated. Reading `GaugeView`'s
`setStyle(...getItemStyle())` against zrender's `brushPath` shows the array
reaches the painter with no `colorStops` and no colour string, so nothing is
filled. The probe is the revised test: the continuous path's colour is a
linear-gradient object and the same option still validates as a gauge option.

## Decision

`progressItemStyle` returns `toLinearGradient(fill.stops, "to-right")` for a
gradient on the continuous path; solid and threshold fills keep their flat
colour. The segmented path keeps its existing band painting, because there
`axisLine` owns the whole ring.
