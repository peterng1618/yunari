// @vitest-environment jsdom

import { LineChart } from "echarts/charts";
import { GridComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Sample } from "../types.js";
import { toEngineOption } from "./engine-option.js";
import {
  buildLineOption,
  defaultLineSettings,
  type LineOption,
} from "./line.js";

/**
 * What the grid option does once it reaches the engine.
 *
 * ## Why this one test needs a DOM
 *
 * Everything else about the builders is decidable from the option object, and
 * `vitest.config.ts` runs in `node` for that reason. Two things here are not.
 *
 * **The deprecation.** `grid.containLabel` is deprecated in ECharts 6 and every
 * mount logged `[ECharts] Specified grid.containLabel but no
 * use(LegacyGridContainLabel); use grid.outerBounds instead`. Only a mounted
 * chart says that, so only a mounted chart can assert it stopped.
 *
 * **That the replacement is not inert.** The key it replaced *looked* applied
 * and was asserted by two unit tests; the instruction that follows from that is
 * to assert the layout rather than the key.
 *
 * Measured here 2026-09-15, one 400x240 line chart, plot-area left edge in
 * pixels — and note the first two rows, because the review predicted
 * otherwise:
 *
 * | grid | plot left | plot bottom |
 * |---|---|---|
 * | `containLabel: true` (before) | 61.94 | 212 |
 * | `outerBoundsMode: 'same'`, `outerBoundsContain: 'axisLabel'` (now) | 61.94 | 212 |
 * | neither, i.e. ECharts' `'auto'` | 53.94 | 220 |
 * | `outerBoundsMode: 'none'` | 8 | 232 |
 *
 * So the deprecated key was **still honoured** — 6.1.0 routes `'auto'` to
 * `'same'` when it is set — and the change is exactly layout-preserving. What it
 * buys is the warning gone, no deprecated key in the emitted option, and no
 * dependence on a legacy module nobody registered. Nothing here looks at a
 * pixel; `jsdom` + `canvas` are only what let `echarts.init` measure text.
 */

const NOW_MS = Date.UTC(2026, 8, 15, 12, 0, 0);
const WIDTH = 400;
const HEIGHT = 240;

/** The inset the line builder applies when axes are drawn. */
const AXIS_INSET_PX = 8;

const instances: echarts.ECharts[] = [];

// The pieces these options need. `scene-fabric/chart-engine.ts` owns this for
// the app; renderer-core must not import that package, so a test that mounts a
// chart registers what it uses.
echarts.use([LineChart, GridComponent, CanvasRenderer]);

afterEach(() => {
  while (instances.length > 0) {
    instances.pop()?.dispose();
  }
});

function sample(value: number, offsetMs = 0): Sample {
  return {
    sensorId: "cpu.load",
    timestamp: new Date(NOW_MS - offsetMs).toISOString(),
    status: "ok",
    value,
  };
}

function lineOption(showAxes: boolean): LineOption {
  // Five figures and a decimal, so the y labels are wide enough that reserving
  // space for them is unmistakable next to an 8 px inset.
  return buildLineOption(
    { ...defaultLineSettings, showAxes },
    [{ sensorId: "cpu.load", samples: [sample(1, 1000), sample(88_888.5)] }],
    NOW_MS,
    false,
  );
}

function mount(option: LineOption): echarts.ECharts {
  const chart = echarts.init(document.createElement("canvas"), null, {
    renderer: "canvas",
    devicePixelRatio: 1,
    width: WIDTH,
    height: HEIGHT,
  });
  instances.push(chart);

  chart.setOption(toEngineOption(option), {
    notMerge: true,
    lazyUpdate: false,
  });

  return chart;
}

/**
 * The x pixel of the plot area's left edge.
 *
 * The x axis minimum maps to that edge by definition, so this is the grid rect
 * measured through public API rather than read off an internal model.
 */
function plotLeftEdge(option: LineOption): number {
  const x = mount(option).convertToPixel({ xAxisIndex: 0 }, option.xAxis.min);

  expect(typeof x, "convertToPixel did not resolve the x axis").toBe("number");

  return x as number;
}

describe("the grid option the engine receives", () => {
  it("draws a chart with axes without ECharts complaining about it", () => {
    // The actual regression guard for `cartesianGrid`: reintroduce
    // `containLabel` and this fails, because ECharts logs the deprecation on
    // every mount. Asserted on `console.log` because that is where ECharts'
    // own `log()` writes — not `console.warn`.
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    mount(lineOption(true));

    const said = [log, warn, error]
      .flatMap((spy) => spy.mock.calls)
      .map((call) => call.map(String).join(" "));

    expect(said, "the engine complained about the grid option").toEqual([]);
  });

  it("keeps the authored inset because no axis labels are drawn", () => {
    // Behaviour rather than keys. Charts draw no engine text, so containment
    // has nothing to reserve; the plot starts at the authored inset.
    expect(plotLeftEdge(lineOption(true))).toBe(AXIS_INSET_PX);

    // A sparkline must reach the element edges the author laid out. This is the
    // half `outerBoundsMode: 'none'` buys: ECharts' default would contain
    // against the canvas and inset an element that asked for no margins.
    expect(plotLeftEdge(lineOption(false))).toBe(0);
  });
});
