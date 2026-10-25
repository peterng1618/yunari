import { describe, expect, it } from "vitest";
import type { Sample, SensorStatus } from "../types.js";
import {
  buildLineOption,
  defaultLineSettings,
  type Interpolation,
  type LinearGradientColor,
  type LineSettings,
  type SeriesInput,
  toEngineColor,
  toSeriesPoints,
} from "./line.js";

const NOW = Date.parse("2026-01-01T00:01:00Z"); // 60s after the epoch below
const T0 = Date.parse("2026-01-01T00:00:00Z");

/** A sample at `offsetSeconds` past T0. */
function at(offsetSeconds: number, value: number): Sample {
  return {
    sensorId: "cpu.load.total",
    timestamp: new Date(T0 + offsetSeconds * 1000).toISOString(),
    status: "ok",
    value,
    unit: "%",
  };
}

/** A non-ok sample at `offsetSeconds`, with no value at all. */
function bad(
  offsetSeconds: number,
  status: Exclude<SensorStatus, "ok">,
): Sample {
  return {
    sensorId: "cpu.load.total",
    timestamp: new Date(T0 + offsetSeconds * 1000).toISOString(),
    status,
    unit: "%",
  };
}

describe("toSeriesPoints — the gap rule (§83)", () => {
  it.each(["missing", "error", "unavailable", "stale"] as const)(
    "emits an explicit null for a %s sample rather than omitting it",
    (status) => {
      const points = toSeriesPoints(
        [at(10, 40), bad(20, status), at(30, 60)],
        defaultLineSettings,
        NOW,
      );

      // Three points, the middle one null. Omitting it would leave two points
      // and the line would join 40 -> 60 straight across the outage.
      expect(points).toHaveLength(3);
      expect(points[1]![1]).toBeNull();
      expect(points.map((p) => p[1])).toEqual([40, null, 60]);
    },
  );

  it("never emits zero in place of a missing value", () => {
    const points = toSeriesPoints(
      [bad(10, "missing")],
      defaultLineSettings,
      NOW,
    );

    expect(points[0]![1]).toBeNull();
    expect(points[0]![1]).not.toBe(0);
  });

  it("keeps a leading and trailing gap", () => {
    const points = toSeriesPoints(
      [bad(5, "missing"), at(10, 50), bad(15, "error")],
      defaultLineSettings,
      NOW,
    );

    expect(points.map((p) => p[1])).toEqual([null, 50, null]);
  });
});

describe("toSeriesPoints — windowing and bounds", () => {
  it("keeps one sample before the window for the left edge", () => {
    const settings: LineSettings = {
      ...defaultLineSettings,
      windowSeconds: 30,
    };

    // Window is NOW-30s .. NOW, i.e. T0+30s .. T0+60s.
    const points = toSeriesPoints(
      [at(10, 1), at(40, 2), at(50, 3)],
      settings,
      NOW,
    );

    expect(points.map((p) => p[1])).toEqual([1, 2, 3]);
  });

  it("drops samples from the future", () => {
    // A clock skew between host and client should not stretch the axis.
    const points = toSeriesPoints(
      [at(30, 1), at(120, 2)],
      defaultLineSettings,
      NOW,
    );

    expect(points.map((p) => p[1])).toEqual([1]);
  });

  it("drops samples with an unparseable timestamp", () => {
    const broken: Sample = {
      sensorId: "x",
      timestamp: "not-a-date",
      status: "ok",
      value: 5,
    };

    // Plotting this would place it at epoch 0 and stretch the axis to 1970.
    expect(
      toSeriesPoints([broken, at(30, 1)], defaultLineSettings, NOW),
    ).toHaveLength(1);
  });

  it("keeps the latest predecessor left of the scrolling window", () => {
    const settings: LineSettings = {
      ...defaultLineSettings,
      windowSeconds: 30,
    };

    const points = toSeriesPoints(
      [at(29, 1), at(40, 2), at(50, 3)],
      settings,
      NOW,
    );

    expect(points).toEqual([
      [T0 + 29_000, 1],
      [T0 + 40_000, 2],
      [T0 + 50_000, 3],
    ]);
  });

  it("caps retained points by dropping the OLDEST", () => {
    const settings: LineSettings = { ...defaultLineSettings, maxPoints: 3 };
    const samples = [at(10, 1), at(20, 2), at(30, 3), at(40, 4), at(50, 5)];

    const points = toSeriesPoints(samples, settings, NOW);

    expect(points.map((p) => p[1])).toEqual([3, 4, 5]);
  });

  it("never averages or interpolates when capping", () => {
    const settings: LineSettings = { ...defaultLineSettings, maxPoints: 2 };
    const points = toSeriesPoints(
      [at(10, 0), at(20, 100), at(30, 50)],
      settings,
      NOW,
    );

    // Every retained value must be one that was actually measured.
    for (const [, value] of points) {
      expect([0, 100, 50]).toContain(value);
    }
  });

  it("sorts out-of-order input by timestamp", () => {
    const points = toSeriesPoints(
      [at(50, 3), at(10, 1), at(30, 2)],
      defaultLineSettings,
      NOW,
    );

    expect(points.map((p) => p[1])).toEqual([1, 2, 3]);
    expect(points.map((p) => p[0])).toEqual(
      [...points.map((p) => p[0])].sort((a, b) => a - b),
    );
  });

  it("returns an empty series for no samples", () => {
    expect(toSeriesPoints([], defaultLineSettings, NOW)).toEqual([]);
  });
});

