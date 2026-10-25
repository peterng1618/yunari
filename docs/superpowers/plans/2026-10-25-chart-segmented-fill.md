# Segmented chart fill — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a discrete `segmentDivisor` setting to bar, gauge and pie, and render each fill as equal segments with a 20% gap.

**Architecture:** One `charts/segments.ts` owns the allowed divisors, segment count and gap ratio. Gauge uses native `axisLine` colour bands, pie splits data items with transparent spacer items, and bar uses a `custom` series so it can honour authored corner radius and per-band paint. `100` keeps every existing option path unchanged.

**Tech Stack:** TypeScript, ECharts 6.1.0, Base UI slider, Vitest, Playwright, Biome.

**Spec:** `docs/superpowers/specs/2026-10-25-chart-playback-and-segmented-fill-design.md` (Design B)

## Global Constraints

- One active plan only. This plan starts only after Plan 1's local-`main` checkpoint is accepted.
- Stage explicit paths; never `git add -A` or `git commit -a`.
- Do not touch or stage `src/web/package-lock.json`.
- Allowed divisors, ascending: `1, 2, 4, 5, 10, 20, 25, 50, 100`. `100` is the default and must reproduce the continuous option exactly.
- Segment count is `100 / segmentDivisor`; the gap is 20% of each segment.
- No missing value becomes zero; a paint that resolves to nothing draws no fill (0007).
- Bar keeps a partial final band; gauge quantises to whole bands; pie subsegments are whole.
- Engine labels stay off (Plan 1); no segmented path draws text.
- Screenshots are evidence, not golden files.

## Review Focus

- Divisor `0`, a non-member, or a string must be refused, never divided by.
- `segmentDivisor: 100` must byte-for-byte preserve the option each builder emits today.
- A missing reading must leave the track and draw no filled segment.
- A rounded-end bar must clamp the radius on the partial final band, not spill outside its band.
- A pie with spacer items must preserve every slice's share of the remaining visible ring.

---

### Task 1: Own the segment model and the discrete slider

**Files:**
- Create: `src/web/packages/renderer-core/src/charts/segments.ts`
- Create: `src/web/packages/renderer-core/src/charts/segments.test.ts`
- Modify: `src/web/packages/renderer-core/src/types.ts`
- Modify: `src/web/packages/renderer-core/src/charts/bar.ts`
- Modify: `src/web/packages/renderer-core/src/charts/pie.ts`
- Modify: `src/web/packages/renderer-core/src/charts/settings-fields.ts`
- Modify: `src/web/packages/renderer-core/src/charts/settings-fields.test.ts`
- Modify: `src/web/packages/renderer-core/src/theme/fabric-envelope-validate.ts`
- Modify: `src/web/packages/renderer-core/src/theme/fabric-envelope-validate.test.ts`
- Modify: `src/web/packages/renderer-core/src/index.ts`
- Modify: `src/web/packages/editor/src/chart-manager/chart-fields.tsx`
- Modify: `src/web/packages/editor/src/chart-manager/panel.ts`
- Modify: `src/web/packages/editor/src/chart-manager/panel.dom.test.ts`
- Modify: `src/web/packages/editor/src/components/ui/control-number.tsx`
- Modify: `src/web/packages/editor/src/components/ui/control-slider.tsx`
- Modify: `src/web/packages/editor/src/components/ui/control.dom.test.tsx`
- Modify: `src/web/packages/editor/src/ui-copy.ts`

**Interfaces:**
- Produces:
  - `SEGMENT_DIVISORS: readonly [1, 2, 4, 5, 10, 20, 25, 50, 100]`
  - `SEGMENT_GAP_RATIO = 0.2`
  - `segmentCount(divisor: number): number` — `100 / divisor` for a member, `1` otherwise.
  - `segmentDivisorOf(settings: { segmentDivisor?: number }): number` — the member or `100`.
  - `SettingsFieldDescriptor.values?: readonly number[]`
  - `ControlSlider` prop `values?: readonly number[]`
  - `ControlNumber` prop `oneOf?: readonly number[]`

