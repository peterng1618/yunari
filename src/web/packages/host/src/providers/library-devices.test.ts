import { describe, expect, it } from "vitest";
import {
  type ControllerLike,
  type CpuLike,
  type FsSizeLike,
  type LibraryModule,
  LibrarySensorProvider,
} from "./library.js";
import {
  type BlockDeviceLike,
  type DriveDevice,
  type DriveLayoutLike,
  driveFor,
  drivesFrom,
  type VolumeLike,
  volumesOf,
} from "./library-devices.js";

const GB = 1024 ** 3;

/** Two cards whose busiest figures belong to different devices on purpose. */
const nvidia: ControllerLike = {
  model: "NVIDIA GeForce RTX 3080 Ti",
  utilizationGpu: 10,
  temperatureGpu: 40,
  powerDraw: 30,
  vram: 12288,
  memoryUsed: 1024,
  memoryTotal: 12288,
};

const amd: ControllerLike = {
  model: "AMD Radeon RX 6800",
  utilizationGpu: 90,
  temperatureGpu: 88,
  powerDraw: 220,
  vram: 16384,
  memoryUsed: 8192,
  memoryTotal: 16384,
};

const nvme: FsSizeLike = {
  mount: "C:",
  fs: "C:",
  size: 500 * GB,
  used: 305 * GB,
};

const archive: FsSizeLike = {
  mount: "D:",
  fs: "D:",
  size: 4000 * GB,
  used: 1600 * GB,
};

interface Fake {
  readonly controllers?: readonly ControllerLike[];
  readonly filesystems?: readonly FsSizeLike[];
  readonly layout?: readonly DriveLayoutLike[];
  readonly blockDevices?: readonly BlockDeviceLike[];
  readonly cpu?: CpuLike;
  /** Reached at the graphics read, so a test can publish mid-sample. */
  readonly onGraphics?: () => Promise<void> | void;
}

/** The library as a machine reports it; every read is injectable. */
function fakeMachine(overrides: Fake = {}): LibraryModule {
  return {
    currentLoad: async () => ({ currentLoad: 12 }),
    cpuCurrentSpeed: async () => ({ avg: 3600 }),
    mem: async () => ({ total: 64 * GB, active: 32 * GB }),
    fsSize: async () => overrides.filesystems ?? [nvme, archive],
    networkStats: async () => [],
    graphics: async () => {
      await overrides.onGraphics?.();
      return { controllers: overrides.controllers ?? [nvidia] };
    },
    cpu: async () => overrides.cpu ?? {},
    diskLayout: async () =>
      overrides.layout ?? [
        { device: "\\\\.\\PHYSICALDRIVE1", name: "Lexar 500GB SSD" },
        { device: "\\\\.\\PHYSICALDRIVE0", name: "ST4000DM004-2CV104" },
      ],
    blockDevices: async () =>
      overrides.blockDevices ?? [
        { mount: "C:", device: "\\\\.\\PHYSICALDRIVE1", label: "" },
        { mount: "D:", device: "\\\\.\\PHYSICALDRIVE0", label: "Data" },
      ],
    // No Wi-Fi, no battery and no system identity: these fixtures test device
    // selection, so the baseline extras are absent rather than invented.
    wifiConnections: async () => [],
    time: () => ({}),
    processes: async () => ({}),
    osInfo: async () => ({}),
    battery: async () => ({}),
  };
}

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

const GPU_KEYS = [
  "gpu.load",
  "gpu.temp",
  "gpu.power",
  "vram.used",
  "vram.total",
  "gpu.name",
];

const CPU_KEYS = ["cpu.brand", "cpu.model", "cpu.manufacturer"];
const DISK_KEYS = ["disk.used", "disk.total", "disk.name"];

