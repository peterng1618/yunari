# Chart playback and label removal — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make 30 fps smooth on every chart, remove engine-drawn chart text, and make the player stop re-applying unchanged options.

**Architecture:** Value families animate through ECharts; the line is placed by a delayed render clock whose axis edge is `nowMs − playbackDelay`. The overscan canvas is deleted and history returns one predecessor sample. A shared reading signature gates `setOption` on both surfaces, and one scene-fabric helper decides animation from family and rate.

**Tech Stack:** TypeScript, ECharts 6.1.0, Fabric 7.4.0, Vitest, Playwright, Biome.

**Spec:** `docs/superpowers/specs/2026-10-25-chart-playback-and-segmented-fill-design.md` (Designs A and C)

## Global Constraints

- One active plan only (ADR-0010). Plans 2 and 3 stay queued.
- Stage explicit paths; never `git add -A` or `git commit -a`.
- Do not touch or stage `src/web/package-lock.json`.
- No chart family draws engine text after Task 1.
- No frame draws a value that was not measured; missing stays missing.
- Numeric text stays on `latest`; it is neither delayed nor interpolated.
- `renderOverscanRightMs`, `_overscanWidth` and the overscan type guard are deleted, not corrected.
- Playwright serves fixed ports; do not run the same project in two worktrees.
- Report anything not verified. Screenshots are evidence, not golden files.

## Review Focus

- A late batch leaves a blank right edge and then grows into it; it must never snap a point backwards inside the window.
- A line with no sample after the render clock still draws to the last measured sample and keeps its left predecessor.
- A value chart with an unchanged reading must not restart its transition thirty times a second.
- A chart at 1 fps must have every animation duration zeroed.
- A document carrying `showLabels` or `showCategoryLabels` must be refused with a validator issue, not silently drop text.

---

### Task 1: Remove engine-drawn chart text

**Files:**
- Modify: `src/web/packages/renderer-core/src/charts/bar.ts`
- Modify: `src/web/packages/renderer-core/src/charts/bar.test.ts`
- Modify: `src/web/packages/renderer-core/src/charts/line.ts`
- Modify: `src/web/packages/renderer-core/src/charts/line.test.ts`
- Modify: `src/web/packages/renderer-core/src/charts/pie.ts`
- Modify: `src/web/packages/renderer-core/src/charts/pie.test.ts`
- Modify: `src/web/packages/renderer-core/src/charts/settings-fields.ts`
- Modify: `src/web/packages/renderer-core/src/charts/settings-fields.test.ts`
- Modify: `src/web/packages/renderer-core/src/theme/fabric-envelope-validate.test.ts`
- Modify: `src/web/packages/editor/src/chart-manager/panel.dom.test.ts`
- Modify: `src/web/packages/editor/src/chart-manager/chart-fields.dom.test.tsx`
- Modify: `src/web/tests/e2e/author-journey-rebuild.spec.ts`
- Modify: `src/web/tests/e2e/rebuild-composition.ts`

**Interfaces:**
- Consumes: existing `BarSettings`, `PieSettings`, `LineSettings`, `CHART_SETTINGS_FIELDS`.
- Produces: `BarSettings` without `showCategoryLabels`; `PieSettings` without `showLabels`; every axis emits `axisLabel: { show: false }`; pie emits `label.show: false` and `labelLine.show: false`.

- [ ] **Step 1: Write the failing option tests**

In `bar.test.ts`, add:

```ts
it("draws axes without any engine text", () => {
  const option = buildBarOption(defaultBarSettings, [
    { sensorId: "cpu.load.total", sample: ok(50) },
  ]);

  expect(option.xAxis).toMatchObject({ show: false });
  expect(option.yAxis).toMatchObject({
    show: false,
    axisLabel: { show: false },
  });
});

it("draws the value axis but still no labels", () => {
  const option = buildBarOption(
    { ...defaultBarSettings, showAxes: true },
    [{ sensorId: "cpu.load.total", sample: ok(50) }],
  );
  const valueAxis = option.xAxis;
  expect(valueAxis).toMatchObject({ show: true, axisLabel: { show: false } });
});
```

