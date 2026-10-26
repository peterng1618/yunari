# 0119 — Segment spacing is a share of the chart, cleared by the caps

- **Date:** 2026-10-26
- **Status:** accepted
- **Paths:** `src/web/packages/renderer-core/src/charts/segments.ts`
  `src/web/packages/renderer-core/src/charts/gauge.ts`
  `src/web/packages/renderer-core/src/charts/bar.ts`
  `src/web/packages/renderer-core/src/charts/pie.ts`
  `src/web/packages/renderer-core/src/charts/settings-fields.ts`

## The problem

A segmented fill needs a gap an author can see at any count and any chart size.
`SEGMENT_GAP_RATIO = 0.2` is a share of each **slot**, so the gap's angle shrinks
as the count rises and its pixels shrink with the chart. ECharts' gauge
`roundCap` extends each band end by `thickness / 2` **pixels**, a length that
does not scale with the chart, so at high counts or small sizes the two caps
meet and the ring reads continuous. The gap is a number the engine consumes, but
*which* number keeps it visible is the mechanism decision.

## Rung 1 — Yunari

Searched: `charts/segments.ts`, `gauge.ts` (`segmentedBands`), `bar.ts`
(`segmentedRenderItem`), `pie.ts` (`toSegmentedPieData`), `settings-fields.ts`,
and the parent design's Design B.

Found: one shared ratio, three consumers, a gauge that quantises to whole bands,
a bar that already shortens its last band, and a pie spacer construction that
solves a spacer value from a desired angle.

## Rung 2 — dependencies

Searched: `src/web/package.json` and the installed `echarts@6.1.0`.

Found: ECharts is the only chart engine. It exposes `roundCap`, `axisLine`
colour bands and the custom-series render API (`getWidth`, `getHeight`); no
installed package owns gap geometry.

## Rung 3 — platform

Searched: ECharts gauge/custom-series option types and the `roundCap` radius
from the gauge source.

Found: a custom `renderItem` works in pixel space, so a pixel gap is native
there. The gauge's ring is an axis-line band list in 0..1, so its gap must be an
angle; `roundCap`'s clearance is `thickness / 2` pixels per end, twice that
across a gap. ECharts offers no relative-to-chart-length unit for either.

## Rung 4 — ecosystem

Searched: nothing external. No library can own this: the value is a parameter of
the option Yunari builds, and every example that rounds gauge ends with a gap
hard-codes degrees or pixels per count.

Found: no solution of this shape to import, and nothing to compare against.

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| Keep share-of-slot | no authoring control | none | gap vanishes at high counts and small sizes | rejected |
| Gap in pixels | bar native | unit meaningless for a ring | gaps vanish on resize in the opposite direction | rejected |
| Share of the chart's smaller edge | one unit for all three families | needs the drawn edge in gauge/pie | clearance still needs a chart size | chosen |
| Multiple of thickness | caps always clear | ignores chart size | a thin ring still loses gaps when shrunk | rejected |

## Rung 6 — probe

Arithmetic over the current formula, not a rendering sample: at a 360 px edge,
a 270° sweep, 20 segments and `thickness` 12, the old gap is
`0.2 × 13.5° × π/180 × 180 px = 8.5 px`, which is 2.36% of the edge — so a
`2.5%` share reproduces the reference look. The clearance at the same size is
`12 / 180 rad = 3.8°`, below the spacing; at a 200 px edge it is `12 / 100 rad =
6.9°`, above it, which is the observed shrink. The plan measures the rendered
result in the browser case.

## Decision

Spacing is `segmentSpacingPercent`, a share of the chart's **smaller drawn
edge** — a constant angle for a ring, because the radius is half the edge — and
the effective gap is `max(spacing, thickness / radius)` clamped to 45% of a
slot. One unit, one owner (`segments.ts`), and the caps are cleared rather than
disabled, because the author's rounded ends are a style choice the gap must
respect.
