import { describe, expect, it } from "vitest";
import { defaultBarSettings } from "../charts/bar.js";
import { defaultLineSettings } from "../charts/line.js";
import { LIVE_SOURCE_CHART_PLAYBACK_DELAY_MS } from "../data/live-source.js";
import type { SampleSource } from "../data/source.js";
import { emptySampleSource } from "../data/source.js";
import { SampleStore } from "../data/store.js";
import type { Artboard, Binding, Globals, TextRun } from "../theme/document.js";
import { defaultGaugeSettings, type Sample } from "../types.js";
import {
  buildChartPlan,
  formatNumber,
  formatUnit,
  MISSING_VALUE_TEXT,
  type PlanInputs,
  type PlanIssue,
  planArtboard,
  resolveStyleValue,
  resolveTextSegments,
} from "./plan.js";

/**
 * The pure decisions a render plan is made of.
 *
 * Each describe calls the owner directly rather than building a whole plan:
 * `planArtboard`, `resolveStyleValue`, `resolveTextSegments` and
 * `buildChartPlan` are what a document's authoring turns into, and the docless
 * entry point that used to assemble them is gone with schema v1.
 */

const NOW = Date.parse("2026-01-01T00:00:10Z");

function ok(value: number, unit = "%", sensorId = "cpu.load.total"): Sample {
  return {
    sensorId,
    timestamp: new Date(NOW).toISOString(),
    status: "ok",
    value,
    unit,
  };
}

function storeWith(entries: Record<string, Sample>): SampleStore {
  const store = new SampleStore();
  store.ingest(Object.entries(entries), NOW);
  return store;
}

function artboardWith(overrides: Partial<Artboard> = {}): Artboard {
  return { width: 800, height: 480, contentFit: "contain", ...overrides };
}

describe("artboard", () => {
  it("carries size and fit mode through", () => {
    expect(planArtboard(artboardWith(), undefined, {}, [])).toMatchObject({
      width: 800,
      height: 480,
      contentFit: "contain",
    });
  });

  it("defaults fit mode to contain", () => {
    expect(
      planArtboard({ width: 100, height: 100 }, undefined, {}, []).contentFit,
    ).toBe("contain");
  });

  // The background is its own envelope section; the artboard no longer carries
  // a paint, so the plan takes the layer's colour as the second argument.
  it("resolves the background colour through the palette", () => {
    const globals: Globals = {
      palette: {
        ink: { name: "Ink", value: { kind: "solid", color: "#101216" } },
      },
    };

    expect(
      planArtboard(
        { width: 100, height: 100 },
        { color: { ref: "palette.ink" } },
        globals,
        [],
      ).background,
    ).toBe("#101216");
  });

  // The palette's other shape — a bare colour rather than `{ kind: "solid" }`.
  // Both resolve to the colour string, which is the form the renderer paints.
  it("resolves a bare palette colour", () => {
    const globals: Globals = {
      palette: { bg: { name: "Background", value: "#101216" } },
    };

    expect(
      planArtboard(
        artboardWith(),
        { color: { ref: "palette.bg" } },
        globals,
        [],
      ).background,
    ).toBe("#101216");
  });

  it("paints nothing when the envelope has no background", () => {
    expect(planArtboard(artboardWith(), undefined, {}, []).background).toBe(
      undefined,
    );
  });
});

describe("type presets", () => {
  it("resolves each text run through its own preset and palette token", () => {
    const globals: Globals = {
      palette: { ink: { name: "Ink", value: "#ffffff" } },
      typePresets: {
        label: {
          name: "Label",
          value: {
            family: "Inter",
            size: 14,
            weight: 500,
            letterSpacing: 1.2,
            lineHeight: 1.1,
          },
        },
        value: {
          name: "Value",
          value: { family: "Inter", size: 32, weight: 700 },
        },
      },
    };

    const result = resolveTextSegments(
      "readout",
      [
        {
          kind: "literal",
          text: "CPU ",
          typePreset: "typePresets.label",
          style: { color: { ref: "palette.ink" } },
        },
        { kind: "literal", text: "48%", typePreset: "typePresets.value" },
      ],
      [],
      { source: emptySampleSource },
      globals,
      [],
    );

    expect(result).toEqual([
      {
        text: "CPU ",
        style: {
          fontFamily: "Inter",
          fontSize: 14,
          fontWeight: 500,
          letterSpacing: 1.2,
          lineHeight: 1.1,
          color: "#ffffff",
        },
      },
      {
        text: "48%",
        style: { fontFamily: "Inter", fontSize: 32, fontWeight: 700 },
      },
    ]);
  });
});