In `line.test.ts`, add:

```ts
it("draws axes without any engine text", () => {
  const option = buildLineOption(defaultLineSettings, [], NOW);
  expect(option.xAxis.axisLabel.show).toBe(false);
  expect(option.yAxis.axisLabel.show).toBe(false);
});
```

In `pie.test.ts`, replace the existing label assertion with:

```ts
it("never draws engine text, with no setting to turn it on", () => {
  const option = buildPieOption(defaultPieSettings, []);
  expect(option.series[0].label.show).toBe(false);
  expect(option.series[0].labelLine.show).toBe(false);
  expect("showLabels" in defaultPieSettings).toBe(false);
});
```

In `settings-fields.test.ts`, remove `showCategoryLabels` from `BAR_COVERAGE`, `showLabels` from `PIE_COVERAGE`, and both from the authored-order arrays. In `fabric-envelope-validate.test.ts`, add:

```ts
it("refuses the removed label keys", () => {
  for (const [family, settings] of [
    ["bar", { showCategoryLabels: true }],
    ["pie", { showLabels: true }],
  ] as const) {
    const issues = validateFabricThemeEnvelope(
      chartEnvelope(family, settings),
    ).issues;
    expect(issues.some((issue) => issue.code === "unknown-field")).toBe(true);
  }
});
```

Use the file's existing envelope helper rather than inventing `chartEnvelope` if one exists; name the helper that builds a chart envelope in that test file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src/web && npx vitest run packages/renderer-core/src/charts/bar.test.ts packages/renderer-core/src/charts/line.test.ts packages/renderer-core/src/charts/pie.test.ts packages/renderer-core/src/charts/settings-fields.test.ts packages/renderer-core/src/theme/fabric-envelope-validate.test.ts`

Expected: the new assertions fail because the settings and label output still exist.

- [ ] **Step 3: Delete the settings and silence every label**

- `bar.ts`: remove `showCategoryLabels` from `BarSettings` and `defaultBarSettings`. Set the category axis to `show: false` and `axisLabel: { show: false }`; set the value axis `axisLabel: { show: false }`; pass `false` to `cartesianGrid` for both axes.
- `line.ts`: add `axisLabel: { show: false }` to both axis option types and both axis objects; pass `false` to `cartesianGrid`.
- `pie.ts`: remove `showLabels` from `PieSettings` and `defaultPieSettings`; emit `label: { show: false }` and `labelLine: { show: false }`.
- `settings-fields.ts`: delete the `showCategoryLabels` and `showLabels` descriptors; change both `showAxes` hints to say axes and gridlines only.
- Update `panel.dom.test.ts`, `chart-fields.dom.test.tsx`, `author-journey-rebuild.spec.ts` and `rebuild-composition.ts` to stop carrying or selecting the removed keys. If an e2e case existed only to toggle a label, delete the case.

- [ ] **Step 4: Run the focused tests**