describe("one device answers the GPU group", () => {
  it("reads every GPU figure from a single controller, not the busiest of each", async () => {
    const provider = new LibrarySensorProvider(
      fakeMachine({ controllers: [nvidia, amd] }),
    );

    const entries = await provider.sample(GPU_KEYS, 0);

    // Card A is the device the provider selected, so its temperature is the one
    // that shows. A maximum would report card B's 88 °C beside card A's name.
    expect(sampleOf(entries, "gpu.temp")?.value).toBe(40);
    expect(sampleOf(entries, "gpu.load")?.value).toBe(10);
    expect(sampleOf(entries, "gpu.power")?.value).toBe(30);
  });

  it("scopes every figure to the assigned card, even a quieter one", async () => {
    const provider = new LibrarySensorProvider(
      fakeMachine({ controllers: [nvidia, amd] }),
    );
    const entries = await provider.sample(GPU_KEYS, 0, {
      assignment: { gpu: "amd-radeon-rx-6800" },
    });

    expect(sampleOf(entries, "gpu.load")?.value).toBe(90);
    expect(sampleOf(entries, "gpu.temp")?.value).toBe(88);
    expect(sampleOf(entries, "gpu.power")?.value).toBe(220);
  });

  it("gives a quiet card its own quiet figures, not the loudest card's", async () => {
    // Same assignment, opposite expectation: a maximum would report the AMD's
    // figures for a theme that asked for the NVIDIA, which is the misattribution
    // the caption would then print.
    const provider = new LibrarySensorProvider(
      fakeMachine({ controllers: [nvidia, amd] }),
    );
    const entries = await provider.sample(GPU_KEYS, 0, {
      assignment: { gpu: "nvidia-geforce-rtx-3080-ti" },
    });

    expect(sampleOf(entries, "gpu.load")?.value).toBe(10);
    expect(sampleOf(entries, "gpu.temp")?.value).toBe(40);
    expect(sampleOf(entries, "gpu.power")?.value).toBe(30);
    expect(textOf(entries, "gpu.name")).toBe("NVIDIA GeForce RTX 3080 Ti");
  });

  it("reports a gap when the assigned card is gone, never another card's numbers", async () => {
    const provider = new LibrarySensorProvider(
      fakeMachine({ controllers: [nvidia, amd] }),
    );
    const entries = await provider.sample(GPU_KEYS, 0, {
      assignment: { gpu: "a-card-this-pc-does-not-have" },
    });

    for (const key of ["gpu.load", "gpu.temp", "gpu.power"]) {
      expect(sampleOf(entries, key), key).toMatchObject({ status: "missing" });
      expect(sampleOf(entries, key), key).not.toHaveProperty("value");
    }
  });

  it("names the card the figures came from", async () => {
    const provider = new LibrarySensorProvider(
      fakeMachine({ controllers: [nvidia, amd] }),
    );

    expect(textOf(await provider.sample(["gpu.name"], 0), "gpu.name")).toBe(
      "NVIDIA GeForce RTX 3080 Ti",
    );

    const entries = await provider.sample(["gpu.name"], 0, {
      assignment: { gpu: "amd-radeon-rx-6800" },
    });

    expect(textOf(entries, "gpu.name")).toBe("AMD Radeon RX 6800");
  });

  it("shows the consumer's chosen name for that card", async () => {
    const provider = new LibrarySensorProvider(
      fakeMachine({ controllers: [nvidia, amd] }),
    );
    const entries = await provider.sample(["gpu.name", "gpu.temp"], 0, {
      assignment: {
        gpu: "nvidia-geforce-rtx-3080-ti",
        names: { "nvidia-geforce-rtx-3080-ti": "Desk card" },
      },
    });

    expect(textOf(entries, "gpu.name")).toBe("Desk card");
    // The override renames the device; it does not change which one answers.
    expect(sampleOf(entries, "gpu.temp")?.value).toBe(40);
  });

  it("has no caption to give when this PC reports no card", async () => {
    const provider = new LibrarySensorProvider(
      fakeMachine({ controllers: [] }),
    );

    const entries = await provider.sample(["gpu.name"], 0);

    expect(sampleOf(entries, "gpu.name")).toMatchObject({ status: "missing" });
    expect(entries[0]?.sample).not.toHaveProperty("textValue");
  });

  it("has no caption to give when the library names no card", async () => {
    // A controller that reports figures but no model cannot be named, and a
    // caption must never stand in for a name the machine did not report.
    const provider = new LibrarySensorProvider(
      fakeMachine({ controllers: [{ ...nvidia, model: "" }] }),
    );

    expect(
      sampleOf(await provider.sample(["gpu.name"], 0), "gpu.name"),
    ).toMatchObject({ status: "missing" });
  });

  it("still reads an unnamed card's figures, because they are real", async () => {
    // The caption is a gap, not the card. Dropping the measurements too would
    // be a worse lie than a missing name: `highest()` reported them, and they
    // are this machine's own readings.
    const provider = new LibrarySensorProvider(
      fakeMachine({ controllers: [{ ...nvidia, model: null }] }),
    );

    const entries = await provider.sample(
      ["gpu.name", "gpu.load", "gpu.temp", "vram.total"],
      0,
    );

    expect(sampleOf(entries, "gpu.name")).toMatchObject({ status: "missing" });
    expect(sampleOf(entries, "gpu.load")?.value).toBe(10);
    expect(sampleOf(entries, "gpu.temp")?.value).toBe(40);
    expect(sampleOf(entries, "vram.total")?.value).toBe(12);
  });

  it("still reads the named card's figures when a second card has no name", async () => {
    const provider = new LibrarySensorProvider(
      fakeMachine({ controllers: [{ ...amd, model: null }, nvidia] }),
    );

    const entries = await provider.sample(["gpu.name", "gpu.temp"], 0);

    expect(textOf(entries, "gpu.name")).toBe("NVIDIA GeForce RTX 3080 Ti");
    expect(sampleOf(entries, "gpu.temp")?.value).toBe(40);
  });
});

