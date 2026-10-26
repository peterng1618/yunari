# 0120 — Segment spacing is a share of the chart, cleared by the caps

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

Arithmetic over the current formula, not a rendering sample. The look the defect
was reported at is the starter RAM gauge at divisor `20` — **five** bands on its
270° sweep: the slot-relative gap that looked right was `0.2 × 54° = 10.8°`. At a
radius of half the drawn edge that is a **9.4%** share of the edge
(`2 × 9.4 / 100 rad = 10.8°`), so a document with no spacing authored redraws that
count unchanged, and every higher count gets the same gap instead of a shrinking
one. The first probe measured the gap at twenty *segments* (divisor five) and
proposed 2.5, which is the tighter count's look, not the reported one.

The clearance is `thickness / radius`, and the radius is the **backing** canvas's:
ECharts draws into `edge × renderScale` and the option's thickness is in those
pixels, so a scene-unit radius made the term wrong by the render scale. On the
starter's 218-unit ring at 2× that is `20 / 218 rad = 5.3°`, below the 10.8° share;
at a quarter of the size it is 21°, above it, which is the observed shrink. The
clearance applies only to round ends: a square end is a butt edge and needs none.

Bar and pie keep a `2.5` share. The probe is the reference gauge's, and a 9.4 bar
gap would be clamped to 45% of a slot at almost every count. The plan measures the
rendered result in the browser case.

## Decision

Spacing is `segmentSpacingPercent`, a share of the chart's **smaller drawn
edge** — a constant angle for a ring, because the radius is half the edge — and
the effective gap is `max(spacing, thickness / backing radius)` for round ends,
clamped to 45% of a slot. One unit, one owner (`segments.ts`), and the caps are
cleared rather than disabled, because the author's rounded ends are a style
choice the gap must respect.
