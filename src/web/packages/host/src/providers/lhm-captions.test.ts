import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LhmSensorProvider } from "./lhm.js";

/** The captured real payload: one GPU, four drives, one CPU. */
function realPayload(): unknown {
  return JSON.parse(
    readFileSync(
      fileURLToPath(new URL("./__fixtures__/real-lhm.json", import.meta.url)),
      "utf8",
    ),
  );
}

/** A provider answering from a tree, which is the shape `data.json` has. */
function lhmFrom(payload: unknown): LhmSensorProvider {
  return new LhmSensorProvider({
    fetcher: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(payload),
    }),
  });
}

const NOW = Date.UTC(2026, 8, 28, 12, 0, 0);

/** A second, hotter card, so "highest" and "chosen" are different answers. */
const secondGpu = {
  Sensor: {
    Children: [
      {
        Text: "Sensor",
        Children: [
          {
            Text: "AMD Radeon RX 6800",
            HardwareId: "/gpu-amd/0",
            Children: [
              {
                Text: "Load",
                Children: [
                  {
                    Text: "GPU Core",
                    SensorId: "/gpu-amd/0/load/0",
                    Type: "Load",
                    RawValue: 99,
                  },
                ],
              },
              {
                Text: "Temperature",
                Children: [
                  {
                    Text: "GPU Core",
                    SensorId: "/gpu-amd/0/temperature/0",
                    Type: "Temperature",
                    RawValue: 88,
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
};

function textOf(
  entries: readonly { semanticKey: string; sample: { textValue?: string } }[],
  key: string,
): string | undefined {
  return entries.find((entry) => entry.semanticKey === key)?.sample.textValue;
}

function sampleOf(
  entries: readonly {
    semanticKey: string;
    sample: {
      status: string;
      value?: number;
      textValue?: string;
      message?: string;
    };
  }[],
  key: string,
) {
  return entries.find((entry) => entry.semanticKey === key)?.sample;
}

const GPU_KEYS = ["gpu.load", "gpu.temp", "gpu.name"];

describe("the caption LibreHardwareMonitor can give", () => {
  it("names the card the theme's figures came from", async () => {
    const provider = lhmFrom(realPayload());

    expect(textOf(await provider.sample(["gpu.name"], NOW), "gpu.name")).toBe(
      "NVIDIA GeForce RTX 3080 Ti",
    );
  });

  it("follows the assignment even when another card reads higher", async () => {
    const payload = {
      Children: [
        ...(realPayload() as { Children: unknown[] }).Children,
        secondGpu,
      ],
    };
    const provider = lhmFrom(payload);
    const entries = await provider.sample(GPU_KEYS, NOW, {
      assignment: { gpu: "nvidia-geforce-rtx-3080-ti" },
    });

    expect(textOf(entries, "gpu.name")).toBe("NVIDIA GeForce RTX 3080 Ti");
    expect(sampleOf(entries, "gpu.load")?.value).toBeLessThan(99);
    expect(sampleOf(entries, "gpu.temp")?.value).toBeLessThan(88);
  });

  it("is a gap when the assigned card is gone", async () => {
    const payload = {
      Children: [
        ...(realPayload() as { Children: unknown[] }).Children,
        secondGpu,
      ],
    };
    const provider = lhmFrom(payload);
    const entries = await provider.sample(GPU_KEYS, NOW, {
      assignment: { gpu: "a-card-this-pc-does-not-have" },
    });

    expect(sampleOf(entries, "gpu.load")).toMatchObject({ status: "missing" });
    expect(sampleOf(entries, "gpu.name")).toMatchObject({ status: "missing" });
  });

  it("has nothing to say about a CPU model, which no sensor here reports", async () => {
    const provider = lhmFrom(realPayload());

    // LHM's CPU node is named by its model, but the three CPU keys are the
    // library's to answer; claiming them here would shadow a string that is
    // actually `Intel(R) Core(TM) i9-10850K CPU @ 3.60GHz`.
    const entries = await provider.sample(["cpu.brand"], NOW);

    expect(entries).toEqual([]);
  });

  it("is a gap, with a reason, when LHM cannot be reached", async () => {
    const provider = new LhmSensorProvider({
      fetcher: async () => ({ ok: false, status: 500, text: async () => "" }),
    });

    const entries = await provider.sample(["gpu.name"], NOW);

    expect(sampleOf(entries, "gpu.name")).toMatchObject({ status: "missing" });
    expect(sampleOf(entries, "gpu.name")?.message).toContain(
      "LibreHardwareMonitor is not reachable",
    );
    expect(entries[0]?.sample).not.toHaveProperty("textValue");
  });
});

describe("the volume caption LibreHardwareMonitor can give", () => {
  it("names the drive the system-disk keys describe", async () => {
    const provider = lhmFrom(realPayload());
    const entries = await provider.sample(["disk.total", "disk.name"], NOW, {
      assignment: { systemDisk: "lexar-500gb-ssd" },
    });

    expect(sampleOf(entries, "disk.total")?.value).toBeCloseTo(500.1, 1);
    expect(textOf(entries, "disk.name")).toBe("Lexar 500GB SSD");
  });

  it("names no volume when the keys describe every drive at once", async () => {
    const provider = lhmFrom(realPayload());

    const entries = await provider.sample(["disk.total", "disk.name"], NOW);

    expect(sampleOf(entries, "disk.total")?.value).toBeGreaterThan(1000);
    expect(sampleOf(entries, "disk.name")).toMatchObject({ status: "missing" });
  });
});