describe("style resolution (§75)", () => {
  const globals: Globals = {
    palette: { accent: { name: "Accent", value: "#00b8d9" } },
  };

  it("substitutes a global reference for its literal", () => {
    expect(resolveStyleValue({ ref: "palette.accent" }, globals, "r", [])).toBe(
      "#00b8d9",
    );
  });

  it("passes a local literal through", () => {
    expect(resolveStyleValue({ value: "#ff0000" }, globals, "r", [])).toBe(
      "#ff0000",
    );
  });

  it("reports an unresolvable reference instead of guessing a default", () => {
    // A silently substituted colour is how a theme ends up looking wrong with
    // nothing to point at.
    const issues: PlanIssue[] = [];

    expect(
      resolveStyleValue({ ref: "palette.nope" }, globals, "r", issues),
    ).toBeUndefined();
    expect(issues).toEqual([
      {
        code: "unresolved-global",
        nodeId: "r",
        detail: 'Global "palette.nope" is not defined in this document.',
      },
    ]);
  });

  it("keeps a literal falsy value rather than dropping it", () => {
    expect(resolveStyleValue({ value: 0 }, globals, "r", [])).toBe(0);
  });
});

describe("text (§89)", () => {
  function segments(
    source: SampleSource,
    bindings: readonly Binding[],
    runs: readonly TextRun[],
    overrides: Partial<
      Pick<PlanInputs, "longUnits" | "measurement" | "themeLanguage">
    > = {},
  ) {
    const issues: PlanIssue[] = [];

    return {
      segments: resolveTextSegments(
        "t",
        runs,
        bindings,
        { source, ...overrides },
        {},
        issues,
      ),
      issues,
    };
  }

  it("reads a bound run through the run's own precision", () => {
    const result = segments(
      storeWith({ "cpu.temp": ok(61.4, "°C", "cpu.temp") }),
      [{ id: "b", semanticKey: "cpu.temp" }],
      [{ kind: "value", bindingId: "b", precision: 0 }],
    );

    expect(result.segments.map((segment) => segment.text)).toEqual(["61°C"]);
  });

  /** A text-valued sample, which is what a clock key reports. */
  function instant(textValue: string, sensorId: string): Sample {
    return {
      sensorId,
      timestamp: new Date(NOW).toISOString(),
      status: "ok",
      textValue,
    };
  }

  it("reads a time binding through the author's format", () => {
    const source = storeWith({
      "time.now": instant("2026-09-24T14:07:09+07:00", "clock:time.now"),
    });

    expect(
      segments(
        source,
        [{ id: "b", semanticKey: "time.now" }],
        [{ kind: "value", bindingId: "b" }],
      ).segments.map((segment) => segment.text),
    ).toEqual(["14:07"]);

    // The same reading, told how to read: the author owns this, not the host.
    expect(
      segments(
        source,
        [{ id: "b", semanticKey: "time.now", format: "dddd, DD MMMM" }],
        [{ kind: "value", bindingId: "b" }],
      ).segments.map((segment) => segment.text),
    ).toEqual(["Thursday, 24 September"]);
  });

  it("reads a pinned zone without the host's own offset deciding", () => {
    const source = storeWith({
      "time.now": instant("2026-09-24T14:07:09+07:00", "clock:time.now"),
    });
    const result = segments(
      source,
      [{ id: "b", semanticKey: "time.now", timeZone: "Asia/Tokyo" }],
      [{ kind: "value", bindingId: "b" }],
    );

    // 14:07 +07:00 is 16:07 in Tokyo, which is the reading the author asked for.
    expect(result.segments[0]!.text).toBe("16:07");
  });

  it("reads a date in the language it is told", () => {
    const source = storeWith({
      "date.today": instant("2026-09-24T14:07:09+07:00", "clock:date.today"),
    });
    const result = segments(
      source,
      [{ id: "b", semanticKey: "date.today", format: "dddd" }],
      [{ kind: "value", bindingId: "b" }],
      { themeLanguage: "ja" },
    );

    // 2026-09-24 is a Thursday, however the language spells it.
    expect(result.segments[0]!.text).toBe("木曜日");
  });

  it("takes names from the pinned zone's own date, not from UTC", () => {
    const source = storeWith({
      "date.today": instant("2026-09-24T20:00:00Z", "clock:date.today"),
    });
    const result = segments(
      source,
      [
        {
          id: "b",
          semanticKey: "date.today",
          format: "dddd",
          timeZone: "Asia/Tokyo",
        },
      ],
      [{ kind: "value", bindingId: "b" }],
      { themeLanguage: "en" },
    );

    // 20:00 UTC is already Friday the 25th in Tokyo, so a formatter that read the
    // instant's UTC day would answer Thursday.
    expect(result.segments[0]!.text).toBe("Friday");
  });

  it("leaves every numeric token in ASCII digits in every language", () => {
    const source = storeWith({
      "date.today": instant("2026-09-24T14:07:09+07:00", "clock:date.today"),
    });
    const result = segments(
      source,
      [{ id: "b", semanticKey: "date.today", format: "DD/MM/YYYY HH:mm" }],
      [{ kind: "value", bindingId: "b" }],
      { themeLanguage: "ar" },
    );

    // `ar` is the sharpest case: its own calendar and digits are not Latin, and
    // the tokens deliberately keep both the padding and the ASCII forms.
    expect(result.segments[0]!.text).toBe("24/09/2026 14:07");
  });

  it("shows a text key that is not a time exactly as it was sent", () => {
    const source = storeWith({ "cpu.model": instant("Ryzen 9", "cpu.model") });
    const result = segments(
      source,
      [{ id: "b", semanticKey: "cpu.model", format: "HH:mm" }],
      [{ kind: "value", bindingId: "b" }],
    );

    // An unknown key reports whatever it likes; no format is applied to it.
    expect(result.segments[0]!.text).toBe("Ryzen 9");
  });

  it("converts a temperature for the consumer, once, after the author's scale", () => {
    const source = storeWith({ "cpu.temp": ok(61.4, "°C", "cpu.temp") });
    const bindings = [{ id: "b", semanticKey: "cpu.temp", scale: 2 }];
    const runs = [{ kind: "value", bindingId: "b", precision: 1 }] as const;

    // The author's scale is part of the reading, so the preference converts what
    // that produces (122.8 °C → 253.04 °F), never the value it started from.
    expect(
      segments(source, bindings, runs, {
        measurement: "imperial",
      }).segments.map((segment) => segment.text),
    ).toEqual(["253.0°F"]);

    // Metric shows what the provider measured, with no conversion at all.
    expect(
      segments(source, bindings, runs, { measurement: "metric" }).segments.map(
        (segment) => segment.text,
      ),
    ).toEqual(["122.8°C"]);
  });

  it("leaves every other family, and a gap, exactly as measured", () => {
    const stale: Sample = {
      sensorId: "cpu.temp",
      timestamp: new Date(NOW).toISOString(),
      status: "stale",
    };
    const result = segments(
      storeWith({ "ram.used": ok(10.5, "GB", "ram.used"), "cpu.temp": stale }),
      [
        { id: "ram", semanticKey: "ram.used" },
        { id: "temp", semanticKey: "cpu.temp" },
      ],
      [
        { kind: "value", bindingId: "ram" },
        { kind: "literal", text: " / " },
        { kind: "value", bindingId: "temp" },
      ],
      { measurement: "imperial" },
    );

    // An imperial consumer still reads memory in the unit it was reported in,
    // and a gap stays a gap rather than becoming a converted number.
    expect(result.segments.map((segment) => segment.text)).toEqual([
      "10.5 GB",
      " / ",
      MISSING_VALUE_TEXT,
    ]);
  });

  it("mixes literals and live values in one element", () => {
    const result = segments(
      storeWith({ "cpu.temp": ok(61.4, "°C", "cpu.temp") }),
      [{ id: "b", semanticKey: "cpu.temp" }],
      [
        { kind: "literal", text: "CPU " },
        { kind: "value", bindingId: "b", precision: 0 },
      ],
    );

    expect(result.segments.map((s) => s.text)).toEqual(["CPU ", "61°C"]);
  });

  it("renders a placeholder and the status for a non-ok sample, never a number", () => {
    // §83: a non-ok sample carries no value, and nothing may be substituted.
    const stale: Sample = {
      sensorId: "cpu.temp",
      timestamp: new Date(NOW).toISOString(),
      status: "stale",
      message: "last read 12 s ago",
    };

    const result = segments(
      storeWith({ "cpu.temp": stale }),
      [{ id: "b", semanticKey: "cpu.temp" }],
      [{ kind: "value", bindingId: "b" }],
    );

    expect(result.segments[0]).toEqual({
      text: MISSING_VALUE_TEXT,
      style: {},
      status: "stale",
      message: "last read 12 s ago",
    });
  });

  it("reports an unmapped semantic key, which needs remapping rather than a retry", () => {
    const result = segments(
      emptySampleSource,
      [{ id: "b", semanticKey: "gpu.hotspot" }],
      [{ kind: "value", bindingId: "b" }],
    );

    expect(result.segments[0]!.text).toBe(MISSING_VALUE_TEXT);
    expect(result.issues[0]).toMatchObject({ code: "unmapped-key" });
  });

  it("does not throw on a run whose binding is missing", () => {
    // Validation rejects this at import; reaching it means an unvalidated
    // document, and one bad run must not take down a dashboard on a phone.
    const result = segments(
      emptySampleSource,
      [],
      [{ kind: "value", bindingId: "ghost" }],
    );

    expect(result.segments[0]!.text).toBe(MISSING_VALUE_TEXT);
    expect(result.issues[0]!.detail).toContain("does not declare");
  });

  it("applies the binding scale and offset", () => {
    // A theme showing MB from a sensor reporting bytes, without the host
    // knowing anything about the theme.
    const result = segments(
      storeWith({ "ram.used": ok(2_147_483_648, "B", "ram.used") }),
      [{ id: "b", semanticKey: "ram.used", scale: 1 / 1_073_741_824 }],
      [{ kind: "value", bindingId: "b", precision: 1 }],
    );

    expect(result.segments[0]!.text).toBe("2.0 B");
  });

  it("lets a run override the binding precision", () => {
    const result = segments(
      storeWith({ "cpu.load.total": ok(45.678) }),
      [{ id: "b", semanticKey: "cpu.load.total", precision: 0 }],
      [{ kind: "value", bindingId: "b", precision: 2 }],
    );

    expect(result.segments[0]!.text).toBe("45.68%");
  });

  it("honours unitDisplay none", () => {
    const result = segments(
      storeWith({ "cpu.load.total": ok(45) }),
      [{ id: "b", semanticKey: "cpu.load.total", unitDisplay: "none" }],
      [{ kind: "value", bindingId: "b", precision: 0 }],
    );

    expect(result.segments[0]!.text).toBe("45");
  });

  it("renders a text and a boolean sample", () => {
    const textSample: Sample = {
      sensorId: "gpu.name",
      timestamp: new Date(NOW).toISOString(),
      status: "ok",
      textValue: "RTX 4080",
    };
    const boolSample: Sample = {
      sensorId: "pump.running",
      timestamp: new Date(NOW).toISOString(),
      status: "ok",
      booleanValue: true,
    };

    const result = segments(
      storeWith({ "gpu.name": textSample, "pump.running": boolSample }),
      [
        { id: "b1", semanticKey: "gpu.name" },
        { id: "b2", semanticKey: "pump.running" },
      ],
      [
        { kind: "value", bindingId: "b1" },
        { kind: "literal", text: " / " },
        { kind: "value", bindingId: "b2" },
      ],
    );

    expect(result.segments.map((s) => s.text)).toEqual([
      "RTX 4080",
      " / ",
      "on",
    ]);
  });

  it("flags an ok sample that carries no value at all as an error", () => {
    // That combination is a provider bug. An empty box would hide it.
    const empty: Sample = {
      sensorId: "x",
      timestamp: new Date(NOW).toISOString(),
      status: "ok",
    };

    const result = segments(
      storeWith({ x: empty }),
      [{ id: "b", semanticKey: "x" }],
      [{ kind: "value", bindingId: "b" }],
    );

    expect(result.segments[0]).toMatchObject({
      text: MISSING_VALUE_TEXT,
      status: "error",
    });
  });

  it("resolves per-run styles independently", () => {
    const globals: Globals = {
      typePresets: {
        small: { name: "Small", value: { family: "Inter", size: 12 } },
        large: { name: "Large", value: { family: "Inter", size: 48 } },
      },
    };

    const result = resolveTextSegments(
      "t",
      [
        { kind: "literal", text: "a", typePreset: "typePresets.small" },
        { kind: "literal", text: "b", typePreset: "typePresets.large" },
      ],
      [],
      { source: emptySampleSource },
      globals,
      [],
    );

    expect(result.map((segment) => segment.style["fontSize"])).toEqual([
      12, 48,
    ]);
  });
});

