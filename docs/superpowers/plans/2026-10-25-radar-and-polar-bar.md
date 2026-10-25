# Radar and polar bar — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `radar` and `polarBar` as chart families with typed settings, option builders, plan wiring and editor surfaces.

**Architecture:** Radar draws one polygon over the bound latest readings on a shared `min`/`max`; it draws no polygon unless at least three readings are present and all are plottable. Polar bar is a bar in polar coordinates and reuses the bar paint/data helpers; it ships continuous only. Both families inherit Plan 1's animation policy and draw no engine text.

**Tech Stack:** TypeScript, ECharts 6.1.0, Fabric 7.4.0, React 19, Vitest, Playwright, Biome.

**Spec:** `docs/superpowers/specs/2026-10-25-chart-playback-and-segmented-fill-design.md` (Designs C, D and E)

## Global Constraints

- One active plan only. This plan starts only after Plan 2's local-`main` checkpoint is accepted.
- Stage explicit paths; never `git add -A` or `git commit -a`.
- Do not touch or stage `src/web/package-lock.json`.
- No engine text: radar `axisName.show` false; polar bar both axes `axisLabel.show` false.
- Radar indicators share one `min`/`max`; no per-spoke scaling.
- A radar with fewer than three bindings or any missing reading draws `data: []`, never zero.
- Polar bar has no `segmentDivisor`; segmented polar bars are deferred.
- Missing polar values are `null`; their track remains.
- Screenshots are evidence, not golden files.

## Review Focus

- A radar whose readings mix units must draw on the authored shared scale, not rescale each spoke to full.
- A radar that loses one reading mid-frame must drop the polygon but keep its frame.
- A polar bar with `innerRadiusPercent >= outerRadiusPercent` must be refused at load.
- A polar bar with a missing sample must leave its track and no bar.
- A family added to `CHART_FAMILIES` must fail the build until every `Record<ChartFamily, …>` is filled.

---

### Task 1: Build the radar adapter

**Files:**
- Create: `src/web/packages/renderer-core/src/charts/radar.ts`
- Create: `src/web/packages/renderer-core/src/charts/radar.test.ts`
- Modify: `src/web/packages/renderer-core/src/charts/bar.ts` (export `BarInput` shape reuse only if needed)
- Modify: `src/web/packages/renderer-core/src/index.ts`

**Interfaces:**
- Produces:
  - `RadarShape = "polygon" | "circle"`
  - `RadarSettings` and `defaultRadarSettings`
  - `RadarInput { readonly sensorId: string; readonly sample: Sample | undefined }`
  - `buildRadarOption(settings: RadarSettings, inputs: readonly RadarInput[], animate?: boolean, palette?: FabricPalette): RadarOption`

- [ ] **Step 1: Write the failing radar tests**