Run: `cd src/web && npx vitest run packages/renderer-core/src/charts/bar.test.ts packages/renderer-core/src/charts/line.test.ts packages/renderer-core/src/charts/pie.test.ts packages/renderer-core/src/charts/settings-fields.test.ts packages/renderer-core/src/theme/fabric-envelope-validate.test.ts packages/editor/src/chart-manager/panel.dom.test.ts packages/editor/src/chart-manager/chart-fields.dom.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/renderer-core/src/charts/bar.ts src/web/packages/renderer-core/src/charts/bar.test.ts src/web/packages/renderer-core/src/charts/line.ts src/web/packages/renderer-core/src/charts/line.test.ts src/web/packages/renderer-core/src/charts/pie.ts src/web/packages/renderer-core/src/charts/pie.test.ts src/web/packages/renderer-core/src/charts/settings-fields.ts src/web/packages/renderer-core/src/charts/settings-fields.test.ts src/web/packages/renderer-core/src/theme/fabric-envelope-validate.test.ts src/web/packages/editor/src/chart-manager/panel.dom.test.ts src/web/packages/editor/src/chart-manager/chart-fields.dom.test.tsx src/web/tests/e2e/author-journey-rebuild.spec.ts src/web/tests/e2e/rebuild-composition.ts
git commit -m "feat(charts): draw no engine labels

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Put the line's axis edge at the delayed render clock

**Files:**
- Modify: `src/web/packages/renderer-core/src/charts/line.ts`
- Modify: `src/web/packages/renderer-core/src/charts/line.test.ts`
- Modify: `src/web/packages/renderer-core/src/charts/engine-option.ts`
- Modify: `src/web/packages/renderer-core/src/scene/plan.test.ts`
- Modify: `src/web/packages/scene-fabric/src/chart-object.ts`
- Modify: `src/web/packages/scene-fabric/src/chart-object.dom.test.ts`

**Interfaces:**
- Consumes: `linePlaybackDelayMs`, `toSeriesPoints`.
- Produces: `buildLineOption` sets `xAxis.max = nowMs − delay` and `xAxis.min = max − windowSeconds×1000`; `LineOption` has no `renderOverscanRightMs`; the chart canvas is exactly its visible backing size.

- [ ] **Step 1: Write the failing line and canvas tests**

In `line.test.ts`, replace the overscan case with:

```ts
it("ends the axis at the delayed render clock and keeps later samples", () => {
  const option = buildLineOption(
    defaultLineSettings,
    [{ sensorId: "a", samples: [at(59, 10), at(60, 20)] }],
    NOW,
    true,
    undefined,
    1_000,
  );

  expect(option.xAxis.max).toBe(NOW - 1_000);
  expect(option.xAxis.min).toBe(NOW - 1_000 - 60_000);
  expect("renderOverscanRightMs" in option).toBe(false);
  expect(option.series[0]!.data).toEqual([
    [T0 + 59_000, 10],
    [NOW, 20],
  ]);
});
```

Update the existing axis tests that expect `option.xAxis.max` to `NOW`: at 30 fps with no delay they still equal `NOW`; keep those. The delayed case is the new one.

In `chart-object.dom.test.ts`, replace the overscan test with:

```ts
it("sizes the backing canvas to the authored box", () => {
  const option = buildLineOption(
    defaultLineSettings,
    [{ sensorId: "cpu.load", samples: [sample(1, 1000), sample(2)] }],
    NOW_MS,
    false,
    undefined,
    1_000,
  );
  const chart = new YunariChart(chartOptions({ option }));
  const element = (chart as unknown as { _element: HTMLCanvasElement })
    ._element;

  expect(element.width).toBe(600);
  chart.dispose();
});
```

In `plan.test.ts`, change the delayed-line expectation to:

```ts
expect(chart.option.xAxis.max).toBe(NOW - 1_000);
expect("renderOverscanRightMs" in chart.option).toBe(false);
expect(chart.option.series[0]!.data.at(-1)).toEqual([NOW, 30]);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src/web && npx vitest run packages/renderer-core/src/charts/line.test.ts packages/renderer-core/src/scene/plan.test.ts packages/scene-fabric/src/chart-object.dom.test.ts`

Expected: the new axis and width assertions fail; the removed-key assertion fails because the key is still emitted.

- [ ] **Step 3: Implement the render clock and delete overscan**

- `line.ts`: `const renderNowMs = nowMs - linePlaybackDelayMs(chartPlaybackDelayMs); const windowStart = renderNowMs - windowMs;` set `xAxis.min = windowStart`, `xAxis.max = renderNowMs`; keep `toSeriesPoints(input.samples, settings, nowMs, windowStart)` so samples after `renderNowMs` remain and ECharts clips them. Delete `renderOverscanRightMs` from `LineOption` and from the returned object.
- `engine-option.ts`: remove the destructuring and the `LineOption` import; return `option as unknown as EChartsCoreOption`.
- `chart-object.ts`: remove `LineOption` import, `_overscanWidth`, `isOverscannedLineOption`, and `_visibleBackingWidth`; `_backingSize` returns the visible rounded size; the blit uses `element.width` as the source width.

- [ ] **Step 4: Run the focused tests**

Run: `cd src/web && npx vitest run packages/renderer-core/src/charts/line.test.ts packages/renderer-core/src/scene/plan.test.ts packages/scene-fabric/src/chart-object.dom.test.ts packages/scene-fabric/src/chart-object.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/renderer-core/src/charts/line.ts src/web/packages/renderer-core/src/charts/line.test.ts src/web/packages/renderer-core/src/charts/engine-option.ts src/web/packages/renderer-core/src/scene/plan.test.ts src/web/packages/scene-fabric/src/chart-object.ts src/web/packages/scene-fabric/src/chart-object.dom.test.ts
git commit -m "fix(charts): end the line at the delayed render clock

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Return the predecessor sample from history