describe("the second disk slot", () => {
  it("still resolves its drive for a theme that binds no unsuffixed disk key", async () => {
    // `disk.data.*` answers a drive too, so a theme that binds only the
    // second slot still needs the model→volume join; the expensive read is
    // only skipped when nothing about disks is bound at all.
    const provider = new LibrarySensorProvider(fakeMachine());
    const entries = await provider.sample(["disk.data.total"], 0, {
      assignment: { dataDisk: "st4000dm004-2cv104" },
    });

    expect(sampleOf(entries, "disk.data.total")?.value).toBeCloseTo(4000, 0);
  });
});

describe("the CPU identity keys", () => {
  it("carry the three strings the library reports, separately", async () => {
    const provider = new LibrarySensorProvider(
      fakeMachine({
        cpu: {
          manufacturer: "Intel",
          brand: "Core™ i9-10850K",
          model: "165",
        },
      }),
    );

    const entries = await provider.sample(CPU_KEYS, 0);

    expect(textOf(entries, "cpu.manufacturer")).toBe("Intel");
    expect(textOf(entries, "cpu.brand")).toBe("Core™ i9-10850K");
    expect(textOf(entries, "cpu.model")).toBe("165");
  });

  it("are gaps when the machine reports none of them", async () => {
    const provider = new LibrarySensorProvider(fakeMachine({ cpu: {} }));

    const entries = await provider.sample(CPU_KEYS, 0);

    for (const key of CPU_KEYS) {
      expect(sampleOf(entries, key), key).toMatchObject({ status: "missing" });
      expect(entries[0]?.sample).not.toHaveProperty("textValue");
    }
  });

  it("leaves a card with no brand to say so rather than reuse another field", async () => {
    const provider = new LibrarySensorProvider(
      fakeMachine({ cpu: { manufacturer: "Intel", brand: "", model: "165" } }),
    );

    const entries = await provider.sample(["cpu.brand", "cpu.model"], 0);

    expect(sampleOf(entries, "cpu.brand")).toMatchObject({ status: "missing" });
    expect(textOf(entries, "cpu.model")).toBe("165");
  });
});

