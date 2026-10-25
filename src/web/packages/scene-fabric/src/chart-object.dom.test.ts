// @vitest-environment jsdom

import {
  buildBarOption,
  buildGaugeOption,
  buildLineOption,
  buildPieOption,
  defaultBarSettings,
  defaultGaugeSettings,
  defaultLineSettings,
  defaultPieSettings,
  type Sample,
} from "@yunari/renderer-core";
import { Group, StaticCanvas } from "fabric/es";
import { describe, expect, it, vi } from "vitest";
import { YunariChart, type YunariChartOptions } from "./chart-object.js";

/**
 * The chart object, actually mounted.
 *
 * ## Why this file overrides the node environment
 *
 * `vitest.config.ts` runs in `node` and says visual behaviour belongs to
 * Playwright. That is still right, and this is not visual behaviour — nothing
 * here looks at a pixel. It asserts **wiring**: that the object constructs, that
 * ECharts initialises on a detached canvas, that the serialised surface is what
 * it claims, that a revived object is an object, and that an engine repaint
 * reaches an enclosing group's cache.
 *
 * All of that needs a `document` and a real 2D context, and nothing more —
 * `jsdom` plus the `canvas` package already in the tree provide exactly that.
 * Deferring it to a browser is what let stage 1 ship an object that **could not
 * be constructed at all**: `option` was a getter with no setter, so Fabric's
 * only entry path threw on every construction, under a green suite of 1,131
 * tests. The prototype-shape test in `chart-object.test.ts` catches that class
 * without a DOM; this file catches the things only a mount can show.
 *
 * Keep it that way. If an assertion here starts needing to compare pixels,
 * colours or layout, it belongs in `tests/e2e`.
 */

const NOW_MS = Date.UTC(2026, 8, 15, 12, 0, 0);

function sample(value: number, offsetMs = 0): Sample {
  return {
    sensorId: "cpu.load",
    timestamp: new Date(NOW_MS - offsetMs).toISOString(),
    status: "ok",
    value,
  };
}

// `animate: false` throughout — the engine's own animation loop does not drive
// Fabric, and these assert wiring rather than motion.
const LINE_OPTION = buildLineOption(
  defaultLineSettings,
  [{ sensorId: "cpu.load", samples: [sample(1, 1000), sample(2)] }],
  NOW_MS,
  false,
);

function chartOptions(
  overrides: Partial<YunariChartOptions> = {},
): YunariChartOptions {
  return {
    family: "line",
    settings: defaultLineSettings,
    width: 300,
    height: 180,
    option: LINE_OPTION,
    ...overrides,
  } as YunariChartOptions;
}

describe("constructing a chart", () => {
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

  it("accepts a built option, which is the regression that mattered", () => {
    // Fabric's `_setOptions` assigns every key of the options bag onto the
    // instance. When `option` was a getter with no setter this threw
    // `TypeError: Cannot set property option … which has only a getter` —
    // every single time, and nothing noticed.
    const chart = new YunariChart(chartOptions());

    expect(chart.disposed).toBe(false);
    expect(chart.option).toBe(LINE_OPTION);
    chart.dispose();
  });

  it("applies its own defaults rather than Fabric’s", () => {
    // `FabricObject`'s constructor assigns `FabricObject.ownDefaults` by name,
    // not `this.constructor.getDefaults()`, so a subclass must assign its own.
    // Measured here rather than read off the static, because the whole point is
    // that the constructor path applies them.
    const chart = new YunariChart(chartOptions());

    expect(chart.originX).toBe("center");
    expect(chart.originY).toBe("center");
    expect(chart.objectCaching).toBe(false);
    expect(chart.strokeWidth).toBe(0);
    chart.dispose();
  });

  it("lets the caller override a Fabric property the defaults also set", () => {
    // The previous constructor re-set origin and caching *after* applying the
    // caller's options, so it silently overrode them. Nothing needs a different
    // origin today; this asserts the mechanism, not a use case.
    const chart = new YunariChart(
      chartOptions({ angle: 37, left: 10, top: 20 }),
    );

    expect(chart.angle).toBe(37);
    expect(chart.left).toBe(10);
    expect(chart.top).toBe(20);
    chart.dispose();
  });

  it("refuses a box it cannot draw in", () => {
    // `echarts.init` on a 0-sized element does not fail loudly, it just never
    // draws. Refuse rather than coerce.
    expect(() => new YunariChart(chartOptions({ width: 0 }))).toThrow(
      /positive width and height/,
    );
    expect(() => new YunariChart(chartOptions({ height: 0 }))).toThrow(
      /positive width and height/,
    );
  });

  it("clamps the render scale against its own box", () => {
    const chart = new YunariChart(chartOptions({ renderScale: 99 }));

    expect(chart.renderScale).toBeLessThanOrEqual(3);
    chart.dispose();
  });

  it("mounts every family the engine registration covers", () => {
    // `chart-engine.ts` registers four families and `GridComponent`. A missing
    // registration does not throw on `init` — the chart just never draws — so
    // the only honest check is to build each family's real option and mount it.
    const built: readonly YunariChartOptions[] = [
      chartOptions(),
      chartOptions({
        family: "gauge",
        settings: defaultGaugeSettings,
        option: buildGaugeOption(defaultGaugeSettings, sample(42), false),
      }),
      chartOptions({
        family: "bar",
        settings: defaultBarSettings,
        option: buildBarOption(
          defaultBarSettings,
          [{ sensorId: "cpu.load", sample: sample(1) }],
          false,
        ),
      }),
      chartOptions({
        family: "pie",
        settings: defaultPieSettings,
        option: buildPieOption(
          defaultPieSettings,
          [{ sensorId: "cpu.load", sample: sample(1) }],
          false,
        ),
      }),
    ];

    for (const options of built) {
      const chart = new YunariChart(options);

      expect(chart.disposed, `${String(options.family)} failed to mount`).toBe(
        false,
      );
      chart.dispose();
    }
  });
});

