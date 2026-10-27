# The live line is placed by its data — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the live line's wall-clock axis and playback delay with a data
clock: the axis ends at the chart's newest reading, the line redraws only when
the data moves, missing readings are skipped, and the host transport queues
sample frames instead of replacing them.

**Architecture:** `buildLineOption` computes one `endMs` from the newest
plottable sample across the chart's series and places the axis at
`[endMs − window, endMs]`. The reading signature loses its clock and delay, so a
line is drawn only when its newest reading moves. `SampleSource` loses
`chartPlaybackDelayMs`, the delay/`liveTail` helpers are deleted, and
`SseConnection` gains a bounded FIFO so a slow connection loses no measurements.
Value families keep ECharts' engine transitions unchanged.

**Tech Stack:** TypeScript, ECharts 6.1.0, Vitest, Playwright, Node `http`.

**Decision:** `docs/decisions/0124-the-live-line-is-placed-by-its-data.md`
(supersedes 0116's line placement and 0068's delay term; amends §83).

## Global Constraints

- `renderer-core` stays Fabric/DOM-free; `exactOptionalPropertyTypes` and
  `noUncheckedIndexedAccess` stay on. Absent stays absent.
- A line's axis ends at its newest **plottable** reading. No delay, no trailing
  hold, no synthetic tail, no wall clock in the line's picture.
- A missing/non-`ok` reading is skipped for a line series only (§83 exception);
  every other family keeps its gap. A missing reading is never zero.
- A line never uses `smooth`.
- The transport bound is a queue, not an unbounded buffer: 120 frames, oldest
  dropped and counted beyond it.
- Every behaviour change lands with a test watched failing first.
- The per-frame editor probe is the motion proof; unit tests cannot see motion.

## Review Focus

- The drawn picture is independent of `Date.now()`: two builds with different
  `nowMs` and the same samples produce the same option.
- A batch arriving after any stall adds a segment; it never changes the drawn
  value at an x the reader has already seen, and never leaves the right edge
  blank.
- A chart whose newest reading is 30 s old freezes with its line at the right
  edge rather than scrolling into emptiness.
- A missing reading between two good ones joins them; the line has no break and
  no data point at the missing x.
- 1 fps and 30 fps draw the same picture; only how soon a redraw happens
  differs.
- A connection that refuses three writes delivers all three after `drain`, in
  order, and only drops the oldest past 120.

---

### Phase 1 — The line is placed by its data

### Task 1.1: Data-clock placement and the line-only gap rule

**Files:**
- Modify: `src/web/packages/renderer-core/src/charts/line.ts`
- Test: `src/web/packages/renderer-core/src/charts/line.test.ts`

**Interfaces:**
- Produces: `buildLineOption(settings, series, nowMs, animate?, palette?)` —
  `nowMs` is only the empty-chart fallback; the axis is
  `[endMs − windowSeconds·1000, endMs]` where `endMs` is the newest plottable
  sample time across `series`.
- Produces: `toSeriesPoints(samples, settings, endMs, windowStart?)` — omits
  non-plottable samples, keeps one predecessor before `windowStart`, caps by
  `maxPoints`.
- Removes: `liveTail`, `linePlaybackDelayMs`, `lineHistorySeconds`, and the
  `chartPlaybackDelayMs` parameter.

- [ ] **Step 1: Write the failing tests**

Replace the `liveTail` and "a delayed line" describes with:
- `it("ends the axis at the newest plottable reading")` — samples at 59 s and
  60 s, `nowMs` later than both: `xAxis.max` is the 60 s sample, `min` is 60 s
  earlier, `data.at(-1)` is that sample (no synthetic tail).
- `it("draws the same picture whatever the wall clock says")` — the same samples
  at `nowMs` and `nowMs + 5_000` produce deep-equal `xAxis` and series data.
- `it("keeps the axis on the data when the newest reading is a gap")` — a
  `missing` sample at 60 s and an `ok` at 50 s: the axis ends at the `ok`
  reading, and no `null` point exists.
