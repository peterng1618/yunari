# 0121 — Segment spacing is a share of the segment

- **Date:** 2026-10-26
- **Status:** accepted; supersedes [0120](0120-segment-spacing-is-a-share-of-the-chart.md)
- **Paths:** `src/web/packages/renderer-core/src/charts/segments.ts`
  `src/web/packages/renderer-core/src/charts/gauge.ts`
  `src/web/packages/renderer-core/src/charts/bar.ts`
  `src/web/packages/renderer-core/src/charts/pie.ts`
  `src/web/packages/renderer-core/src/charts/settings-fields.ts`

## The problem

The owner's ruling: the gap is authored as a percentage of **the segment it
separates**, and at 100% the empty space is as wide as the segment itself, with
or without its rounded corners. 0120 measured the gap against the chart's
smaller edge instead, which made the slider's meaning depend on the segment
count: above roughly 20% of the edge the gap stopped changing at ordinary counts
because the 45%-of-a-band clamp had already taken it, and the rounded caps ate
the first `thickness / radius` of every gap, so raising the setting barely moved
the picture.

## Rung 1 — Yunari

Searched: `charts/segments.ts`, `gauge.ts` (`segmentedBands`), `bar.ts`
(`segmentedRenderItem`), `pie.ts` (`toSegmentedPieData`), `settings-fields.ts`,
0120 and the parent design's Design B.

Found: three adapters, one shared percentage, a gauge whose caps overhang each
band end by half the thickness, a bar whose gap is in pixel space, and a pie
spacer construction with one solved denominator.

## Rung 2 — dependencies

Searched: the installed `echarts@6.1.0` gauge and custom-series options.

Found: no fraction-of-a-shape unit; the gap is a colour-stop proportion, a pixel
length, or a data item, one per family.

## Rung 3 — platform

Searched: ECharts `roundCap`, `axisLine` colour stops, custom `renderItem`.

Found: a round cap extends `thickness / 2` beyond each colour stop, so the
*empty* space between two painted bands is `stopGap - thickness / radius`. A
percentage of the segment's *painted* width therefore has to be solved for the
stop gap, not written into it.

## Rung 4 — ecosystem

Searched: nothing external. No package owns a chart's gap geometry; examples
hard-code degrees per count.

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| Share of the chart edge (0120) | one unit for three families | needs the drawn edge | the slider's useful range shrinks with the count; caps eat the gap | rejected |
| Share of the *slot* (pitch) | gap in the band's own terms | — | at 50% the gap already equals the band, so the top half of 1–100 is mostly gone | rejected |
| Share of the segment's **painted width** | matches the owner's definition at every count | the gauge needs one solve | the pie's spacers stop being equal | chosen |

## Rung 6 — probe

For a band of `b` degrees, cap clearance `c` (0 without round ends) and authored
share `q = p / 100`: the painted extent is `b - s + c` where `s` is the stop gap,
and the empty space is `s - c`. Setting `s - c = q (b - s + c)` gives

```
s = (q (b + c) + c) / (1 + q)      clamped to b
```

At `q = 1` the space equals the painted extent and both are `b / 2`; at `q = 0`
the space is zero. For a bar or a pie piece, where nothing overhangs, `s = q b /
(1 + q)`, the same equation with `c = 0`. The starter RAM gauge at divisor 20 is
five bands of 54° with `c = 5.26°`: at the default 10% the stop gap is 10.2°, the
painted extent 48.8° and the empty space 4.9° — the picture the owner approved,
without the caps eating the setting.

## Decision

`segmentSpacingPercent` is an integer 1–100, a share of the painted segment, and
the gap is solved for the painted extent (the caps included). The default is 10
for every family, which is the look the owner approved on the reference gauge;
the bar and the pie draw a tighter gap than their old 20% of a slot, and the
slider is the way back. The 45%-of-a-band clamp is gone: the percentage defines
the relationship, and the only bound is that a band cannot be negative.

The bar no longer needs the drawn box at all — its gap is a function of its own
band — so `getWidth`/`getHeight` leave `BarRenderApi`. The pie's spacers stop
being equal: each gap is the same share of the piece it follows, so a larger
slice leaves a larger gap.
