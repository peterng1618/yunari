import { describe, expect, it } from "vitest";
import {
  type BatteryLike,
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
    cpu: async () => ({}),
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
