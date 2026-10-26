import { describe, expect, it } from "vitest";
import {
  type BatteryLike,
  type CpuLike,
  type LibraryModule,
  LibrarySensorProvider,
  type OsInfoLike,
  type WifiConnectionLike,
} from "./library.js";

/**
 * The baseline sensors the library answers directly: Wi-Fi, system identity and
 * battery. Each is read only when a demanded key needs it, and each gap is a
 * `missing` sample with a reason rather than a zero or an empty string.
 */

const GB = 1024 ** 3;

const wifi: WifiConnectionLike = {
  ssid: "HomeNet",
  quality: 72,
  txRate: 866,
};

const osReport: OsInfoLike = {
  hostname: "DESKTOP-7Q3",
  distro: "Windows 11 Pro",
  platform: "win32",
  build: "22631",
};

const laptopBattery: BatteryLike = {
  hasBattery: true,
  isCharging: true,
  acConnected: true,
  timeRemaining: 90,
  designedCapacity: 80000,
  maxCapacity: 60000,
  percent: 76,
  voltage: 12.4,
};

/**
 * The library's desktop default, field for field: `hasBattery` is false but the
 * rest are concrete (`isCharging: false`, `acConnected: true`, zeros, a null
 * countdown). Without the gate those fields would answer `ok` booleans and a
 * `0 %` level — fabricated telemetry on a machine with no battery.
 */
const desktopBattery: BatteryLike = {
  hasBattery: false,
  isCharging: false,
  acConnected: true,
  designedCapacity: 0,
  maxCapacity: 0,
  percent: 0,
  voltage: 0,
  timeRemaining: null,
};

interface Fake {
  readonly wifi?: readonly WifiConnectionLike[];
  readonly battery?: BatteryLike;
  readonly os?: OsInfoLike;
  readonly cpu?: CpuLike;
  readonly uptime?: number;
  readonly processes?: number;
}

/** The library as this machine reports it; every read is injectable. */
function fakeMachine(overrides: Fake = {}): LibraryModule {
  return {
    currentLoad: async () => ({ currentLoad: 12 }),
    cpuCurrentSpeed: async () => ({ avg: 3600 }),
    mem: async () => ({ total: 64 * GB, active: 32 * GB }),
    fsSize: async () => [],
    networkStats: async () => [],
    graphics: async () => ({ controllers: [] }),
    cpu: async () => overrides.cpu ?? {},
    diskLayout: async () => [],
    blockDevices: async () => [],
    // Fractional on purpose: the provider promises integer seconds and a count.
    time: () => ({ uptime: overrides.uptime ?? 3599.6 }),
    processes: async () => ({ all: overrides.processes ?? 321.9 }),
    osInfo: async () => overrides.os ?? osReport,
    battery: async () => overrides.battery ?? laptopBattery,
    wifiConnections: async () => overrides.wifi ?? [wifi],
  };
}

const BATTERY_KEYS = [
  "battery.level",
  "battery.state",
  "battery.charging",
  "battery.timeRemaining",
  "battery.ac",
  "battery.health",
  "battery.voltage",
];

const WIFI_KEYS = ["wifi.ssid", "wifi.signal", "wifi.linkSpeed"];
const SYSTEM_TEXT_KEYS = ["system.hostname", "system.os", "system.osBuild"];

function sampleOf(
  entries: readonly {
    semanticKey: string;
    sample: {
      status: string;
      value?: number;
      textValue?: string;
      booleanValue?: boolean;
      unit?: string;
      message?: string;
    };
  }[],
  key: string,
) {
  return entries.find((entry) => entry.semanticKey === key)?.sample;
}

describe("Wi-Fi readings", () => {
  it("carry the connected network's name, signal and link rate", async () => {
    const provider = new LibrarySensorProvider(fakeMachine());
    const entries = await provider.sample(WIFI_KEYS, 0);

    expect(sampleOf(entries, "wifi.ssid")?.textValue).toBe("HomeNet");
    expect(sampleOf(entries, "wifi.signal")).toMatchObject({
      status: "ok",
      value: 72,
      unit: "%",
    });
    expect(sampleOf(entries, "wifi.linkSpeed")).toMatchObject({
      status: "ok",
      value: 866,
      unit: "Mb/s",
    });
  });

  it("are all gaps when no adapter is connected, never an empty SSID", async () => {
    const provider = new LibrarySensorProvider(fakeMachine({ wifi: [] }));
    const entries = await provider.sample(WIFI_KEYS, 0);

    for (const key of WIFI_KEYS) {
      expect(sampleOf(entries, key), key).toMatchObject({ status: "missing" });
      expect(sampleOf(entries, key), key).not.toHaveProperty("value");
    }
    expect(sampleOf(entries, "wifi.ssid")).not.toHaveProperty("textValue");
  });

  it("treats a blank SSID as a gap while the signal still answers", async () => {
    const provider = new LibrarySensorProvider(
      fakeMachine({ wifi: [{ ...wifi, ssid: "   " }] }),
    );
    const entries = await provider.sample(WIFI_KEYS, 0);

    expect(sampleOf(entries, "wifi.ssid")).toMatchObject({ status: "missing" });
    expect(sampleOf(entries, "wifi.signal")?.value).toBe(72);
  });
});