describe("charts", () => {
  function chartPlan(
    content: Parameters<typeof buildChartPlan>[1],
    bindings: readonly Binding[],
    source: SampleSource,
    palette?: Parameters<typeof buildChartPlan>[5],
  ) {
    const issues: PlanIssue[] = [];
    const chart = buildChartPlan(
      "c",
      content,
      bindings,
      { source, nowMs: NOW, animate: false },
      issues,
      palette,
    );

    return { chart, issues };
  }

  it("feeds the latest sample to a gauge", () => {
    const { chart, issues } = chartPlan(
      { family: "gauge", settings: defaultGaugeSettings },
      [{ id: "b", semanticKey: "cpu.load.total" }],
      storeWith({ "cpu.load.total": ok(42) }),
    );

    expect(chart.family).toBe("gauge");
    if (chart.family === "gauge") {
      expect(chart.option.series[0].data[0]!.value).toBe(42);
    }
    expect(issues).toEqual([]);
  });

  it("applies scale and offset to chart data too", () => {
    // A gauge with a 0–100 range bound to a 0–1 ratio would otherwise sit at
    // the bottom of its range forever.
    const { chart } = chartPlan(
      { family: "gauge", settings: defaultGaugeSettings },
      [{ id: "b", semanticKey: "fan.ratio", scale: 100 }],
      storeWith({ "fan.ratio": ok(0.42, "", "fan.ratio") }),
    );

    if (chart.family === "gauge") {
      expect(chart.option.series[0].data[0]!.value).toBeCloseTo(42);
    }
  });

  it("gives a line chart its windowed history", () => {
    const store = new SampleStore();
    store.ingest(
      [
        [
          "cpu.load.total",
          { ...ok(10), timestamp: new Date(NOW - 3000).toISOString() },
        ],
        [
          "cpu.load.total",
          { ...ok(20), timestamp: new Date(NOW - 2000).toISOString() },
        ],
        [
          "cpu.load.total",
          { ...ok(30), timestamp: new Date(NOW - 1000).toISOString() },
        ],
      ],
      NOW,
    );

    const { chart } = chartPlan(
      { family: "line", settings: defaultLineSettings },
      [{ id: "b", semanticKey: "cpu.load.total" }],
      store,
    );

    if (chart.family === "line") {
      expect(chart.option.series[0]!.data.map((point) => point[1])).toEqual([
        10, 20, 30,
      ]);
    }
  });

  it("keeps the next live segment outside the line viewport", () => {
    const store = new SampleStore();
    store.ingest(
      [
        [
          "cpu.load.total",
          {
            ...ok(10),
            timestamp: new Date(NOW - 3000).toISOString(),
            presentationTimestamp: new Date(NOW - 2000).toISOString(),
          },
        ],
        [
          "cpu.load.total",
          {
            ...ok(20),
            timestamp: new Date(NOW - 2000).toISOString(),
            presentationTimestamp: new Date(NOW - 1000).toISOString(),
          },
        ],
        [
          "cpu.load.total",
          {
            ...ok(30),
            timestamp: new Date(NOW - 1000).toISOString(),
            presentationTimestamp: new Date(NOW).toISOString(),
          },
        ],
      ],
      NOW,
    );
    const source = Object.assign(store, { chartPlaybackDelayMs: 1_000 });

    const { chart } = chartPlan(
      { family: "line", settings: defaultLineSettings },
      [{ id: "b", semanticKey: "cpu.load.total" }],
      source,
    );

    if (chart.family === "line") {
      expect(chart.option.xAxis.max).toBe(NOW);
      expect(chart.option.renderOverscanRightMs).toBe(1_000);
      expect(chart.option.series[0]!.data.at(-1)).toEqual([NOW, 30]);
    }
  });

  it("requests the delayed line viewport's left-edge predecessor", () => {
    const windows: number[] = [];
    const source = {
      chartPlaybackDelayMs: 1_000,
      latest: () => undefined,
      history: (_key: string, windowSeconds: number) => {
        windows.push(windowSeconds);
        return [];
      },
    };

    buildChartPlan(
      "line",
      { family: "line", settings: defaultLineSettings },
      [{ id: "b", semanticKey: "cpu.load.total" }],
      { source, nowMs: NOW },
      [],
    );

    // The axis window plus one cadence: the window alone leaves the sample
    // `toSeriesPoints` keeps for the left edge below the source's own cutoff.
    expect(windows).toEqual([defaultLineSettings.windowSeconds + 2]);
  });

  /**
   * **The quantisation, not a duration.** A source answers a trailing window at
   * its own cadence, so the oldest sample it returns sits somewhere inside the
   * first cadence above the cutoff it was handed — and the axis slides under a
   * frame clock while the series advances a whole batch at a time. The line
   * therefore has to be drawn to its window's left edge on *every* frame of a
   * cadence, for any cadence the source's own delay allows, not merely for one
   * whose samples happen to line up with the cutoff (`vg-571`).
   */
  it.each([700, 950, 1_018])(
    "draws the line to its window's left edge at every frame of a %i ms cadence",
    (cadenceMs) => {
      const store = new SampleStore();
      const start = Date.parse("2026-01-01T00:10:00Z");
      // Two minutes, so the 60 s window is full for every frame below.
      const lastElapsed = Math.floor(120_000 / cadenceMs) * cadenceMs;
      for (let elapsed = 0; elapsed <= lastElapsed; elapsed += cadenceMs) {
        store.ingest(
          [
            [
              "cpu.load",
              {
                sensorId: "os:cpu.load",
                timestamp: new Date(start + elapsed).toISOString(),
                status: "ok" as const,
                value: 40,
                unit: "%",
              },
            ],
          ],
          start + elapsed,
        );
      }
      const source = {
        chartPlaybackDelayMs: LIVE_SOURCE_CHART_PLAYBACK_DELAY_MS,
        latest: (key: string) => store.latest(key),
        history: (key: string, windowSeconds: number) =>
          store.history(key, windowSeconds),
      };

      // Every frame of one whole cadence measured from the newest batch, as
      // the display's 30 fps loop walks it.
      for (let frame = 0; frame <= 30; frame += 1) {
        const nowMs = start + lastElapsed + (frame * cadenceMs) / 30;
        const chart = buildChartPlan(
          "line",
          { family: "line", settings: defaultLineSettings },
          [{ id: "b", semanticKey: "cpu.load" }],
          { source, nowMs },
          [],
        );
        if (chart.family !== "line") throw new Error("expected a line chart");
        const data = chart.option.series[0]!.data;

        expect(data.length).toBeGreaterThan(0);
        expect(
          data[0]![0],
          `frame ${frame}: the series starts after the axis does, so the line begins inside the plot`,
        ).toBeLessThanOrEqual(chart.option.xAxis.min);
      }
    },
  );

  it("gives a bar chart one category per binding, in order", () => {
    const { chart } = chartPlan(
      { family: "bar", settings: defaultBarSettings },
      [
        { id: "b1", semanticKey: "cpu.load.total" },
        { id: "b2", semanticKey: "gpu.load.total" },
      ],
      storeWith({
        "cpu.load.total": ok(30),
        "gpu.load.total": ok(70, "%", "gpu.load.total"),
      }),
    );

    if (chart.family === "bar") {
      expect(chart.option.series[0].data.map((d) => d.value)).toEqual([30, 70]);
    }
  });

  it("reports each unmapped chart key once", () => {
    const { issues } = chartPlan(
      { family: "bar", settings: defaultBarSettings },
      [
        { id: "b1", semanticKey: "a.missing" },
        { id: "b2", semanticKey: "b.missing" },
      ],
      emptySampleSource,
    );

    expect(issues.map((i) => i.detail)).toEqual([
      'No sensor is mapped to "a.missing".',
      'No sensor is mapped to "b.missing".',
    ]);
  });

  it("still emits a drawable option when a key is unmapped", () => {
    // The adapters' own gap rules cover the missing sample; the chart must
    // still render its track rather than the frame failing.
    const { chart } = chartPlan(
      { family: "gauge", settings: defaultGaugeSettings },
      [{ id: "b", semanticKey: "nope" }],
      emptySampleSource,
    );

    if (chart.family === "gauge") {
      expect(chart.option.series[0].progress.show).toBe(false);
    }
  });
});

