import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { matchLhmSensors } from "./lhm-mapping.js";
import { flattenLhmSensors, type LhmSensor } from "./lhm-tree.js";

/** The real v0.9.6 capture: i9-10850K + RTX 3080 Ti. Every sensor name and
 * value asserted here was read off that capture, not invented. */
function realSensors(): readonly LhmSensor[] {
  const path = fileURLToPath(
    new URL("./__fixtures__/real-lhm.json", import.meta.url),
  );
  return flattenLhmSensors(JSON.parse(readFileSync(path, "utf8")));
}

function valuesOf(
  sensors: readonly LhmSensor[],
  keys: readonly string[],
): ReadonlyMap<string, number> {
  return new Map(
    matchLhmSensors(sensors, keys).map((match) => [
      match.semanticKey,
      match.value,
    ]),
  );
}

describe("per-core readings", () => {
  const keys = Array.from({ length: 10 }, (_, index) => index + 1).flatMap(
    (core) => [
      `cpu.core.${core}.load`,
      `cpu.core.${core}.temp`,
      `cpu.core.${core}.clock`,
    ],
  );

  it("reports one key per core, 1-based, from the sensor of each type", () => {
    const values = valuesOf(realSensors(), keys);

    for (const key of keys) {
      expect(values.has(key)).toBe(true);
    }

    expect(values.get("cpu.core.1.temp")).toBe(38);
    expect(values.get("cpu.core.1.clock")).toBe(4800);
    // Load arrives per logical processor; a core reads its hottest thread.
    expect(values.get("cpu.core.2.load")).toBe(4.7);
  });

  it("removes a core's keys when its sensors are removed", () => {
    const withoutCore2 = realSensors().filter(
      (sensor) =>
        sensor.text !== "CPU Core #2" &&
        !sensor.text.startsWith("CPU Core #2 Thread"),
    );
    const values = valuesOf(withoutCore2, keys);

    expect(values.has("cpu.core.1.temp")).toBe(true);
    expect(
      [...values.keys()].filter((key) => key.startsWith("cpu.core.2.")),
    ).toEqual([]);
  });

  it("invents no core the machine does not report", () => {
    expect(
      matchLhmSensors(realSensors(), [
        "cpu.core.11.load",
        "cpu.core.11.temp",
        "cpu.core.11.clock",
      ]),
    ).toEqual([]);
  });
});

describe("CPU roles and aggregates", () => {
  it("answers package, hottest-core and average-core keys", () => {
    const values = valuesOf(realSensors(), [
      "cpu.temp.package",
      "cpu.temp.core.max",
      "cpu.temp.core.avg",
      "cpu.temp",
      "cpu.voltage",
    ]);

    expect(values.get("cpu.temp.package")).toBe(41);
    expect(values.get("cpu.temp.core.max")).toBe(41);
    expect(values.get("cpu.temp.core.avg")).toBe(38.2);
    // The aggregate is unchanged: it still reads the package figure here.
    expect(values.get("cpu.temp")).toBe(41);
    expect(values.get("cpu.voltage")).toBe(1.362);
  });
});

describe("GPU roles and aggregates", () => {
  it("separates core, hotspot and memory-junction temperatures", () => {
    const values = valuesOf(realSensors(), [
      "gpu.temp",
      "gpu.temp.core",
      "gpu.temp.hotspot",
      "vram.temp",
    ]);

    expect(values.get("gpu.temp")).toBe(38);
    expect(values.get("gpu.temp.core")).toBe(38);
    expect(values.get("gpu.temp.hotspot")).toBe(44.6);
    expect(values.get("vram.temp")).toBe(44);
  });

  it("answers voltage and the memory clock", () => {
    const values = valuesOf(realSensors(), [
      "gpu.voltage",
      "gpu.clock",
      "gpu.clock.memory",
    ]);

    expect(values.get("gpu.voltage")).toBe(0.763);
    expect(values.get("gpu.clock")).toBe(210);
    expect(values.get("gpu.clock.memory")).toBe(405);
  });

  it("reports each fan under its own number", () => {
    const values = valuesOf(realSensors(), [
      "gpu.fan",
      "gpu.fan.1",
      "gpu.fan.2",
    ]);

    // Both fans are stopped in this capture, so 0 is the reading, not a gap.
    expect(values.get("gpu.fan.1")).toBe(0);
    expect(values.get("gpu.fan.2")).toBe(0);
    expect(values.get("gpu.fan")).toBe(0);
  });
});