describe("system readings", () => {
  it("report uptime in seconds and the process count as numbers", async () => {
    const provider = new LibrarySensorProvider(fakeMachine());
    const entries = await provider.sample(
      ["system.uptime", "system.processes"],
      0,
    );

    expect(sampleOf(entries, "system.uptime")).toMatchObject({
      status: "ok",
      value: 3600,
      unit: "s",
    });
    expect(sampleOf(entries, "system.processes")).toMatchObject({
      status: "ok",
      value: 321,
    });
  });

  it("carry the host name, operating system and build as text", async () => {
    const provider = new LibrarySensorProvider(fakeMachine());
    const entries = await provider.sample(SYSTEM_TEXT_KEYS, 0);

    expect(sampleOf(entries, "system.hostname")?.textValue).toBe("DESKTOP-7Q3");
    expect(sampleOf(entries, "system.os")?.textValue).toBe("Windows 11 Pro");
    expect(sampleOf(entries, "system.osBuild")?.textValue).toBe("22631");
  });

  it("fall back to the platform when the distribution name is blank", async () => {
    const provider = new LibrarySensorProvider(
      fakeMachine({ os: { ...osReport, distro: "" } }),
    );
    const entries = await provider.sample(["system.os"], 0);

    expect(sampleOf(entries, "system.os")?.textValue).toBe("win32");
  });

  it("are gaps for identity fields the machine does not report", async () => {
    const provider = new LibrarySensorProvider(
      fakeMachine({
        os: { hostname: "", distro: "", platform: "", build: "" },
      }),
    );
    const entries = await provider.sample(SYSTEM_TEXT_KEYS, 0);

    for (const key of SYSTEM_TEXT_KEYS) {
      expect(sampleOf(entries, key), key).toMatchObject({ status: "missing" });
      expect(sampleOf(entries, key), key).not.toHaveProperty("textValue");
    }
  });
});