describe("the serialised object", () => {
  it("emits the custom properties and nothing derived", () => {
    const chart = new YunariChart(chartOptions());
    const json = chart.toObject();

    expect(json).toMatchObject({ type: "YunariChart", family: "line" });
    expect(json.settings).toEqual(defaultLineSettings);

    // The §67 rule, measured on the real output rather than on the key list:
    // the built option holds live samples in `series[].data`, and `renderScale`
    // is the display's, not the document's.
    expect(json).not.toHaveProperty("option");
    expect(json).not.toHaveProperty("renderScale");
    chart.dispose();
  });

  it("omits the origin when defaults are stripped, like every other class", () => {
    // **This assertion inverted on 2026-09-15**, and it is not a regression.
    // It used to require the origin to survive stripping, which needed a
    // `toObject` override — §134's explicit-origin condition. That condition
    // was replaced: defaults are stripped everywhere, so a persisted key means
    // an authored deviation and an absent one means the default of the Fabric
    // major the envelope records and refuses to load across. The override was
    // withdrawn with it.
    //
    // What makes this worth asserting rather than deleting is that the chart
    // must behave like `Rect` and `Group` here. A single class still writing
    // its origin is how the withdrawn rule comes back for one object.
    const chart = new YunariChart(chartOptions());

    chart.includeDefaultValues = false;

    const json = chart.toObject();

    expect(json).not.toHaveProperty("originX");
    expect(json).not.toHaveProperty("originY");
    // Still centred in memory: only the *persisted* surface changed.
    expect(chart.originX).toBe("center");
    chart.dispose();
  });

  it("revives through Fabric’s own path, into a real chart", async () => {
    // `fromObject` is not overridden, so this exercises
    // `FabricObject._fromObject` — including `enlivenObjectEnlivables`, which
    // an override would have skipped. A revived chart carries configuration,
    // not pixels: the option is derived and `plan.ts` re-supplies it.
    const chart = new YunariChart(chartOptions({ angle: 37 }));
    const json = chart.toObject();
    chart.dispose();

    // Cast because the inherited static keeps `FabricObject`'s return type; the
    // point of the assertion below is that the instance is the right class.
    const revived = (await YunariChart.fromObject(json)) as YunariChart;

    expect(revived).toBeInstanceOf(YunariChart);
    expect(revived.family).toBe("line");
    expect(revived.settings).toEqual(defaultLineSettings);
    expect(revived.angle).toBe(37);
    expect(revived.originX).toBe("center");
    expect(revived.option).toBeUndefined();
    revived.dispose();
  });
});

describe("the canvas round trip", () => {
  it("revives a chart through StaticCanvas.loadFromJSON", async () => {
    // The path stage 3 actually depends on, which had no test: only
    // `YunariChart.fromObject` did, and calling that directly proves the class
    // can revive itself while saying nothing about whether the *canvas* can
    // find it. That needs `classRegistry.setClass` to have run — which happens
    // on import of `chart-object.ts`, and is exactly what `package.json`'s
    // `sideEffects` entry stops a bundler from dropping.
    const source = new StaticCanvas(undefined, { width: 400, height: 300 });
    const chart = new YunariChart(
      chartOptions({ left: 150, top: 90, angle: 37 }),
    );

    source.add(chart);

    const json = source.toObject();
    await source.dispose();

    const revived = new StaticCanvas(undefined, { width: 400, height: 300 });
    await revived.loadFromJSON(json);

    const objects = revived.getObjects();

    expect(objects).toHaveLength(1);

    const [first] = objects;

    // The assertion that matters: a real `YunariChart`, not the plain
    // `FabricObject` the registry falls back to when a class is unknown.
    expect(first).toBeInstanceOf(YunariChart);
    expect((first as YunariChart).family).toBe("line");
    expect((first as YunariChart).settings).toEqual(defaultLineSettings);
    expect(first?.angle).toBe(37);
    // Derived, so it does not survive — `plan.ts` re-supplies it, which is the
    // normal render path.
    expect((first as YunariChart).option).toBeUndefined();

    await revived.dispose();
  });
});

