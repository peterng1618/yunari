# 0127 — Smoothing returns as an authored line interpolation

- **Date:** 2026-10-27
- **Status:** accepted 2026-10-27
- **Paths:** `src/web/packages/renderer-core/src/charts/line.ts`,
  `src/web/packages/renderer-core/src/charts/settings-fields.ts`,
  `src/web/packages/renderer-core/src/theme/fabric-envelope-validate.ts`

## The problem

A line on the player moves only when a sample arrives (0124): its axis ends at
the newest reading and there is no wall clock extending it between samples. At a
1 Hz host the drawn line therefore steps once a second. The author had a
`smooth` interpolation choice until 0116 removed it, and now wants it back as a
drawn shape — not as motion. The line's engine animation stays off; mixing an
engine transition with a data-clock jump would put two kinds of motion on one
chart.

The question is only whether the old objection to smoothing still holds.

## Rung 1 — Yunari

Searched: `charts/line.ts` (`smooth: false`, the `Interpolation` union),
`charts/settings-fields.ts` (`INTERPOLATION`), `theme/fabric-envelope-validate.ts`
(the select refusal), `charts/line.test.ts`, `chart-animation.ts`, decisions
0116 and 0124.

Found:
- 0116 removed `smooth` because the line was placed by a wall clock: the axis
  edge advanced every frame, so a flat stretch held at the edge had to bend as
  the edge moved over it.
- 0124 deleted that edge. The axis now ends at the newest reading and moves only
  when a sample arrives. Nothing is drawn "held at the edge" between samples.
- The validator refuses a select value that is not in the field's options, which
  is what made the removal enforceable at load time.
- `chartAnimationFor` keeps the line at `animate: false`; the builders' `smooth`
  is independent of that.

## Rung 2 — dependencies

Searched: installed `echarts` 6.x — `LineView`, the line option typedefs
(`smooth`, `step`), and ECharts' documented animation/data-diff behaviour.

Found: `smooth` and `step` are mutually exclusive line options; a smooth
segment's control points are computed from the adjacent points, so adding a
point reshapes the two segments either side of it. That cost is unchanged by
0124 — what 0124 removed is the *continuous* reshaping the wall-clock edge
caused, not the one-off reshape when a batch arrives.

## Rung 3 — platform

No browser or native API is involved; the renderer's option surface is read in
rung 2.

## Rung 4 — ecosystem

Searched: ECharts line-series docs and examples for `smooth`, and the streamed
line patterns referenced by 0116/0124.

Found: ECharts' own live-data examples use `smooth: false` for streamed lines,
and the option is otherwise a static presentation choice. No library offers
"smooth only where it cannot reshape seen history"; that distinction is the
application's.

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| Keep `linear`/`step` only | Preserves 0116 exactly | None | The author keeps a stepped line at 1 Hz with no choice | Rejected |
| Restore `smooth` as a third interpolation value | Reuses the engine's own smoothing; authored, default stays `linear` | One union member, one option in the field, one validator path | A new sample bends the segment beside it; the curve is not straight interpolation | Chosen |
| Approximate smoothing in the builder (custom control points) | Could pin seen history | Duplicates ECharts layout and a second geometry path | unproven, more ownership | Rejected |
| Turn on engine animation for the line | Continuous motion | A second kind of motion on the same chart; animation frames are not blitted (vg-107) | Jarring, expensive, and does not address the request | Rejected |

## Rung 6 — probe

Unit-level: `buildLineOption` emits `smooth: true` for the `smooth` value and
`smooth: false` for `linear`/`step`; `step` stays exclusive to `step`; the theme
validator accepts `interpolation: "smooth"` and still refuses an unknown value.
No pixel is read; the shape is the engine's documented behaviour, not ours.

## Decision

`Interpolation` is `linear | step | smooth`, and `smooth` is authored per line.
Under the data clock the old objection — a held stretch bending as the edge
advances — no longer applies; what remains is a single reshape when a sample
lands, which is the accepted cost of the curve. The default stays `linear`, and
the line's engine animation stays off so the chart has one kind of motion.