- `it("ends a shared axis at the newest series")` — two series, newest 60 s and
  50 s; `xAxis.max` is the 60 s one and the older series ends at 50 s.
- `it("draws a stall's incoming segment without moving what was painted")` —
  build with samples ending at 70 s, then with an 80 s sample; every 100 ms x in
  `[axisMin, 70 s]` reads the same drawn value.
- `it("starts the axis at its newest reading when nothing has arrived")` —
  empty series: `xAxis.max === nowMs`.

Replace the §83 gap describe with:
- `it.each(["missing","error","unavailable","stale"])("skips a %s reading")` —
  `toSeriesPoints` returns only the plottable points, no `null`.
- `it("never draws a skipped reading as zero")`.
- `it("keeps the reading either side of a skipped one")` — 40 at 10 s, gap at
  20 s, 60 at 30 s → `[[10s,40],[30s,60]]`.

Update windowing tests to pass the new bound/window explicitly, and delete the
`liveTail`, `lineHistorySeconds` and delay-argument cases.

- [ ] **Step 2: Run the tests and watch them fail**

`cd src/web && npx vitest run packages/renderer-core/src/charts/line.test.ts`

- [ ] **Step 3: Implement**

In `line.ts`:
- `sampleTimeMs(sample)` returns `Date.parse(sample.timestamp)` (host clock).
- Delete `liveTail`, `linePlaybackDelayMs`, `liveHistorySeconds`; keep the
  playback-delay clamp only if another caller exists (it must not).
- `toSeriesPoints` filters `hasPlottableValue`, maps to `[t, value]`, sorts,
  keeps one predecessor at `< windowStart`, applies `maxPoints`.
- Add `lineEndMs(series): number | undefined` = max plottable time.
- `buildLineOption`: `const endMs = lineEndMs(series) ?? nowMs;` then
  `windowStart = endMs − windowMs`; `xAxis.min/max`; each series data from
  `toSeriesPoints(input.samples, settings, endMs, windowStart)`; keep
  `connectNulls: false` (inert with no nulls), `smooth: false`, `step`.
- Update the file's doc comments: the line is placed by its newest reading, and
  a missing reading is skipped (§83 line exception, 0124).

- [ ] **Step 4: Run the line tests green**

`cd src/web && npx vitest run packages/renderer-core/src/charts/line.test.ts`

### Task 1.2: The reading signature loses its clock

**Files:**
- Modify: `src/web/packages/renderer-core/src/charts/reading-signature.ts`
- Test: `src/web/packages/renderer-core/src/charts/reading-signature.test.ts`

**Interfaces:**
- Produces: `chartReadingSignature(content, bindings, source, palette?, drawnEdgePx?)`.
- A line reads `source.history(key, settings.windowSeconds).at(-1)`; no `now`.

- [ ] **Step 1: Write the failing tests**

- `it("does not move with the wall clock")` — a line signature at two `nowMs`
  values is identical (the parameter is gone; drive it through two `Date.now`
  values is not possible, so assert the call shape has no clock argument and the
  same source gives the same string twice).
- `it("moves when a line's newest reading moves")` — two sources whose history
  differs in the last sample give different signatures.
- Delete "asks for the history its delay needs" and the delay argument from the
  drawn-box test.
- `it("asks for exactly the chart's window")` — the recorded `history` seconds
  equal `defaultLineSettings.windowSeconds`.

- [ ] **Step 2: Run and watch fail**

`npx vitest run packages/renderer-core/src/charts/reading-signature.test.ts`

- [ ] **Step 3: Implement** — drop `nowMs` and `playbackDelayMs`; remove the
  `now:` suffix; request `content.settings.windowSeconds`; update the doc
  comment (a line moves when its newest reading moves).

- [ ] **Step 4: Green.**

### Task 1.3: The plan builder stops carrying a delay

