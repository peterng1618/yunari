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
});
