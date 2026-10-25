import { describe, expect, it } from "vitest";
import type { Sample, SensorStatus } from "../types.js";
import {
  buildPieOption,
  computeComposition,
  defaultPieSettings,
  type PieDataItem,
  type PieSettings,
  type PieSliceInput,
  toSegmentedPieData,
} from "./pie.js";

function sample(value: number, sensorId = "ram.used"): Sample {
  return {
    sensorId,
    timestamp: "2026-01-01T00:00:00Z",
    status: "ok",
    value,
    unit: "GB",
  };
}

function badSample(status: Exclude<SensorStatus, "ok">): Sample {
  return {
    sensorId: "ram.used",
    timestamp: "2026-01-01T00:00:00Z",
    status,
    message: "sensor unavailable",
  };
}

const fixed32: PieSettings = {
  ...defaultPieSettings,
  total: { kind: "fixed", value: 32 },
};

function parts(...values: (number | undefined)[]): PieSliceInput[] {
  return values.map((value, index) => ({
    sensorId: `part.${index}`,
    sample:
      value === undefined
        ? badSample("unavailable")
        : sample(value, `part.${index}`),
  }));
}

describe("computeComposition — sum total", () => {
  it("makes the known parts the whole", () => {
    const result = computeComposition(defaultPieSettings, parts(10, 30));

    expect(result.whole).toBe(40);
    expect(result.knownTotal).toBe(40);
    expect(result.slices.map((s) => s.share)).toEqual([0.25, 0.75]);
    expect(result.remainder).toBeUndefined();
  });

  it("reports incompleteness rather than hiding a missing part", () => {
    // The two remaining slices still fill the circle — with an unknown total
    // there is no honest alternative — but `complete` is what lets the text
    // layer say the pie is showing less than everything.
    const result = computeComposition(
      defaultPieSettings,
      parts(10, 30, undefined),
    );

    expect(result.complete).toBe(false);
    expect(result.missing).toEqual(["part.2"]);
    expect(result.slices).toHaveLength(2);
  });

  it("never substitutes zero for a missing part", () => {
    const result = computeComposition(defaultPieSettings, parts(10, undefined));

    // A zero slice would be indistinguishable from a part that is genuinely
    // empty, which is the substitution §83 rules out.
    expect(result.slices.map((s) => s.sensorId)).toEqual(["part.0"]);
    expect(result.slices.some((s) => s.value === 0)).toBe(false);
  });

  it("treats every non-ok status as missing", () => {
    for (const status of [
      "missing",
      "stale",
      "error",
      "unavailable",
    ] as const) {
      const result = computeComposition(defaultPieSettings, [
        { sensorId: "a", sample: sample(5) },
        { sensorId: "b", sample: badSample(status) },
      ]);
      expect(result.missing).toEqual(["b"]);
    }
  });

  it("treats a negative part as unknown", () => {
    // A negative value would subtract angle from its neighbours, making the
    // other slices wrong rather than just making this one wrong.
    const result = computeComposition(defaultPieSettings, [
      { sensorId: "a", sample: sample(10) },
      { sensorId: "b", sample: sample(-4) },
    ]);

    expect(result.missing).toEqual(["b"]);
    expect(result.whole).toBe(10);
  });

  it("yields zero shares rather than NaN when everything is zero", () => {
    const result = computeComposition(defaultPieSettings, parts(0, 0));
    expect(result.slices.map((s) => s.share)).toEqual([0, 0]);
  });

  it("keeps a real zero part as a slice", () => {
    const result = computeComposition(defaultPieSettings, parts(0, 10));
    expect(result.slices).toHaveLength(2);
    expect(result.complete).toBe(true);
  });
});