**Files:**
- Modify: `src/web/packages/renderer-core/src/data/source.ts`
- Modify: `src/web/packages/renderer-core/src/data/store.ts`
- Modify: `src/web/packages/renderer-core/src/data/store.test.ts`
- Modify: `src/web/packages/fake-source/src/index.ts`
- Modify: `src/web/packages/fake-source/src/index.test.ts`
- Modify: `src/web/packages/renderer-core/src/charts/line.ts`
- Modify: `src/web/packages/renderer-core/src/scene/plan.test.ts`

**Interfaces:**
- Consumes: `SampleSource.history(key, seconds)`.
- Produces: `history` returns the trailing window plus the last sample strictly before its cutoff; `lineHistorySeconds(windowSeconds, delay)` returns `windowSeconds + delay/1000`.

- [ ] **Step 1: Write the failing history tests**

In `store.test.ts`:

```ts
it("returns the last sample before the window as a predecessor", () => {
  const store = new SampleStore();
  store.ingest(
    [
      ["a", ok(1, NOW - 61_000)],
      ["a", ok(2, NOW - 60_500)],
      ["a", ok(3, NOW - 1000)],
    ],
    NOW,
  );

  expect(store.history("a", 60).map((s) => s.value)).toEqual([2, 3]);
});

it("returns only the predecessor when the window is empty", () => {
  const store = new SampleStore();
  store.ingest([["a", ok(1, NOW - 61_000)]], NOW);
  expect(store.history("a", 60).map((s) => s.value)).toEqual([1]);
});
```

In `fake-source` tests, change the full-history count from `61` to `62`, and the zero-window count from `1` to `2`; add:

```ts
it("puts exactly one sample before the window's cutoff", () => {
  const source = new FakeSampleSource(T0, { sampleIntervalMs: 1000 });
  const history = source.history("cpu.load.total", 10);
  const cutoff = Date.parse(history.at(-1)!.timestamp) - 10_000;
  const before = history.filter((s) => Date.parse(s.timestamp) < cutoff);

  expect(before).toHaveLength(1);
});
```

In `plan.test.ts`, change `expect(windows).toEqual([defaultLineSettings.windowSeconds + 2])` to `+ 1`.

In `line.test.ts`, add a direct test for the window:

```ts
it("asks for the window plus one playback delay", () => {
  expect(lineHistorySeconds(60, 1_000)).toBe(61);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src/web && npx vitest run packages/renderer-core/src/data/store.test.ts packages/fake-source/src/index.test.ts packages/renderer-core/src/scene/plan.test.ts packages/renderer-core/src/charts/line.test.ts`

Expected: predecessor counts and `lineHistorySeconds` fail.

- [ ] **Step 3: Implement the contract**

- `source.ts`: extend the `history` doc comment with the predecessor sentence.
- `store.ts`: find the last finite-time sample with `time < start`; return `[predecessor, ...inWindow]` when one exists, otherwise the window. Preserve oldest-first order.
- `fake-source/src/index.ts`: generate from `Math.ceil(start / interval) * interval - interval` through `end` by `interval`, so exactly one sample precedes an aligned cutoff.
- `line.ts`: `lineHistorySeconds` returns `windowSeconds + delaySeconds` (one delay).
- Update any editor/player source fakes that implement the interface, keeping the predecessor rule.

- [ ] **Step 4: Run the focused tests**

