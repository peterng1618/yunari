import { describe, expect, it } from "vitest";
import type { Sample, SensorStatus } from "../types.js";
import {
  type BarSettings,
  buildBarOption,
  defaultBarSettings,
  toBarColor,
  toBarDataItem,
} from "./bar.js";
import type { LinearGradientColor } from "./fill.js";

function sample(value: number, sensorId = "cpu.load.total"): Sample {
  return {
    sensorId,
    timestamp: "2026-01-01T00:00:00Z",
    status: "ok",
    value,
    unit: "%",
  };
}

/**
 * A non-ok sample with `value` genuinely absent rather than set to `undefined` —
 * `exactOptionalPropertyTypes` treats those as different types, and the wire
 * format omits the key.
 */
function badSample(status: Exclude<SensorStatus, "ok">): Sample {
  return {
    sensorId: "cpu.load.total",
    timestamp: "2026-01-01T00:00:00Z",
    status,
    message: "sensor unavailable",
  };
}

const thresholds: BarSettings = {
  ...defaultBarSettings,
  fill: {
    kind: "thresholds",
    bands: [
      { offset: 0.6, color: "#00ff00" },
      { offset: 0.85, color: "#ffaa00" },
      { offset: 1, color: "#ff0000" },
    ],
  },
};

describe("buildBarOption", () => {
  it("puts categories on the y axis for horizontal bars", () => {
    const option = buildBarOption(defaultBarSettings, [
      { sensorId: "a", sample: sample(50) },
    ]);

    expect(option.yAxis.type).toBe("category");
    expect(option.xAxis.type).toBe("value");
  });

  it("puts categories on the x axis for vertical bars", () => {
    const option = buildBarOption(
      { ...defaultBarSettings, orientation: "vertical" },
      [{ sensorId: "a", sample: sample(50) }],
    );

    expect(option.xAxis.type).toBe("category");
    expect(option.yAxis.type).toBe("value");
  });

  it("pins the value axis to the authored range", () => {
    // Letting the engine autoscale would move the bar when the data moved,
    // which reads as a larger change than actually happened.
    const option = buildBarOption({ ...defaultBarSettings, min: 20, max: 90 }, [
      { sensorId: "a", sample: sample(50) },
    ]);

    const axis = option.xAxis;
    expect(axis.type).toBe("value");
    if (axis.type === "value") {
      expect(axis.min).toBe(20);
      expect(axis.max).toBe(90);
    }
  });

  it("draws axes without any engine text", () => {
    const option = buildBarOption(defaultBarSettings, [
      { sensorId: "cpu.load.total", sample: sample(50) },
    ]);

    expect(option.xAxis).toMatchObject({ show: false });
    expect(option.yAxis).toMatchObject({
      show: false,
      axisLabel: { show: false },
    });
  });

  it("draws the value axis but still no labels", () => {
    const option = buildBarOption({ ...defaultBarSettings, showAxes: true }, [
      { sensorId: "cpu.load.total", sample: sample(50) },
    ]);
    const valueAxis = option.xAxis;
    expect(valueAxis).toMatchObject({ show: true, axisLabel: { show: false } });
  });

  it("labels categories, falling back to the sensor id", () => {
    const option = buildBarOption(defaultBarSettings, [
      { sensorId: "cpu.load.total", sample: sample(10), label: "CPU" },
      { sensorId: "gpu.load.total", sample: sample(20) },
    ]);

    const axis = option.yAxis;
    if (axis.type === "category") {
      expect(axis.data).toEqual(["CPU", "gpu.load.total"]);
    }
  });

  it("emits one bar per category, in input order", () => {
    const option = buildBarOption(defaultBarSettings, [
      { sensorId: "a", sample: sample(10) },
      { sensorId: "b", sample: sample(20) },
      { sensorId: "c", sample: sample(30) },
    ]);

    expect(option.series[0].data.map((d) => d.value)).toEqual([10, 20, 30]);
  });

  it("shows a background only when a track is configured", () => {
    // No authored track radius: the track is the plain rectangle it always was.
    const unround = { ...defaultBarSettings };
    delete (unround as { trackCornerRadius?: unknown }).trackCornerRadius;
    const withTrack = buildBarOption(unround, []);
    expect(withTrack.series[0].showBackground).toBe(true);
    expect(withTrack.series[0].backgroundStyle).toEqual({ color: "#2a2f3a" });

    const plain = { ...defaultBarSettings };
    delete (plain as { track?: unknown }).track;
    const withoutTrack = buildBarOption(plain, []);
    expect(withoutTrack.series[0].showBackground).toBe(false);
    expect("backgroundStyle" in withoutTrack.series[0]).toBe(false);
  });

  it("rounds the track from its own radius, and leaves the bar's alone", () => {
    // The two ends of a progress bar are drawn by two different ECharts
    // properties — the bar's `itemStyle.borderRadius`, the track's
    // `backgroundStyle.borderRadius` — so one authorable value each is what
    // makes them independent.
    const option = buildBarOption(
      { ...defaultBarSettings, cornerRadius: 2, trackCornerRadius: 20 },
      [{ sensorId: "a", sample: sample(50) }],
    );

    expect(option.series[0].backgroundStyle?.borderRadius).toBe(20);
    expect(option.series[0].data[0]?.itemStyle.borderRadius).toBe(2);
  });

  it("leaves the bar's radius alone when only the track's is set", () => {
    const option = buildBarOption(
      { ...defaultBarSettings, trackCornerRadius: 20 },
      [{ sensorId: "a", sample: sample(50) }],
    );

    expect(option.series[0].data[0]?.itemStyle.borderRadius).toBe(
      defaultBarSettings.cornerRadius,
    );
  });

  it("omits the track's radius entirely rather than rounding it to zero", () => {
    // exactOptionalPropertyTypes: an absent authored value has to stay absent,
    // because ECharts reads a missing key as "no radius" and a present 0 as a
    // rounded rect with no corners — the same picture, two different documents.
    const settings = { ...defaultBarSettings };
    delete (settings as { trackCornerRadius?: unknown }).trackCornerRadius;

    const option = buildBarOption(settings, []);
    expect("borderRadius" in (option.series[0].backgroundStyle ?? {})).toBe(
      false,
    );
  });

  it("never rounds a track radius negative", () => {
    const option = buildBarOption(
      { ...defaultBarSettings, trackCornerRadius: -5 },
      [],
    );
    expect(option.series[0].backgroundStyle?.borderRadius).toBe(0);
  });

  it("omits barWidth entirely when unset", () => {
    // exactOptionalPropertyTypes: an explicit undefined is a different type, and
    // ECharts distributes the slot only when the key is absent.
    const settings = { ...defaultBarSettings };
    delete (settings as { barWidth?: unknown }).barWidth;

    const option = buildBarOption(settings, []);
    expect("barWidth" in option.series[0]).toBe(false);
  });

  it("clamps the category gap into 0–100 and formats it as a percentage", () => {
    expect(
      buildBarOption({ ...defaultBarSettings, categoryGapPercent: 250 }, [])
        .series[0].barCategoryGap,
    ).toBe("100%");
    expect(
      buildBarOption({ ...defaultBarSettings, categoryGapPercent: -10 }, [])
        .series[0].barCategoryGap,
    ).toBe("0%");
  });

  it("passes the animation flag through so screenshots can disable it", () => {
    expect(buildBarOption(defaultBarSettings, [], false).animation).toBe(false);
  });

  it("reserves no grid padding when there are no axes or labels", () => {
    // A progress bar must reach the element edges the author laid out; axis
    // padding would silently shrink it.
    const option = buildBarOption(defaultBarSettings, []);
    expect(option.grid).toEqual({
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      outerBoundsMode: "none",
    });
  });
});

