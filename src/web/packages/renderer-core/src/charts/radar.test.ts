import { describe, expect, it } from "vitest";
import type { Sample } from "../types.js";
import { buildRadarOption, defaultRadarSettings } from "./radar.js";

function ok(value: number): Sample {
  return {
    sensorId: "cpu.load.total",
    timestamp: "2026-01-01T00:00:00.000Z",
    status: "ok",
    value,
    unit: "%",
  };
}

describe("buildRadarOption", () => {
  it("emits one indicator per binding on the shared scale", () => {
    const option = buildRadarOption(defaultRadarSettings, [
      { sensorId: "cpu.load.total", sample: ok(70) },
      { sensorId: "gpu.load.total", sample: ok(40) },
      { sensorId: "ram.used", sample: ok(55) },
    ]);

    expect(option.radar.indicator).toEqual([
      { name: "cpu.load.total", min: 0, max: 100 },
      { name: "gpu.load.total", min: 0, max: 100 },
      { name: "ram.used", min: 0, max: 100 },
    ]);
    expect(option.series[0]!.data).toEqual([{ value: [70, 40, 55] }]);
    expect(option.radar.axisName.show).toBe(false);
  });

  it("draws no polygon with fewer than three readings", () => {
    const option = buildRadarOption(defaultRadarSettings, [
      { sensorId: "a", sample: ok(10) },
      { sensorId: "b", sample: ok(20) },
    ]);

    expect(option.series[0]!.data).toEqual([]);
  });

  it("draws no polygon if any reading is missing", () => {
    const option = buildRadarOption(defaultRadarSettings, [
      { sensorId: "a", sample: ok(10) },
      { sensorId: "b", sample: undefined },
      { sensorId: "c", sample: ok(30) },
    ]);

    expect(option.series[0]!.data).toEqual([]);
  });

  it("clamps only what is drawn", () => {
    const option = buildRadarOption({ ...defaultRadarSettings, max: 100 }, [
      { sensorId: "a", sample: ok(150) },
      { sensorId: "b", sample: ok(-5) },
      { sensorId: "c", sample: ok(50) },
    ]);

    expect(option.series[0]!.data).toEqual([{ value: [100, 0, 50] }]);
  });

  it("resolves a threshold stroke at the top of the scale", () => {
    const option = buildRadarOption(
      {
        ...defaultRadarSettings,
        stroke: {
          kind: "thresholds",
          bands: [
            { offset: 0.5, color: "#0f0" },
            { offset: 1, color: "#f00" },
          ],
        },
      },
      [
        { sensorId: "a", sample: ok(10) },
        { sensorId: "b", sample: ok(20) },
        { sensorId: "c", sample: ok(30) },
      ],
    );

    expect(option.series[0]!.lineStyle.color).toBe("#f00");
  });

  it("draws an empty frame when showAxes is off", () => {
    const option = buildRadarOption(
      { ...defaultRadarSettings, showAxes: false },
      [],
    );

    expect(option.radar.axisLine.show).toBe(false);
    expect(option.radar.splitLine.show).toBe(false);
    expect(option.radar.splitArea.show).toBe(false);
  });
});