describe("formatNumber", () => {
  it("honours an explicit precision exactly, including trailing zeroes", () => {
    expect(formatNumber(45, 2)).toBe("45.00");
    expect(formatNumber(45.678, 1)).toBe("45.7");
    expect(formatNumber(45.678, 0)).toBe("46");
  });

  it("clamps precision to the schema range", () => {
    expect(formatNumber(1, 99)).toBe("1.000000");
    expect(formatNumber(1, -5)).toBe("1");
  });

  it("rounds to one decimal and drops a trailing zero when unspecified", () => {
    expect(formatNumber(45.67, undefined)).toBe("45.7");
    expect(formatNumber(1200, undefined)).toBe("1200");
    expect(formatNumber(0.5, undefined)).toBe("0.5");
    expect(formatNumber(45.0, undefined)).toBe("45");
  });

  it("writes the reading in the theme's own number format", () => {
    expect(formatNumber(17.6, undefined, "de")).toBe("17,6");
    expect(formatNumber(17.6, undefined, "fr")).toBe("17,6");
    expect(formatNumber(17.6, undefined, "ru")).toBe("17,6");
    expect(formatNumber(17.6, 1, "de")).toBe("17,6");

    // A tag the runtime does not know falls back rather than throwing.
    expect(formatNumber(45, 2, "de")).toBe("45,00");
    expect(formatNumber(17.6, undefined, "not-a-tag")).toBe("17.6");
  });

  it("leaves the width of a reading where the author laid it out", () => {
    // Grouping is off: `8,667.3` is wider than `8667.3`, and a text box was
    // sized by hand.
    expect(formatNumber(8667.25, undefined, "en")).toBe("8667.3");
    expect(formatNumber(8667.25, undefined, "de")).toBe("8667,3");
  });

  it("handles negatives", () => {
    expect(formatNumber(-3.25, 1)).toBe("-3.3");
    expect(formatNumber(-0.04, undefined)).toBe("0");
  });
});

