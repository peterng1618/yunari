import { describe, expect, it } from "vitest";
import {
  defaultGaugeSettings,
  type GaugeSettings,
  type Sample,
  type SensorStatus,
} from "../types.js";
import {
  approximateGradient,
  buildGaugeOption,
  mixHex,
  toColorSegments,
} from "./gauge.js";

const PROGRESS = "#00b8d9";
const TRACK = "#222222";

/** A full-turn gauge with flat paints, so a gap is a number and a colour. */
function gaugeOption(
  over: Partial<GaugeSettings>,
  drawnEdge?: number,
  value = 50,
) {
  return buildGaugeOption(
    {
      ...defaultGaugeSettings,
      startAngle: 0,
      endAngle: 360,
      min: 0,
      max: 100,
      roundCap: false,
      track: { kind: "solid", color: TRACK },
      progress: { kind: "solid", color: PROGRESS },
      ...over,
    },
    sample(value),
    true,
    undefined,
    drawnEdge,
  );
}

const colorBands = (
  option: ReturnType<typeof buildGaugeOption>,
): [number, string][] => option.series[0].axisLine.lineStyle.color;

/** The empty arc each of `count` bands leaves, read back as degrees. */
function gapDegrees(
  option: ReturnType<typeof buildGaugeOption>,
  count: number,
  sweep = 360,
): number {
  return (1 / count - colorBands(option)[0]![0]) * sweep;
}

/** An ok sample carrying a plottable value. */
function sample(value = 50): Sample {
  return {
    sensorId: "cpu.load.total",
    timestamp: "2026-01-01T00:00:00Z",
    status: "ok",
    value,
    unit: "%",
  };
}

/**
 * A non-ok sample with `value` genuinely absent rather than set to `undefined`.
 * The distinction matters: `exactOptionalPropertyTypes` treats an explicit
 * `undefined` as a different type, and the wire format omits the key entirely.
 */
function sampleWithoutValue(status: Exclude<SensorStatus, "ok">): Sample {
  return {
    sensorId: "cpu.load.total",
    timestamp: "2026-01-01T00:00:00Z",
    status,
    unit: "%",
  };
}