describe("buildLineOption", () => {
  it("pins connectNulls to false so gaps are never bridged", () => {
    const option = buildLineOption(
      defaultLineSettings,
      [{ sensorId: "a", samples: [] }],
      NOW,
    );

    expect(option.series[0]!.connectNulls).toBe(false);
  });

  it("scrolls the x axis after the configured window fills", () => {
    const settings: LineSettings = {
      ...defaultLineSettings,
      windowSeconds: 30,
    };
    const option = buildLineOption(
      settings,
      [{ sensorId: "a", samples: [at(10, 1)] }],
      NOW,
    );

    // Without pinning, a chart with one point would collapse its axis onto it.
    expect(option.xAxis.max).toBe(NOW);
    expect(option.xAxis.min).toBe(NOW - 30_000);
  });

  it("does not alter the timeline for legacy player-start inputs", () => {
    const settings: LineSettings = {
      ...defaultLineSettings,
      windowSeconds: 30,
    };
    const option = (
      buildLineOption as (
        ...args: readonly unknown[]
      ) => ReturnType<typeof buildLineOption>
    )(
      settings,
      [{ sensorId: "a", samples: [at(40, 1), at(50, 2)] }],
      NOW,
      true,
      undefined,
      NOW,
    );

    expect(option.xAxis).toMatchObject({ min: NOW - 30_000, max: NOW });
    expect(option.series[0]!.data).toEqual([
      [T0 + 40_000, 1],
      [T0 + 50_000, 2],
    ]);
  });

  it("renders the newest measurement without a synthetic tail", () => {
    const option = buildLineOption(
      defaultLineSettings,
      [{ sensorId: "a", samples: [at(59, 10), at(60, 20)] }],
      NOW + 500,
      true,
      undefined,
    );

    expect(option.series[0]!.data).toEqual([
      [T0 + 59_000, 10],
      [NOW, 20],
    ]);
  });

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

  it.each<[Interpolation, boolean, "end" | false]>([
    ["linear", false, false],
    ["smooth", true, false],
    ["step", false, "end"],
  ])("maps %s interpolation", (interpolation, smooth, step) => {
    const option = buildLineOption(
      { ...defaultLineSettings, interpolation },
      [{ sensorId: "a", samples: [] }],
      NOW,
    );

    expect(option.series[0]!.smooth).toBe(smooth);
    expect(option.series[0]!.step).toBe(step);
  });

  it("treats the area fill as independent of the stroke (§83)", () => {
    const withArea = buildLineOption(
      defaultLineSettings,
      [{ sensorId: "a", samples: [] }],
      NOW,
    );
    expect(withArea.series[0]!.areaStyle).toBeDefined();

    const settings = { ...defaultLineSettings };
    delete (settings as { area?: unknown }).area;
    const withoutArea = buildLineOption(
      settings,
      [{ sensorId: "a", samples: [] }],
      NOW,
    );

    expect(withoutArea.series[0]!.areaStyle).toBeUndefined();
    // Removing the area must not change the stroke.
    expect(withoutArea.series[0]!.lineStyle).toEqual(
      withArea.series[0]!.lineStyle,
    );
  });

  it("supports multiple series (§81)", () => {
    const option = buildLineOption(
      defaultLineSettings,
      [
        { sensorId: "cpu", samples: [at(30, 10)], label: "CPU" },
        { sensorId: "gpu", samples: [at(30, 20)] },
      ],
      NOW,
    );

    expect(option.series).toHaveLength(2);
    expect(option.series[0]!.name).toBe("CPU");
    expect(option.series[1]!.name).toBe("gpu"); // falls back to sensorId
  });

  it("gives a sparkline zero margins and no label reservation", () => {
    const option = buildLineOption(
      { ...defaultLineSettings, showAxes: false },
      [{ sensorId: "a", samples: [] }],
      NOW,
    );

    // A sparkline must reach the element edges the author laid out, so the
    // outer bounds are infinite rather than the canvas. `grid.dom.test.ts`
    // asserts that this reaches the engine; this asserts the option.
    expect(option.grid.outerBoundsMode).toBe("none");
    expect(option.grid.left).toBe(0);
    expect(option.grid.right).toBe(0);
    expect(option.xAxis.show).toBe(false);
    expect(option.yAxis.show).toBe(false);
  });

  it("draws axes without any engine text", () => {
    const option = buildLineOption(defaultLineSettings, [], NOW);
    expect(option.xAxis.axisLabel.show).toBe(false);
    expect(option.yAxis.axisLabel.show).toBe(false);
  });

  it("omits axis bounds when unset rather than sending undefined", () => {
    const option = buildLineOption(
      defaultLineSettings,
      [{ sensorId: "a", samples: [] }],
      NOW,
    );

    expect("min" in option.yAxis).toBe(false);
    expect("max" in option.yAxis).toBe(false);
  });

  it("applies fixed axis bounds when set (§83 ranges)", () => {
    const option = buildLineOption(
      { ...defaultLineSettings, min: 0, max: 100 },
      [{ sensorId: "a", samples: [] }],
      NOW,
    );

    expect(option.yAxis.min).toBe(0);
    expect(option.yAxis.max).toBe(100);
  });

  it("omits sampling unless explicitly enabled", () => {
    const off = buildLineOption(
      defaultLineSettings,
      [{ sensorId: "a", samples: [] }],
      NOW,
    );
    expect(off.series[0]!.sampling).toBeUndefined();

    const on = buildLineOption(
      { ...defaultLineSettings, sampling: "lttb" },
      [{ sensorId: "a", samples: [] }],
      NOW,
    );
    expect(on.series[0]!.sampling).toBe("lttb");
  });

  it("disables animation when asked, for deterministic screenshots", () => {
    const option = buildLineOption(
      defaultLineSettings,
      [{ sensorId: "a", samples: [] }],
      NOW,
      false,
    );

    expect(option.animation).toBe(false);
  });

  it("colours threshold line segments per value when a range is authored", () => {
    // Authored offsets are fractions; `visualMap` pieces are values, so the
    // mapping comes from the declared min/max. A band runs from the previous
    // boundary to its own, matching `resolveThresholdColor`'s "up to here".
    const option = buildLineOption(
      {
        ...defaultLineSettings,
        min: 0,
        max: 200,
        stroke: {
          kind: "thresholds",
          bands: [
            { offset: 0.25, color: "#00ff00" },
            { offset: 0.5, color: "#ffab00" },
            { offset: 1, color: "#ff0000" },
          ],
        },
      },
      [{ sensorId: "a", samples: [at(10, 1)] }],
      NOW,
    );

    expect(option.visualMap).toMatchObject({
      show: false,
      type: "piecewise",
      dimension: 1,
      seriesIndex: 0,
      pieces: [
        { min: -Infinity, max: 50, color: "#00ff00" },
        { min: 50, max: 100, color: "#ffab00" },
        { min: 100, max: Infinity, color: "#ff0000" },
      ],
    });
    // The whole-series colour would fight the per-segment one.
    expect(option.series[0]!.lineStyle).not.toHaveProperty("color");
  });

  it("leaves a threshold line unsplit without an authored range", () => {
    const option = buildLineOption(
      {
        ...defaultLineSettings,
        stroke: {
          kind: "thresholds",
          bands: [{ offset: 0.5, color: "#ff0000" }],
        },
      },
      [{ sensorId: "a", samples: [at(10, 1)] }],
      NOW,
    );

    expect(option.visualMap).toBeUndefined();
    expect(option.series[0]!.lineStyle.color).toBe("#ff0000");
  });

  it("ignores a threshold range that cannot span", () => {
    const option = buildLineOption(
      {
        ...defaultLineSettings,
        min: 5,
        max: 5,
        stroke: {
          kind: "thresholds",
          bands: [{ offset: 0.5, color: "#ff0000" }],
        },
      },
      [{ sensorId: "a", samples: [at(10, 1)] }],
      NOW,
    );

    expect(option.visualMap).toBeUndefined();
  });

  it("leaves a solid line's colour untouched", () => {
    const option = buildLineOption(
      defaultLineSettings,
      [{ sensorId: "a", samples: [at(10, 1)] }],
      NOW,
    );

    expect(option.visualMap).toBeUndefined();
    expect(option.series[0]!.lineStyle.color).toBe("#00b8d9");
  });
});