Run: `cd src/web && npx vitest run packages/renderer-core/src/data/store.test.ts packages/fake-source/src/index.test.ts packages/renderer-core/src/scene/plan.test.ts packages/renderer-core/src/charts/line.test.ts packages/renderer-core/src/data/live-source.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/renderer-core/src/data/source.ts src/web/packages/renderer-core/src/data/store.ts src/web/packages/renderer-core/src/data/store.test.ts src/web/packages/fake-source/src/index.ts src/web/packages/fake-source/src/index.test.ts src/web/packages/renderer-core/src/charts/line.ts src/web/packages/renderer-core/src/scene/plan.test.ts
git commit -m "fix(charts): return the line's left-edge predecessor

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Gate re-application and choose animation by family and rate

**Files:**
- Create: `src/web/packages/renderer-core/src/charts/reading-signature.ts`
- Create: `src/web/packages/renderer-core/src/charts/reading-signature.test.ts`
- Modify: `src/web/packages/renderer-core/src/index.ts`
- Create: `src/web/packages/scene-fabric/src/chart-animation.ts`
- Create: `src/web/packages/scene-fabric/src/chart-animation.test.ts`
- Modify: `src/web/packages/scene-fabric/src/index.ts`
- Modify: `src/web/packages/editor/src/chart-manager/index.ts`
- Modify: `src/web/packages/editor/src/editor-session.ts`
- Modify: `src/web/packages/editor/src/editor-main.ts`
- Modify: `src/web/packages/player/src/main.ts`
- Modify: `src/web/packages/player/src/main.dom.test.ts`

**Interfaces:**
- Consumes: `ChartContent`, `Binding`, `SampleSource`, `lineHistorySeconds`; `ChartRefreshRate`.
- Produces:
  - `chartReadingSignature(content: ChartContent, bindings: readonly Binding[], source: SampleSource, nowMs: number): string`
  - `chartAnimationFor(family: ChartFamily, rate: ChartRefreshRate): boolean`
  - `EditorSessionOptions.chartRefreshRate?: () => ChartRefreshRate`
  - `ChartManagerOptions.refreshRate?: () => ChartRefreshRate`

- [ ] **Step 1: Write the failing shared tests**

`reading-signature.test.ts`:

```ts
const sample: Sample = {
  sensorId: "cpu.load.total",
  timestamp: "2026-01-01T00:00:01.000Z",
  status: "ok",
  value: 42,
  unit: "%",
};
const source: SampleSource = {
  latest: () => sample,
  history: () => [sample],
};

it("moves a value chart only when its reading moves", () => {
  const chart = { family: "bar", settings: defaultBarSettings } as const;
  const bindings = [{ id: "b", semanticKey: "cpu.load.total" }];

  expect(chartReadingSignature(chart, bindings, source, 1_000)).toBe(
    chartReadingSignature(chart, bindings, source, 1_500),
  );
});