describe("toBarDataItem", () => {
  it("draws no bar for a missing sample", () => {
    // The critical case for this family: a zero-length bar and a bar for the
    // value 0 are pixel-identical, so a missing sample MUST be null (§83).
    for (const status of [
      "missing",
      "stale",
      "error",
      "unavailable",
    ] as const) {
      const item = toBarDataItem(defaultBarSettings, {
        sensorId: "a",
        sample: badSample(status),
      });
      expect(item.value).toBeNull();
    }
  });

  it("draws no bar when there is no sample at all", () => {
    expect(
      toBarDataItem(defaultBarSettings, { sensorId: "a", sample: undefined })
        .value,
    ).toBeNull();
  });

  it("distinguishes a real zero from a missing sample", () => {
    expect(
      toBarDataItem(defaultBarSettings, { sensorId: "a", sample: sample(0) })
        .value,
    ).toBe(0);
  });

  it("clamps the drawn value into the range, leaving the raw sample untouched", () => {
    const overRange = sample(105);
    const item = toBarDataItem(defaultBarSettings, {
      sensorId: "a",
      sample: overRange,
    });

    expect(item.value).toBe(100);
    // §83: the raw value is preserved for whatever else reads it.
    expect(overRange.value).toBe(105);
  });

  it("clamps below the range too", () => {
    const item = toBarDataItem(
      { ...defaultBarSettings, min: 10 },
      {
        sensorId: "a",
        sample: sample(-40),
      },
    );
    expect(item.value).toBe(10);
  });

  it("colours each bar by its own value — the capability the line family lacks", () => {
    const items = [sample(30), sample(70), sample(95)].map((s) =>
      toBarDataItem(thresholds, { sensorId: "a", sample: s }),
    );

    expect(items.map((i) => i.itemStyle.color)).toEqual([
      "#00ff00",
      "#ffaa00",
      "#ff0000",
    ]);
  });

  it("resolves thresholds against the authored range, not a 0–100 assumption", () => {
    const shifted: BarSettings = { ...thresholds, min: 0, max: 200 };
    // 70 of 200 is 0.35 — still the first band, where 70 of 100 was the second.
    const item = toBarDataItem(shifted, { sensorId: "a", sample: sample(70) });
    expect(item.itemStyle.color).toBe("#00ff00");
  });

  it("uses an out-of-range raw value for the colour, not the clamped one", () => {
    // Clamping is a display concern. A sensor reading 150 % is in the top
    // threshold band, and using the clamped value would be the same answer here
    // — but a value BELOW min must not pick up the bottom band by accident.
    const item = toBarDataItem(thresholds, {
      sensorId: "a",
      sample: sample(150),
    });
    expect(item.itemStyle.color).toBe("#ff0000");
  });

  it("applies the corner radius, never negative", () => {
    expect(
      toBarDataItem(
        { ...defaultBarSettings, cornerRadius: -5 },
        {
          sensorId: "a",
          sample: sample(1),
        },
      ).itemStyle.borderRadius,
    ).toBe(0);
  });
});