describe("battery readings", () => {
  it("converts the library's minutes remaining to seconds", async () => {
    const provider = new LibrarySensorProvider(fakeMachine());
    const entries = await provider.sample(["battery.timeRemaining"], 0);

    expect(sampleOf(entries, "battery.timeRemaining")).toMatchObject({
      status: "ok",
      value: 5400,
      unit: "s",
    });
  });

  it("names charging and discharging, and stays silent on plugged-in idle", async () => {
    const discharging = new LibrarySensorProvider(
      fakeMachine({
        battery: {
          ...laptopBattery,
          isCharging: false,
          acConnected: false,
        },
      }),
    );
    const charging = new LibrarySensorProvider(fakeMachine());
    const idle = new LibrarySensorProvider(
      fakeMachine({
        battery: {
          ...laptopBattery,
          isCharging: false,
          acConnected: true,
        },
      }),
    );

    expect(
      sampleOf(await charging.sample(["battery.state"], 0), "battery.state")
        ?.textValue,
    ).toBe("charging");
    expect(
      sampleOf(await discharging.sample(["battery.state"], 0), "battery.state")
        ?.textValue,
    ).toBe("discharging");
    // Full versus idle is not reported, so the state is a gap rather than a
    // guess — and the reason names that gap, not absent battery hardware.
    const idleState = sampleOf(
      await idle.sample(["battery.state"], 0),
      "battery.state",
    );
    expect(idleState).toMatchObject({ status: "missing" });
    expect(idleState?.message).toContain("neither charging nor discharging");
    expect(idleState?.message).not.toContain("no battery");
  });

  it("reports level and voltage from the battery", async () => {
    const provider = new LibrarySensorProvider(fakeMachine());
    const entries = await provider.sample(
      ["battery.level", "battery.voltage"],
      0,
    );

    expect(sampleOf(entries, "battery.level")).toMatchObject({
      status: "ok",
      value: 76,
      unit: "%",
    });
    expect(sampleOf(entries, "battery.voltage")).toMatchObject({
      status: "ok",
      value: 12.4,
      unit: "V",
    });
  });

  it("reports voltage as a gap when a present battery reports zero", async () => {
    // The library leaves `voltage` at 0 when the platform does not report it;
    // no present battery reads 0 V, so this is a fabricated zero, not a value.
    const provider = new LibrarySensorProvider(
      fakeMachine({ battery: { ...laptopBattery, voltage: 0 } }),
    );
    const entries = await provider.sample(["battery.voltage"], 0);

    expect(sampleOf(entries, "battery.voltage")).toMatchObject({
      status: "missing",
    });
    expect(sampleOf(entries, "battery.voltage")).not.toHaveProperty("value");
  });

  it("treats a non-positive countdown as a gap in every power state", async () => {
    // The darwin path builds the estimate as parseInt('0' + value) and the
    // Windows path never sets it, so a zero or negative countdown means the
    // estimate was not read — discharging, AC-connected or charging alike.
    const states = [
      { acConnected: true, isCharging: false },
      { acConnected: false, isCharging: false },
      { acConnected: true, isCharging: true },
    ];

    for (const state of states) {
      const provider = new LibrarySensorProvider(
        fakeMachine({
          battery: { ...laptopBattery, ...state, timeRemaining: 0 },
        }),
      );
      const entries = await provider.sample(["battery.timeRemaining"], 0);

      expect(
        sampleOf(entries, "battery.timeRemaining"),
        JSON.stringify(state),
      ).toMatchObject({ status: "missing" });
      expect(sampleOf(entries, "battery.timeRemaining")).not.toHaveProperty(
        "value",
      );
    }
  });

  it("carries charging and AC as booleans", async () => {
    const provider = new LibrarySensorProvider(
      fakeMachine({
        battery: { ...laptopBattery, isCharging: false, acConnected: true },
      }),
    );
    const entries = await provider.sample(
      ["battery.charging", "battery.ac"],
      0,
    );

    expect(sampleOf(entries, "battery.charging")).toMatchObject({
      status: "ok",
      booleanValue: false,
    });
    expect(sampleOf(entries, "battery.ac")).toMatchObject({
      status: "ok",
      booleanValue: true,
    });
  });

  it("derives health from the design and maximum capacity", async () => {
    const provider = new LibrarySensorProvider(fakeMachine());
    const entries = await provider.sample(["battery.health"], 0);

    expect(sampleOf(entries, "battery.health")).toMatchObject({
      status: "ok",
      value: 75,
      unit: "%",
    });
  });

  it("reports health as a gap when a capacity is not positive", async () => {
    const provider = new LibrarySensorProvider(
      fakeMachine({
        battery: { ...laptopBattery, designedCapacity: 0 },
      }),
    );
    const entries = await provider.sample(["battery.health"], 0);

    expect(sampleOf(entries, "battery.health")).toMatchObject({
      status: "missing",
    });
    expect(sampleOf(entries, "battery.health")).not.toHaveProperty("value");
  });

  it("reports every battery key as a gap on a desktop, never zero", async () => {
    const provider = new LibrarySensorProvider(
      fakeMachine({ battery: desktopBattery }),
    );
    const entries = await provider.sample(BATTERY_KEYS, 0);

    for (const key of BATTERY_KEYS) {
      expect(sampleOf(entries, key), key).toMatchObject({ status: "missing" });
      expect(sampleOf(entries, key), key).not.toHaveProperty("value");
      expect(sampleOf(entries, key), key).not.toHaveProperty("textValue");
      expect(sampleOf(entries, key), key).not.toHaveProperty("booleanValue");
    }
    expect(sampleOf(entries, "battery.state")?.message).toContain("no battery");
  });
});

describe("CPU core counts", () => {
  const CORE_KEYS = ["cpu.cores.physical", "cpu.cores.logical"];

  it("reports the physical and logical counts the CPU read carries", async () => {
    const provider = new LibrarySensorProvider(
      fakeMachine({ cpu: { physicalCores: 8, cores: 16 } }),
    );
    const entries = await provider.sample(CORE_KEYS, 0);

    expect(sampleOf(entries, "cpu.cores.physical")).toMatchObject({
      status: "ok",
      value: 8,
    });
    expect(sampleOf(entries, "cpu.cores.logical")).toMatchObject({
      status: "ok",
      value: 16,
    });
  });

  it("reports a count the library does not state as a gap, never zero", async () => {
    const provider = new LibrarySensorProvider(
      fakeMachine({ cpu: { physicalCores: 0 } }),
    );
    const entries = await provider.sample(CORE_KEYS, 0);

    for (const key of CORE_KEYS) {
      expect(sampleOf(entries, key), key).toMatchObject({ status: "missing" });
      expect(sampleOf(entries, key), key).not.toHaveProperty("value");
    }
  });
});

