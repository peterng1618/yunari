import { describe, expect, it } from "vitest";
import type { Sample } from "../types.js";
import { buildPolarBarOption, defaultPolarBarSettings } from "./polar-bar.js";

function ok(value: number): Sample {
  return {
    sensorId: "cpu.load.total",
    timestamp: "2026-01-01T00:00:00.000Z",
    status: "ok",
    value,
    unit: "%",
  };
}

describe("buildPolarBarOption", () => {
  it("draws one category per binding around the authored start angle", () => {
    const option = buildPolarBarOption(defaultPolarBarSettings, [
      { sensorId: "cpu.load.total", sample: ok(70) },
      { sensorId: "gpu.load.total", sample: ok(40) },
      { sensorId: "ram.used", sample: ok(55) },
    ]);

    expect(option.angleAxis).toMatchObject({
      type: "category",
      data: ["cpu.load.total", "gpu.load.total", "ram.used"],
      startAngle: 90,
      axisLabel: { show: false },
    });
    expect(option.series[0]).toMatchObject({
      type: "bar",
      coordinateSystem: "polar",
      barCategoryGap: "40%",
    });
  });

  it("draws the authored track behind every bar", () => {
    const option = buildPolarBarOption(defaultPolarBarSettings, [
      { sensorId: "a", sample: ok(70) },
    ]);

    expect(option.series[0]!.showBackground).toBe(true);
    expect(option.series[0]!.backgroundStyle).toEqual({
      color: "#2a2f3a",
      borderRadius: 7,
    });
  });

  it("leaves a missing bar as null while its track remains", () => {
    const option = buildPolarBarOption(defaultPolarBarSettings, [
      { sensorId: "a", sample: undefined },
    ]);

    expect(option.series[0]!.data[0]!.value).toBeNull();
    expect(option.series[0]!.showBackground).toBe(true);
  });

  it("maps the authored radii and start angle", () => {
    const option = buildPolarBarOption(
      {
        ...defaultPolarBarSettings,
        startAngle: 180,
        innerRadiusPercent: 10,
        outerRadiusPercent: 60,
      },
      [],
    );

    expect(option.polar.radius).toEqual(["10%", "60%"]);
    expect(option.angleAxis.startAngle).toBe(180);
  });

  it("leaves a polar bar's width to the category gap", () => {
    // A polar bar's width is an angle in degrees, and ECharts reads `barWidth`
    // before it looks at `barCategoryGap`: the cartesian default of 14 pins
    // every bar to a 14° sliver and makes the gap inert.
    const option = buildPolarBarOption(defaultPolarBarSettings, [
      { sensorId: "a", sample: ok(70) },
      { sensorId: "b", sample: ok(40) },
      { sensorId: "c", sample: ok(55) },
    ]);

    expect("barWidth" in defaultPolarBarSettings).toBe(false);
    expect("barWidth" in option.series[0]!).toBe(false);
    expect(option.series[0]!.barCategoryGap).toBe("40%");
  });

  it("has no segment divisor", () => {
    expect("segmentDivisor" in defaultPolarBarSettings).toBe(false);
  });

  it("keeps a gradient linear in screen space, not radial", () => {
    // A polar bar has no authored growth direction, so the paint helpers are
    // handed `to-top` rather than reading an orientation it does not have.
    const option = buildPolarBarOption(
      {
        ...defaultPolarBarSettings,
        fill: {
          kind: "gradient",
          stops: [
            { offset: 0, color: "#000" },
            { offset: 1, color: "#fff" },
          ],
        },
      },
      [{ sensorId: "a", sample: ok(50) }],
    );

    expect(option.series[0]!.data[0]!.itemStyle.color).toMatchObject({
      x: 0,
      y: 1,
      x2: 0,
      y2: 0,
    });
  });
});