describe("the volume caption", () => {
  it("resolves the drive model back to the volume that answers for it", async () => {
    const provider = new LibrarySensorProvider(fakeMachine());
    const entries = await provider.sample(DISK_KEYS, 0, {
      assignment: { systemDisk: "lexar-500gb-ssd" },
    });

    // The assigned id is the drive's model, the same id LibreHardwareMonitor
    // lists, so a choice made with either provider reaches the same volume.
    expect(sampleOf(entries, "disk.total")?.value).toBeCloseTo(500, 0);
    expect(sampleOf(entries, "disk.used")?.value).toBeCloseTo(305, 0);
    expect(textOf(entries, "disk.name")).toBe("Lexar 500GB SSD");
  });

  it("shows the consumer's chosen name for the drive", async () => {
    const provider = new LibrarySensorProvider(fakeMachine());
    const entries = await provider.sample(DISK_KEYS, 0, {
      assignment: {
        systemDisk: "st4000dm004-2cv104",
        names: { "st4000dm004-2cv104": "Games" },
      },
    });

    expect(textOf(entries, "disk.name")).toBe("Games");
    expect(sampleOf(entries, "disk.total")?.value).toBeCloseTo(4000, 0);
  });

  it("names no volume when the figures describe every volume at once", async () => {
    const provider = new LibrarySensorProvider(fakeMachine());

    const entries = await provider.sample(DISK_KEYS, 0);

    expect(sampleOf(entries, "disk.total")?.value).toBeCloseTo(4500, 0);
    // The unsuffixed keys sum every volume, so a single drive's name beside
    // them would misattribute the sum.
    expect(sampleOf(entries, "disk.name")).toMatchObject({
      status: "missing",
    });
  });

  it("is a gap when the assigned drive is gone, never another drive's figures", async () => {
    const provider = new LibrarySensorProvider(fakeMachine());
    const entries = await provider.sample(DISK_KEYS, 0, {
      assignment: { systemDisk: "a-drive-this-pc-does-not-have" },
    });

    expect(sampleOf(entries, "disk.total")).toMatchObject({
      status: "missing",
    });
    expect(sampleOf(entries, "disk.name")).toMatchObject({ status: "missing" });
  });

  it("still names the drive when the model carries a filesystem label too", async () => {
    // `blockDevices` reports the volume label ("Data"); the drive model is the
    // identity, so the caption names the drive and not the label.
    const provider = new LibrarySensorProvider(fakeMachine());
    const entries = await provider.sample(["disk.name"], 0, {
      assignment: { systemDisk: "st4000dm004-2cv104" },
    });

    expect(textOf(entries, "disk.name")).toBe("ST4000DM004-2CV104");
  });
});

/** A POSIX machine's reports: a device path in `fs`, a mount point in `mount`. */
const posixRoot: VolumeLike = {
  mount: "/",
  size: 500 * GB,
  used: 305 * GB,
};

const posixData: VolumeLike = {
  mount: "/data",
  size: 2000 * GB,
  used: 900 * GB,
};

const posixLayout: readonly DriveLayoutLike[] = [
  { device: "/dev/nvme0n1", name: "Samsung SSD 990 PRO" },
];

const posixVolumes: readonly BlockDeviceLike[] = [
  { mount: "/", device: "/dev/nvme0n1", label: "" },
  { mount: "/data", device: "/dev/nvme0n1", label: "Data" },
];

