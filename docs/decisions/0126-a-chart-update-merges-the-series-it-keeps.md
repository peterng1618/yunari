# 0126 — A chart update merges the series it keeps

- **Date:** 2026-10-27
- **Status:** accepted 2026-10-27
- **Paths:** `src/web/packages/scene-fabric/src/chart-object.ts`

## The problem

The player updates a bar, pie or gauge chart when its reading changes. Each
update was meant to be an engine data transition — the bar grows from its old
value, the needle moves from its old angle — because `chartAnimationFor` turns
engine animation on for every family except the line, and the builders emit
`animationDurationUpdate` for exactly that. What the reader saw instead was the
value family replaying its *appear* animation on every sample: the bar growing
from zero, the pie sweeping from nothing, the needle starting at its minimum.

0117 chose `{notMerge: false, replaceMerge: ["series"]}` for the update path.
The note describes it as "replaces series data" while keeping the instance and
its axes, and lists the risk as "a removed series must be absent, not merely
empty". The engine does not do the first thing.

## Rung 1 — Yunari

Searched: `scene-fabric/src/chart-object.ts` `setOption`; every builder's
`series` array in `renderer-core/src/charts/`; the two update callers
(`player/src/main.ts` `refresh`, `editor/src/chart-manager/index.ts`
`#applyChart`).

Found:
- Both update callers reach `YunariChart.setOption` without `{replace: true}`.
  Authored changes — settings, bindings, palette reassignment — pass
  `{replace: true}` and are unaffected by this decision.
- Every builder emits exactly `series[0]` for bar, segmented bar, pie, gauge,
  polar bar and radar. A line emits one per bound input, and bindings are
  authored, so the count is fixed between authored changes.
- No builder gives its series an `id`.

## Rung 2 — dependencies

Searched: `echarts` 6.x installed source — `lib/model/Global.js`
`_mergeOption`, `lib/util/model.js` `mappingToExists`, `prepareResult`,
`mappingById`, `mappingByIndex`.

Found: `replaceMerge` is a *matching mode*, not a merge of series data. In
`replaceMerge` mode `prepareResult` nulls every existing component unless a
new component matches it **by `id`**; `mappingById` only matches an `id`;
`mappingByIndex` then appends the rest as `brandNew`. `brandNew` sets
`__requireNewView`, so the engine builds a new view and plays the appear
animation. With no ids in our options, every `setOption` on this path is a full
series rebuild — which is the defect.

## Rung 3 — platform

Not applicable: the platform here is the ECharts merge contract, read in rung 2.
There is no browser API for component identity.

## Rung 4 — ecosystem

Searched: ECharts `setOption` API docs (`replaceMerge`), the animation handbook,
and the common dynamic-data patterns referenced by 0117.

Found: the documented streaming pattern is to call `setOption` with only
`series.data` and let components merge; ids are the documented way to keep a
component across a `replaceMerge`. Every example that drops series with
`replaceMerge` assigns ids first. 0117's note read `replaceMerge` as
"replaces series while keeping axes" and did not carry that precondition.

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| Keep `replaceMerge: ["series"]`, add a stable `id` to every builder's series | Preserves "a removed series must be absent" | Touches every chart builder and its option-shape tests | Line ids must be unique per bound sensor; ids become a persisted-adjacent contract for a case the merge path never has | Rejected |
| Drop `replaceMerge`; plain merge by index/name | Series models survive, data diff drives `animationDurationUpdate` | A series removed by a *merge* would linger | The merge path never changes series count: authored changes already replace, and every value family has one series | Chosen |
| Rebuild the chart `notMerge: true` each tick | Trivial | Rebuilds axes and animation every tick | The defect, worse | Rejected |

## Rung 6 — probe

`chart-object.dom.test.ts` mounts each value family through `YunariChart`,
reads `getModel().getSeries()[0]` before and after a reading change, and asserts
it is the same model. Red under `replaceMerge` (all three families rebuilt),
green with the plain merge. The engine's own `setOption` is the only observer;
no pixel is read.

## Decision

The update path merges with `{notMerge: false, lazyUpdate: false}`. Preserving a
series *model* is the whole point of a merge: it is what lets the data differ
emit an update and the engine animate the value. `replaceMerge` without ids is
a rebuild wearing a merge's options. Authored changes still replace the whole
option, and they are the only path that can change the series shape.