it("moves a line with the render clock", () => {
  const chart = { family: "line", settings: defaultLineSettings } as const;
  const bindings = [{ id: "b", semanticKey: "cpu.load.total" }];

  expect(chartReadingSignature(chart, bindings, source, 1_000)).not.toBe(
    chartReadingSignature(chart, bindings, source, 1_500),
  );
});
```

`chart-animation.test.ts`:

```ts
it.each(["gauge", "bar", "pie"] as const)(
  "animates %s at 30 fps",
  (family) => expect(chartAnimationFor(family, 30)).toBe(true),
);
it("leaves the line clock-driven at 30 fps", () => {
  expect(chartAnimationFor("line", 30)).toBe(false);
});
it.each(["gauge", "line", "bar", "pie"] as const)(
  "zeroes %s at 1 fps",
  (family) => expect(chartAnimationFor(family, 1)).toBe(false),
);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src/web && npx vitest run packages/renderer-core/src/charts/reading-signature.test.ts packages/scene-fabric/src/chart-animation.test.ts`

Expected: modules not found.

- [ ] **Step 3: Implement the shared owners and wire both surfaces**

- `reading-signature.ts`: move the editor's family pull verbatim; for `line` use `lineHistorySeconds(content.settings.windowSeconds, source.chartPlaybackDelayMs)` and append `|now:${nowMs}`; every other family uses `latest`.
- Export it from `renderer-core/src/index.ts`.
- `chart-animation.ts`: `return rate === 30 && family !== "line";`; export from scene-fabric.
- Editor: delete `#readingSignature`; call the shared function. Add `refreshRate?: () => ChartRefreshRate` to `ChartManagerOptions`, default `() => 30`. Pass `animate: chartAnimationFor(chart.family, this.#refreshRate())` in `#applyChart`. Add `chartRefreshRate?: () => ChartRefreshRate` to `EditorSessionOptions`, pass `() => 30` when absent, and pass it to `ChartManager`. In `editor-main.ts`, pass `() => chartRefreshRate` in the session options.
- Player: track `let chartRate: ChartRefreshRate = 30;`; `refresh` passes it to `hydrateCharts`; `onRateChange` updates it before `setRate`. Add a module-level `const drawnReadings = new WeakMap<object, string>();`. In `hydrateCharts`, compute `chartReadingSignature(content, bindings, source, Date.now())` before planning; skip when equal to the chart object's stored signature; store only after `setOption` succeeds. Pass `animate: chartAnimationFor(family, rate)`.
- Update `main.dom.test.ts` only where the changed constructor shape requires it; the cadence cases stay.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `cd src/web && npx vitest run packages/renderer-core/src/charts/reading-signature.test.ts packages/scene-fabric/src/chart-animation.test.ts packages/editor/src/chart-manager/index.dom.test.ts packages/player/src/main.dom.test.ts`

Then: `cd src/web && npm run typecheck`

Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/renderer-core/src/charts/reading-signature.ts src/web/packages/renderer-core/src/charts/reading-signature.test.ts src/web/packages/renderer-core/src/index.ts src/web/packages/scene-fabric/src/chart-animation.ts src/web/packages/scene-fabric/src/chart-animation.test.ts src/web/packages/scene-fabric/src/index.ts src/web/packages/editor/src/chart-manager/index.ts src/web/packages/editor/src/editor-session.ts src/web/packages/editor/src/editor-main.ts src/web/packages/player/src/main.ts src/web/packages/player/src/main.dom.test.ts
git commit -m "feat(charts): animate value families and gate unchanged options

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Plan gate and local main checkpoint

**Files:**
- Modify: `STATUS.md`
- Modify: `docs/superpowers/plans/2026-10-25-chart-playback-and-animation.md` (tick this task only)

**Interfaces:**
- Consumes: every task above.
- Produces: a green gate, a local `main` merge and a stop for owner testing.

- [x] **Step 1: Run the line-edge browser case**

Run: `cd src/web && npx playwright test tests/e2e/live-chart-edge.spec.ts --workers=1`

Expected: PASS. The case must show the newest point at or right of the delayed edge, never inside it, and the chart rect must not move. If the port is owned by another run, wait or use a separate worktree; do not change `strictPort`.

- [x] **Step 2: Run the full gate**

Run: `cd src/web && npm run gate`

Expected: exit 0. If it fails, fix the failure in this plan; do not proceed to the merge.

- [x] **Step 3: Run the status check**

Run: `cd src/web && npm run status:check`

Expected: exit 0.

- [x] **Step 4: Replace STATUS.md's completed-change summary**

Keep only: current objective (this plan), active work, 1–5 bullets for the last completed change, next steps, blockers. One item per line, never wrapped. Name the plan and the merge checkpoint.

- [x] **Step 5: Commit the status update**

```bash
git add STATUS.md docs/superpowers/plans/2026-10-25-chart-playback-and-animation.md
git commit -m "docs(status): record the playback checkpoint

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [x] **Step 6: Merge locally into main and stop**

From the checkout that has `main` checked out (find it with `git worktree list`):

```bash
git -C <main-worktree> merge --no-ff peterng1618/improve-charts
```

Do not push. Confirm the merge commit's first parent is local `main`. Then stop and report the merge sha, the gate exit code, and the phone test steps for the owner. Do not start Plan 2 until the owner confirms this checkpoint.