describe("a volume on POSIX", () => {
  /** The drive these reports describe, which must exist for the join to mean. */
  const posixDrive = (): DriveDevice => {
    const drive = driveFor(
      drivesFrom(posixLayout, posixVolumes),
      "samsung-ssd-990-pro",
    );
    if (drive === undefined) {
      throw new Error("the POSIX fixture must report a drive to join against");
    }
    return drive;
  };

  it("joins its own device when it is the root volume", () => {
    // The root is the volume macOS and Linux report first and most often.
    // Normalising `/` to the empty string drops it out of every drive, so a
    // whole platform's storage card reads empty with nothing to show for it.
    expect(volumesOf([posixRoot], posixDrive())).toEqual([posixRoot]);
  });

  it("joins its own device alongside a volume on a data mount", () => {
    expect(volumesOf([posixRoot, posixData], posixDrive())).toEqual([
      posixRoot,
      posixData,
    ]);
  });

  it("reaches a storage key instead of reporting the drive as empty", async () => {
    const provider = new LibrarySensorProvider(
      fakeMachine({
        filesystems: [posixRoot],
        layout: posixLayout,
        blockDevices: posixVolumes,
      }),
    );
    const entries = await provider.sample(DISK_KEYS, 0, {
      assignment: { systemDisk: "samsung-ssd-990-pro" },
    });

    expect(sampleOf(entries, "disk.total")?.value).toBeCloseTo(500, 0);
    expect(sampleOf(entries, "disk.used")?.value).toBeCloseTo(305, 0);
    expect(textOf(entries, "disk.name")).toBe("Samsung SSD 990 PRO");
  });

  it("still compares a trailing slash equal, which is what the strip is for", () => {
    // A trailing slash is not a different mount, and dropping it is not the
    // bug: normalising `/` *into* the empty string is.
    const drives = drivesFrom(posixLayout, [
      { mount: "/data/", device: "/dev/nvme0n1", label: "Data" },
    ]);
    const drive = driveFor(drives, "samsung-ssd-990-pro");
    if (drive === undefined) {
      throw new Error("the POSIX fixture must report a drive to join against");
    }

    expect(volumesOf([posixData], drive)).toEqual([posixData]);
  });
});

describe("an assignment given to one sample", () => {
  it("scopes that sample alone, while another is in flight with another one", async () => {
    // Hold the first sample's read open, start a second with the other card,
    // then let the first finish: neither sample may answer with the other's
    // devices, which is what a shared mutable assignment could not promise.
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reached!: () => void;
    const atFirstGraphics = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let reads = 0;

    const provider = new LibrarySensorProvider(
      fakeMachine({
        controllers: [nvidia, amd],
        onGraphics: () => {
          reads += 1;

          if (reads > 1) {
            return Promise.resolve();
          }

          reached();
          return held;
        },
      }),
    );

    const first = provider.sample(["gpu.temp", "gpu.name"], 0, {
      assignment: { gpu: "amd-radeon-rx-6800" },
    });
    await atFirstGraphics;
    const second = provider.sample(["gpu.temp", "gpu.name"], 0, {
      assignment: { gpu: "nvidia-geforce-rtx-3080-ti" },
    });
    release();

    const [theirs, mine] = await Promise.all([first, second]);

    // Each sample answers for the card it was given, figures and caption
    // together: the caption cannot sit over another device's reading.
    expect(textOf(theirs, "gpu.name")).toBe("AMD Radeon RX 6800");
    expect(sampleOf(theirs, "gpu.temp")?.value).toBe(88);
    expect(textOf(mine, "gpu.name")).toBe("NVIDIA GeForce RTX 3080 Ti");
    expect(sampleOf(mine, "gpu.temp")?.value).toBe(40);
  });
});

describe("the devices a consumer can choose between", () => {
  it("lists a drive by its model, so a choice matches the other provider", async () => {
    const provider = new LibrarySensorProvider(fakeMachine());

    const { disks } = await provider.describeDevices();

    expect(disks).toEqual([
      { id: "lexar-500gb-ssd", name: "Lexar 500GB SSD" },
      { id: "st4000dm004-2cv104", name: "ST4000DM004-2CV104" },
    ]);
  });

  it("lists a card by its model", async () => {
    const provider = new LibrarySensorProvider(
      fakeMachine({ controllers: [nvidia, amd] }),
    );

    expect((await provider.describeDevices()).gpus).toEqual([
      { id: "nvidia-geforce-rtx-3080-ti", name: "NVIDIA GeForce RTX 3080 Ti" },
      { id: "amd-radeon-rx-6800", name: "AMD Radeon RX 6800" },
    ]);
  });

  it("reports an empty machine as no devices, not as an error", async () => {
    const provider = new LibrarySensorProvider(
      fakeMachine({ controllers: [], layout: [], blockDevices: [] }),
    );

    expect(await provider.describeDevices()).toEqual({ gpus: [], disks: [] });
  });
});