describe("toBarColor", () => {
  it("returns a solid fill unchanged", () => {
    expect(toBarColor(defaultBarSettings, 0.5)).toBe("#00b8d9");
  });

  it("builds a real cartesian gradient along the growth direction", () => {
    const stops = [
      { offset: 0, color: "#00b8d9" },
      { offset: 1, color: "#ff4d4f" },
    ];

    const horizontal = toBarColor(
      { ...defaultBarSettings, fill: { kind: "gradient", stops } },
      0.5,
    ) as LinearGradientColor;
    expect([horizontal.x, horizontal.x2]).toEqual([0, 1]);

    // A vertical bar grows upward, so its gradient must start at the bottom or
    // it would read upside down relative to the horizontal case.
    const vertical = toBarColor(
      {
        ...defaultBarSettings,
        orientation: "vertical",
        fill: { kind: "gradient", stops },
      },
      0.5,
    ) as LinearGradientColor;
    expect([vertical.y, vertical.y2]).toEqual([1, 0]);
  });
});

describe("category order", () => {
  /**
   * Regression test for a defect found by looking at a rendered screenshot.
   *
   * ECharts places category index 0 at the **bottom** of a y axis, so a
   * horizontal chart drew the first authored bar last. On a dashboard whose
   * labels are separate text elements, the bars read in the opposite order from
   * their labels — the values were right and the pairing was wrong, which is
   * worse than being obviously broken.
   */
  it("inverts the category axis for horizontal bars so authored order reads downward", () => {
    const option = buildBarOption(defaultBarSettings, [
      { sensorId: "first", sample: sample(10) },
      { sensorId: "second", sample: sample(90) },
    ]);

    const axis = option.yAxis;
    expect(axis.type).toBe("category");
    if (axis.type === "category") {
      expect(axis.inverse).toBe(true);
      expect(axis.data).toEqual(["first", "second"]);
    }
  });

  it("does not invert a vertical chart, where index 0 is already leftmost", () => {
    const option = buildBarOption(
      { ...defaultBarSettings, orientation: "vertical" },
      [{ sensorId: "first", sample: sample(10) }],
    );

    const axis = option.xAxis;
    if (axis.type === "category") {
      expect(axis.inverse).toBe(false);
    }
  });
});

// 0007: a value the renderer cannot colour is a gap, not a transparent bar
// carrying a live number. `noValue` is the same datum shape a missing sample
// produces, so the two absences stay distinguishable only through the issue
// `buildChartPlan` reports.
describe("a bar whose fill has no palette entry", () => {
  const unresolved: BarSettings = {
    ...defaultBarSettings,
    trackCornerRadius: 20,
    fill: { ref: "palette.absent" },
  };

  it("draws no value rather than a transparent bar on a live number", () => {
    const option = buildBarOption(unresolved, [
      { sensorId: "disk.used", sample: sample(46.8) },
    ]);
    expect(option.series[0].data[0]!.value).toBeNull();
  });

  it("still resolves the track, which is not the value", () => {
    const option = buildBarOption(
      { ...unresolved, track: { ref: "palette.track" } },
      [{ sensorId: "disk.used", sample: sample(46.8) }],
      false,
      { track: { name: "Track", value: { kind: "solid", color: "#2a2f3a" } } },
    );
    expect(option.series[0].backgroundStyle).toEqual({
      color: "#2a2f3a",
      borderRadius: 20,
    });
  });
});