describe("toEngineColor", () => {
  it("passes a solid colour through", () => {
    expect(toEngineColor({ kind: "solid", color: "#ff0000" }, "stroke")).toBe(
      "#ff0000",
    );
  });

  it("produces a REAL linear gradient — no segment approximation needed here", () => {
    // The contrast with the gauge adapter is the point: a cartesian chart is
    // exactly where an ECharts gradient is defined.
    const color = toEngineColor(
      {
        kind: "gradient",
        stops: [
          { offset: 0, color: "#000000" },
          { offset: 1, color: "#ffffff" },
        ],
      },
      "area",
    ) as LinearGradientColor;

    expect(color.type).toBe("linear");
    expect(color.colorStops).toHaveLength(2);
  });

  it("orients an area gradient vertically and a stroke gradient horizontally", () => {
    const stops = [
      { offset: 0, color: "#000000" },
      { offset: 1, color: "#ffffff" },
    ];

    const area = toEngineColor(
      { kind: "gradient", stops },
      "area",
    ) as LinearGradientColor;
    const stroke = toEngineColor(
      { kind: "gradient", stops },
      "stroke",
    ) as LinearGradientColor;

    expect([area.x2, area.y2]).toEqual([0, 1]); // fades toward the axis
    expect([stroke.x2, stroke.y2]).toEqual([1, 0]); // reads along time
  });

  it("sorts gradient stops and clamps offsets into 0..1", () => {
    const color = toEngineColor(
      {
        kind: "gradient",
        stops: [
          { offset: 1.5, color: "#ffffff" },
          { offset: -0.5, color: "#000000" },
        ],
      },
      "area",
    ) as LinearGradientColor;

    expect(color.colorStops.map((s) => s.offset)).toEqual([0, 1]);
    expect(color.colorStops[0]!.color).toBe("#000000");
  });

  it("collapses a single-stop gradient to a plain colour", () => {
    expect(
      toEngineColor(
        { kind: "gradient", stops: [{ offset: 0.3, color: "#abc" }] },
        "area",
      ),
    ).toBe("#abc");
  });

  it("reduces thresholds to the top band when no range is authored", () => {
    // A line's colour is a whole-series property and the authored offsets are
    // fractions. Without a declared range there is no honest value mapping, so
    // the whole-series fallback stands (§85).
    const color = toEngineColor(
      {
        kind: "thresholds",
        bands: [
          { offset: 0.3, color: "#00ff00" },
          { offset: 0.9, color: "#ff0000" },
        ],
      },
      "stroke",
    );

    expect(color).toBe("#ff0000");
  });

  it("falls back to transparent for an empty fill", () => {
    expect(toEngineColor({ kind: "gradient", stops: [] }, "area")).toBe(
      "transparent",
    );
    expect(toEngineColor({ kind: "thresholds", bands: [] }, "stroke")).toBe(
      "transparent",
    );
  });
});

