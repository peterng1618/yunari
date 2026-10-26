import { describe, expect, it } from "vitest";
import type { SampleSource } from "../data/source.js";
import { defaultGaugeSettings, type Sample } from "../types.js";
import { defaultBarSettings } from "./bar.js";
import { defaultLineSettings } from "./line.js";
import { chartReadingSignature } from "./reading-signature.js";

const sample: Sample = {
  sensorId: "cpu.load.total",
  timestamp: "2026-01-01T00:00:01.000Z",
  status: "ok",
  value: 42,
  unit: "%",
};
const source: SampleSource = {
  latest: () => sample,
  history: () => [sample],
};

describe("chartReadingSignature", () => {
  it("moves a value chart only when its reading moves", () => {
    const chart = { family: "bar", settings: defaultBarSettings } as const;
    const bindings = [{ id: "b", semanticKey: "cpu.load.total" }];

    expect(chartReadingSignature(chart, bindings, source, 1_000)).toBe(
      chartReadingSignature(chart, bindings, source, 1_500),
    );
  });

  it("moves a line with the render clock", () => {
    const chart = { family: "line", settings: defaultLineSettings } as const;
    const bindings = [{ id: "b", semanticKey: "cpu.load.total" }];

    expect(chartReadingSignature(chart, bindings, source, 1_000)).not.toBe(
      chartReadingSignature(chart, bindings, source, 1_500),
    );
  });

  it("moves with the drawn box, so a resize redraws a static chart", () => {
    // The gap is measured against the drawn size, so geometry is part of what
    // the option holds. Without it a gauge with no binding keeps the gap it was
    // built with until something else moves.
    const chart = { family: "gauge", settings: defaultGaugeSettings } as const;
    const at = (drawnEdgePx: number) =>
      chartReadingSignature(
        chart,
        [],
        source,
        1_000,
        undefined,
        undefined,
        drawnEdgePx,
      );

    expect(at(800)).not.toBe(at(400));
    expect(at(800)).toBe(at(800));
  });

  it("asks for the history its delay needs, and less when the delay is dropped", () => {
    // The signature must read what the chart would draw: a 1 fps caller drops
    // the delay, so the plan asks for the window alone and so must this.
    const chart = { family: "line", settings: defaultLineSettings } as const;
    const bindings = [{ id: "b", semanticKey: "cpu.load.total" }];
    const asked: number[] = [];
    const delayed: SampleSource = {
      chartPlaybackDelayMs: 2_000,
      latest: () => sample,
      history: (_key, seconds) => {
        asked.push(seconds);
        return [sample];
      },
    };

    chartReadingSignature(chart, bindings, delayed, 1_000);
    chartReadingSignature(chart, bindings, delayed, 1_000, undefined, 0);

    expect(asked).toEqual([
      defaultLineSettings.windowSeconds + 2,
      defaultLineSettings.windowSeconds,
    ]);
  });

  it("moves only with the palette tokens the settings name", () => {
    const chart = {
      family: "bar",
      settings: {
        ...defaultBarSettings,
        fill: { ref: "palette.accent" },
      },
    } as const;
    const bindings = [{ id: "b", semanticKey: "cpu.load.total" }];
    const palette = (accent: string) => ({
      accent: {
        name: "Accent",
        value: { kind: "solid" as const, color: accent },
      },
      other: {
        name: "Other",
        value: { kind: "solid" as const, color: "#123" },
      },
    });

    // A token the settings do not name is not an input to the plan.
    expect(
      chartReadingSignature(chart, bindings, source, 1_000, palette("#111")),
    ).toBe(
      chartReadingSignature(chart, bindings, source, 1_000, palette("#111")),
    );
    // The one they do name is.
    expect(
      chartReadingSignature(chart, bindings, source, 1_000, palette("#111")),
    ).not.toBe(
      chartReadingSignature(chart, bindings, source, 1_000, palette("#222")),
    );
  });
});
