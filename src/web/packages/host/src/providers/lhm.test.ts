import { describe, expect, it, vi } from "vitest";
import { LHM_DESCRIPTORS, LhmSensorProvider } from "./lhm.js";
import { matchLhmSensors } from "./lhm-mapping.js";
import { flattenLhmSensors } from "./lhm-tree.js";

/** Minimal `data.json` shaped like a real LHM reply. */
const DATA_JSON = {
  Children: [
    {
      Text: "Sensor",
      Children: [
        {
          Text: "Intel Core i9-10850K",
          HardwareId: "/intelcpu/0",
          Children: [
            {
              Text: "Temperature",
              Children: [
                {
                  Text: "CPU Package",
                  SensorId: "/intelcpu/0/temperature/0",
                  Type: "Temperature",
                  RawValue: "62.0 °C",
                },
                {
                  Text: "Core #1",
                  SensorId: "/intelcpu/0/temperature/1",
                  Type: "Temperature",
                  RawValue: "55.0 °C",
                },
                {
                  Text: "Core Max",
                  SensorId: "/intelcpu/0/temperature/2",
                  Type: "Temperature",
                  RawValue: "61.0 °C",
                },
                {
                  Text: "Core Average",
                  SensorId: "/intelcpu/0/temperature/3",
                  Type: "Temperature",
                  RawValue: "57.0 °C",
                },
                {
                  Text: "CPU Core #1",
                  SensorId: "/intelcpu/0/temperature/4",
                  Type: "Temperature",
                  RawValue: "55.0 °C",
                },
                {
                  Text: "CPU Core #2",
                  SensorId: "/intelcpu/0/temperature/5",
                  Type: "Temperature",
                  RawValue: "58.0 °C",
                },
              ],
            },
            {
              Text: "Load",
              Children: [
                {
                  Text: "CPU Core #1 Thread #1",
                  SensorId: "/intelcpu/0/load/0",
                  Type: "Load",
                  RawValue: "100.0 %",
                },
                {
                  Text: "CPU Core #1 Thread #2",
                  SensorId: "/intelcpu/0/load/1",
                  Type: "Load",
                  RawValue: "0.0 %",
                },
                {
                  Text: "CPU Core #2 Thread #1",
                  SensorId: "/intelcpu/0/load/2",
                  Type: "Load",
                  RawValue: "5.0 %",
                },
                {
                  Text: "CPU Core #2 Thread #2",
                  SensorId: "/intelcpu/0/load/3",
                  Type: "Load",
                  RawValue: "7.0 %",
                },
              ],
            },
            {
              Text: "Clock",
              Children: [
                {
                  Text: "CPU Core #1",
                  SensorId: "/intelcpu/0/clock/0",
                  Type: "Clock",
                  RawValue: "4800.0 MHz",
                },
                {
                  Text: "CPU Core #2",
                  SensorId: "/intelcpu/0/clock/1",
                  Type: "Clock",
                  RawValue: "4700.0 MHz",
                },
              ],
            },
            {
              Text: "Voltage",
              Children: [
                {
                  Text: "CPU Core",
                  SensorId: "/intelcpu/0/voltage/0",
                  Type: "Voltage",
                  RawValue: "1.362 V",
                },
              ],
            },
            {
              Text: "Power",
              Children: [
                {
                  Text: "Package",
                  SensorId: "/intelcpu/0/power/0",
                  Type: "Power",
                  RawValue: "45.5 W",
                },
              ],
            },
            {
              Text: "Fan",
              Children: [
                {
                  Text: "CPU Fan",
                  SensorId: "/intelcpu/0/fan/0",
                  Type: "Fan",
                  RawValue: "1200 RPM",
                },
              ],
            },
          ],
        },
        {
          Text: "NVIDIA GeForce RTX 3080 Ti",
          HardwareId: "/gpu-nvidia/0",
          Children: [
            {
              Text: "Load",
              Children: [
                {
                  Text: "GPU Core",
                  SensorId: "/gpu-nvidia/0/load/0",
                  Type: "Load",
                  RawValue: "42.0 %",
                },
                {
                  Text: "GPU Memory",
                  SensorId: "/gpu-nvidia/0/load/1",
                  Type: "Load",
                  RawValue: "63.0 %",
                },
              ],
            },
            {
              Text: "SmallData",
              Children: [
                {
                  Text: "GPU Memory Used",
                  SensorId: "/gpu-nvidia/0/data/0",
                  Type: "SmallData",
                  RawValue: "4096.0 MB",
                },
                {
                  Text: "GPU Memory Total",
                  SensorId: "/gpu-nvidia/0/data/1",
                  Type: "SmallData",
                  RawValue: "12288.0 MB",
                },
              ],
            },
            {
              Text: "Fan",
              Children: [
                {
                  Text: "GPU Fan 1",
                  SensorId: "/gpu-nvidia/0/fan/0",
                  Type: "Fan",
                  RawValue: "1100 RPM",
                },
                {
                  Text: "GPU Fan 2",
                  SensorId: "/gpu-nvidia/0/fan/1",
                  Type: "Fan",
                  RawValue: "1300 RPM",
                },
              ],
            },
          ],
        },
        {
          Text: "Lexar 500GB SSD",
          HardwareId: "/nvme/0",
          Children: [
            {
              Text: "Load",
              Children: [
                {
                  Text: "Used Space",
                  SensorId: "/nvme/0/load/0",
                  Type: "Load",
                  RawValue: "61.5 %",
                },
              ],
            },
            {
              Text: "Data",
              Children: [
                {
                  Text: "Free Space",
                  SensorId: "/nvme/0/data/1",
                  Type: "Data",
                  RawValue: "194.0 GB",
                },
                {
                  Text: "Total Space",
                  SensorId: "/nvme/0/data/2",
                  Type: "Data",
                  RawValue: "499.0 GB",
                },
              ],
            },
          ],
        },
        {
          Text: "Ethernet",
          HardwareId: "/nic/0",
          Children: [
            {
              Text: "Throughput",
              Children: [
                {
                  Text: "Download Speed",
                  SensorId: "/nic/0/throughput/0",
                  Type: "Throughput",
                  RawValue: "1250000.0 B/s",
                },
                {
                  Text: "Upload Speed",
                  SensorId: "/nic/0/throughput/1",
                  Type: "Throughput",
                  RawValue: "625000.0 B/s",
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe("LHM sensor mapping", () => {
  const sensors = flattenLhmSensors(DATA_JSON);

  it("answers each key from the sensor that owns it", () => {
    const matched = new Map(
      matchLhmSensors(sensors, [
        "cpu.temp",
        "cpu.power",
        "cpu.fan",
        "gpu.load",
        "gpu.temp",
      ]).map((match) => [match.semanticKey, match.value]),
    );

    // CPU Package is preferred over the per-core reading.
    expect(matched.get("cpu.temp")).toBe(62);
    expect(matched.get("cpu.power")).toBe(45.5);
    expect(matched.get("cpu.fan")).toBe(1200);
    expect(matched.get("gpu.load")).toBe(42);
    // No NVIDIA temperature sensor in this fixture: absent, not zero.
    expect(matched.has("gpu.temp")).toBe(false);
  });

  it("converts Data to GB and Throughput to Mb/s", () => {
    const matched = new Map(
      matchLhmSensors(sensors, [
        "vram.used",
        "vram.total",
        "vram.used.percent",
        "network.download",
        "network.upload",
      ]).map((match) => [match.semanticKey, match.value]),
    );

    expect(matched.get("vram.used")).toBeCloseTo(4, 6);
    expect(matched.get("vram.total")).toBeCloseTo(12, 6);
    expect(matched.get("vram.used.percent")).toBe(63);
    // 1_250_000 B/s is 10 Mb/s.
    expect(matched.get("network.download")).toBeCloseTo(10, 6);
    expect(matched.get("network.upload")).toBeCloseTo(5, 6);
  });

  it("derives disk.used from total minus free, because Used Space is a percent", () => {
    // The trap: LHM types `Used Space` as Load but its value is 61.5 %, so
    // reporting it as GB would be wrong by two orders of magnitude.
    const matched = new Map(
      matchLhmSensors(sensors, [
        "disk.used",
        "disk.total",
        "disk.used.percent",
      ]).map((match) => [match.semanticKey, match.value]),
    );

    expect(matched.get("disk.used")).toBeCloseTo(305, 6);
    expect(matched.get("disk.total")).toBeCloseTo(499, 6);
    // Derived from the same used/total the other two keys report, so the three
    // disk keys cannot describe different sets of drives. LHM's own
    // `Used Space` reads 61.5 % here; 305/499 is the consistent figure.
    expect(matched.get("disk.used.percent")).toBeCloseTo((305 / 499) * 100, 6);
  });

  it("answers only the requested keys", () => {
    expect(
      matchLhmSensors(sensors, ["cpu.fan"]).map((m) => m.semanticKey),
    ).toEqual(["cpu.fan"]);
    expect(matchLhmSensors(sensors, ["cpu.load"])).toEqual([]);
  });

  it("takes the highest reading when hardware repeats", () => {
    const twoGpus = flattenLhmSensors({
      Children: [
        {
          Text: "Sensor",
          Children: [
            {
              Text: "NVIDIA GeForce RTX 3080 Ti",
              HardwareId: "/gpu-nvidia/0",
              Children: [
                {
                  Text: "Load",
                  Children: [
                    {
                      Text: "GPU Core",
                      SensorId: "a",
                      Type: "Load",
                      RawValue: 20,
                    },
                  ],
                },
              ],
            },
            {
              Text: "NVIDIA GeForce RTX 3080 Ti",
              HardwareId: "/gpu-nvidia/1",
              Children: [
                {
                  Text: "Load",
                  Children: [
                    {
                      Text: "GPU Core",
                      SensorId: "b",
                      Type: "Load",
                      RawValue: 70,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(matchLhmSensors(twoGpus, ["gpu.load"])[0]?.value).toBe(70);
  });

  it("numbers each GPU fan while the aggregate keeps the first", () => {
    const matched = new Map(
      matchLhmSensors(sensors, ["gpu.fan", "gpu.fan.1", "gpu.fan.2"]).map(
        (match) => [match.semanticKey, match.value],
      ),
    );

    expect(matched.get("gpu.fan.1")).toBe(1100);
    expect(matched.get("gpu.fan.2")).toBe(1300);
    expect(matched.get("gpu.fan")).toBe(1100);
  });

  it("sums throughput across links rather than reporting one", () => {
    const twoNics = flattenLhmSensors({
      Children: [
        {
          Text: "Sensor",
          Children: [
            {
              Text: "Ethernet",
              HardwareId: "/nic/0",
              Children: [
                {
                  Text: "Throughput",
                  Children: [
                    {
                      Text: "Download Speed",
                      SensorId: "a",
                      Type: "Throughput",
                      RawValue: 125_000,
                    },
                  ],
                },
              ],
            },
            {
              Text: "Ethernet",
              HardwareId: "/nic/1",
              Children: [
                {
                  Text: "Throughput",
                  Children: [
                    {
                      Text: "Download Speed",
                      SensorId: "b",
                      Type: "Throughput",
                      RawValue: 125_000,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    // 250000 B/s total is 2 Mb/s.
    expect(
      matchLhmSensors(twoNics, ["network.download"])[0]?.value,
    ).toBeCloseTo(2, 6);
  });
});

describe("LHM provider", () => {
  function providerReturning(
    response: { ok: boolean; status: number; body: unknown } | Error,
  ): LhmSensorProvider {
    return new LhmSensorProvider({
      fetcher: vi.fn(async () => {
        if (response instanceof Error) throw response;
        return {
          ok: response.ok,
          status: response.status,
          text: async () => JSON.stringify(response.body),
        };
      }),
    });
  }

  it("describes the extended vocabulary it can answer", () => {
    const keys = LHM_DESCRIPTORS.map((d) => d.semanticKey);

    expect(keys).toContain("cpu.temp");
    expect(keys).toContain("cpu.temp.package");
    expect(keys).toContain("cpu.voltage");
    expect(keys).toContain("gpu.temp.hotspot");
    expect(keys).toContain("gpu.clock.memory");
    expect(keys).toContain("vram.temp");
    expect(LHM_DESCRIPTORS.every((d) => d.tier === "extended")).toBe(true);
  });

  it("describes the dynamic keys this machine reports", async () => {
    const provider = providerReturning({
      ok: true,
      status: 200,
      body: DATA_JSON,
    });

    const descriptors = await provider.describe();
    const keys = descriptors.map((descriptor) => descriptor.semanticKey);
    // Derived from the payload rather than hard-coded, so the test still holds
    // when the fixture gains or loses a core.
    const cores = new Set(
      flattenLhmSensors(DATA_JSON).flatMap((sensor) => {
        const match = /^CPU Core #(\d+)(?: Thread #\d+)?$/.exec(sensor.text);
        return match === null ? [] : [Number(match[1])];
      }),
    );

    expect(cores.size).toBeGreaterThan(1);
    for (const core of cores) {
      for (const quantity of ["load", "temp", "clock"]) {
        expect(keys).toContain(`cpu.core.${core}.${quantity}`);
      }
    }
    expect(keys.filter((key) => key.startsWith("cpu.core."))).toHaveLength(
      cores.size * 3,
    );
    expect(
      descriptors.find(
        (descriptor) => descriptor.semanticKey === "cpu.core.1.load",
      ),
    ).toMatchObject({ unit: "%", tier: "extended" });
    expect(keys).toContain("gpu.fan.1");
    expect(keys).toContain("gpu.fan.2");
  });

  it("falls back to the static list when discovery fails", async () => {
    const unreachable = providerReturning(new Error("connect ECONNREFUSED"));
    const refused = providerReturning({ ok: false, status: 500, body: {} });

    expect(await unreachable.describe()).toEqual(LHM_DESCRIPTORS);
    expect(await refused.describe()).toEqual(LHM_DESCRIPTORS);
  });

  it("maps a live answer onto vocabulary units", async () => {
    const provider = providerReturning({
      ok: true,
      status: 200,
      body: DATA_JSON,
    });

    const entries = await provider.sample(
      ["cpu.temp", "network.download"],
      Date.UTC(2026, 8, 24),
    );

    expect(entries.map((entry) => entry.sample)).toMatchObject([
      { status: "ok", value: 62, unit: "°C" },
      { status: "ok", value: 10, unit: "Mb/s" },
    ]);
    expect(provider.health().available).toBe(true);
  });

  it("answers per-core and per-fan keys requested by name", async () => {
    const provider = providerReturning({
      ok: true,
      status: 200,
      body: DATA_JSON,
    });

    const entries = await provider.sample(
      [
        "cpu.core.1.temp",
        "cpu.core.1.load",
        "cpu.core.2.load",
        "gpu.fan.2",
        "cpu.voltage",
      ],
      Date.UTC(2026, 8, 24),
    );

    expect(entries.map((entry) => entry.sample)).toMatchObject([
      { status: "ok", value: 55, unit: "°C" },
      // 100 % and 0 % threads: the core is half utilized, not fully.
      { status: "ok", value: 50, unit: "%" },
      // 5 % and 7 % threads.
      { status: "ok", value: 6, unit: "%" },
      { status: "ok", value: 1300, unit: "RPM" },
      { status: "ok", value: 1.362, unit: "V" },
    ]);
  });

  it("reports a dynamic key the machine cannot answer as a gap", async () => {
    const provider = providerReturning({
      ok: true,
      status: 200,
      body: DATA_JSON,
    });

    const entries = await provider.sample(["cpu.core.9.temp"], 0);

    expect(entries[0]?.sample).toMatchObject({ status: "missing" });
    expect(entries[0]?.sample).not.toHaveProperty("value");
  });

  it("reports LHM being absent as a gap with a reason, never a reading", async () => {
    const provider = providerReturning(new Error("connect ECONNREFUSED"));

    const entries = await provider.sample(["cpu.temp"], 0);

    expect(entries[0]?.sample).toMatchObject({ status: "missing" });
    expect(entries[0]?.sample).not.toHaveProperty("value");
    expect(entries[0]?.sample.message).toContain("ECONNREFUSED");
    expect(provider.health().available).toBe(false);
  });

  it("keeps the host's own transport address out of a message a browser reads", async () => {
    // The sample message is served over the sample stream to every display on
    // the network, and `ProviderHealth` says in as many words that these are
    // redacted. The address is the host's business, not the reader's.
    const provider = providerReturning(new Error("connect ECONNREFUSED"));

    const message = (await provider.sample(["cpu.temp"], 0))[0]?.sample.message;

    expect(message).not.toContain("127.0.0.1");
    expect(message).not.toContain("8085");
    // The sentence still says what is wrong, so the display is not left with
    // a reason it cannot act on.
    expect(message).toContain("LibreHardwareMonitor is not reachable");
    expect(message).toContain("ECONNREFUSED");
  });

  it("keeps the address out of its health too, which is the other browser-facing one", async () => {
    const provider = providerReturning(new Error("connect ECONNREFUSED"));
    await provider.sample(["cpu.temp"], 0);

    expect(provider.health().message ?? "").not.toContain("127.0.0.1");
  });

  it("reports a sensor the machine does not have as a gap", async () => {
    const provider = providerReturning({
      ok: true,
      status: 200,
      body: DATA_JSON,
    });

    const entries = await provider.sample(["gpu.temp"], 0);

    expect(entries[0]?.sample).toMatchObject({ status: "missing" });
    expect(entries[0]?.sample.message).toContain("no matching");
  });

  it("skips keys it does not own", async () => {
    const fetcher = vi.fn();
    const provider = new LhmSensorProvider({ fetcher });

    expect(await provider.sample(["ram.used"], 0)).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