describe("buildGaugeOption", () => {
  it("passes arbitrary sweep angles straight through", () => {
    // Verified 2026-09-12: ECharts accepts −360…360 for both, so half and
    // arbitrary-sweep gauges need no workaround.
    const option = buildGaugeOption(
      { ...defaultGaugeSettings, startAngle: 180, endAngle: 0 },
      sample(),
    );

    expect(option.series[0].startAngle).toBe(180);
    expect(option.series[0].endAngle).toBe(0);
  });

  it("clamps the displayed value without losing the raw reading", () => {
    const option = buildGaugeOption(
      { ...defaultGaugeSettings, min: 0, max: 100 },
      sample(137),
    );

    // §83: display clamps, the sample itself is untouched.
    expect(option.series[0].data[0]!.value).toBe(100);
  });

  it.each(["missing", "error", "unavailable", "stale"] as const)(
    "draws no progress arc for a %s sample",
    (status) => {
      const option = buildGaugeOption(
        defaultGaugeSettings,
        sampleWithoutValue(status),
      );

      // §83: a gap, not a zero. A visible zero-length arc would read as "0 %".
      expect(option.series[0].progress.show).toBe(false);
      expect(option.series[0].data).toEqual([]);
    },
  );

  it("draws the progress arc for an ok sample", () => {
    const option = buildGaugeOption(defaultGaugeSettings, sample());
    expect(option.series[0].progress.show).toBe(true);
    expect(option.series[0].data).toHaveLength(1);
  });

  it("treats an undefined sample as missing rather than zero", () => {
    const option = buildGaugeOption(defaultGaugeSettings, undefined);
    expect(option.series[0].progress.show).toBe(false);
    expect(option.series[0].data).toEqual([]);
  });

  it("disables animation when asked, for deterministic screenshots", () => {
    const option = buildGaugeOption(defaultGaugeSettings, sample(), false);
    expect(option.series[0].animation).toBe(false);
  });

  it("splits the ring into equal bands with transparent gaps", () => {
    const option = buildGaugeOption(
      { ...defaultGaugeSettings, segmentDivisor: 10 },
      sample(55),
    );
    const colors = option.series[0].axisLine.lineStyle.color;

    // 10 bands: each visible band followed by a gap, except the last band's end.
    expect(colors).toHaveLength(19);
    // The band ends where its gap begins: one share of the drawn edge, not a
    // fifth of the slot.
    expect(colors[0]![0]).toBeCloseTo(0.1 - gapDegrees(option, 10, 270) / 270);
    expect(colors[1]).toEqual([0.1, "transparent"]);
    expect(option.series[0].progress.show).toBe(false);
    expect(option.series[0].data).toEqual([]);
  });

  it("fills bands the reading reaches and tracks the rest", () => {
    const option = buildGaugeOption(
      {
        ...defaultGaugeSettings,
        segmentDivisor: 10,
        track: { kind: "solid", color: "#222222" },
        progress: { kind: "solid", color: "#00b8d9" },
      },
      sample(55),
    );
    const colors = option.series[0].axisLine.lineStyle.color;
    const solid = colors.filter(([, color]) => color !== "transparent");

    expect(solid.slice(0, 5).every(([, color]) => color === "#00b8d9")).toBe(
      true,
    );
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

  it("keeps the gap a share of the chart as the count rises", () => {
    // Five slices and fifty: the same edge, the same gap. A share of the slot
    // would have shrunk tenfold with the count.
    const five = gapDegrees(gaugeOption({ segmentDivisor: 20 }), 5);
    const fifty = gapDegrees(gaugeOption({ segmentDivisor: 2 }), 50);

    expect(fifty).toBeCloseTo(five, 5);
  });

  it("widens the gap to clear round caps on a small chart", () => {
    // A cap extends each band end by half the thickness, so the gap has to be
    // measured against the radius rather than the chart's raw size.
    const large = gapDegrees(
      gaugeOption({ segmentDivisor: 5, thickness: 12 }, 800),
      20,
    );
    const small = gapDegrees(
      gaugeOption({ segmentDivisor: 5, thickness: 12 }, 200),
      20,
    );

    expect(small).toBeGreaterThan(large);
  });

  it("never takes more than 45% of a band", () => {
    const gap = gapDegrees(
      gaugeOption({ segmentDivisor: 1, thickness: 80 }),
      100,
    );

    expect(gap).toBeLessThanOrEqual(0.45 * 3.6);
  });

  it("draws touching bands at zero spacing when no chart size is known", () => {
    const bands = colorBands(
      gaugeOption({ segmentDivisor: 20, segmentSpacingPercent: 0 }, undefined),
    );

    expect(bands.some(([, color]) => color === "transparent")).toBe(false);
  });

  it("stops a partial fill at the reading", () => {
    const bands = colorBands(
      gaugeOption(
        { segmentDivisor: 25, segmentFill: "partial", min: 0, max: 100 },
        undefined,
        30,
      ),
    );
    const boundary = bands.findIndex(
      ([at, color]) => at === 0.3 && color === PROGRESS,
    );

    // The band the reading lands in is progress up to the reading and track
    // afterwards, not the whole slice.
    expect(boundary).toBeGreaterThan(-1);
    expect(bands[boundary + 1]?.[1]).toBe(TRACK);
  });

  it("quantises a whole fill to the band the reading reaches", () => {
    const bands = colorBands(
      gaugeOption(
        { segmentDivisor: 25, segmentFill: "whole", min: 0, max: 100 },
        undefined,
        24,
      ),
    );

    // A reading inside the first quarter has not yet reached that slice's
    // visible end, so nothing lights: the slice boundary is where the gap
    // begins, as it has always drawn.
    expect(bands.filter(([, color]) => color === PROGRESS)).toHaveLength(0);
  });

  it("keeps the continuous option at 100", () => {
    const option = buildGaugeOption(defaultGaugeSettings, sample(55));

    expect(option.series[0].progress.show).toBe(true);
    expect(option.series[0].axisLine.lineStyle.color).toEqual([[1, "#2a2f3a"]]);
  });
});

describe("toColorSegments", () => {
  it("maps a solid fill to one full-span segment", () => {
    expect(
      toColorSegments(
        { kind: "solid", color: "#ff0000" },
        defaultGaugeSettings,
      ),
    ).toEqual([[1, "#ff0000"]]);
  });

  it("keeps threshold bands exact and ascending", () => {
    const segments = toColorSegments(
      {
        kind: "thresholds",
        // Deliberately out of order — authored data cannot be trusted to be sorted.
        bands: [
          { offset: 0.9, color: "#ff0000" },
          { offset: 0.3, color: "#00ff00" },
          { offset: 0.6, color: "#ffff00" },
        ],
      },
      defaultGaugeSettings,
    );

    expect(segments.map((s) => s[0])).toEqual([0.3, 0.6, 0.9, 1]);
    expect(segments[0]![1]).toBe("#00ff00");
  });

  it("covers the ring tail so no arc is left unpainted", () => {
    const segments = toColorSegments(
      { kind: "thresholds", bands: [{ offset: 0.5, color: "#abcdef" }] },
      defaultGaugeSettings,
    );

    expect(segments.at(-1)![0]).toBe(1);
  });
});

describe("approximateGradient", () => {
  it("emits the requested number of ascending segments ending at 1", () => {
    const segments = approximateGradient(
      [
        { offset: 0, color: "#000000" },
        { offset: 1, color: "#ffffff" },
      ],
      16,
    );

    expect(segments).toHaveLength(16);
    expect(segments.at(-1)![0]).toBeCloseTo(1);

    const offsets = segments.map((s) => s[0]);
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
  });

  it("interpolates towards the end colour across the ring", () => {
    const segments = approximateGradient(
      [
        { offset: 0, color: "#000000" },
        { offset: 1, color: "#ffffff" },
      ],
      8,
    );

    const first = parseInt(segments[0]![1].slice(1, 3), 16);
    const last = parseInt(segments.at(-1)![1].slice(1, 3), 16);

    expect(first).toBeLessThan(last);
  });

  it("collapses a single stop to a solid ring", () => {
    expect(
      approximateGradient([{ offset: 0.4, color: "#123456" }], 32),
    ).toEqual([[1, "#123456"]]);
  });

  it("caps the segment count to keep option size bounded", () => {
    expect(
      approximateGradient(
        [
          { offset: 0, color: "#000000" },
          { offset: 1, color: "#ffffff" },
        ],
        10_000,
      ),
    ).toHaveLength(256);
  });
});

describe("mixHex", () => {
  it("mixes six-digit hex in sRGB", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  it("expands three-digit shorthand", () => {
    expect(mixHex("#000", "#fff", 1)).toBe("#ffffff");
  });

  it("mixes a named colour, and falls back for one it cannot parse", () => {
    // A named colour is readable now that the shared parser owns the grammar;
    // an unreadable value still returns a valid endpoint rather than a
    // malformed colour the engine would silently drop.
    expect(mixHex("rebeccapurple", "#ffffff", 0.8)).toBe("#e0d6eb");
    expect(mixHex("nope", "#ffffff", 0.2)).toBe("nope");
    expect(mixHex("nope", "#ffffff", 0.8)).toBe("#ffffff");
  });
});

describe("the progress arc colour", () => {
  /**
   * Regression tests for a defect found by looking at a rendered screenshot.
   *
   * `progress.itemStyle` was left unset for a `thresholds` or `gradient` fill,
   * on the reasoning that those are "expressed through axisLine segments". They
   * are not — axisLine carries the track — so the arc fell through to ECharts'
   * default blue and the authored fill was silently discarded. The emitted
   * option was exactly what the adapter intended, which is why no unit test
   * caught it.
   */
  const bands = [
    { offset: 0.7, color: "#00b8d9" },
    { offset: 0.9, color: "#ffab00" },
    { offset: 1, color: "#ff5630" },
  ];

  function progressColor(
    fill: GaugeSettings["progress"],
    value: number,
  ): unknown {
    return buildGaugeOption(
      { ...defaultGaugeSettings, progress: fill },
      sample(value),
    ).series[0].progress.itemStyle.color;
  }

  it("always emits a colour, so nothing falls through to an engine default", () => {
    for (const fill of [
      { kind: "solid" as const, color: "#123456" },
      { kind: "thresholds" as const, bands },
      { kind: "gradient" as const, stops: bands },
    ]) {
      expect(progressColor(fill, 50)).toBeDefined();
    }
  });

  it("uses a solid fill directly", () => {
    expect(progressColor({ kind: "solid", color: "#123456" }, 50)).toBe(
      "#123456",
    );
  });

  it("picks the threshold band containing the current value", () => {
    // The ring turns amber and then red as the value crosses each boundary —
    // the same per-value resolution the bar family uses.
    expect(progressColor({ kind: "thresholds", bands }, 50)).toBe("#00b8d9");
    expect(progressColor({ kind: "thresholds", bands }, 80)).toBe("#ffab00");
    expect(progressColor({ kind: "thresholds", bands }, 95)).toBe("#ff5630");
  });

  it("resolves thresholds against the authored range, not a 0–100 assumption", () => {
    const option = buildGaugeOption(
      {
        ...defaultGaugeSettings,
        min: 0,
        max: 200,
        progress: { kind: "thresholds", bands },
      },
      sample(80),
    );

    // 80 of 200 is 0.4 — the first band, where 80 of 100 was the second.
    expect(option.series[0].progress.itemStyle.color).toBe("#00b8d9");
  });

  it("follows the arc for a gradient fill instead of a cartesian gradient", () => {
    // ECharts applies gauge `progress` colour across the swept arc, so arc
    // segments make the gradient follow the ring. A cartesian `to-right`
    // gradient did not — that was the §85 gauge gap.
    const color = progressColor({ kind: "gradient", stops: bands }, 50);

    expect(Array.isArray(color)).toBe(true);
    const segments = color as [number, string][];
    // Ascending proportions covering the full ring.
    expect(segments.at(-1)?.[0]).toBe(1);
    expect(segments[0]?.[0]).toBeLessThan(segments.at(-1)![0]);
    expect(
      segments.every(([proportion]) => proportion > 0 && proportion <= 1),
    ).toBe(true);
    // Colours step along the sweep rather than repeating one value: the
    // midpoint sampling interpolates between stops, so several distinct
    // colours prove a real gradient along the arc.
    expect(new Set(segments.map(([, c]) => c)).size).toBeGreaterThan(3);
    expect(segments.every(([, hex]) => /^#[0-9a-f]{6}$/i.test(hex))).toBe(true);
  });

  it("keeps the track fill independent of the progress fill", () => {
    const option = buildGaugeOption(
      {
        ...defaultGaugeSettings,
        track: { kind: "solid", color: "#111111" },
        progress: { kind: "solid", color: "#eeeeee" },
      },
      sample(50),
    );

    expect(option.series[0].axisLine.lineStyle.color).toEqual([[1, "#111111"]]);
    expect(option.series[0].progress.itemStyle.color).toBe("#eeeeee");
  });
});

// 0007: the same gap, in the gauge's own vocabulary — `progress.show` is
// already the no-value state a missing sample uses.
describe("a gauge whose progress paint has no palette entry", () => {
  const unresolved: GaugeSettings = {
    ...defaultGaugeSettings,
    progress: { ref: "palette.absent" },
  };

  it("draws no arc at all, so the ring shows no number it cannot colour", () => {
    const option = buildGaugeOption(unresolved, sample(50), false, {});
    expect(option.series[0].progress.show).toBe(false);
    // The track still resolves, so the panel is visibly empty rather than
    // showing a bar with no colour.
    const track = defaultGaugeSettings.track as { readonly color: string };
    expect(option.series[0].axisLine.lineStyle.color).toEqual([
      [1, track.color],
    ]);
  });
});

/**
 * 0008: the datum and the arc's visibility are one decision, because ECharts
 * 6.1.0's `GaugeView._renderPointer` reads its own `_progressEls` inside the
 * data-diff `update` callback and only assigns it after a render that drew an
 * arc. A datum that outlives `progress.show: false` therefore throws inside the
 * renderer — `TypeError: Cannot read properties of undefined (reading '0')` —
 * and the per-chart guard in the player turns it into a grey ring with no arc.
 */
describe("the gauge's datum follows its arc", () => {
  const cases: readonly {
    label: string;
    option: () => ReturnType<typeof buildGaugeOption>;
  }[] = [
    {
      label: "an ok sample",
      option: () => buildGaugeOption(defaultGaugeSettings, sample()),
    },
    {
      label: "a missing sample",
      option: () => buildGaugeOption(defaultGaugeSettings, undefined),
    },
    {
      label: "a non-ok sample",
      option: () =>
        buildGaugeOption(defaultGaugeSettings, sampleWithoutValue("error")),
    },
    {
      label: "a progress paint that resolves to nothing",
      option: () =>
        buildGaugeOption(
          { ...defaultGaugeSettings, progress: { ref: "palette.absent" } },
          sample(),
          false,
          {},
        ),
    },
  ];

  it.each(cases)(
    "carries a datum exactly when $label has an arc",
    (testCase) => {
      const series = testCase.option().series[0];

      // The invariant, not the two halves of it: ECharts can survive a flag
      // flipping under a datum, and cannot survive a flag flipping under nothing.
      expect(series.data.length > 0).toBe(series.progress.show);
    },
  );

  it("keeps the datum equal to the clamped reading, not the raw one", () => {
    const option = buildGaugeOption(
      { ...defaultGaugeSettings, min: 0, max: 100 },
      sample(137),
    );

    expect(option.series[0].data[0]!.value).toBe(100);
  });
});