describe("a library that cannot be read at all", () => {
  it("reports every key it owns as a gap, with the reason", async () => {
    const machine = fakeMachine();
    const provider = new LibrarySensorProvider({
      ...machine,
      graphics: async () => {
        throw new Error("wmi said no");
      },
    });

    const entries = await provider.sample(["gpu.temp", "gpu.name"], 0);

    expect(sampleOf(entries, "gpu.temp")).toMatchObject({ status: "missing" });
    expect(sampleOf(entries, "gpu.name")).toMatchObject({ status: "missing" });
    expect(provider.health()).toMatchObject({ available: false });
  });

  it("does not pass a third-party error string through to a browser verbatim", async () => {
    // `systeminformation` shells out and its errors quote the command and the
    // machine's own paths. The sample message reaches every display on the
    // network, so whatever that library says is not what a display is shown.
    const machine = fakeMachine();
    const provider = new LibrarySensorProvider({
      ...machine,
      graphics: async () => {
        throw new Error(
          "spawn C:\\Windows\\System32\\wbem\\WMIC.exe ENOENT after querying http://192.168.1.5:5985/wbem",
        );
      },
    });

    const message =
      sampleOf(await provider.sample(["gpu.temp"], 0), "gpu.temp")?.message ??
      "";

    expect(message).not.toContain("WMIC.exe");
    expect(message).not.toContain("192.168.1.5");
    // The cause still survives, because "a sensor has no reading" with no
    // reason is a gap a person cannot act on.
    expect(message).toContain("system information is unavailable");
    expect(message).toContain("ENOENT");
  });
});

describe("nothing but a caption is asked for", () => {
  it("never reads the machine", async () => {
    let read = false;
    const machine = fakeMachine();
    const provider = new LibrarySensorProvider({
      ...machine,
      cpu: async () => {
        read = true;
        return {};
      },
      graphics: async () => {
        read = true;
        return { controllers: [] };
      },
    });

    await provider.sample(["time.now"], 0);

    expect(read).toBe(false);
  });
});

describe("a caption is display metadata only", () => {
  it("carries no serial number, even when the library reports one", async () => {
    // `DriveLayoutLike` has no `serialNum` field, so the type already forbids
    // it; the cast proves the runtime drops it too, should the shape widen.
    const layout = [
      {
        device: "\\\\.\\PHYSICALDRIVE1",
        name: "Lexar 500GB SSD",
        serialNum: "S4EWNX0R123456",
      },
    ] as unknown as readonly DriveLayoutLike[];

    const provider = new LibrarySensorProvider(fakeMachine({ layout }));
    const entries = await provider.sample(DISK_KEYS, 0, {
      assignment: { systemDisk: "lexar-500gb-ssd" },
    });

    expect(JSON.stringify(entries)).not.toContain("S4EWNX0R123456");
    expect(textOf(entries, "disk.name")).toBe("Lexar 500GB SSD");
  });
});