```ts
it("emits one indicator per binding on the shared scale", () => {
  const option = buildRadarOption(defaultRadarSettings, [
    { sensorId: "cpu.load.total", sample: ok(70) },
    { sensorId: "gpu.load.total", sample: ok(40) },
    { sensorId: "ram.used", sample: ok(55) },
  ]);

  expect(option.radar.indicator).toEqual([
    { name: "cpu.load.total", min: 0, max: 100 },
    { name: "gpu.load.total", min: 0, max: 100 },
    { name: "ram.used", min: 0, max: 100 },
  ]);
  expect(option.series[0].data).toEqual([{ value: [70, 40, 55] }]);
  expect(option.radar.axisName.show).toBe(false);
});

it("draws no polygon with fewer than three readings", () => {
  const option = buildRadarOption(defaultRadarSettings, [
    { sensorId: "a", sample: ok(10) },
    { sensorId: "b", sample: ok(20) },
  ]);
  expect(option.series[0].data).toEqual([]);
});

it("draws no polygon if any reading is missing", () => {
  const option = buildRadarOption(defaultRadarSettings, [
    { sensorId: "a", sample: ok(10) },
    { sensorId: "b", sample: undefined },
    { sensorId: "c", sample: ok(30) },
  ]);
  expect(option.series[0].data).toEqual([]);
});

it("clamps only what is drawn", () => {
  const option = buildRadarOption(
    { ...defaultRadarSettings, max: 100 },
    [
      { sensorId: "a", sample: ok(150) },
      { sensorId: "b", sample: ok(-5) },
      { sensorId: "c", sample: ok(50) },
    ],
  );
  expect(option.series[0].data).toEqual([{ value: [100, 0, 50] }]);
});

it("resolves a threshold stroke at the top of the scale", () => {
  const option = buildRadarOption(
    {
      ...defaultRadarSettings,
      stroke: {
        kind: "thresholds",
        bands: [
          { offset: 0.5, color: "#0f0" },
          { offset: 1, color: "#f00" },
        ],
      },
    },
    [
      { sensorId: "a", sample: ok(10) },
      { sensorId: "b", sample: ok(20) },
      { sensorId: "c", sample: ok(30) },
    ],
  );
  expect(option.series[0].lineStyle.color).toBe("#f00");
});

it("draws an empty frame when showAxes is off", () => {
  const option = buildRadarOption(
    { ...defaultRadarSettings, showAxes: false },
    [],
  );
  expect(option.radar.axisLine.show).toBe(false);
  expect(option.radar.splitLine.show).toBe(false);
  expect(option.radar.splitArea.show).toBe(false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src/web && npx vitest run packages/renderer-core/src/charts/radar.test.ts`

Expected: module not found.

- [ ] **Step 3: Implement `radar.ts`**

Declare the settings and defaults: `min: 0`, `max: 100`, `shape: "polygon"`, `splitNumber: 4`, `lineWidth: 2`, `showMarkers: true`, `markerSize: 4`, `showAxes: true`, `stroke: { kind: "solid", color: "#00b8d9" }`, no default `area`, no default `animation`. Build indicators from every input in binding order with `min`/`max` from settings. Compute values with `applyTransform` already applied by the caller, but clamp here for drawing. Emit `data: []` unless `inputs.length >= 3` and every input has a plottable value. Resolve `stroke` and optional `area` once with `resolveFlatColor(fill, 1)`; an unresolved stroke also yields `data: []`. Emit `axisName: { show: false }`, axisLine/splitLine/splitArea from `showAxes`, `symbol`/`symbolSize` from marker settings, and `toEngineAnimation(settings.animation, animate)`. Export the types and builder from `renderer-core/src/index.ts`.

- [ ] **Step 4: Run the focused tests**

Run: `cd src/web && npx vitest run packages/renderer-core/src/charts/radar.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/renderer-core/src/charts/radar.ts src/web/packages/renderer-core/src/charts/radar.test.ts src/web/packages/renderer-core/src/index.ts
git commit -m "feat(charts): add the radar adapter

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Build the polar bar adapter on the bar paint helpers

**Files:**
- Create: `src/web/packages/renderer-core/src/charts/polar-bar.ts`
- Create: `src/web/packages/renderer-core/src/charts/polar-bar.test.ts`
- Modify: `src/web/packages/renderer-core/src/charts/bar.ts`
- Modify: `src/web/packages/renderer-core/src/charts/bar.test.ts`
- Modify: `src/web/packages/renderer-core/src/index.ts`

**Interfaces:**
- Produces:
  - `PolarBarSettings = Omit<BarSettings, "orientation" | "segmentDivisor"> & { startAngle; innerRadiusPercent; outerRadiusPercent }`
  - `defaultPolarBarSettings`
  - `buildPolarBarOption(settings: PolarBarSettings, inputs: readonly BarInput[], animate?: boolean, palette?: FabricPalette): PolarBarOption`
  - `toBarColor` accepts `BarSettings | PolarBarSettings`; a polar setting resolves gradients `to-top`.

- [ ] **Step 1: Write the failing polar tests**

```ts
it("draws one category per binding around the authored start angle", () => {
  const option = buildPolarBarOption(defaultPolarBarSettings, [
    { sensorId: "cpu.load.total", sample: ok(70) },
    { sensorId: "gpu.load.total", sample: ok(40) },
    { sensorId: "ram.used", sample: ok(55) },
  ]);

  expect(option.angleAxis).toMatchObject({
    type: "category",
    data: ["cpu.load.total", "gpu.load.total", "ram.used"],
    startAngle: 90,
    axisLabel: { show: false },
  });
  expect(option.series[0]).toMatchObject({
    type: "bar",
    coordinateSystem: "polar",
    barCategoryGap: "40%",
  });
});

