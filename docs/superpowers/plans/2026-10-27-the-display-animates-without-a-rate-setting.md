# The Display Animates Without a Rate Setting — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the per-display chart refresh-rate setting and make every chart's own motion visible, while samples keep arriving on the host's cadence.

**Architecture:** One fixed 30 fps scene loop; animation permission becomes a family rule; `YunariChart` blits ECharts transition frames until the engine reports `finished`; clock text repaints only when its rendered string changes; the preview source answers every semantic key with its own kind.

**Tech Stack:** TypeScript, Fabric 7, ECharts 6, Vitest (jsdom for mounts), npm workspaces under `src/web/`.

**Spec:** `docs/superpowers/specs/2026-10-27-the-display-animates-without-a-rate-setting-design.md`

## Global Constraints

- Run Vitest as `node node_modules/vitest/vitest.mjs run <paths>` from `src/web/`. `npx vitest` is rewritten by the shell hook and loses `run`, entering watch mode.
- Write test reports under `C:\Users\peter\AppData\Local\Temp\`; the scratch gate refuses report files inside the repo.
- Red first: run each task's new test before writing the implementation and record the failure.
- Stage explicit paths only; never `git add -A`.
- Conventional commits, ending each with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Before each task's commit, replace `STATUS.md`'s "Last completed change" with 1–5 one-line bullets for that commit and run `npm run status:check` from `src/web/`.
- A decision note must exist before any write to `scene-fabric/src/chart-object.ts` or `host/src/server.ts` (reuse gate).
- Biome: `node node_modules/@biomejs/biome/bin/biome check --write <changed files>`.
- Do not touch `src/web/package-lock.json`; no dependency changes are needed.

## Review Focus

1. A host reporting at 30 Hz restarts a 1 s transition every sample; the pump must stay armed without leaking renders or throwing.
2. A clock formatted to minutes or dates must paint once a minute/day, not 30 times a second, and must not flicker its placeholder.
3. A chart whose settings disable animation must never arm the pump (no continuous rendering of a static chart).
4. A host that stops answering must freeze readings rather than fabricate them; removing the rate poll must not add an error loop.
5. A display record written before this change (carrying `chartFps`) must load and render normally, with the value ignored.

---

## Phase 1 — Motion

### Task 1: Animation permission is a family rule

**Files:**
- Modify: `src/web/packages/scene-fabric/src/chart-animation.ts`
- Modify: `src/web/packages/scene-fabric/src/chart-animation.test.ts`
- Modify: `src/web/packages/player/src/main.ts`
- Modify: `src/web/packages/editor/src/chart-manager/index.ts`
- Modify: `src/web/packages/editor/src/editor-session.ts`
- Modify: `src/web/packages/editor/src/editor-main.ts`
- Create: `docs/decisions/0129-a-transition-blits-its-own-frames.md`

**Interfaces:**
- Consumes: `ChartFamily` from `@yunari/renderer-core`.
- Produces: `chartAnimationFor(family: ChartFamily): boolean`.
- Removes: the `refreshRate` option of `ChartManager`, and the `chartRefreshRate` option of `EditorSession` (the editor's own loop keeps its variable until Task 6).

- [ ] **Step 1: Write the failing test** in `chart-animation.test.ts`

```ts
describe("chartAnimationFor", () => {
  it.each(["gauge", "bar", "pie", "radar", "polarBar"] as const)(
    "animates %s",
    (family) => expect(chartAnimationFor(family)).toBe(true),
  );
  it("leaves the line static", () => {
    expect(chartAnimationFor("line")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it red**

Run: `node node_modules/vitest/vitest.mjs run packages/scene-fabric/src/chart-animation.test.ts`
Expected: FAIL — `chartAnimationFor` takes two arguments / returns false for a value family.

- [ ] **Step 3: Implement** `chartAnimationFor(family: ChartFamily): boolean` as `family !== "line"`; update its docblock: the line's motion is the data-clock jump, every other family's is the engine's transition. Update the two call sites to `chartAnimationFor(family)`, delete `#refreshRate` and its constructor option from `ChartManager`, and delete the `refreshRate` option and passing from `EditorSession`/`editor-main`.

- [ ] **Step 4: Write the decision note** `docs/decisions/0129-a-transition-blits-its-own-frames.md` claiming `scene-fabric/src/chart-object.ts` and `host/src/server.ts`. Rungs: (1) Yunari — `_onEngineRendered` marks dirty only (vg-107); (2) ECharts — `finished` fires from zrender's `rendered` only when `zr.animation.isFinished()`, so arming before `setOption` and disarming on `finished` is exact; (3) platform — RAF is the only frame clock; (4) ecosystem — ECharts' own transition pump is `animationDurationUpdate`; (5) comparison — permanent render loop (rejected, vg-107), per-frame blit only during a transition (chosen), no blit (rejected: invisible motion); (6) probe — the Task 2 test; (7) build — no dependency.

- [ ] **Step 5: Run the tests and the typecheck**

Run: `node node_modules/vitest/vitest.mjs run packages/scene-fabric/src/chart-animation.test.ts packages/editor/src/chart-manager`
Run: `npm run typecheck -w @yunari/scene-fabric && npm run typecheck -w @yunari/editor && npm run typecheck -w @yunari/player`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add docs/decisions/0129-a-transition-blits-its-own-frames.md STATUS.md \
  src/web/packages/scene-fabric/src/chart-animation.ts \
  src/web/packages/scene-fabric/src/chart-animation.test.ts \
  src/web/packages/player/src/main.ts \
  src/web/packages/editor/src/chart-manager/index.ts \
  src/web/packages/editor/src/editor-session.ts \
  src/web/packages/editor/src/editor-main.ts
git commit -m "feat(charts): animate every family except the line"
```

### Task 2: The chart blits its own transition frames

**Files:**
- Modify: `src/web/packages/scene-fabric/src/chart-object.ts`
- Modify: `src/web/packages/scene-fabric/src/chart-object.dom.test.ts`

**Interfaces:**
- Consumes: the existing `_onEngineRendered` listener and `_requestCanvasRender`.
- Produces (private, test-visible through a cast): `_onEngineFinished`, the `_pumping` flag, and the module constant `TRANSITION_FRAME_MS = 1000 / 30`.

- [ ] **Step 1: Write the failing DOM test**

```ts
it("blits transition frames and stops when the engine finishes", () => {
  const gauge = (value: number) =>
    buildGaugeOption(defaultGaugeSettings, sample(value), true);
  const chart = new YunariChart(chartOptions({
    family: "gauge", settings: defaultGaugeSettings, option: gauge(10),
  }));
  const canvas = new StaticCanvas(undefined, { width: 400, height: 300 });
  canvas.add(chart);
  const render = vi.spyOn(canvas, "requestRenderAll")
    .mockImplementation(() => undefined as never);
  const engine = chart as unknown as {
    _onEngineRendered(): void;
    _onEngineFinished(): void;
  };

  chart.setOption(gauge(20));
  render.mockClear();

  engine._onEngineRendered();
  expect(render, "a transition frame was not blitted").toHaveBeenCalled();
  engine._onEngineFinished();
  render.mockClear();
  engine._onEngineRendered();
  expect(render).not.toHaveBeenCalled();
  chart.dispose();
});
```

Add a second case pinning the cap: with `vi.spyOn(performance, "now")` returning a fixed value, two consecutive `_onEngineRendered()` calls blit once. Add a third: `setOption(buildGaugeOption(settings, sample(30), false))` then `_onEngineRendered()` requests no render, because a chart whose settings disable animation never arms the pump.

- [ ] **Step 2: Run it red**

Run: `node node_modules/vitest/vitest.mjs run packages/scene-fabric/src/chart-object.dom.test.ts`
Expected: FAIL — `_onEngineRendered` requested no render.

- [ ] **Step 3: Implement** in `YunariChart`: reset `_pumping = true` and `_lastPumpMs = Number.NEGATIVE_INFINITY` immediately before `this._chart?.setOption(...)`; in `_onEngineRendered`, after `set("dirty", true)`, request one canvas render when pumping and `performance.now() - _lastPumpMs >= TRANSITION_FRAME_MS`. Subscribe `this._chart.on("finished", this._onEngineFinished)` in `_mount`, where `_onEngineFinished` clears `_pumping`; unsubscribe in `dispose`. Extend the docblocks: the render is still asked for by the thing that changed the pixels, now bounded to a transition.

- [ ] **Step 4: Run it green**

Run: `node node_modules/vitest/vitest.mjs run packages/scene-fabric/src/chart-object.dom.test.ts packages/scene-fabric/src/chart-object.test.ts`
Expected: PASS, and the earlier series-identity tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/scene-fabric/src/chart-object.ts \
  src/web/packages/scene-fabric/src/chart-object.dom.test.ts STATUS.md
git commit -m "feat(charts): blit a chart's transition frames"
```

### Task 3: Clock text repaints only when it changes

**Files:**
- Modify: `src/web/packages/scene-fabric/src/fabric-text.ts`
- Modify: `src/web/packages/scene-fabric/src/fabric-text.dom.test.ts`

**Interfaces:**
- Produces: unchanged `refreshBoundText` signature; it now sets text, layout and requests a render only when at least one object's resolved text differs from what it shows.

- [ ] **Step 1: Write the failing test** in the existing bound-text describe of `fabric-text.dom.test.ts`

```ts
it("does not repaint a reading whose text did not change", async () => {
  const { canvas, object } = stage();
  const source = {
    revision: 0,
    latest: () => ({ sensorId: "cpu.load", timestamp: "", status: "ok" as const, value: 48 }),
    history: () => [],
  };
  const render = vi.spyOn(canvas, "requestRenderAll");
  const bindings = { label: [{ id: "load", semanticKey: "cpu.load" }] };

  refreshBoundText(canvas, bindings, source, undefined);
  render.mockClear();
  const text = object.text;
  refreshBoundText(canvas, bindings, source, undefined);

  expect(object.text).toBe(text);
  expect(render, "an unchanged reading repainted").not.toHaveBeenCalled();
  await canvas.dispose();
});
```

Update the existing "measures a bound object once in the sample pass" case: its source resolves no reading, so the placeholder already shown is unchanged and the expected measure count becomes 0.

- [ ] **Step 2: Run it red**

Run: `node node_modules/vitest/vitest.mjs run packages/scene-fabric/src/fabric-text.dom.test.ts`
Expected: FAIL — a render was requested for unchanged text.

- [ ] **Step 3: Implement** — in `refreshBoundText`'s per-object block, compare the resolved `shape.text` with `object.text`; when equal, skip the `set`, `refreshLayout` and record no change. Track `changed` across the walk and call `canvas.requestRenderAll()` only when something changed. Comment: a minute clock paints once a minute because its rendered string is what repaints, not the 1 Hz sample.

- [ ] **Step 4: Run it green**

Run: `node node_modules/vitest/vitest.mjs run packages/scene-fabric/src/fabric-text.dom.test.ts packages/scene-fabric/src/authored-box.dom.test.ts packages/scene-fabric/src/persist.dom.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/scene-fabric/src/fabric-text.ts \
  src/web/packages/scene-fabric/src/fabric-text.dom.test.ts STATUS.md
git commit -m "fix(text): repaint a bound reading only when its text changes"
```

---

## Phase 2 — Removal and preview

### Task 4: The preview source answers every dictionary key

**Files:**
- Modify: `src/web/packages/fake-source/src/index.ts`
- Modify: `src/web/packages/fake-source/src/index.test.ts`

**Interfaces:**
- Consumes: `describeSemanticKey`, `SEMANTIC_KEYS`, `ValueKind`.
- Produces: `FakeSampleSource.sampleAt(key, ms)` returning `textValue` for text/instant/image keys, `booleanValue` for boolean keys, and `value` + the descriptor's `unit` for numeric keys.

- [ ] **Step 1: Write the failing invariant test**

```ts
import { SEMANTIC_KEYS } from "@yunari/renderer-core";

it("answers every key in the semantic dictionary with its own kind", () => {
  const source = new FakeSampleSource(T0);
  for (const descriptor of SEMANTIC_KEYS) {
    const sample = source.sampleAt(descriptor.key, T0);
    expect(sample.status, descriptor.key).toBe("ok");
    if (descriptor.instant !== undefined) {
      expect(sample.textValue, descriptor.key).toMatch(/^\d{4}-\d\d-\d\dT/);
    } else if (descriptor.valueKind === "text") {
      expect(typeof sample.textValue, descriptor.key).toBe("string");
    } else if (descriptor.valueKind === "boolean") {
      expect(typeof sample.booleanValue, descriptor.key).toBe("boolean");
    } else {
      expect(typeof sample.value, descriptor.key).toBe("number");
      expect(sample.unit, descriptor.key).toBe(descriptor.unit);
    }
  }
});

it("keeps a capacity total constant", () => {
  const source = new FakeSampleSource(T0);
  for (const key of ["ram.total", "vram.total", "disk.total", "disk.data.total"]) {
    expect(source.sampleAt(key, T0).value).toBe(source.sampleAt(key, T0 + 60_000).value);
  }
});
```

- [ ] **Step 2: Run it red**

Run: `node node_modules/vitest/vitest.mjs run packages/fake-source`
Expected: FAIL — text and boolean keys come back with numeric values; data-rate keys carry no unit.

- [ ] **Step 3: Implement** in `sampleAt`, after the explicit `textValues` override and before the capacity/waveform branches: resolve `describeSemanticKey(key)`; emit `booleanValue` (`stableHash(key) % 2 === 0`) for `valueKind: "boolean"`, `textValue` for `valueKind: "text"` from a module `TEXT_VALUES` table with `descriptor.label` as fallback. In the numeric branch use `descriptor.unit ?? profile.unit`. Add `"disk.total": { value: 2_000, unit: "GB" }` and `"disk.data.total": { value: 2_000, unit: "GB" }` to `CAPACITY_TOTALS`. `TEXT_VALUES` names the recognisable sensors (`gpu.name`: "Reference GPU", `cpu.model`: "Yunari Dev CPU", `system.os`: "Windows 11", `system.hostname`: "studio-pc", `battery.state`: "Discharging", `weather.location`: "Local", `weather.condition`: "Partly cloudy", `media.state`: "Playing", `media.app`: "Music", `game.name`: "Sample Game", `disk.name`: "System"); every other text key falls back to its label.

- [ ] **Step 4: Run it green**

Run: `node node_modules/vitest/vitest.mjs run packages/fake-source packages/editor/src/preview-source.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/fake-source/src/index.ts \
  src/web/packages/fake-source/src/index.test.ts STATUS.md
git commit -m "feat(fake-source): answer every semantic key with its own kind"
```

### Task 5: The host and the player stop carrying a rate

**Files:**
- Modify: `src/web/packages/host/src/settings/displays.ts`
- Modify: `src/web/packages/host/src/settings/displays.test.ts`
- Modify: `src/web/packages/host/src/server.ts`
- Modify: `src/web/packages/host/src/server.test.ts`
- Modify: `src/web/packages/player/src/publish-follower.ts`
- Modify: `src/web/packages/player/src/publish-follower.test.ts`
- Modify: `src/web/packages/player/src/main.ts`
- Modify: `src/web/packages/player/src/main.dom.test.ts`

**Interfaces:**
- Removes: `chartFps` from `DisplayRecord`/`DisplayPatch`, `chartFpsFor`, `rateOrThrow`; `chartFps` from the display poll; `PublishFollowerOptions.onRateChange`; the player's `chartRate`.
- Keeps until Task 6: `ChartRefreshRate` and `startChartRefresh(refresh, rate)`. The player passes the literal `30`.

- [ ] **Step 1: Run the affected suites red**

Delete the rate-specific cases first (they describe behaviour that is going away): `displays.test.ts`'s `chartFpsFor` cases and the stored-rate case; `publish-follower.test.ts`'s `followPublished's rate report` describe; `main.dom.test.ts`'s `the rate the display repaints at` describe (lines 333–603) and its local helpers `chartFps`, `chartTimerDelays`, `refreshLoopsStarted`, `chartWakes`; the `chartFps` assertions in `server.test.ts`. Replace `displays.test.ts`'s stored-rate case with one that reads a record written with `chartFps: 1` and expects the display to load with no rate field and no throw. Then update the remaining fixtures and run:

Run: `node node_modules/vitest/vitest.mjs run packages/host/src/settings/displays.test.ts packages/host/src/server.test.ts packages/player/src/publish-follower.test.ts packages/player/src/main.dom.test.ts`
Expected: FAIL where the imports and payload types still name the rate.

- [ ] **Step 2: Implement the host removal** — delete the field, the two helpers and every read/write of `chartFps`; delete `chartFpsForDisplay` and the poll's field; update the docblock that named "the rate a display's charts repaint at".

- [ ] **Step 3: Implement the player removal** — delete `onRateChange` and the `chartFps` read in `publish-follower.ts`; delete `chartRate` and the re-rate callback in `main.ts`; call `startChartRefresh(refresh, 30, undefined, { onError: reportRepaintError })`.

- [ ] **Step 4: Run it green**

Run: `node node_modules/vitest/vitest.mjs run packages/host/src/settings/displays.test.ts packages/host/src/server.test.ts packages/player/src/publish-follower.test.ts packages/player/src/main.dom.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/host/src/settings/displays.ts \
  src/web/packages/host/src/settings/displays.test.ts \
  src/web/packages/host/src/server.ts src/web/packages/host/src/server.test.ts \
  src/web/packages/player/src/publish-follower.ts \
  src/web/packages/player/src/publish-follower.test.ts \
  src/web/packages/player/src/main.ts src/web/packages/player/src/main.dom.test.ts STATUS.md
git commit -m "refactor(host): stop publishing a per-display chart rate"
```

### Task 6: One fixed cadence in scene-fabric and the editor

**Files:**
- Modify: `src/web/packages/scene-fabric/src/chart-refresh.ts`
- Modify: `src/web/packages/scene-fabric/src/chart-refresh.test.ts`
- Modify: `src/web/packages/scene-fabric/src/index.ts`
- Modify: `src/web/packages/player/src/main.ts`
- Modify: `src/web/packages/editor/src/editor-main.ts`
- Modify: `src/web/packages/editor/src/editor-shell/session-facade.ts`
- Modify: `src/web/packages/editor/src/editor-shell/shell-menu-bar.tsx`
- Modify: `src/web/packages/editor/src/editor-shell/shell-layout.dom.test.tsx`
- Modify: `src/web/packages/editor/src/ui-copy.ts`
- Modify: `src/web/packages/editor/src/copy-defects.test.ts`
- Modify: `src/web/packages/editor/src/live-runtime.ts`

**Interfaces:**
- Produces: `startSceneRefresh(refresh: () => void, frames?: FrameDriver, options?: ChartRefreshOptions)`; `FrameDriver` keeps only `requestFrame`/`cancelFrame`.
- Removes: `ChartRefreshRate`, `setRate`, the 1 fps timer branch, `EditorViewControls.chartRefreshRate`/`setChartRefreshRate`, `uiCopy.view.chartRefresh`/`fps30`/`fps1`, and the View menu's rate row.

- [ ] **Step 1: Rewrite `chart-refresh.test.ts` first**

Replace the rate cases with: the loop requests a frame on mount and re-arms one per tick; `stop()` clears the pending frame and `start()` re-arms; `dispose()` ends it; a refresh that throws keeps the cadence. Drop `setRate` from every fake driver.

- [ ] **Step 2: Run it red**

Run: `node node_modules/vitest/vitest.mjs run packages/scene-fabric/src/chart-refresh.test.ts`
Expected: FAIL — the type and export still carry a rate.

- [ ] **Step 3: Implement the loop** — fixed `1_000 / 30` interval, frame wake only; delete the timer driver members and the `setTimer`/`clearTimer` branch. Export `startSceneRefresh` from `scene-fabric/src/index.ts`.

- [ ] **Step 4: Implement the editor removal** — delete the rate state, facade methods, menu `ViewSetting` row, and the three copy strings; update the `shell-layout.dom.test.tsx` menu assertion to expect only the source trigger, its comment, and the `copy-defects.test.ts` comment that names `chartRefresh`; update `live-runtime.ts`'s "author's chart rate" comments to the fixed 30.

- [ ] **Step 5: Run it green**

Run: `node node_modules/vitest/vitest.mjs run packages/scene-fabric/src/chart-refresh.test.ts packages/editor/src/editor-shell/shell-layout.dom.test.tsx packages/editor/src/copy-defects.test.ts packages/player/src/main.dom.test.ts`
Run: `npm run typecheck --workspaces --if-present`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/web/packages/scene-fabric/src/chart-refresh.ts \
  src/web/packages/scene-fabric/src/chart-refresh.test.ts \
  src/web/packages/scene-fabric/src/index.ts \
  src/web/packages/player/src/main.ts \
  src/web/packages/editor/src/editor-main.ts \
  src/web/packages/editor/src/editor-shell/session-facade.ts \
  src/web/packages/editor/src/editor-shell/shell-menu-bar.tsx \
  src/web/packages/editor/src/editor-shell/shell-layout.dom.test.tsx \
  src/web/packages/editor/src/ui-copy.ts \
  src/web/packages/editor/src/copy-defects.test.ts \
  src/web/packages/editor/src/live-runtime.ts STATUS.md
git commit -m "refactor(scene): one fixed refresh cadence"
```

---

## Phase 3 — Close-out

### Task 7: Evidence and the merge

- [ ] **Step 1: Update the spec's status** to `implemented 2026-10-27` and note in the decision note 0129 what the probe measured.

- [ ] **Step 2: Run the full gate**

Run: `npm run gate > "C:/Users/peter/AppData/Local/Temp/yunari-gate-rate-removal.log" 2>&1; echo "exit=$?"`
Expected: `exit=0`; report the unit and worker counts from the log.

- [ ] **Step 3: Commit the close-out**

```bash
git add docs/superpowers/specs/2026-10-27-the-display-animates-without-a-rate-setting-design.md \
  docs/decisions/0129-a-transition-blits-its-own-frames.md STATUS.md
git commit -m "docs(specs): the rate removal is implemented"
```

- [ ] **Step 4: Merge locally to `main`** with `--ff-only` from the main checkout (`D:/git-repos/yunari`), then confirm `git status` clean and `git log -1` is the close-out commit.