describe("the expensive discovery reads", () => {
  it("reads the CPU's identity once, not once per sample", async () => {
    let reads = 0;
    const machine = fakeMachine();
    const provider = new LibrarySensorProvider({
      ...machine,
      cpu: async () => {
        reads += 1;
        return { manufacturer: "Intel", brand: "Core i9", model: "165" };
      },
    });

    await provider.sample(["cpu.brand"], 0);
    await provider.sample(["cpu.brand"], 0);
    await provider.sample(["cpu.brand"], 0);

    //  costs ~1.5 s against a 1 s poll. Re-reading it every sample
    // would outrun the poll loop, which has no overlap protection.
    expect(reads).toBe(1);
  });

  it("reads the drive index once too", async () => {
    let reads = 0;
    const machine = fakeMachine();
    const provider = new LibrarySensorProvider({
      ...machine,
      diskLayout: async () => {
        reads += 1;
        return [{ device: "\\.\PHYSICALDRIVE1", name: "Lexar 500GB SSD" }];
      },
    });

    await provider.sample(["disk.total"], 0);
    await provider.sample(["disk.total"], 0);

    expect(reads).toBe(1);
  });

  it("re-reads after a failure instead of caching the failure forever", async () => {
    let attempts = 0;
    const machine = fakeMachine();
    const provider = new LibrarySensorProvider({
      ...machine,
      diskLayout: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("wmi said no");
        return [{ device: "\\\\.\\PHYSICALDRIVE1", name: "Lexar 500GB SSD" }];
      },
    });
    // Assigned, because an unassigned `disk.total` answers from `fsSize`
    // alone and never needs the index — the failure only shows where the
    // index is what the key depends on.
    const assigned = { assignment: { systemDisk: "lexar-500gb-ssd" } };

    // First sample: the volume is a gap, and nothing else is taken down with it.
    const first = await provider.sample(
      ["disk.total", "gpu.load"],
      0,
      assigned,
    );
    expect(sampleOf(first, "disk.total")).toMatchObject({ status: "missing" });
    expect(sampleOf(first, "gpu.load")?.value).toBe(10);

    // Second sample: the retry succeeds, so the failure was not terminal. A
    // cached rejection would leave every later sample a permanent gap.
    const second = await provider.sample(["disk.total"], 0, assigned);
    expect(attempts).toBe(2);
    expect(sampleOf(second, "disk.total")).toMatchObject({ status: "ok" });
  });

  it("keeps every unassigned disk key answering when the index fails", async () => {
    // The unsuffixed keys measure every volume and need no index, so a
    // transient `diskLayout()` failure must not turn them into gaps.
    const machine = fakeMachine();
    const provider = new LibrarySensorProvider({
      ...machine,
      diskLayout: async () => {
        throw new Error("wmi said no");
      },
    });

    const entries = await provider.sample(["disk.total", "gpu.load"], 0);

    expect(sampleOf(entries, "disk.total")?.value).toBeCloseTo(4500, 0);
    expect(sampleOf(entries, "gpu.load")?.value).toBe(10);
    expect(provider.health()).toMatchObject({ available: true });
  });

  it("keeps answering the other keys when the CPU cannot be read", async () => {
    const machine = fakeMachine();
    const provider = new LibrarySensorProvider({
      ...machine,
      cpu: async () => {
        throw new Error("cpu exploded");
      },
    });

    const entries = await provider.sample(
      ["cpu.brand", "gpu.temp", "disk.total"],
      0,
    );

    expect(sampleOf(entries, "cpu.brand")).toMatchObject({ status: "missing" });
    expect(sampleOf(entries, "gpu.temp")?.value).toBe(40);
    expect(sampleOf(entries, "disk.total")?.value).toBeCloseTo(4500, 0);
    expect(provider.health()).toMatchObject({ available: true });
  });

  it("keeps a drive's name when only the volume walk fails", async () => {
    const machine = fakeMachine();
    const failingVolumes = new LibrarySensorProvider({
      ...machine,
      fsSize: async () => {
        throw new Error("wmi said no");
      },
    });

    const entries = await failingVolumes.sample(
      ["disk.used.percent", "disk.name"],
      0,
      { assignment: { systemDisk: "lexar-500gb-ssd" } },
    );

    expect(sampleOf(entries, "disk.used.percent")).toMatchObject({
      status: "missing",
    });
    // The name is the drive index's answer, and that read succeeded.
    expect(textOf(entries, "disk.name")).toBe("Lexar 500GB SSD");
    expect(sampleOf(entries, "disk.name")).toMatchObject({ status: "ok" });
  });

  it("drops a drive's name when the index fails", async () => {
    const machine = fakeMachine();
    const failingIndex = new LibrarySensorProvider({
      ...machine,
      diskLayout: async () => {
        throw new Error("wmi said no");
      },
    });

    const entries = await failingIndex.sample(["disk.name"], 0, {
      assignment: { systemDisk: "lexar-500gb-ssd" },
    });

    expect(sampleOf(entries, "disk.name")).toMatchObject({ status: "missing" });
    expect(textOf(entries, "disk.name")).toBeUndefined();
  });
});
