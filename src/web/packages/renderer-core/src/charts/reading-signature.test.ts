import { describe, expect, it } from "vitest";
import type { SampleSource } from "../data/source.js";
import type { Sample } from "../types.js";
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
    chartReadingSignature(chart, bindings, delayed, 1_000, 0);

    expect(asked).toEqual([
      defaultLineSettings.windowSeconds + 2,
      defaultLineSettings.windowSeconds,
    ]);
  });
});
