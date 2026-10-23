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