describe("formatUnit", () => {
  it("omits a space before a percent or degree sign", () => {
    expect(formatUnit("%", "short", undefined)).toBe("%");
    expect(formatUnit("°C", "short", undefined)).toBe("°C");
  });

  it("adds a space before a word-like unit", () => {
    expect(formatUnit("RPM", "short", undefined)).toBe(" RPM");
    expect(formatUnit("W", "short", undefined)).toBe(" W");
  });

  it("renders nothing for none or a missing unit", () => {
    expect(formatUnit("%", "none", undefined)).toBe("");
    expect(formatUnit(undefined, "short", undefined)).toBe("");
    expect(formatUnit("", "short", undefined)).toBe("");
  });

  it("uses a long name when one is supplied", () => {
    expect(formatUnit("W", "long", { W: "watts" })).toBe(" watts");
  });

  it("falls back to the short symbol rather than inventing a long name", () => {
    expect(formatUnit("RPM", "long", undefined)).toBe(" RPM");
  });
});

// 0007: a chart's paint references resolve from the document's palette, and one
// that cannot is reported with the code `resolveStyleValue` already uses.
describe("chart paint references", () => {
  const palette = {
    storage: {
      name: "Storage",
      value: { kind: "solid" as const, color: "#00b8d9" },
    },
  };

  const settings = { ...defaultBarSettings, fill: { ref: "palette.storage" } };

  function storageBar(withPalette: boolean) {
    const issues: PlanIssue[] = [];

    return {
      chart: buildChartPlan(
        "bar",
        { family: "bar", settings },
        [{ id: "b", semanticKey: "disk.used" }],
        {
          source: storeWith({ "disk.used": ok(46.8) }),
          nowMs: NOW,
          animate: false,
        },
        issues,
        withPalette ? palette : undefined,
      ),
      issues,
    };
  }

  it("resolves a bar fill from the document palette", () => {
    const { chart, issues } = storageBar(true);

    if (chart.family === "bar") {
      expect(chart.option.series[0].data[0]!.itemStyle.color).toBe("#00b8d9");
    }
    expect(issues).toEqual([]);
  });

  it("leaves a bar whose paint reference the document does not define unpainted", () => {
    // The datum is absent, not a transparent bar on a live number (0007).
    const { chart, issues } = storageBar(false);

    if (chart.family === "bar") {
      expect(chart.option.series[0].data[0]!.value).toBeNull();
    }
    expect(issues.map((issue) => issue.detail)).toEqual([
      'Chart paint "palette.storage" is not defined in this document.',
    ]);
  });
});