**Files:**
- Modify: `src/web/packages/renderer-core/src/scene/plan.ts`
- Test: `src/web/packages/renderer-core/src/scene/plan.test.ts`

**Interfaces:**
- Removes: `ChartPlanContext.playbackDelayMs`; `buildLinePoints(bindings,
  settings, source)`.
- `buildChartPlan` passes no delay; the line's history request is the window.

- [ ] **Step 1: Write/update the failing tests**
  - Replace "requests the delayed line viewport's left-edge predecessor" with
    "requests the line's own window" → `[defaultLineSettings.windowSeconds]`.
  - Replace the delayed-axis case with "ends the axis at the newest sample's own
    timestamp" using the three samples whose `presentationTimestamp` is 1 s
    ahead: `xAxis.max === NOW − 1_000`, last point `[NOW − 1_000, 30]`.
  - Delete "drops the source's delay…" and every `chartPlaybackDelayMs` /
    `playbackDelayMs` argument.
  - Keep the cadence loop; assert every frame in it produces the same option
    (the picture no longer depends on the frame clock).

- [ ] **Step 2: Run and watch fail.**
- [ ] **Step 3: Implement.** Remove the delay plumbing; update the
  `buildLinePoints` doc (the line asks for its window; the source returns the
  predecessor).
- [ ] **Step 4: Green.**

---

### Phase 2 — Every surface draws the same line

### Task 2.1: `SampleSource` drops the delay

**Files:**
- Modify: `src/web/packages/renderer-core/src/data/source.ts`
- Modify: `src/web/packages/renderer-core/src/data/live-source.ts`
- Modify: `src/web/packages/editor/src/preview-source.ts`
- Modify: `src/web/packages/renderer-core/src/index.ts`
- Test: `src/web/packages/editor/src/preview-source.test.ts`,
  `src/web/packages/renderer-core/src/data/live-source.test.ts` (if it asserts
  the constant)

- [ ] **Step 1: Update the tests** — remove the
  `LIVE_SOURCE_CHART_PLAYBACK_DELAY_MS` assertions; a preview line's smoothness
  test keeps one source, without the `undelayed` twin.
- [ ] **Step 2: Run and watch fail.**
- [ ] **Step 3: Implement** — delete the property, the constant and the exports.
- [ ] **Step 4: Green.**

### Task 2.2: `chartPlaybackDelayFor` is deleted

**Files:**
- Modify: `src/web/packages/scene-fabric/src/chart-animation.ts`
- Modify: `src/web/packages/scene-fabric/src/index.ts`
- Test: `src/web/packages/scene-fabric/src/chart-animation.test.ts`

- [ ] **Step 1: Update the test** — remove the `chartPlaybackDelayFor` describe;
  keep `chartAnimationFor` cases, retitling "leaves the line static" (it moves
  with its data, so an engine transition would animate the jump).
- [ ] **Step 2: Run and watch fail.**
- [ ] **Step 3: Implement** — delete the function and export; update the comment.
- [ ] **Step 4: Green.**

### Task 2.3: Editor and player stop passing a delay

**Files:**
- Modify: `src/web/packages/editor/src/chart-manager/index.ts`
- Modify: `src/web/packages/player/src/main.ts`
- Tests: the existing editor/player DOM suites that construct these paths

- [ ] **Step 1:** Remove `chartPlaybackDelayFor` imports, the `nowMs`/delay
  arguments to `chartReadingSignature`, and `playbackDelayMs` from
  `buildChartPlan`/`buildLineOption` calls. Keep `nowMs` for the empty-chart
  fallback and for value families.
- [ ] **Step 2:** Update comments: the loop still owns text; a line redraws when
  its reading moves.
- [ ] **Step 3:** Run the affected suites, then typecheck.

---

### Phase 3 — The transport keeps every measurement

### Task 3.1: A bounded frame queue