describe("an engine repaint reaches the canvas", () => {
  it("invalidates an enclosing group’s cache", () => {
    // The defect this exists for: `dirty` was set by field assignment, which
    // skips `FabricObject._set` — and `_set` is the only thing that propagates
    // dirtiness to `this.parent`. A Fabric `Group` caches by default, so the
    // group would have kept redrawing a stale bitmap while the chart repainted
    // underneath it: a live chart frozen the moment it is grouped, and visible
    // nowhere else.
    const chart = new YunariChart(chartOptions());
    const group = new Group([chart]);

    group.set("dirty", false);
    chart.set("dirty", false);
    expect(group.dirty).toBe(false);

    // A real engine repaint, not a synthetic event: `setOption` runs with
    // `lazyUpdate: false`, so zrender paints and fires `rendered` before this
    // returns.
    chart.setOption(LINE_OPTION);

    expect(chart.dirty).toBe(true);
    expect(group.dirty).toBe(true);
    chart.dispose();
  });

  it("asks the canvas to redraw for its own repaint, and not for the engine's", () => {
    // The second half of `vg-107`. The canvas render used to ride the engine's
    // `rendered` event, so every engine repaint — an animation frame, a group's
    // re-render, anything the engine did on its own — asked Fabric to redraw the
    // **whole document**. The chart asks for the blit where it changes its own
    // pixels instead, so a repaint it did not ask for invalidates the object
    // (which is what an enclosing group's cache reads) without redrawing the
    // scene.
    const chart = new YunariChart(chartOptions());
    const canvas = new StaticCanvas(undefined, { width: 400, height: 300 });
    canvas.add(chart);
    const render = vi
      .spyOn(canvas, "requestRenderAll")
      .mockImplementation(() => undefined as never);
    render.mockClear();
    chart.set("dirty", false);

    // zrender's `rendered`, invoked the way the engine invokes it.
    (chart as unknown as { _onEngineRendered: () => void })._onEngineRendered();

    expect(chart.dirty).toBe(true);
    expect(render).not.toHaveBeenCalled();

    // The repaint the chart *did* ask for still reaches the canvas, so the
    // pixels it painted cannot be left invisible.
    chart.setOption(LINE_OPTION);
    expect(render).toHaveBeenCalledTimes(1);
    chart.dispose();
  });
});

describe("a gauge crossing from no value to a value", () => {
  /** The real built options, so this breaks if `gauge.ts` regresses. */
  function gauge(noValue: boolean, value: number) {
    return buildGaugeOption(
      defaultGaugeSettings,
      noValue ? undefined : sample(value),
      false,
    );
  }

  function gaugeChart(option: ReturnType<typeof buildGaugeOption>) {
    return new YunariChart(
      chartOptions({
        family: "gauge",
        settings: defaultGaugeSettings,
        option,
      }),
    );
  }

  it("survives the transition the engine cannot survive with a datum", () => {
    // **0008, and the throw it removes.** ECharts 6.1.0's
    // `GaugeView._renderPointer` reads its own `_progressEls` inside the
    // data-diff `update` callback, and only assigns it after a render that
    // actually drew a progress arc. `DataDiffer` only calls `update` for a
    // datum present in both the old and the new data, so the first render is
    // safe and the second is not: a gauge mounted before telemetry has arrived
    // — which is exactly what the player does, and the editor does not — threw
    // `TypeError: Cannot read properties of undefined (reading '0')` the moment
    // its first sample landed, and the per-chart guard in `hydrateCharts` left
    // the ring as a grey track with no arc.
    //
    // The option is the fix's own claim: no arc, no datum, so the differ emits
    // `add`, which is the one path that never reads `_progressEls`.
    const chart = gaugeChart(gauge(true, 0));

    expect(() => chart.setOption(gauge(false, 59.79))).not.toThrow();
    chart.dispose();
  });

  it("survives it repeatedly, in both directions", () => {
    // A display is not a one-shot: telemetry flaps between readings, gaps and
    // non-`ok` statuses, and each crossing is another `update` callback. The
    // defect hid behind a single transition; the fix has to hold for all of
    // them, so this walks the cycle rather than one step of it.
    const chart = gaugeChart(gauge(true, 0));

    const crossing = () => {
      chart.setOption(gauge(false, 59.79));
      chart.setOption(gauge(true, 0));
      chart.setOption(gauge(false, 12.5));
    };

    expect(crossing).not.toThrow();
    expect(crossing).not.toThrow();
    chart.dispose();
  });
});

describe("disposal", () => {
  it("is idempotent and refuses further work", () => {
    // Whatever owns the canvas must call this: `canvas.remove()` does not.
    const chart = new YunariChart(chartOptions());

    chart.dispose();
    expect(chart.disposed).toBe(true);
    expect(() => chart.dispose()).not.toThrow();

    // A disposed chart accepts nothing, so a late telemetry push cannot
    // resurrect a released ECharts instance.
    chart.setOption(LINE_OPTION);
    chart.resizeTo(10, 10);
    chart.setRenderScale(1);
    expect(chart.disposed).toBe(true);
  });
});