describe("the reads each key group needs", () => {
  it("does not read processes, battery or OS for a Wi-Fi-only sample", async () => {
    const calls: string[] = [];
    const machine = fakeMachine();
    const provider = new LibrarySensorProvider({
      ...machine,
      processes: async () => {
        calls.push("processes");
        return { all: 321 };
      },
      battery: async () => {
        calls.push("battery");
        return laptopBattery;
      },
      osInfo: async () => {
        calls.push("osInfo");
        return osReport;
      },
      time: () => {
        calls.push("time");
        return { uptime: 3600 };
      },
    });

    await provider.sample(["wifi.signal"], 0);

    // A theme that binds Wi-Fi must not pay for the expensive process read.
    expect(calls).toEqual([]);
  });

  it("re-reads the process count after the cache window", async () => {
    let reads = 0;
    const machine = fakeMachine();
    const provider = new LibrarySensorProvider({
      ...machine,
      processes: async () => {
        reads += 1;
        return { all: 300 + reads };
      },
    });

    // Inside the 5 s window the count is reused, because `processes()` costs
    // more than a poll interval.
    expect(
      sampleOf(
        await provider.sample(["system.processes"], 0),
        "system.processes",
      )?.value,
    ).toBe(301);
    expect(
      sampleOf(
        await provider.sample(["system.processes"], 1000),
        "system.processes",
      )?.value,
    ).toBe(301);
    expect(reads).toBe(1);

    const later = await provider.sample(["system.processes"], 6000);
    expect(sampleOf(later, "system.processes")?.value).toBe(302);
    expect(reads).toBe(2);
  });
});

const MACHINE_READS = [
  "currentLoad",
  "cpuCurrentSpeed",
  "mem",
  "fsSize",
  "networkStats",
  "graphics",
] as const;

/** The default fake, with each machine-wide read recorded by name. */
function recordingMachine(calls: string[]): LibraryModule {
  const machine = fakeMachine();
  const record =
    <T>(name: string, read: () => Promise<T>) =>
    async (): Promise<T> => {
      calls.push(name);
      return read();
    };

  return {
    ...machine,
    currentLoad: record("currentLoad", machine.currentLoad),
    cpuCurrentSpeed: record("cpuCurrentSpeed", machine.cpuCurrentSpeed),
    mem: record("mem", machine.mem),
    fsSize: record("fsSize", machine.fsSize),
    networkStats: record("networkStats", machine.networkStats),
    graphics: record("graphics", machine.graphics),
  };
}