**Files:**
- Create: `src/web/packages/host/src/transport/frame-queue.ts`
- Modify: `src/web/packages/host/src/transport/sse.ts`
- Delete: `src/web/packages/host/src/transport/keep-latest.ts`,
  `src/web/packages/host/src/transport/keep-latest.test.ts`
- Test: `src/web/packages/host/src/transport/sse.test.ts`,
  `src/web/packages/host/src/transport/frame-queue.test.ts`

**Interfaces:**
- Produces: `class FrameQueue<T>` with
  `constructor(limit: number)`, `offer(item): boolean` (true when it displaced
  the oldest), `take(): T | undefined`, `size`, `droppedCount`,
  `deliveredCount`.
- `SseConnection` uses `new FrameQueue<string>(SSE_FRAME_QUEUE_LIMIT)` with
  `SSE_FRAME_QUEUE_LIMIT = 120`; `flush()` drains until empty or backpressured.

- [ ] **Step 1: Write the failing queue tests** — FIFO order; the 121st offer
  drops the oldest and counts it; `take` on empty is undefined; falsy items are
  held.
- [ ] **Step 2: Update the SSE test** — replace "keeps only the newest frame"
  with "delivers every frame that waited on a drain, in order": offer
  `first/second/third` while unwritable, drain, expect writes
  `first, second, third`; then assert `droppedCount === 0`.
- [ ] **Step 3: Run and watch fail.**
- [ ] **Step 4: Implement** — the loop in `flush()`; delete the old slot and its
  test; update `docs/architecture/ownership.md`'s "SSE connection/keep-latest"
  row to "SSE connection/frame queue".
- [ ] **Step 5: Green.**

### Task 3.2: Retire the delay-specific checks

**Files:**
- Delete: `src/web/packages/host/src/chart-edge-cadence.test.ts`
- Modify: `src/web/tests/e2e/live-chart-edge.spec.ts`

- [ ] **Step 1:** Delete the cadence test (the invariant it guards no longer
  exists).
- [ ] **Step 2:** Rework the opt-in probe's assertions: each line's `axisMax`
  equals its newest sample time; the series carries no `null`; `axisMax` never
  goes backwards; the axis edge stays within `[canvas 0, canvasWidth]`. Remove
  the `LIVE_SOURCE_CHART_PLAYBACK_DELAY_MS` lag assertion.
- [ ] **Step 3:** `npx tsc --noEmit -p tsconfig.e2e.json` (or the gate's
  typecheck) is green.

---

### Phase 4 — Verification

- [ ] **4.1 Focused unit proof:** `npx vitest run packages/renderer-core/src/charts packages/renderer-core/src/scene/plan.test.ts packages/scene-fabric/src/chart-animation.test.ts packages/host/src/transport packages/editor/src/preview-source.test.ts`.
- [ ] **4.2 Full gate:** `cd src/web && npm run gate` → exit 0; record the code
  and the test/file counts. Re-run if the known `secret-store` timeout (`vg-754`)
  fires, and say so if it does.
- [ ] **4.3 Browser proof (motion):** rebuild the bundles, run the editor against
  the real host with real machine sensors at 30 fps and at 1 fps, and read, per
  frame: `axisMax`, newest sample time, series null count, and whether the drawn
  value at a fixed x changes. Acceptance: `axisMax === newest sample time` on
  every frame; zero nulls; zero changes to an already-drawn x; the axis never
  moves between batches; no blank strip at the right edge in either rate.
- [ ] **4.4 Registers and handoff:** close/annotate `vg-753` (the transport
  decision is made; the delay half is deleted), replace STATUS.md's "Last
  completed change", keep the active-plan bullet current, and commit.

## Failure modes this plan must not produce

- An axis that still depends on `Date.now()` when any plottable sample exists.
- A `null` point in a line series, or a gap at the right edge.
- A redraw per frame (the signature must not carry a clock).
- A queue that grows without bound, or a flush that writes one frame per batch
  when several waited.
- A value family losing its 30 fps engine transition.