describe("computeComposition — fixed total", () => {
  it("measures the remainder against the authored whole", () => {
    const result = computeComposition(fixed32, parts(8, 4));

    expect(result.whole).toBe(32);
    expect(result.knownTotal).toBe(12);
    expect(result.remainder).toBe(20);
    expect(result.slices.map((s) => s.share)).toEqual([0.25, 0.125]);
  });

  it("enlarges the remainder, not the peers, when a part is missing", () => {
    // This is the reason a fixed total exists. Under `sum`, losing a part
    // inflates the others; here the unknown lands in the remainder, where it is
    // honest.
    const complete = computeComposition(fixed32, parts(8, 4));
    const degraded = computeComposition(fixed32, parts(8, undefined));

    expect(degraded.slices[0]!.share).toBe(complete.slices[0]!.share);
    expect(degraded.remainder).toBe(24);
    expect(degraded.complete).toBe(false);
  });

  it("reports overflow instead of drawing a negative remainder", () => {
    const result = computeComposition(fixed32, parts(30, 10));

    expect(result.overflow).toBe(true);
    expect(result.remainder).toBeUndefined();
    // Falls back to the known sum so the drawing stays coherent; shares stay
    // within 0–1 rather than exceeding the circle.
    expect(result.whole).toBe(40);
    expect(result.slices.every((s) => s.share <= 1)).toBe(true);
  });

  it("treats a fixed total exactly filled as complete, with no remainder slice", () => {
    const result = computeComposition(fixed32, parts(16, 16));

    expect(result.overflow).toBe(false);
    expect(result.remainder).toBe(0);
  });

  it("clamps a negative authored total to zero", () => {
    const result = computeComposition(
      { ...defaultPieSettings, total: { kind: "fixed", value: -10 } },
      parts(5),
    );
    expect(result.overflow).toBe(true);
  });
});

describe("toSegmentedPieData", () => {
  const item = (name: string, value: number, color: string): PieDataItem => ({
    name,
    value,
    itemStyle: { color, borderRadius: 4 },
  });

  it("splits every slice into equal real items with spacers between", () => {
    const items = toSegmentedPieData(
      [item("cpu", 50, "#0f0"), item("gpu", 50, "#00f")],
      2,
      0,
    );

    expect(items.filter((entry) => entry.name === "cpu")).toHaveLength(2);
    expect(items.filter((entry) => entry.name === "gpu")).toHaveLength(2);
    // One internal gap per slice plus one slice-boundary gap per slice.
    expect(items.filter((entry) => entry.name === "")).toHaveLength(4);
  });

  it("keeps the visible shares equal", () => {
    const items = toSegmentedPieData(
      [item("a", 75, "#0f0"), item("b", 25, "#00f")],
      4,
      2,
    );
    const real = items.filter((entry) => entry.name !== "");
    const a = real.filter((entry) => entry.name === "a");
    const b = real.filter((entry) => entry.name === "b");

    expect(
      a.reduce((sum, entry) => sum + entry.value, 0) /
        b.reduce((sum, entry) => sum + entry.value, 0),
    ).toBeCloseTo(3);
  });

  it("leaves the continuous data at 100", () => {
    const option = buildPieOption(defaultPieSettings, parts(50));

    expect(option.series[0].padAngle).toBe(defaultPieSettings.padAngle);
    expect(option.series[0].data).toHaveLength(1);
  });

  it("emits no labels and a zero series pad for the segmented path", () => {
    const option = buildPieOption(
      { ...defaultPieSettings, segmentDivisor: 10 },
      parts(50),
    );

    expect(option.series[0].padAngle).toBe(0);
    expect(option.series[0].label.show).toBe(false);
    expect(option.series[0].labelLine.show).toBe(false);
  });
});