it("draws the authored track behind every bar", () => {
  const option = buildPolarBarOption(defaultPolarBarSettings, [
    { sensorId: "a", sample: ok(70) },
  ]);
  expect(option.series[0].showBackground).toBe(true);
  expect(option.series[0].backgroundStyle).toEqual({
    color: "#2a2f3a",
    borderRadius: 7,
  });
});

it("leaves a missing bar as null while its track remains", () => {
  const option = buildPolarBarOption(defaultPolarBarSettings, [
    { sensorId: "a", sample: undefined },
  ]);
  expect(option.series[0].data[0]!.value).toBeNull();
  expect(option.series[0].showBackground).toBe(true);
});

it("maps the authored radii and start angle", () => {
  const option = buildPolarBarOption(
    {
      ...defaultPolarBarSettings,
      startAngle: 180,
      innerRadiusPercent: 10,
      outerRadiusPercent: 60,
    },
    [],
  );
  expect(option.polar.radius).toEqual(["10%", "60%"]);
  expect(option.angleAxis.startAngle).toBe(180);
});

it("has no segment divisor", () => {
  expect("segmentDivisor" in defaultPolarBarSettings).toBe(false);
});
```

In `bar.test.ts`, add:

```ts
it("keeps the cartesian gradient direction for a bar", () => {
  const option = buildBarOption(
    {
      ...defaultBarSettings,
      orientation: "vertical",
      fill: {
        kind: "gradient",
        stops: [
          { offset: 0, color: "#000" },
          { offset: 1, color: "#fff" },
        ],
      },
    },
    [{ sensorId: "a", sample: ok(50) }],
  );
  expect(option.series[0].data[0]!.itemStyle.color).toMatchObject({
    x: 0,
    y: 0,
    x2: 0,
    y2: 1,
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src/web && npx vitest run packages/renderer-core/src/charts/polar-bar.test.ts packages/renderer-core/src/charts/bar.test.ts`

Expected: polar module missing.

- [ ] **Step 3: Implement the polar adapter and widen the bar helpers**

- `bar.ts`: change `toBarDataItem`, `toBarColor`, `toBackgroundStyle` and `toTrackColor` to accept `BarSettings | PolarBarSettings`; replace every `settings.orientation` read with `"orientation" in settings ? settings.orientation : "vertical"` for gradient direction. Export `toBackgroundStyle` if the polar builder lives in another module.
- `polar-bar.ts`: define the settings type and defaults by spreading `defaultBarSettings` without `orientation` and `segmentDivisor`, then adding `startAngle: 90`, `innerRadiusPercent: 20`, `outerRadiusPercent: 80`.
- Build `polar.radius`, category `angleAxis` (names, `show`, `startAngle`, `clockwise: true`, `axisLabel: false`), value `radiusAxis` (`min`, `max`, `show`, `axisLabel: false`), and one polar `bar` series with `toBarDataItem`, `barWidth`, `barCategoryGap`, `showBackground`, `backgroundStyle`, `silent: true`, and animation.
- Clamp the radius percentages to 0–100 with the existing `clampPercent` shape. Do not add `segmentDivisor`.
- Export both from `renderer-core/src/index.ts`.

- [ ] **Step 4: Run the focused tests**

Run: `cd src/web && npx vitest run packages/renderer-core/src/charts/polar-bar.test.ts packages/renderer-core/src/charts/bar.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/renderer-core/src/charts/polar-bar.ts src/web/packages/renderer-core/src/charts/polar-bar.test.ts src/web/packages/renderer-core/src/charts/bar.ts src/web/packages/renderer-core/src/charts/bar.test.ts src/web/packages/renderer-core/src/index.ts
git commit -m "feat(charts): add the polar bar adapter

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Register both families in the document and plan

**Files:**
- Modify: `src/web/packages/renderer-core/src/theme/document.ts`
- Modify: `src/web/packages/renderer-core/src/charts/settings-fields.ts`
- Modify: `src/web/packages/renderer-core/src/charts/settings-fields.test.ts`
- Modify: `src/web/packages/renderer-core/src/charts/engine-option.ts`
- Modify: `src/web/packages/renderer-core/src/scene/plan.ts`
- Modify: `src/web/packages/renderer-core/src/scene/plan.test.ts`
- Modify: `src/web/packages/renderer-core/src/theme/fabric-envelope-validate.ts`
- Modify: `src/web/packages/renderer-core/src/theme/fabric-envelope-validate.test.ts`

**Interfaces:**
- Consumes: `RadarSettings`, `PolarBarSettings`, `buildRadarOption`, `buildPolarBarOption`.
- Produces: `CHART_FAMILIES` includes `"radar"` and `"polarBar"`; `ChartContent` has both arms; `buildChartPlan` returns `PlanChart` for both; `ChartOptionByFamily` has both option types.

- [ ] **Step 1: Write the failing registration tests**

In `settings-fields.test.ts`, add radar and polar coverage maps and authored-order arrays; assert:

```ts
it("declares both new families' settings", () => {
  expect(settingsFieldsFor("radar").map((f) => f.property)).toContain("shape");
  expect(settingsFieldsFor("polarBar").map((f) => f.property)).toContain(
    "innerRadiusPercent",
  );
  expect(settingsFieldsFor("polarBar").map((f) => f.property)).not.toContain(
    "segmentDivisor",
  );
});
```

In `plan.test.ts`:

```ts
it("plans a radar from the bound latest readings", () => {
  const source = sourceAt({
    "cpu.load.total": ok(70),
    "gpu.load.total": ok(40),
    "ram.used": ok(55),
  });
  const { chart } = chartPlan(
    { family: "radar", settings: defaultRadarSettings },
    [
      { id: "a", semanticKey: "cpu.load.total" },
      { id: "b", semanticKey: "gpu.load.total" },
      { id: "c", semanticKey: "ram.used" },
    ],
    source,
  );
  expect(chart.family).toBe("radar");
  if (chart.family === "radar") {
    expect(chart.option.series[0].data).toEqual([{ value: [70, 40, 55] }]);
  }
});

it("plans a polar bar from the bound latest readings", () => {
  const source = sourceAt({ "cpu.load.total": ok(70) });
  const { chart } = chartPlan(
    { family: "polarBar", settings: defaultPolarBarSettings },
    [{ id: "a", semanticKey: "cpu.load.total" }],
    source,
  );
  expect(chart.family).toBe("polarBar");
  if (chart.family === "polarBar") {
    expect(chart.option.series[0].type).toBe("bar");
  }
});
```

Use the file's existing source/plan helpers.

In `fabric-envelope-validate.test.ts`:

```ts
it("refuses crossed polar radii", () => {
  const issues = validateFabricThemeEnvelope(
    envelopeWithChart("polarBar", {
      innerRadiusPercent: 80,
      outerRadiusPercent: 20,
    }),
  ).issues;
  expect(issues.some((issue) => issue.code === "out-of-range")).toBe(true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src/web && npx vitest run packages/renderer-core/src/charts/settings-fields.test.ts packages/renderer-core/src/scene/plan.test.ts packages/renderer-core/src/theme/fabric-envelope-validate.test.ts`

Expected: type errors and missing families.

- [ ] **Step 3: Register the families**

- `document.ts`: append `"radar"` and `"polarBar"` to `CHART_FAMILIES`; import the settings types; add both `ChartContent` arms.
- `settings-fields.ts`: add the radar and polar arrays exactly as Tasks 1 and 2 declared their settings, plus paint rows (`radar`: `stroke`, `area`; `polarBar`: `fill`, `track`). Keep the order matching each settings interface.
- `engine-option.ts`: add `readonly radar: RadarOption; readonly polarBar: PolarBarOption;`.
- `plan.ts`: add cases that map bindings through `applyTransform` into `RadarInput`/`BarInput`; radar uses `buildRadarOption`, polar uses `buildPolarBarOption`. Both pass `animate`.
- `fabric-envelope-validate.ts` `scalarPairs`: return `[["innerRadiusPercent", "outerRadiusPercent"]]` for `polarBar`. Radar's `min`/`max` pair is already derived from its descriptors.
- `settings-fields.test.ts`: fill the radar/polar coverage maps so the exhaustive check compiles.

- [ ] **Step 4: Run the focused tests and typecheck**

Run: `cd src/web && npx vitest run packages/renderer-core/src/charts/settings-fields.test.ts packages/renderer-core/src/scene/plan.test.ts packages/renderer-core/src/theme/fabric-envelope-validate.test.ts`

Then: `cd src/web && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/renderer-core/src/theme/document.ts src/web/packages/renderer-core/src/charts/settings-fields.ts src/web/packages/renderer-core/src/charts/settings-fields.test.ts src/web/packages/renderer-core/src/charts/engine-option.ts src/web/packages/renderer-core/src/scene/plan.ts src/web/packages/renderer-core/src/scene/plan.test.ts src/web/packages/renderer-core/src/theme/fabric-envelope-validate.ts src/web/packages/renderer-core/src/theme/fabric-envelope-validate.test.ts
git commit -m "feat(charts): register radar and polar bar

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Add both families to the editor

**Files:**
- Modify: `src/web/packages/editor/src/new-object-defaults.ts`
- Modify: `src/web/packages/editor/src/new-object-defaults.test.ts`
- Modify: `src/web/packages/editor/src/ui-copy.ts`
- Modify: `src/web/packages/editor/src/editor-shell/icons.ts`
- Modify: `src/web/packages/editor/src/panes/composition/kind-mark.tsx`
- Modify: `src/web/packages/editor/src/chart-manager/index.ts`
- Modify: `src/web/packages/editor/src/chart-manager/panel.ts`
- Modify: `src/web/packages/editor/src/chart-manager/panel.dom.test.ts`
- Modify: `src/web/packages/editor/src/new-object-panel.dom.test.ts`
- Modify: `src/web/packages/editor/src/panes/composition/kind-mark.dom.test.tsx`
- Modify: `src/web/tests/e2e/inspector-sections.spec.ts`
- Modify: `src/web/tests/e2e/rebuild-driver.ts`

**Interfaces:**
- Consumes: `defaultRadarSettings`, `defaultPolarBarSettings`, `CHART_FAMILIES`.
- Produces: Add-pane tiles, layer marks, inspector defaults, binding caps and insert branches for both families.

- [ ] **Step 1: Write the failing editor tests**

In `new-object-defaults.test.ts`:

```ts
it("gives a radar a token-backed stroke and no track", () => {
  const settings = createNewChartDefaults(globals, "radar");
  expect(settings.stroke).toEqual({ ref: "palette.cpu" });
});

it("gives a polar bar a token-backed fill and surface track", () => {
  const settings = createNewChartDefaults(globals, "polarBar");
  expect(settings.fill).toEqual({ ref: "palette.cpu" });
  expect(settings.track).toEqual({ ref: "palette.background" });
});
```

Use the file's existing `globals` fixture.

In `panel.dom.test.ts`:

```ts
it("offers a radar twelve series and a polar bar unbounded", () => {
  expect(chartContentView(radarTarget).series?.refused).toBe(false);
  expect(chartContentView(polarTarget).series?.refused).toBe(false);
});
```

For the radar cap, build 12 bindings and assert the thirteenth is refused; keep the test's existing `series` view shape.

In `kind-mark.dom.test.tsx`, the existing loop over `CHART_FAMILIES` already covers the new marks; add assertions that the radar and polar bar marks are distinct from the generic chart mark.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src/web && npx vitest run packages/editor/src/new-object-defaults.test.ts packages/editor/src/chart-manager/panel.dom.test.ts packages/editor/src/panes/composition/kind-mark.dom.test.tsx`

Expected: missing family branches and labels.

- [ ] **Step 3: Implement the editor surfaces**

- `new-object-defaults.ts`: add overloads for `"radar"` and `"polarBar"`; in the switch return `{ ...defaultRadarSettings, stroke: ref }` and `{ ...defaultPolarBarSettings, fill: ref, track: surfaceRef }`.
- `ui-copy.ts`: add `radar: "Radar"`, `polarBar: "Polar bar"` to `chartFamilyLabels`; make `runSeriesFull` say "A radar chart draws one spoke per series, up to 12." for `radar` and keep the one-reading sentence for gauge.
- `editor-shell/icons.ts`: import `Radar` and `LoaderPinwheel`, export `CHART_RADAR_GLYPH` and `CHART_POLAR_BAR_GLYPH`, and update the "four chart families" comment to six.
- `kind-mark.tsx`: add both keys to `CHART_ICONS`.
- `chart-manager/index.ts`: add `"radar"` and `"polarBar"` cases to the insert switch.
- `panel.ts`: add both defaults to `defaultsOf`; add `radar: 12` and `polarBar: Number.POSITIVE_INFINITY` to `MAX_BINDINGS`.
- Update `new-object-panel.dom.test.ts` only if a fixed tile count or label list exists; the Add pane's family loop should pick the tiles up.
- Add one `inspector-sections.spec.ts` case that inserts each family from the Add pane, binds three readings to radar and one to polar bar, and asserts the canvas drew. The existing families' cases stay.

- [ ] **Step 4: Run the focused editor tests**

Run: `cd src/web && npx vitest run packages/editor/src/new-object-defaults.test.ts packages/editor/src/chart-manager/panel.dom.test.ts packages/editor/src/panes/composition/kind-mark.dom.test.tsx packages/editor/src/new-object-panel.dom.test.ts packages/editor/src/chart-manager/chart-fields.dom.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/editor/src/new-object-defaults.ts src/web/packages/editor/src/new-object-defaults.test.ts src/web/packages/editor/src/ui-copy.ts src/web/packages/editor/src/editor-shell/icons.ts src/web/packages/editor/src/panes/composition/kind-mark.tsx src/web/packages/editor/src/chart-manager/index.ts src/web/packages/editor/src/chart-manager/panel.ts src/web/packages/editor/src/chart-manager/panel.dom.test.ts src/web/packages/editor/src/new-object-panel.dom.test.ts src/web/packages/editor/src/panes/composition/kind-mark.dom.test.tsx src/web/tests/e2e/inspector-sections.spec.ts
git commit -m "feat(editor): offer radar and polar bar

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Plan gate, browser evidence and local main checkpoint

**Files:**
- Modify: `STATUS.md`
- Modify: `docs/superpowers/plans/2026-10-25-radar-and-polar-bar.md` (tick this task only)

**Interfaces:**
- Consumes: every task above.
- Produces: a green gate, rendered evidence for both families, and a local `main` merge.

- [ ] **Step 1: Run the family browser case**

Run: `cd src/web && npx playwright test tests/e2e/inspector-sections.spec.ts --grep "radar and polar bar" --workers=1`

Expected: PASS. Capture one screenshot per family: radar with four readings, radar missing one reading, polar bar with track and one missing reading. Screenshots are evidence.

- [ ] **Step 2: Run the full gate**

Run: `cd src/web && npm run gate`

Expected: exit 0. Fix failures in this plan before merging.

- [ ] **Step 3: Update STATUS.md and commit**

Replace the completed-change section with 1–5 bullets: both families, shared radar scale, polar bar reuse, and the deferred segmented polar bar. One item per line.

```bash
git add STATUS.md docs/superpowers/plans/2026-10-25-radar-and-polar-bar.md
git commit -m "docs(status): record the chart-family checkpoint

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Merge locally into main and stop**

From the checkout that has `main` checked out:

```bash
git -C <main-worktree> merge --no-ff peterng1618/improve-charts
```

Do not push. Report the merge sha, the gate exit code, the screenshot paths, and the owner's test steps: open the Add pane, insert radar and polar bar, bind readings, and check the shared scale and missing-reading behaviour. Stop after the merge.