describe("the machine-wide reads each family needs", () => {
  it("reads only load for a cpu.load theme", async () => {
    const calls: string[] = [];
    const provider = new LibrarySensorProvider(recordingMachine(calls));

    const entries = await provider.sample(["cpu.load"], 0);
    const load = sampleOf(entries, "cpu.load");

    expect(calls).toEqual(["currentLoad"]);
    expect(load).toMatchObject({ status: "ok", value: 12 });
    expect(Number.isFinite(load?.value)).toBe(true);
  });

  it("reads only memory for ram.used.percent", async () => {
    const calls: string[] = [];
    const provider = new LibrarySensorProvider(recordingMachine(calls));

    const entries = await provider.sample(["ram.used.percent"], 0);

    expect(calls).toEqual(["mem"]);
    expect(sampleOf(entries, "ram.used.percent")?.value).toBe(50);
  });

  it("reads graphics for gpu.load without walking the disks", async () => {
    const calls: string[] = [];
    const provider = new LibrarySensorProvider(recordingMachine(calls));

    await provider.sample(["gpu.load"], 0);

    expect(calls).toEqual(["graphics"]);
  });

  it.each([
    ["cpu.clock", "cpuCurrentSpeed"],
    ["disk.used.percent", "fsSize"],
    ["network.download", "networkStats"],
  ])("reads %s from %s alone", async (key, family) => {
    const calls: string[] = [];
    const provider = new LibrarySensorProvider(recordingMachine(calls));

    await provider.sample([key], 0);

    expect(calls).toContain(family);
    const others: readonly string[] = MACHINE_READS.filter(
      (name) => name !== family,
    );
    expect(calls.filter((name) => others.includes(name))).toEqual([]);
  });

  it("starts a family once for groups sharing a tick", async () => {
    const calls: string[] = [];
    const provider = new LibrarySensorProvider(recordingMachine(calls));

    // Four displays are several ask groups on one clock: the second group must
    // reuse the first's read rather than pay a second walk.
    await provider.sample(["ram.used.percent"], 0);
    await provider.sample(["ram.total"], 0);
    await provider.sample(["cpu.load"], 0);

    expect(calls.filter((name) => name === "mem")).toHaveLength(1);
    expect(calls.filter((name) => name === "currentLoad")).toHaveLength(1);
  });

  it("starts a fresh read on the next tick", async () => {
    const calls: string[] = [];
    const provider = new LibrarySensorProvider(recordingMachine(calls));

    await provider.sample(["cpu.load"], 0);
    await provider.sample(["cpu.load"], 1000);

    expect(calls.filter((name) => name === "currentLoad")).toHaveLength(2);
  });

  it("returns only the keys it owns, never an unrequested family's", async () => {
    const calls: string[] = [];
    const provider = new LibrarySensorProvider(recordingMachine(calls));

    const entries = await provider.sample(["cpu.load"], 0);

    expect(entries.map((entry) => entry.semanticKey)).toEqual(["cpu.load"]);
    expect(sampleOf(entries, "ram.used")).toBeUndefined();
    expect(sampleOf(entries, "disk.used")).toBeUndefined();
  });

  it("contains a rejecting family without losing another's keys", async () => {
    const machine = fakeMachine();
    const provider = new LibrarySensorProvider({
      ...machine,
      graphics: async () => {
        throw new Error("wmi said no");
      },
    });

    const entries = await provider.sample(["cpu.load", "gpu.load"], 0);

    expect(sampleOf(entries, "cpu.load")).toMatchObject({
      status: "ok",
      value: 12,
    });
    expect(sampleOf(entries, "gpu.load")).toMatchObject({ status: "missing" });
    expect(sampleOf(entries, "gpu.load")?.message).toContain(
      "system information is unavailable",
    );
  });

  it("never fails a sample over a family it did not need", async () => {
    const machine = fakeMachine();
    const provider = new LibrarySensorProvider({
      ...machine,
      graphics: async () => {
        throw new Error("wmi said no");
      },
    });

    const entries = await provider.sample(["cpu.load"], 0);

    expect(sampleOf(entries, "cpu.load")).toMatchObject({
      status: "ok",
      value: 12,
    });
    expect(provider.health().available).toBe(true);
  });

  it("reads a failing family once for every group sharing a tick", async () => {
    let reads = 0;
    const machine = fakeMachine();
    const provider = new LibrarySensorProvider({
      ...machine,
      graphics: async () => {
        reads += 1;
        throw new Error("wmi said no");
      },
    });

    const first = await provider.sample(["gpu.load"], 0);
    const second = await provider.sample(["gpu.load"], 0);
    const third = await provider.sample(["cpu.load"], 0);

    // A broken GPU read is one shell-out per tick, not one per display, and
    // both groups are told the same thing about it.
    expect(reads).toBe(1);
    expect(sampleOf(first, "gpu.load")).toMatchObject({ status: "missing" });
    expect(sampleOf(second, "gpu.load")).toMatchObject({ status: "missing" });
    expect(sampleOf(third, "cpu.load")).toMatchObject({
      status: "ok",
      value: 12,
    });
  });

  it("keeps the tick's failure for a later group that needs nothing failing", async () => {
    const machine = fakeMachine();
    const provider = new LibrarySensorProvider({
      ...machine,
      graphics: async () => {
        throw new Error("wmi said no");
      },
    });

    await provider.sample(["gpu.load"], 0);
    await provider.sample(["cpu.load"], 0);

    // A cpu-only group must not erase the fact that this tick's GPU read
    // failed: health is the tick's verdict, not the last group's.
    expect(provider.health()).toMatchObject({ available: false });

    await provider.sample(["cpu.load"], 1000);

    expect(provider.health()).toMatchObject({ available: true });
  });
});

describe("the existing library keys", () => {
  it("keep their readings beside the new ones", async () => {
    const provider = new LibrarySensorProvider(fakeMachine());
    const entries = await provider.sample(
      ["cpu.load", "ram.total", "wifi.signal"],
      0,
    );

    expect(sampleOf(entries, "cpu.load")?.value).toBe(12);
    expect(sampleOf(entries, "ram.total")?.value).toBe(64);
    expect(sampleOf(entries, "wifi.signal")?.value).toBe(72);
  });
});
