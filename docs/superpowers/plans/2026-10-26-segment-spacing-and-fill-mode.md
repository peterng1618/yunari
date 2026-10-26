# Segment spacing and fill mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the slot-relative segment gap with an authored share of the chart's drawn size, clear round caps automatically, and let the gauge and bar choose whole-band or partial last-band fill.

**Architecture:** One helper owns the spacing arithmetic (`charts/segments.ts`); each adapter converts the chart share into its own axis (angle for gauge and pie, pixels for the bar's custom `renderItem`). `ChartPlanContext` carries the chart's drawn edge so gauge and pie can convert a pixel clearance to an angle; the bar reads its own size from the custom-series API. Two new optional settings (`segmentSpacingPercent`, `segmentFill`) make absent mean the family's current behaviour.

**Tech Stack:** TypeScript, ECharts 6.1.0, Vitest, Playwright, React 19 editor controls.

**Spec:** `docs/superpowers/specs/2026-10-26-segment-spacing-and-fill-mode-design.md` (Design B6–B9), which extends `docs/superpowers/specs/2026-10-25-chart-playback-and-segmented-fill-design.md` (Design B).

## Global Constraints

- `renderer-core` stays Fabric/DOM-free. `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are on; absent is absent, never a coerced zero.
- `SEGMENT_GAP_RATIO` is replaced for gauge and bar; the pie keeps its spacer construction but its target angle comes from the same spacing share.
- Rounded ends are never silently disabled; the clearance widens the gap instead.
- Absent `segmentFill` means gauge `"whole"`, bar `"partial"`; absent `segmentSpacingPercent` means the family default.
- Charts under `src/web/packages/renderer-core/src/charts/` are a mechanism boundary: `docs/decisions/0120-<slug>.md` must land before the first write there.
- Every new test is watched fail before its implementation exists.

## Review Focus

- A gauge at half the drawn size keeps its gap: the cap-clearance term must win over the spacing term there.
- `segmentSpacingPercent: 0` draws bands touching without consuming a neighbour's slot.
- A gauge with `segmentFill: "partial"` stops its fill at the reading; a bar with `"whole"` lights only whole bands.
- A document carrying neither new key draws exactly as it does today.
- A pie's slice shares stay exact when the spacing changes.

---

### Task 1: Settings, defaults and the editor's percentage track

**Files:**
- Create: `docs/decisions/0120-segment-spacing-is-a-share-of-the-chart.md`
- Modify: `src/web/packages/renderer-core/src/charts/segments.ts`
- Modify: `src/web/packages/renderer-core/src/charts/gauge.ts` (`GaugeSettings`, `defaultGaugeSettings`)
- Modify: `src/web/packages/renderer-core/src/charts/bar.ts` (`BarSettings`, `defaultBarSettings`)
- Modify: `src/web/packages/renderer-core/src/charts/pie.ts` (`PieSettings`, `defaultPieSettings`)
- Modify: `src/web/packages/renderer-core/src/charts/settings-fields.ts`
- Modify: `src/web/packages/editor/src/chart-manager/chart-fields.ts` and `chart-fields.tsx`
- Modify: `src/web/packages/editor/src/chart-manager/panel.ts`
- Test: `src/web/packages/renderer-core/src/charts/segments.test.ts`, `settings-fields.test.ts`, `src/web/packages/renderer-core/src/theme/fabric-envelope-validate.test.ts`, `gauge.test.ts`, `bar.test.ts`, `pie.test.ts`, `src/web/packages/editor/src/chart-manager/panel.dom.test.ts`, `chart-fields.dom.test.tsx`

**Interfaces:**
- Produces: `SEGMENT_SPACING_PERCENT_DEFAULT = 2.5`; `segmentSpacingPercentOf(settings: { readonly segmentSpacingPercent?: number }): number`; `segmentFillOf(settings: { readonly segmentFill?: "whole" | "partial" }, fallback: "whole" | "partial"): "whole" | "partial"`.
- Produces: `GaugeSettings.segmentSpacingPercent?: number`, `GaugeSettings.segmentFill?: "whole" | "partial"`; the same two optional keys on `BarSettings`; `PieSettings.segmentSpacingPercent?: number`.
- Produces: each `default*Settings` carries `segmentSpacingPercent: 2.5`; gauge carries `segmentFill: "whole"`, bar `"partial"`.
- Produces: `ChartSettingView` gains `readonly decimals?: number` and `readonly suffix?: string`, rendered by `chart-fields.tsx`'s slider well and `aria-valuetext`.

- [ ] **Step 1: Write the decision note**

Create `docs/decisions/0120-segment-spacing-is-a-share-of-the-chart.md` with the problem (slot-relative gap shrinks with count; `roundCap` clearance is in pixels), the ruling (spacing is a share of the smaller drawn edge; clearance = `thickness / radius`, clamped to 45% of a slot), the rejected alternatives (share-of-slot, thickness multiples), and the searches performed for each. Follow `docs/decisions/README.md`'s template.

- [ ] **Step 2: Write the failing setting tests**

In `segments.test.ts`:

```ts
it("reads an absent spacing as the family default", () => {
  expect(segmentSpacingPercentOf({})).toBe(SEGMENT_SPACING_PERCENT_DEFAULT);
  expect(segmentSpacingPercentOf({ segmentSpacingPercent: 0 })).toBe(0);
});

it("reads an absent fill mode as the family's own", () => {
  expect(segmentFillOf({}, "whole")).toBe("whole");
  expect(segmentFillOf({}, "partial")).toBe("partial");
  expect(segmentFillOf({ segmentFill: "whole" }, "partial")).toBe("whole");
});
```

In `settings-fields.test.ts`, extend the coverage maps and expected authored orders with `segmentSpacingPercent` for all three families and `segmentFill` for gauge and bar; assert the spacing descriptor is `{ kind: "number", min: 0, max: 20 }` and the fill descriptor is a select with the two options and `visibleWhen` matching `segmentDivisor !== 100`.

In `panel.dom.test.ts` and `chart-fields.dom.test.tsx`, assert a bare gauge's spacing row is `{ control: "slider", value: 2.5, min: 0, max: 20 }`, and that its well reads `2.5%` with `aria-valuetext` `2.5%`.

In `fabric-envelope-validate.test.ts`, assert the envelope refuses `segmentSpacingPercent: 30` at `path: "/scene/objects/0/settings/segmentSpacingPercent"` and refuses `segmentFill: "half"` at its select path, accepting `"partial"`.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd src/web && npx vitest run packages/renderer-core/src/charts/segments.test.ts packages/renderer-core/src/charts/settings-fields.test.ts packages/renderer-core/src/theme/fabric-envelope-validate.test.ts packages/editor/src/chart-manager/panel.dom.test.ts packages/editor/src/chart-manager/chart-fields.dom.test.tsx`
Expected: FAIL — `segmentSpacingPercentOf` is not exported, the descriptors are absent.

- [ ] **Step 4: Implement the settings surface**

Add the two helpers to `segments.ts` with the doc comment explaining that spacing is a share of the drawn edge while the old ratio was a share of the slot. Add the optional keys and defaults to the three settings types. Add the descriptors to `settings-fields.ts` (spacing: label "Segment spacing", hint "How much of the chart's smaller edge is left empty between slices."; fill: label "Fill", options `Whole segment` / `Partial segment`, `visibleWhen` `segmentDivisor !== 100`). Add `decimals`/`suffix` to `ChartSettingView`, project `decimals: 1, suffix: "%"` for `segmentSpacingPercent` in `panel.ts`, and format the well and `aria-valuetext` in `chart-fields.tsx` when present.

- [ ] **Step 5: Run the focused tests**

Run: `cd src/web && npx vitest run packages/renderer-core/src/charts/segments.test.ts packages/renderer-core/src/charts/settings-fields.test.ts packages/renderer-core/src/theme/fabric-envelope-validate.test.ts packages/editor/src/chart-manager/panel.dom.test.ts packages/editor/src/chart-manager/chart-fields.dom.test.tsx && npx tsc -p packages/renderer-core && npx biome check packages/renderer-core/src/charts packages/renderer-core/src/theme packages/editor/src/chart-manager`
Expected: PASS, both commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add docs/decisions/0120-segment-spacing-is-a-share-of-the-chart.md STATUS.md src/web/packages/renderer-core/src/charts/segments.ts src/web/packages/renderer-core/src/charts/gauge.ts src/web/packages/renderer-core/src/charts/bar.ts src/web/packages/renderer-core/src/charts/pie.ts src/web/packages/renderer-core/src/charts/settings-fields.ts src/web/packages/renderer-core/src/charts/settings-fields.test.ts src/web/packages/renderer-core/src/charts/segments.test.ts src/web/packages/renderer-core/src/theme/fabric-envelope-validate.test.ts src/web/packages/editor/src/chart-manager/panel.ts src/web/packages/editor/src/chart-manager/chart-fields.ts src/web/packages/editor/src/chart-manager/chart-fields.tsx src/web/packages/editor/src/chart-manager/panel.dom.test.ts src/web/packages/editor/src/chart-manager/chart-fields.dom.test.tsx
git commit -m "feat(charts): author segment spacing as a share of the chart"
```

---

### Task 2: Gauge spacing and fill mode

**Files:**
- Modify: `src/web/packages/renderer-core/src/charts/segments.ts` (gap helpers)
- Modify: `src/web/packages/renderer-core/src/charts/gauge.ts`
- Modify: `src/web/packages/renderer-core/src/scene/plan.ts` (`ChartPlanContext.drawnEdge`, gauge call)
- Modify: `src/web/packages/editor/src/chart-manager/index.ts` (pass the drawn edge)
- Modify: `src/web/packages/player/src/main.ts` (pass the drawn edge)
- Test: `src/web/packages/renderer-core/src/charts/segments.test.ts`, `gauge.test.ts`, `src/web/packages/renderer-core/src/scene/plan.test.ts`

**Interfaces:**
- Consumes: `segmentSpacingPercentOf`, `segmentFillOf` from Task 1.
- Produces: `gaugeGap(settings: GaugeSettings, sweepDegrees: number, count: number, drawnEdge: number | undefined): number` returning the gap in degrees, clamped to `0.45 * bandSweep`; an absent edge skips the clearance term.
- Produces: `ChartPlanContext.drawnEdge?: number`; `buildGaugeOption(settings, sample, animate?, palette?, drawnEdge?)`.
- Produces: in `partial` mode the gauge's `axisLine.lineStyle.color` carries a boundary at the reading's position with progress paint after it; in `whole` mode the existing `reaches` test is unchanged.

- [ ] **Step 1: Write the failing gauge tests**

In `gauge.test.ts`, with a 360° sweep, `min: 0`, `max: 100`, 20 segments (divisor 5), `thickness` 12:

```ts
it("keeps the gap a share of the chart as the count rises", () => {
  const five = gapDegrees(gaugeOption({ segmentDivisor: 20 }), 5);
  const fifty = gapDegrees(gaugeOption({ segmentDivisor: 2 }), 50);
  expect(fifty).toBeCloseTo(five, 5);
});

it("widens the gap to clear round caps on a small chart", () => {
  const large = gapDegrees(gaugeOption({ segmentDivisor: 5, thickness: 12 }, 800), 20);
  const small = gapDegrees(gaugeOption({ segmentDivisor: 5, thickness: 12 }, 200), 20);
  expect(small).toBeGreaterThan(large);
});

it("never takes more than 45% of a band", () => {
  const gap = gapDegrees(gaugeOption({ segmentDivisor: 1, thickness: 80 }), 100);
  expect(gap).toBeLessThanOrEqual(0.45 * 3.6);
});

it("draws touching bands at zero spacing when no chart size is known", () => {
  const bands = colorBands(
    gaugeOption({ segmentDivisor: 20, segmentSpacingPercent: 0 }),
    5,
  );
  expect(bands.some(([, color]) => color === "transparent")).toBe(false);
});

it("stops a partial fill at the reading", () => {
  // 25% of a 4-segment ring: bands 1 and 2 whole, band 3 quarter filled.
  const bands = colorBands(gaugeOption({ segmentDivisor: 25, segmentFill: "partial", max: 100 }), 25);
  expect(bands.at(-1)?.[1]).toBe(progressColor);
});

it("quantises a whole fill to the band the reading reaches", () => {
  const bands = colorBands(gaugeOption({ segmentDivisor: 25, segmentFill: "whole" }), 24);
  expect(bands.filter(([, color]) => color === progressColor)).toHaveLength(0);
});
```

`gapDegrees` and `colorBands` are file-local readers over `option.series[0].axisLine.lineStyle.color`.

In `plan.test.ts`, assert `buildChartPlan` passes `drawnEdge` from the context: a gauge plan built with `drawnEdge: 200` has a larger gap offset than the same plan with `drawnEdge: 800`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src/web && npx vitest run packages/renderer-core/src/charts/gauge.test.ts packages/renderer-core/src/charts/segments.test.ts packages/renderer-core/src/scene/plan.test.ts`
Expected: FAIL — `gaugeGap` absent, `drawnEdge` not on the context.

- [ ] **Step 3: Implement the gauge path**

In `segments.ts`:

```ts
export function gaugeGap(
  settings: GaugeSettings,
  sweepDegrees: number,
  count: number,
  drawnEdge: number | undefined,
): number {
  const bandSweep = Math.abs(sweepDegrees) / Math.max(1, count);
  // A share of the edge against a radius of half the edge is a constant angle.
  const spacing =
    ((2 * segmentSpacingPercentOf(settings)) / 100) * (180 / Math.PI);
  const clearance =
    drawnEdge === undefined
      ? 0
      : (settings.thickness / Math.max(1, drawnEdge / 2)) * (180 / Math.PI);
  return Math.min(Math.max(spacing, clearance), 0.45 * bandSweep);
}
```

The comment states why the spacing term does not carry `drawnEdge`, and why an absent edge skips the clearance term rather than guessing a chart size. In `gauge.ts`, replace `SEGMENT_GAP_RATIO / count` offsets with `gaugeGap(...) / sweep` offsets, and splice the reading boundary in `partial` mode. In `plan.ts`, add `drawnEdge` to `ChartPlanContext` and pass it to `buildGaugeOption`; in the editor manager and player, pass the node's smaller drawn edge.

- [ ] **Step 4: Run the focused tests and typecheck**

Run: `cd src/web && npx vitest run packages/renderer-core/src/charts/gauge.test.ts packages/renderer-core/src/charts/segments.test.ts packages/renderer-core/src/scene/plan.test.ts && npm run typecheck`
Expected: PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/renderer-core/src/charts/segments.ts src/web/packages/renderer-core/src/charts/gauge.ts src/web/packages/renderer-core/src/charts/gauge.test.ts src/web/packages/renderer-core/src/charts/segments.test.ts src/web/packages/renderer-core/src/scene/plan.ts src/web/packages/renderer-core/src/scene/plan.test.ts src/web/packages/editor/src/chart-manager/index.ts src/web/packages/player/src/main.ts
git commit -m "feat(charts): space gauge bands by the drawn size"
```

---

### Task 3: Bar spacing and fill mode

**Files:**
- Modify: `src/web/packages/renderer-core/src/charts/bar.ts`
- Test: `src/web/packages/renderer-core/src/charts/bar.test.ts`

**Interfaces:**
- Consumes: `segmentSpacingPercentOf`, `segmentFillOf`.
- Produces: `barGapPx(edgePx: number, bandPx: number, spacingPercent: number): number`, clamped to `0.45 * bandPx`.
- Produces: `renderItem` reads `api.getWidth()`/`api.getHeight()` for the edge; `whole` mode draws `fraction >= 1 ? 1 : 0`, `partial` keeps the reading's fraction.

- [ ] **Step 1: Write the failing bar tests**

In `bar.test.ts`, using the existing renderItem harness with `api.getWidth: () => 400, api.getHeight: () => 300`:

```ts
it("draws the same pixel gap on a large and a small chart", () => {
  const large = gapOf(render({ segmentDivisor: 5, segmentSpacingPercent: 5 }, 400));
  const small = gapOf(render({ segmentDivisor: 5, segmentSpacingPercent: 5 }, 200));
  expect(small).toBeCloseTo(large / 2, 5);
});

it("clamps the spacing to 45% of a band", () => {
  const gap = gapOf(render({ segmentDivisor: 1, segmentSpacingPercent: 20 }, 400));
  expect(gap).toBeLessThanOrEqual(0.45 * bandPx);
});

it("lights whole bands only in whole mode", () => {
  const rects = fillRects(render({ segmentDivisor: 25, segmentFill: "whole" }, 400, 24));
  expect(rects.every((rect) => rect.width === bandVisible)).toBe(true);
  expect(rects).toHaveLength(0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src/web && npx vitest run packages/renderer-core/src/charts/bar.test.ts`
Expected: FAIL — the gap does not follow the chart size or the authored spacing.

- [ ] **Step 3: Implement the bar path**

Add `barGapPx` beside `gaugeGap`. In `segmentedRenderItem`, replace `const gap = SEGMENT_GAP_RATIO` with the computed gap and `visible = band - gapPx`; read `edge = Math.min(api.getWidth(), api.getHeight())` inside the render callback; branch `fraction` on `segmentFillOf(settings, "partial")`.

- [ ] **Step 4: Run the focused tests**

Run: `cd src/web && npx vitest run packages/renderer-core/src/charts/bar.test.ts packages/renderer-core/src/charts/segments.test.ts && npx tsc -p packages/renderer-core`
Expected: PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/renderer-core/src/charts/bar.ts src/web/packages/renderer-core/src/charts/bar.test.ts
git commit -m "feat(charts): space bar bands by the drawn size"
```

---

### Task 4: Pie spacing

**Files:**
- Modify: `src/web/packages/renderer-core/src/charts/pie.ts`
- Modify: `src/web/packages/renderer-core/src/charts/segments.ts` (target-angle helper)
- Test: `src/web/packages/renderer-core/src/charts/pie.test.ts`, `segments.test.ts`

**Interfaces:**
- Consumes: `segmentSpacingPercentOf`, `pieGap(settings: PieSettings, drawnEdge: number): number` returning the gap in degrees at the authored outer radius.
- Produces: `toSegmentedPieData` takes the target gap in degrees instead of reading `SEGMENT_GAP_RATIO`; the spacer ratio solves `r = G * count / (A - G * (count - 1))` per item, clamped to `[0, 0.45]`.

- [ ] **Step 1: Write the failing pie tests**

```ts
it("spaces sub-slices by the chart share at the authored radius", () => {
  const gap = pieGap({ ...defaultPieSettings, outerRadiusPercent: 100 }, 400);
  expect(gap).toBeCloseTo((2 * 2.5 / 100) * (180 / Math.PI), 5);
});

it("keeps composition shares exact when the spacing changes", () => {
  const tight = sliceShares(toSegmentedPieData(items, 5, 1, 200, 400));
  const wide = sliceShares(toSegmentedPieData(items, 5, 6, 200, 400));
  expect(wide).toEqual(tight);
});
```

`sliceShares` sums each colour's real (non-spacer) values and asserts the same proportions.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src/web && npx vitest run packages/renderer-core/src/charts/pie.test.ts packages/renderer-core/src/charts/segments.test.ts`
Expected: FAIL — the gap is still `SEGMENT_GAP_RATIO`.

- [ ] **Step 3: Implement the pie path**

Add `pieGap` to `segments.ts` and the target-angle spacer solve in `pie.ts`; keep `SEGMENT_GAP_RATIO` only if a continuous-path use remains, and delete it if not.

- [ ] **Step 4: Run the focused tests**

Run: `cd src/web && npx vitest run packages/renderer-core/src/charts/pie.test.ts packages/renderer-core/src/charts/segments.test.ts && npx tsc -p packages/renderer-core`
Expected: PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/renderer-core/src/charts/pie.ts src/web/packages/renderer-core/src/charts/pie.test.ts src/web/packages/renderer-core/src/charts/segments.ts src/web/packages/renderer-core/src/charts/segments.test.ts
git commit -m "feat(charts): space pie slices by the drawn size"
```

---

### Task 5: Browser evidence, gate, STATUS and local main checkpoint

**Files:**
- Modify: `src/web/tests/e2e/inspector-sections.spec.ts`
- Modify: `STATUS.md`
- Modify: `docs/superpowers/plans/2026-10-26-segment-spacing-and-fill-mode.md` (tick this task only)

**Interfaces:**
- Consumes: every task above.
- Produces: a browser case proving the gap survives a smaller chart and the fill toggle moves pixels; a green gate; a local `main` merge.

- [x] **Step 1: Extend the segmented-fill browser case**

In the existing `segmentDivisor` case, after the divisor reaches `20`:

- assert the built option's gap offsets rather than pixel counts: `builtOption` for the gauge at the authored size, then again after resizing the chart to half its width, and assert the half-size option's gap in degrees is larger (cap clearance won) while the large one is the 2.5% share.
- capture `editor-chart-gauge-spacing-large` and `editor-chart-gauge-spacing-small` (canvas scope, as the radar case does).
- toggle Fill from `Whole segment` to `Partial segment`, and assert the canvas hash changes; capture `editor-chart-gauge-fill-partial`.

Run: `cd src/web && YUNARI_CAPTURE=1 YUNARI_CAPTURE_DIR="C:/tmp/yunari-segment-spacing" npx playwright test tests/e2e/inspector-sections.spec.ts --grep "segment" --workers=1`
Expected: PASS; three PNGs.

- [x] **Step 2: Run the full gate**

Run: `cd src/web && npm run gate`
Expected: exit 0. A red `packages/host/src/themes/store.test.ts` asset-bounds timeout is the open flake (vg-175/vg-590/vg-661): re-run and record which runs were red and why.

- [x] **Step 3: Update STATUS.md and commit**

Replace "Last completed change" with 1–5 one-line bullets: spacing as a chart share, cap clearance, fill-mode toggle, defaults unchanged, browser evidence. Set the active plan to this one until the merge.

```bash
git add STATUS.md docs/superpowers/plans/2026-10-26-segment-spacing-and-fill-mode.md
git commit -m "docs(status): record the segment-spacing checkpoint"
```

- [x] **Step 4: Merge locally into main and stop**

```bash
git -C D:/git-repos/yunari merge --no-ff peterng1618/improve-charts
```

Do not push. Report the merge sha, the gate exit code, the screenshot paths, and the owner's test steps: open the starter RAM gauge, resize it smaller at divisor 20, lower the divisor below 20 with rounded ends on, drag Segment spacing, and switch Fill between whole and partial.