describe("multi-series strokes", () => {
  /**
   * §81 calls for multi-series line charts. Before the palette, every series
   * drew in `stroke` — two traces in one colour, which a rendered screenshot
   * showed is not a multi-series chart in any useful sense.
   */
  const seriesOf = (count: number): SeriesInput[] =>
    Array.from({ length: count }, (_, i) => ({
      sensorId: `sensor.${i}`,
      samples: [],
    }));

  it("falls back to stroke when no palette is set", () => {
    const option = buildLineOption(
      defaultLineSettings,
      seriesOf(2),
      Date.now(),
    );

    expect(option.series.map((s) => s.lineStyle.color)).toEqual([
      "#00b8d9",
      "#00b8d9",
    ]);
  });

  it("gives each series its own palette entry", () => {
    const option = buildLineOption(
      {
        ...defaultLineSettings,
        palette: [
          { kind: "solid", color: "#aaaaaa" },
          { kind: "solid", color: "#bbbbbb" },
        ],
      },
      seriesOf(2),
      Date.now(),
    );

    expect(option.series.map((s) => s.lineStyle.color)).toEqual([
      "#aaaaaa",
      "#bbbbbb",
    ]);
  });

  it("cycles a palette shorter than the series count", () => {
    const option = buildLineOption(
      {
        ...defaultLineSettings,
        palette: [{ kind: "solid", color: "#aaaaaa" }],
      },
      seriesOf(3),
      Date.now(),
    );

    expect(option.series.map((s) => s.lineStyle.color)).toEqual([
      "#aaaaaa",
      "#aaaaaa",
      "#aaaaaa",
    ]);
  });

  it("ignores an empty palette rather than emitting no colour", () => {
    const option = buildLineOption(
      { ...defaultLineSettings, palette: [] },
      seriesOf(1),
      Date.now(),
    );

    expect(option.series[0]!.lineStyle.color).toBe("#00b8d9");
  });

  it("fills the area under the first series only", () => {
    // Stacked translucent areas turn into mud and hide the crossings a
    // multi-series chart exists to show.
    const option = buildLineOption(
      defaultLineSettings,
      seriesOf(3),
      Date.now(),
    );

    expect(option.series.map((s) => s.areaStyle !== undefined)).toEqual([
      true,
      false,
      false,
    ]);
  });

  it("still fills a single-series chart", () => {
    const option = buildLineOption(
      defaultLineSettings,
      seriesOf(1),
      Date.now(),
    );
    expect(option.series[0]!.areaStyle).toBeDefined();
  });
});

describe("dash patterns (§81)", () => {
  it("emits solid explicitly when none is authored", () => {
    // Stated rather than left to the engine default, so the option says what it
    // draws.
    const option = buildLineOption(
      defaultLineSettings,
      [{ sensorId: "a", samples: [] }],
      Date.now(),
    );
    expect(option.series[0]!.lineStyle.type).toBe("solid");
  });

  it("passes a dash pattern through to every series", () => {
    const option = buildLineOption(
      { ...defaultLineSettings, dash: "dashed" },
      [
        { sensorId: "a", samples: [] },
        { sensorId: "b", samples: [] },
      ],
      Date.now(),
    );

    expect(option.series.map((s) => s.lineStyle.type)).toEqual([
      "dashed",
      "dashed",
    ]);
  });
});