describe("buildPieOption", () => {
  it("emits a donut radius pair from the percentages", () => {
    const option = buildPieOption(defaultPieSettings, parts(1, 1));
    expect(option.series[0].radius).toEqual(["60%", "100%"]);
  });

  it("clamps radius percentages into 0–100", () => {
    const option = buildPieOption(
      {
        ...defaultPieSettings,
        innerRadiusPercent: -20,
        outerRadiusPercent: 400,
      },
      parts(1),
    );
    expect(option.series[0].radius).toEqual(["0%", "100%"]);
  });

  it("omits endAngle for a full sweep", () => {
    const option = buildPieOption(defaultPieSettings, parts(1));
    expect("endAngle" in option.series[0]).toBe(false);
  });

  it("passes an arbitrary sweep through", () => {
    const option = buildPieOption(
      { ...defaultPieSettings, endAngle: -90 },
      parts(1),
    );
    expect(option.series[0].endAngle).toBe(-90);
  });

  it("draws a remainder slice only for a fixed total", () => {
    const withRemainder = buildPieOption(fixed32, parts(8));
    expect(withRemainder.series[0].data.map((d) => d.name)).toEqual([
      "part.0",
      "remainder",
    ]);

    const summed = buildPieOption(defaultPieSettings, parts(8));
    expect(summed.series[0].data.map((d) => d.name)).toEqual(["part.0"]);
  });

  it("omits a zero remainder rather than emitting a zero-value slice", () => {
    const option = buildPieOption(fixed32, parts(16, 16));
    expect(option.series[0].data.map((d) => d.name)).toEqual([
      "part.0",
      "part.1",
    ]);
  });

  it("cycles the palette and lets a slice override it", () => {
    const settings: PieSettings = {
      ...defaultPieSettings,
      palette: [
        { kind: "solid", color: "#111111" },
        { kind: "solid", color: "#222222" },
      ],
      total: { kind: "sum" },
    };

    const option = buildPieOption(settings, [
      { sensorId: "a", sample: sample(1, "a") },
      { sensorId: "b", sample: sample(1, "b") },
      { sensorId: "c", sample: sample(1, "c") },
      {
        sensorId: "d",
        sample: sample(1, "d"),
        fill: { kind: "solid", color: "#abcdef" },
      },
    ]);

    expect(option.series[0].data.map((d) => d.itemStyle.color)).toEqual([
      "#111111",
      "#222222",
      "#111111",
      "#abcdef",
    ]);
  });

  it("preserves authored slice order rather than sorting by magnitude", () => {
    // "cores 0..7" must not reorder by load; reading order is part of the
    // composition's meaning.
    const option = buildPieOption(defaultPieSettings, parts(5, 90, 1));
    expect(option.series[0].data.map((d) => d.value)).toEqual([5, 90, 1]);
  });

  it("resolves a threshold slice fill at the slice share", () => {
    const option = buildPieOption({ ...fixed32, palette: [] }, [
      {
        sensorId: "a",
        sample: sample(28),
        fill: {
          kind: "thresholds",
          bands: [
            { offset: 0.8, color: "#00ff00" },
            { offset: 1, color: "#ff0000" },
          ],
        },
      },
    ]);

    // 28 of 32 is 0.875 — above the 0.8 band boundary.
    expect(option.series[0].data[0]!.itemStyle.color).toBe("#ff0000");
  });

  it("never draws engine text, with no setting to turn it on", () => {
    const option = buildPieOption(defaultPieSettings, parts(1));
    expect(option.series[0].label.show).toBe(false);
    expect(option.series[0].labelLine.show).toBe(false);
    expect("showLabels" in defaultPieSettings).toBe(false);
  });

  it("never emits a negative pad angle or corner radius", () => {
    const option = buildPieOption(
      { ...defaultPieSettings, padAngle: -5, cornerRadius: -3 },
      parts(1),
    );
    expect(option.series[0].padAngle).toBe(0);
    expect(option.series[0].data[0]!.itemStyle.borderRadius).toBe(0);
  });

  it("emits an empty data array when nothing is known", () => {
    // No slices at all is the correct rendering of "no data": an empty ring,
    // not a full one.
    const option = buildPieOption(
      defaultPieSettings,
      parts(undefined, undefined),
    );
    expect(option.series[0].data).toEqual([]);
  });
});
