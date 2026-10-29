import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { matchLhmSensors, matchLhmSensorsAssigned } from "./lhm-mapping.js";
import { flattenLhmSensors } from "./lhm-tree.js";

/** The captured real payload: one GPU, four drives. */
function realSensors() {
  return flattenLhmSensors(
    JSON.parse(
      readFileSync(
        fileURLToPath(new URL("./__fixtures__/real-lhm.json", import.meta.url)),
        "utf8",
      ),
    ),
  );
}

describe("device assignment", () => {
  it("changes which GPU answers the theme's gpu.* keys", () => {
    const sensors = [
      ...realSensors(),
      // A second GPU, so "one device" and "the highest of each" differ.
      {
        sensorId: "/gpu-amd/0/load/0",
        hardwareId: "/gpu-amd/0",
        hardwareType: "AMD Radeon RX 6800",
        text: "GPU Core",
        type: "Load",
        value: 99,
      },
      {
        sensorId: "/gpu-amd/0/temperature/0",
        hardwareId: "/gpu-amd/0",
        hardwareType: "AMD Radeon RX 6800",
        text: "GPU Core",
        type: "Temperature",
        value: 88,
      },
    ];

    // Unassigned: the first card the machine reports answers, and every key
    // comes from it. This used to assert the opposite — that the highest
    // reading won — which is the defect the assignment rule removes: a
    // maximum could pair one card's load with another's temperature under a
    // single caption.
    const unassigned = new Map(
      matchLhmSensorsAssigned(sensors, ["gpu.load", "gpu.temp"], {}).map(
        (m) => [m.semanticKey, m.value],
      ),
    );
    expect(unassigned.get("gpu.load")).not.toBe(99);
    expect(unassigned.get("gpu.temp")).not.toBe(88);

    // Assigned to the NVIDIA card: the theme's single gpu.load must follow it,
    // even though the AMD card reads higher.
    const chosen = new Map(
      matchLhmSensorsAssigned(sensors, ["gpu.load", "gpu.temp"], {
        gpu: "nvidia-geforce-rtx-3080-ti",
      }).map((m) => [m.semanticKey, m.value]),
    );
    expect(chosen.get("gpu.load")).toBeLessThan(99);
    expect(chosen.get("gpu.temp")).toBeLessThan(88);
    // The same two figures the unassigned case reports: one card either way,
    // and the assignment only says which.
    expect(chosen.get("gpu.load")).toBe(unassigned.get("gpu.load"));
  });

  it("changes which drive the system-disk keys describe", () => {
    const sensors = realSensors();

    const all = new Map(
      matchLhmSensorsAssigned(sensors, ["disk.total"], {}).map((m) => [
        m.semanticKey,
        m.value,
      ]),
    );
    // Every drive summed.
    expect(all.get("disk.total")).toBeGreaterThan(1000);

    const one = new Map(
      matchLhmSensorsAssigned(sensors, ["disk.total"], {
        systemDisk: "lexar-500gb-ssd",
      }).map((m) => [m.semanticKey, m.value]),
    );
    // Just the chosen SSD.
    expect(one.get("disk.total")).toBeCloseTo(500.1, 1);
  });

  it("leaves other groups untouched when only one is assigned", () => {
    const sensors = realSensors();

    const assigned = new Map(
      matchLhmSensorsAssigned(sensors, ["cpu.temp", "cpu.fan"], {
        systemDisk: "lexar-500gb-ssd",
      }).map((m) => [m.semanticKey, m.value]),
    );

    expect(assigned.get("cpu.temp")).toBeGreaterThan(0);
    expect(assigned.get("cpu.fan")).toBeGreaterThan(0);
  });

  it("reports a gap when the assigned device is gone, not another device's figures", () => {
    // A drive removed after it was chosen: the keys must report a gap, not a
    // reading from a different drive. The title used to say "falls back to the
    // default" while asserting the opposite.
    const assigned = matchLhmSensorsAssigned(realSensors(), ["disk.total"], {
      systemDisk: "drive-that-was-removed",
    });

    expect(assigned).toEqual([]);
  });

  it("leaves the groups nothing assigned alone, and picks one card for the GPU", () => {
    // Unassigned storage is still the host's total, exactly as `matchLhmSensors`
    // computes it. The GPU group is the one that changed: it answers from a
    // single card now, where it used to take the highest of each. The captured
    // payload has one GPU, so the two agree here and only diverge with a second
    // card — which `library-devices.test.ts` covers by injection.
    const sensors = realSensors();
    const keys = ["cpu.temp", "gpu.load", "disk.total", "network.download"];

    expect(matchLhmSensorsAssigned(sensors, keys, {})).toEqual(
      matchLhmSensors(sensors, keys),
    );
  });
});