- [ ] **Step 1: Write the failing model tests**

`segments.test.ts`:

```ts
it("maps the allowed divisors to whole segment counts", () => {
  expect(SEGMENT_DIVISORS.map(segmentCount)).toEqual([
    100, 50, 25, 20, 10, 5, 4, 2, 1,
  ]);
});

it("treats 100 and an unknown divisor as continuous", () => {
  expect(segmentCount(100)).toBe(1);
  expect(segmentCount(33)).toBe(1);
});

it("reads a missing setting as 100", () => {
  expect(segmentDivisorOf({})).toBe(100);
  expect(segmentDivisorOf({ segmentDivisor: 10 })).toBe(10);
});
```

In `settings-fields.test.ts`, add `segmentDivisor` to the coverage maps for gauge, bar and pie, and to their authored-order arrays where its position is fixed. Add:

```ts
it("declares the discrete divisors on all three segmented families", () => {
  for (const family of ["gauge", "bar", "pie"] as const) {
    expect(
      settingsFieldsFor(family).find((f) => f.property === "segmentDivisor"),
    ).toMatchObject({ kind: "number", values: SEGMENT_DIVISORS });
  }
});
```

In `fabric-envelope-validate.test.ts`:

```ts
it("refuses a segment divisor that is not an allowed value", () => {
  const issues = validateFabricThemeEnvelope(
    envelopeWithChart("bar", { segmentDivisor: 33 }),
  ).issues;
  expect(issues.some((issue) => issue.code === "out-of-range")).toBe(true);
});
```

Use the file's existing chart-envelope helper name.

In `control.dom.test.tsx`, add a slider case:

```tsx
it("writes the divisor, while its track moves over indices", () => {
  const commits: number[] = [];
  render(
    <ControlSlider
      label="Segments"
      value={100}
      min={1}
      max={100}
      values={[1, 2, 4, 5, 10, 20, 25, 50, 100]}
      onCommit={(value) => commits.push(value)}
    />,
  );
  const track = screen.getByRole("slider");
  expect(track).toHaveAttribute("aria-valuetext", "100");
  fireEvent.keyDown(track, { key: "ArrowLeft" });
  expect(commits).toEqual([50]);
});
```

Use the file's existing render/import helpers.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src/web && npx vitest run packages/renderer-core/src/charts/segments.test.ts packages/renderer-core/src/charts/settings-fields.test.ts packages/renderer-core/src/theme/fabric-envelope-validate.test.ts packages/editor/src/components/ui/control.dom.test.tsx`

Expected: `segments.ts` missing; descriptor and slider props missing.

- [ ] **Step 3: Implement the model and control**

- `segments.ts`: the constants and functions above; no ECharts import.
- Add `segmentDivisor: number` to `GaugeSettings`, `BarSettings`, `PieSettings`, defaults `100`.
- `settings-fields.ts`: add `readonly values?: readonly number[]` to `SettingsFieldDescriptor`; add one `segmentDivisor` descriptor per family in the order its settings interface declares it, with `values: SEGMENT_DIVISORS`, `min: 1`, `max: 100`.
- `fabric-envelope-validate.ts` `chartScalars`: after the range checks, refuse a present number not in `descriptor.values` with `out-of-range`.
- `panel.ts` `settingRows`: when `field.values` exists, emit a `slider` row with `values`, `min`/`max` from the list ends, the authored/default divisor as `value`, and `clearable: false`. Add `values?: readonly number[]` to the slider arm of `ChartSettingView`.
- `chart-fields.tsx`: pass `row.values` into `ControlSlider`.
- `ControlSlider`: when `values` is present, the track runs `0..values.length-1` with step 1 and integer input; every track value maps back through `values` for preview and commit; `aria-valuetext` is the divisor; the well shows the divisor and passes `oneOf={values}`.
- `ControlNumber`: add `oneOf`; after the bounds checks, refuse a value not in the list with a new `uiCopy.controls.oneOf(values)` sentence.
- Export the segment constants from `renderer-core/src/index.ts`.

- [ ] **Step 4: Run the focused tests**

Run: `cd src/web && npx vitest run packages/renderer-core/src/charts/segments.test.ts packages/renderer-core/src/charts/settings-fields.test.ts packages/renderer-core/src/theme/fabric-envelope-validate.test.ts packages/editor/src/components/ui/control.dom.test.tsx packages/editor/src/chart-manager/panel.dom.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/renderer-core/src/charts/segments.ts src/web/packages/renderer-core/src/charts/segments.test.ts src/web/packages/renderer-core/src/types.ts src/web/packages/renderer-core/src/charts/bar.ts src/web/packages/renderer-core/src/charts/pie.ts src/web/packages/renderer-core/src/charts/settings-fields.ts src/web/packages/renderer-core/src/charts/settings-fields.test.ts src/web/packages/renderer-core/src/theme/fabric-envelope-validate.ts src/web/packages/renderer-core/src/theme/fabric-envelope-validate.test.ts src/web/packages/renderer-core/src/index.ts src/web/packages/editor/src/chart-manager/chart-fields.tsx src/web/packages/editor/src/chart-manager/panel.ts src/web/packages/editor/src/chart-manager/panel.dom.test.ts src/web/packages/editor/src/components/ui/control-number.tsx src/web/packages/editor/src/components/ui/control-slider.tsx src/web/packages/editor/src/components/ui/control.dom.test.tsx src/web/packages/editor/src/ui-copy.ts
git commit -m "feat(charts): add the segment divisor and its slider

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Segmented gauge through native colour bands

**Files:**
- Modify: `src/web/packages/renderer-core/src/charts/gauge.ts`
- Modify: `src/web/packages/renderer-core/src/charts/gauge.test.ts`

**Interfaces:**
- Consumes: `segmentCount`, `segmentDivisorOf`, `SEGMENT_GAP_RATIO`, `colorAt`, `resolveFlatColor`.
- Produces: `buildGaugeOption` returns a segmented `axisLine.lineStyle.color` array and `progress.show: false` when `segmentDivisor !== 100`.

- [ ] **Step 1: Write the failing gauge tests**

```ts
it("splits the ring into equal bands with transparent gaps", () => {
  const option = buildGaugeOption(
    { ...defaultGaugeSettings, segmentDivisor: 10 },
    ok(55),
  );
  const colors = option.series[0].axisLine.lineStyle.color;

  // 10 bands: each visible band followed by a gap, except the last band's end.
  expect(colors).toHaveLength(19);
  expect(colors[0]![0]).toBeCloseTo(0.08);
  expect(colors[1]).toEqual([0.1, "transparent"]);
  expect(option.series[0].progress.show).toBe(false);
});

it("fills bands the reading reaches and tracks the rest", () => {
  const option = buildGaugeOption(
    {
      ...defaultGaugeSettings,
      segmentDivisor: 10,
      track: { kind: "solid", color: "#222222" },
      progress: { kind: "solid", color: "#00b8d9" },
    },
    ok(55),
  );
  const colors = option.series[0].axisLine.lineStyle.color;
  const solid = colors.filter(([, color]) => color !== "transparent");
  expect(solid.slice(0, 5).every(([, color]) => color === "#00b8d9")).toBe(true);
  expect(solid.slice(5).every(([, color]) => color === "#222222")).toBe(true);
});

it("leaves a missing sample entirely in track paint", () => {
  const option = buildGaugeOption(
    { ...defaultGaugeSettings, segmentDivisor: 10 },
    undefined,
  );
  const solid = option.series[0].axisLine.lineStyle.color.filter(
    ([, color]) => color !== "transparent",
  );
  expect(new Set(solid.map(([, color]) => color)).size).toBe(1);
});

it("keeps the continuous option at 100", () => {
  const option = buildGaugeOption(defaultGaugeSettings, ok(55));
  expect(option.series[0].progress.show).toBe(true);
  expect(option.series[0].axisLine.lineStyle.color).toEqual([
    [1, "#2a2f3a"],
  ]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src/web && npx vitest run packages/renderer-core/src/charts/gauge.test.ts`

Expected: segmented assertions fail.

- [ ] **Step 3: Implement the gauge branch**

When `segmentCount(segmentDivisorOf(settings)) === 1`, return the current option unchanged. Otherwise:

- Build `N` bands; each visible band ends at `(i + 1 - SEGMENT_GAP_RATIO) / N`; push a transparent entry at `(i + 1) / N` except after the last.
- A band is progress paint when its **end** is at or below `normalizePosition(displayValue, min, max)` and a sample is plottable; otherwise track paint.
- Gradient paint samples `colorAt(stops, band midpoint)`; threshold progress paint stays flat at the reading; threshold track paint takes its top band.
- If `progress` resolves to nothing, every band is track paint.
- Emit `axisLine.lineStyle.color` as the band list; `progress.show: false`; `data: []`; keep `roundCap`, animation and every other field.
- `gradientSegments` is not used by the segmented branch.

- [ ] **Step 4: Run the focused tests**

Run: `cd src/web && npx vitest run packages/renderer-core/src/charts/gauge.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/renderer-core/src/charts/gauge.ts src/web/packages/renderer-core/src/charts/gauge.test.ts
git commit -m "feat(charts): segment the gauge with native colour bands

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Segmented pie through data-item splitting

**Files:**
- Modify: `src/web/packages/renderer-core/src/charts/pie.ts`
- Modify: `src/web/packages/renderer-core/src/charts/pie.test.ts`

**Interfaces:**
- Consumes: `segmentCount`, `segmentDivisorOf`, `SEGMENT_GAP_RATIO`.
- Produces: `toSegmentedPieData(items: readonly PieDataItem[], count: number, padAngle: number): PieDataItem[]`; segmented series `padAngle: 0`.

- [ ] **Step 1: Write the failing pie tests**

```ts
it("splits every slice into equal real items with spacers between", () => {
  const items = toSegmentedPieData(
    [
      { name: "cpu", value: 50, itemStyle: { color: "#0f0", borderRadius: 4 } },
      { name: "gpu", value: 50, itemStyle: { color: "#00f", borderRadius: 4 } },
    ],
    2,
    0,
  );
  expect(items.filter((item) => item.name === "cpu")).toHaveLength(2);
  expect(items.filter((item) => item.name === "gpu")).toHaveLength(2);
  // One internal gap per slice plus one slice-boundary gap per slice.
  expect(items.filter((item) => item.name === "")).toHaveLength(4);
});

it("keeps the visible shares equal", () => {
  const items = toSegmentedPieData(
    [
      { name: "a", value: 75, itemStyle: { color: "#0f0", borderRadius: 4 } },
      { name: "b", value: 25, itemStyle: { color: "#00f", borderRadius: 4 } },
    ],
    4,
    2,
  );
  const real = items.filter((item) => item.name !== "");
  const a = real.filter((item) => item.name === "a");
  const b = real.filter((item) => item.name === "b");
  expect(a.reduce((sum, item) => sum + item.value, 0) /
    b.reduce((sum, item) => sum + item.value, 0)).toBeCloseTo(3);
});

it("emits no labels and a zero series pad for the segmented path", () => {
  const option = buildPieOption(
    { ...defaultPieSettings, segmentDivisor: 10 },
    [{ sensorId: "cpu.load.total", sample: ok(50) }],
  );
  expect(option.series[0].padAngle).toBe(0);
  expect(option.series[0].label.show).toBe(false);
  expect(option.series[0].labelLine.show).toBe(false);
});

it("keeps the continuous data at 100", () => {
  const option = buildPieOption(defaultPieSettings, [
    { sensorId: "cpu.load.total", sample: ok(50) },
  ]);
  expect(option.series[0].padAngle).toBe(defaultPieSettings.padAngle);
  expect(option.series[0].data).toHaveLength(1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src/web && npx vitest run packages/renderer-core/src/charts/pie.test.ts`

Expected: `toSegmentedPieData` missing; segmented option still continuous.

- [ ] **Step 3: Implement the split and spacer construction**

- Compute `N = count`, `G = SEGMENT_GAP_RATIO × (N - 1) / N`, `k = 1 + G`; `S` is the sum of item values.
- Boundary gap value: `denominator = 1 - (items.length × padAngle) / 360`; when `denominator > 0`, `boundary = ((k × S) / denominator) × padAngle / 360`; otherwise `0`.
- For each item: `real = k × item.value / N`; push `N` real items with the same name, colour and `borderRadius`; between them push spacers of `SEGMENT_GAP_RATIO × real`; after the last real push one boundary spacer.
- Spacers: `name: ""`, `itemStyle: { color: NO_INK, borderRadius: 0 }`.
- Segmented path: `padAngle: 0`; data is the segmented list; keep start/end angles, radius, `silent`, labels off.
- `100` returns the current data and authored `padAngle` unchanged.

- [ ] **Step 4: Run the focused tests**

Run: `cd src/web && npx vitest run packages/renderer-core/src/charts/pie.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/renderer-core/src/charts/pie.ts src/web/packages/renderer-core/src/charts/pie.test.ts
git commit -m "feat(charts): segment the pie with spacer data items

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Segmented bar through a custom series

**Files:**
- Modify: `src/web/packages/renderer-core/src/charts/bar.ts`
- Modify: `src/web/packages/renderer-core/src/charts/bar.test.ts`
- Modify: `src/web/packages/renderer-core/src/charts/engine-option.ts`

**Interfaces:**
- Consumes: `segmentCount`, `segmentDivisorOf`, `SEGMENT_GAP_RATIO`, `colorAt`, `resolveChartPaint`.
- Produces: `BarOption` becomes `ContinuousBarOption | SegmentedBarOption`; segmented series is `type: "custom"`, `coordinateSystem: "cartesian2d"`, with a `renderItem` that draws track and filled rects per band.

- [ ] **Step 1: Write the failing bar tests**

```ts
it("draws N bands with a 20% gap and a partial final band", () => {
  const option = buildBarOption(
    {
      ...defaultBarSettings,
      segmentDivisor: 10,
      min: 0,
      max: 100,
      track: { kind: "solid", color: "#222" },
      fill: { kind: "solid", color: "#0f0" },
    },
    [{ sensorId: "a", sample: ok(55) }],
    true,
  );
  expect(option.series[0].type).toBe("custom");
  const rendered = collectRects(option, { width: 100, height: 20 });
  // Ten track bands, five full fills, one half-filled band: 8px visible × 50%.
  expect(rendered.track).toHaveLength(10);
  expect(rendered.fill).toHaveLength(6);
  expect(rendered.fill.at(-1)!.width).toBeCloseTo(4, 5);
});

it("draws no fill for a missing sample but keeps the track", () => {
  const option = buildBarOption(
    { ...defaultBarSettings, segmentDivisor: 10 },
    [{ sensorId: "a", sample: undefined }],
  );
  const rendered = collectRects(option, { width: 100, height: 20 });
  expect(rendered.fill).toHaveLength(0);
  expect(rendered.track).toHaveLength(10);
});

it("keeps the continuous series at 100", () => {
  const option = buildBarOption(defaultBarSettings, [
    { sensorId: "a", sample: ok(55) },
  ]);
  expect(option.series[0].type).toBe("bar");
});
```

Add a `collectRects` test helper that calls the custom `renderItem` with a fake `params`/`api` whose `coord` maps value/category to pixels and whose `size` returns the category band. Keep it local to the test file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src/web && npx vitest run packages/renderer-core/src/charts/bar.test.ts`

Expected: segmented cases receive a `bar` series.

- [ ] **Step 3: Implement the custom series**

- When `segmentCount` is `1`, return the current option unchanged.
- Add `buildSegmentedBarOption(settings, inputs, animate, palette)` returning grid/axes with labels off and one `custom` series.
- The custom series data is one `[categoryIndex, value | null]` per binding; `renderItem` returns a group of rects.
- Geometry: map `min` and `max` to pixels along the value axis; `band = api.size([0, 1])[1]` for horizontal and `api.size([1, 0])[0]` for vertical; `thickness = settings.barWidth ?? band × (1 − categoryGapPercent/100)`; centre the rect in the band.
- Each band is `range / N` long; its visible part is `80%`; the last filled band is partial by the reading's fraction.
- Track rects are drawn for every band when `track` resolves; fill rects over them. Corner radius is `cornerRadius` clamped by ECharts to the rect; a partial band's rect is shortened, not stretched.
- Paint: solid and threshold resolve flat at the reading; gradient samples `colorAt(stops, band midpoint)`; unresolved fill draws no fill.
- Stable rect order every frame; return `transition: "shape"` on the filled rects so the extent moves. Set `silent: true`, `clip: true`.
- `engine-option.ts`: type `BarOption` as the union of continuous and segmented shapes; no new cast.

- [ ] **Step 4: Run the focused tests**

Run: `cd src/web && npx vitest run packages/renderer-core/src/charts/bar.test.ts packages/renderer-core/src/charts/engine-option.test.ts`

Expected: PASS. If no `engine-option.test.ts` exists, run `npm run typecheck` instead for that second half.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/renderer-core/src/charts/bar.ts src/web/packages/renderer-core/src/charts/bar.test.ts src/web/packages/renderer-core/src/charts/engine-option.ts
git commit -m "feat(charts): segment the bar with a custom series

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Plan gate, browser evidence and local main checkpoint

**Files:**
- Modify: `STATUS.md`
- Modify: `docs/superpowers/plans/2026-10-25-chart-segmented-fill.md` (tick this task only)
- Modify: `src/web/tests/e2e/inspector-sections.spec.ts`

**Interfaces:**
- Consumes: every task above.
- Produces: rendered evidence at divisors `100, 50, 10, 2, 1`, a green gate and a local `main` merge.

- [ ] **Step 1: Add the browser case**

In `inspector-sections.spec.ts`, add one case that inserts a bar, gauge and pie, binds one reading, sets `data-yunari-chart-setting="segmentDivisor"` to each of `100, 50, 10, 2, 1`, and captures a screenshot per divisor. Assert the canvas changed between `100` and `10` for each family; restore the divisor and assert the continuous option has no custom series. Register the new capture in `docs/evidence/screenshots/README.md` only if the repository's capture registry requires it.

- [ ] **Step 2: Run the focused browser case**

Run: `cd src/web && npx playwright test tests/e2e/inspector-sections.spec.ts --grep "segmented fill" --workers=1`

Expected: PASS. If the port is owned by another run, wait or run in a separate worktree; do not change `strictPort`.

- [ ] **Step 3: Run the full gate**

Run: `cd src/web && npm run gate`

Expected: exit 0. Fix failures in this plan before merging.

- [ ] **Step 4: Update STATUS.md and commit**

Replace the completed-change section with 1–5 bullets for this plan: the divisor, the slider, and the three segmented paths. Keep one item per line. Then:

```bash
git add STATUS.md docs/superpowers/plans/2026-10-25-chart-segmented-fill.md
git commit -m "docs(status): record the segmented-fill checkpoint

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Merge locally into main and stop**

From the checkout that has `main` checked out:

```bash
git -C <main-worktree> merge --no-ff peterng1618/improve-charts
```

Do not push. Report the merge sha, the gate exit code, the screenshot paths, and the owner's test steps: open the editor, insert each family, and drag the divisor from 100 to 1. Do not start Plan 3 until the owner confirms.
