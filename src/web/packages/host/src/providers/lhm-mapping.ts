import { semanticId } from "@yunari/renderer-core";
import type { LhmSensor } from "./lhm-tree.js";

/** Which LHM sensor answers which Yunari semantic key. Modelled on explicit
 * sensor names and LHM sensor kinds, never on provider instance identity (§93).
 *
 * LHM names a hardware node by its *model* ("Intel Core i9-10850K", "NVIDIA
 * GeForce RTX 3080 Ti", "Ethernet"), not by kind, so hardware is matched by a
 * pattern over that name. Every name below was read off a real LHM v0.9.6
 * install; a hand-written fixture did not reveal them. */

/** LHM's `SensorType`, spelling its kind as `data.json` reports it. */
type LhmSensorType =
  | "Temperature"
  | "Load"
  | "Power"
  | "Clock"
  | "Fan"
  | "Data"
  | "SmallData"
  | "Throughput"
  | "Level"
  | "Voltage"
  | "Current";

/** Which hardware node a binding applies to, matched against its name. */
type HardwareGroup = "cpu" | "cooling" | "gpu" | "storage" | "network";

interface LhmBinding {
  readonly semanticKey: string;
  readonly group: HardwareGroup;
  readonly type: LhmSensorType;
  /** Accepted sensor names, in priority order; first match wins. */
  readonly anyText: readonly string[];
  /** How repeated hardware instances combine. Default: highest. */
  readonly combine?: "sum" | "highest";
}

const CPU_PATTERN = /intel|amd|ryzen|core i\d|threadripper/i;
/** A liquid cooler (NZXT Kraken, Corsair, …) drives the CPU, and so do the
 * motherboard super-I/O fan headers (ITE/Nuvoton/Fintek chips). */
const COOLING_PATTERN =
  /kraken|corsair|nzxt|coolit|aio|liquid|ite it|nuvoton|fintek|prime|aorus|tomahawk/i;
const GPU_PATTERN = /nvidia|geforce|radeon|gpu|arc a\d/i;
/** Drive model designations vary widely: `Lexar 500GB SSD`, `ST4000DM004`,
 * `WDC WD30NMVW`, `Samsung SSD 970`, `CT1000MX500SSD1`. */
const STORAGE_PATTERN =
  /ssd|hdd|nvme|disk|wdc|wd\d|\bst\d|ct\d|micron|samsung|lexar|seagate|kingston|toshiba|crucial|sandisk|intel ssd/i;
const NETWORK_PATTERN = /ethernet|wi-?fi|wireless|network|802\.11/i;

function groupOf(hardwareName: string): HardwareGroup | undefined {
  // Order matters: a "Bluetooth Network Connection" is a network node, and a GPU
  // named "Intel Arc" must not be read as a CPU.
  if (NETWORK_PATTERN.test(hardwareName)) return "network";
  if (COOLING_PATTERN.test(hardwareName)) return "cooling";
  if (STORAGE_PATTERN.test(hardwareName)) return "storage";
  if (GPU_PATTERN.test(hardwareName)) return "gpu";
  if (CPU_PATTERN.test(hardwareName)) return "cpu";
  return undefined;
}

const BINDINGS: readonly LhmBinding[] = [
  // CPU. `Core Average` is the package temperature LHM reports when a dedicated
  // package sensor is absent; `Core Max` is the hotter reading.
  {
    semanticKey: "cpu.temp",
    group: "cpu",
    type: "Temperature",
    anyText: ["CPU Package", "Core Average", "Core Max"],
  },
  {
    semanticKey: "cpu.temp",
    group: "cooling",
    type: "Temperature",
    anyText: ["Liquid"],
  },
  // The package figure and the core extremes, beside the aggregate rather than
  // replacing it: a theme bound to `cpu.temp` keeps reading what it always did.
  {
    semanticKey: "cpu.temp.package",
    group: "cpu",
    type: "Temperature",
    anyText: ["CPU Package"],
  },
  {
    semanticKey: "cpu.temp.core.max",
    group: "cpu",
    type: "Temperature",
    anyText: ["Core Max"],
  },
  {
    semanticKey: "cpu.temp.core.avg",
    group: "cpu",
    type: "Temperature",
    anyText: ["Core Average"],
  },
  {
    semanticKey: "cpu.power",
    group: "cpu",
    type: "Power",
    anyText: ["CPU Package", "Package", "CPU Cores"],
  },
  {
    semanticKey: "cpu.clock",
    group: "cpu",
    type: "Clock",
    anyText: ["Cores (Average)", "Core Average", "CPU Core #1", "Bus Speed"],
  },
  {
    semanticKey: "cpu.voltage",
    group: "cpu",
    type: "Voltage",
    anyText: ["CPU Core"],
  },
  // Only an explicit CPU fan name answers this; a case or AIO fan does not.
  {
    semanticKey: "cpu.fan",
    group: "cpu",
    type: "Fan",
    anyText: ["CPU Fan", "CPU"],
  },
  {
    semanticKey: "cpu.fan",
    group: "cooling",
    type: "Fan",
    anyText: [
      "Pump",
      "Fan #1",
      "Fan #2",
      "Fan #3",
      "Fan #4",
      "Fan #5",
      "Fan #6",
    ],
  },

  // GPU
  {
    semanticKey: "gpu.load",
    group: "gpu",
    type: "Load",
    anyText: ["GPU Core", "D3D 3D"],
  },
  {
    semanticKey: "gpu.temp",
    group: "gpu",
    type: "Temperature",
    anyText: ["GPU Core"],
  },
  {
    semanticKey: "gpu.temp.core",
    group: "gpu",
    type: "Temperature",
    anyText: ["GPU Core"],
  },
  {
    semanticKey: "gpu.temp.hotspot",
    group: "gpu",
    type: "Temperature",
    anyText: ["GPU Hot Spot"],
  },
  {
    semanticKey: "gpu.power",
    group: "gpu",
    type: "Power",
    anyText: ["GPU Package", "GPU Power"],
  },
  {
    semanticKey: "gpu.voltage",
    group: "gpu",
    type: "Voltage",
    anyText: ["GPU Core Voltage"],
  },
  {
    semanticKey: "gpu.clock",
    group: "gpu",
    type: "Clock",
    anyText: ["GPU Core"],
  },
  {
    semanticKey: "gpu.clock.memory",
    group: "gpu",
    type: "Clock",
    anyText: ["GPU Memory"],
  },
  {
    semanticKey: "gpu.fan",
    group: "gpu",
    type: "Fan",
    anyText: ["GPU Fan 1", "GPU Fan"],
  },

  // VRAM. LHM reports GPU memory as `SmallData` in MB, not `Data` in GB.
  {
    semanticKey: "vram.used",
    group: "gpu",
    type: "SmallData",
    anyText: ["D3D Dedicated Memory Used", "GPU Memory Used"],
  },
  {
    semanticKey: "vram.total",
    group: "gpu",
    type: "SmallData",
    anyText: ["GPU Memory Total"],
  },
  {
    semanticKey: "vram.used.percent",
    group: "gpu",
    type: "Load",
    anyText: ["GPU Memory"],
  },
  {
    semanticKey: "vram.temp",
    group: "gpu",
    type: "Temperature",
    anyText: ["GPU Memory Junction"],
  },

  // Disk capacity. `Used Space` is typed Load but carries a percentage, so it
  // answers only the percent key; `disk.used` is derived from Total minus Free.
  {
    semanticKey: "disk.used.percent",
    group: "storage",
    type: "Load",
    anyText: ["Used Space"],
  },
  {
    semanticKey: "disk.total",
    group: "storage",
    type: "Data",
    anyText: ["Total Space"],
  },
  {
    semanticKey: "disk.free",
    group: "storage",
    type: "Data",
    anyText: ["Free Space"],
  },

  // Network. LHM's `Throughput` is bytes per second; the vocabulary is Mb/s.
  {
    semanticKey: "network.download",
    group: "network",
    type: "Throughput",
    anyText: ["Download Speed"],
  },
  {
    semanticKey: "network.upload",
    group: "network",
    type: "Throughput",
    anyText: ["Upload Speed"],
  },
];

/**
 * A binding whose key carries the sensor's own identity, so the key set depends
 * on the machine rather than on the vocabulary. Numbers come from LHM's own
 * name and are 1-based; a name absent from the capture produces no key.
 */
interface LhmDynamicBinding {
  readonly group: HardwareGroup;
  readonly type: LhmSensorType;
  readonly pattern: RegExp;
  /** Builds the semantic key from the sensor's own name. */
  readonly key: (match: RegExpExecArray) => string;
  /** How repeated matches for one key combine. Default: highest. */
  readonly combine?: "mean";
  /** Leave the key alone when an earlier binding already answered it. */
  readonly whenAbsent?: boolean;
}

const DYNAMIC_BINDINGS: readonly LhmDynamicBinding[] = [
  {
    group: "cpu",
    type: "Load",
    // The vocabulary's per-core Load sensor, named directly by the spec's table.
    pattern: /^CPU Core #(\d+)$/,
    key: (match) => `cpu.core.${match[1]}.load`,
  },
  {
    group: "cpu",
    type: "Load",
    // Other LHM builds name load per logical processor only. A core then reads
    // the mean of its threads — the conventional per-core utilization — so a
    // core's gauge cannot exceed the aggregate by taking its busiest thread.
    pattern: /^CPU Core #(\d+) Thread #\d+$/,
    key: (match) => `cpu.core.${match[1]}.load`,
    combine: "mean",
    whenAbsent: true,
  },
  {
    group: "cpu",
    type: "Temperature",
    pattern: /^CPU Core #(\d+)$/,
    key: (match) => `cpu.core.${match[1]}.temp`,
  },
  {
    group: "cpu",
    type: "Clock",
    pattern: /^CPU Core #(\d+)$/,
    key: (match) => `cpu.core.${match[1]}.clock`,
  },
  {
    group: "gpu",
    type: "Fan",
    pattern: /^GPU Fan (\d+)$/,
    key: (match) => `gpu.fan.${match[1]}`,
  },
];

/** Dynamic keys this provider owns by shape, discovered per machine. */
const CPU_CORE_KEY = /^cpu\.core\.[1-9]\d*\.(load|temp|clock)$/;
const GPU_FAN_KEY = /^gpu\.fan\.[1-9]\d*$/;

export function isLhmDynamicKey(key: string): boolean {
  return CPU_CORE_KEY.test(key) || GPU_FAN_KEY.test(key);
}

/**
 * Every dynamic key these sensors can answer, requested or not. The provider
 * advertises these so an editor can list per-core and per-fan readings exactly
 * like built-ins.
 */
export function dynamicKeyReadings(
  sensors: readonly LhmSensor[],
): readonly string[] {
  const keys = new Set<string>();

  for (const binding of DYNAMIC_BINDINGS) {
    for (const sensor of sensors) {
      if (
        sensor.value === undefined ||
        sensor.type !== binding.type ||
        groupOf(sensor.hardwareType) !== binding.group
      ) {
        continue;
      }

      const match = binding.pattern.exec(sensor.text);
      if (match !== null) {
        keys.add(binding.key(match));
      }
    }
  }

  return [...keys];
}

/** LHM reports `Data` in GB and `SmallData` in MB. */
const MIB_PER_GB = 1024;
const MEGABIT_PER_BYTE_PER_SECOND = 8 / 1_000_000;

function scaleFor(binding: LhmBinding, value: number): number {
  switch (binding.type) {
    case "SmallData":
      // MB to GB, the unit the vocabulary declares for VRAM.
      return value / MIB_PER_GB;
    case "Throughput":
      return value * MEGABIT_PER_BYTE_PER_SECOND;
    default:
      // `Data` is already GB, and the rest carry their own unit.
      return value;
  }
}

function matches(binding: LhmBinding, sensor: LhmSensor): boolean {
  return (
    sensor.type === binding.type &&
    groupOf(sensor.hardwareType) === binding.group &&
    binding.anyText.includes(sensor.text)
  );
}

export interface LhmMatch {
  readonly semanticKey: string;
  readonly sensor: LhmSensor;
  readonly value: number;
}

/** Sums a named sensor across every hardware node in a group. */
function sumNamed(
  sensors: readonly LhmSensor[],
  group: HardwareGroup,
  names: readonly string[],
): number | undefined {
  let sum = 0;
  let found = false;

  for (const sensor of sensors) {
    if (
      sensor.value === undefined ||
      groupOf(sensor.hardwareType) !== group ||
      !names.includes(sensor.text)
    ) {
      continue;
    }

    sum += scaleFor(
      {
        semanticKey: "",
        group,
        type: sensor.type as LhmSensorType,
        anyText: names,
      },
      sensor.value,
    );
    found = true;
  }

  return found ? sum : undefined;
}

/** `disk.used` has no direct LHM sensor: LHM's `Used Space` is a percentage. */
function deriveDiskUsed(sensors: readonly LhmSensor[]): number | undefined {
  const total = sumNamed(sensors, "storage", ["Total Space"]);
  const free = sumNamed(sensors, "storage", ["Free Space"]);

  return total === undefined || free === undefined ? undefined : total - free;
}

/** A GPU this machine reports, so a consumer can choose between them. */
interface GpuDeviceReading {
  readonly deviceId: string;
  readonly name: string;
}

export function gpuDeviceReadings(
  sensors: readonly LhmSensor[],
): readonly GpuDeviceReading[] {
  const seen = new Map<string, string>();

  for (const sensor of sensors) {
    if (groupOf(sensor.hardwareType) === "gpu") {
      seen.set(sensor.hardwareId, sensor.hardwareType);
    }
  }

  return [...seen].map(([hardwareId, name]) => ({
    deviceId: semanticId(name) || hardwareId,
    name,
  }));
}

/**
 * One entry per discovered storage device, for the per-device disk keys.
 * A drive reports Total and Free in GB and Used Space as a percentage, so used
 * capacity is derived the same way the aggregate is.
 */
interface DiskDeviceReading {
  readonly deviceId: string;
  readonly name: string;
  readonly usedGb: number;
  readonly totalGb: number;
  readonly usedPercent: number;
}

export function diskDeviceReadings(
  sensors: readonly LhmSensor[],
): readonly DiskDeviceReading[] {
  const names = new Map<string, string>();

  for (const sensor of sensors) {
    if (groupOf(sensor.hardwareType) === "storage") {
      names.set(sensor.hardwareId, sensor.hardwareType);
    }
  }

  const readings: DiskDeviceReading[] = [];

  for (const [hardwareId, name] of names) {
    const own = sensors.filter((sensor) => sensor.hardwareId === hardwareId);
    const total = sumNamed(own, "storage", ["Total Space"]);
    const free = sumNamed(own, "storage", ["Free Space"]);

    if (total === undefined || free === undefined || total <= 0) {
      continue;
    }

    const usedGb = total - free;
    readings.push({
      deviceId: semanticId(name),
      name,
      usedGb,
      totalGb: total,
      usedPercent: (usedGb / total) * 100,
    });
  }

  return readings;
}

/** Records a reading, combining repeated hardware by the binding's rule. */
function selectReading(
  chosen: Map<string, LhmMatch>,
  semanticKey: string,
  sensor: LhmSensor,
  value: number,
  sums: boolean,
): void {
  const existing = chosen.get(semanticKey);

  if (existing === undefined) {
    chosen.set(semanticKey, { semanticKey, sensor, value });
    return;
  }

  chosen.set(semanticKey, {
    ...existing,
    value: sums ? existing.value + value : Math.max(existing.value, value),
  });
}

/**
 * First sensor that answers each key. Where the set it is given holds several
 * instances of one group, capacity and throughput sum while a percentage,
 * temperature, power or clock takes the highest.
 *
 * That is the rule for whatever set reaches it. Which devices are in that set
 * is `matchLhmSensorsAssigned`'s decision, and it is a selection, not a maximum
 * (0004) — so an unassigned group here is one device's reading, not the
 * busiest one's.
 */
export function matchLhmSensors(
  sensors: readonly LhmSensor[],
  semanticKeys: readonly string[],
): readonly LhmMatch[] {
  const wanted = new Set(semanticKeys);
  const chosen = new Map<string, LhmMatch>();

  for (const binding of BINDINGS) {
    // `disk.free` is a derivation input, not a semantic key.
    if (
      binding.semanticKey === "disk.free" ||
      !wanted.has(binding.semanticKey)
    ) {
      continue;
    }

    for (const sensor of sensors) {
      if (sensor.value === undefined || !matches(binding, sensor)) {
        continue;
      }

      const sums =
        binding.combine === "sum" ||
        binding.type === "Data" ||
        binding.type === "SmallData" ||
        binding.type === "Throughput";

      selectReading(
        chosen,
        binding.semanticKey,
        sensor,
        scaleFor(binding, sensor.value),
        sums,
      );
    }
  }

  // Dynamic keys depend on which sensors this machine reports, so only the
  // requested ones are produced; a request for an absent device stays absent.
  for (const binding of DYNAMIC_BINDINGS) {
    const groups = new Map<
      string,
      { sensor: LhmSensor; sum: number; max: number; count: number }
    >();

    for (const sensor of sensors) {
      const reading = sensor.value;
      if (
        reading === undefined ||
        sensor.type !== binding.type ||
        groupOf(sensor.hardwareType) !== binding.group
      ) {
        continue;
      }

      const match = binding.pattern.exec(sensor.text);
      if (match === null) {
        continue;
      }

      const semanticKey = binding.key(match);
      if (!wanted.has(semanticKey)) {
        continue;
      }

      const group = groups.get(semanticKey);
      if (group === undefined) {
        groups.set(semanticKey, {
          sensor,
          sum: reading,
          max: reading,
          count: 1,
        });
      } else {
        group.sum += reading;
        group.max = Math.max(group.max, reading);
        group.count += 1;
      }
    }

    for (const [semanticKey, group] of groups) {
      if (binding.whenAbsent === true && chosen.has(semanticKey)) {
        continue;
      }

      selectReading(
        chosen,
        semanticKey,
        group.sensor,
        binding.combine === "mean" ? group.sum / group.count : group.max,
        false,
      );
    }
  }

  // A summed percentage is meaningless; it must describe the same set of drives
  // that `disk.used` and `disk.total` aggregate (see `deriveDiskUsed`).
  if (wanted.has("disk.used.percent")) {
    const used = deriveDiskUsed(sensors);
    const total = sumNamed(sensors, "storage", ["Total Space"]);

    if (used !== undefined && total !== undefined && total > 0) {
      const sensor = chosen.get("disk.used.percent")?.sensor;

      chosen.set("disk.used.percent", {
        semanticKey: "disk.used.percent",
        sensor: sensor ?? {
          sensorId: "derived",
          hardwareId: "",
          hardwareType: "Storage",
          text: "Used Space (derived)",
          type: "Load",
          value: 0,
        },
        value: (used / total) * 100,
      });
    }
  }

  if (wanted.has("disk.used") && !chosen.has("disk.used")) {
    const used = deriveDiskUsed(sensors);
    const total = sumNamed(sensors, "storage", ["Total Space"]);

    if (used !== undefined && total !== undefined && total > 0) {
      chosen.set("disk.used", {
        semanticKey: "disk.used",
        sensor: {
          sensorId: "derived",
          hardwareId: "",
          hardwareType: "Storage",
          text: "Used Space (derived)",
          type: "Data",
          value: used,
        },
        value: used,
      });
    }
  }

  return [...chosen.values()];
}

/** A consumer's device choice, applied to the aggregate keys a theme binds. */
export interface DeviceAssignment {
  /** Device id whose readings answer the unsuffixed `gpu.*` keys. */
  readonly gpu?: string;
  /** Device id answering `disk.used`/`disk.total`/`disk.used.percent`. */
  readonly systemDisk?: string;
  /** Device id for the per-device data-disk keys, when a theme names one. */
  readonly dataDisk?: string;
  /**
   * What the consumer calls each device, keyed by device id. It rides with the
   * choice rather than beside it, so one publish reaches the readings and the
   * caption that names them in the same cycle.
   */
  readonly names?: Readonly<Record<string, string>>;
}

/**
 * Readings limited to the assigned devices, so a two-GPU machine can show the
 * GPU the consumer chose under the theme's single `gpu.*` keys. An unassigned
 * group answers from the first device the machine reports, not the busiest one
 * (0004) — a caption that changes text every sample cannot be read.
 */
/** The data-disk slot's keys. */
const DATA_DISK_KEYS = [
  "disk.data.used",
  "disk.data.total",
  "disk.data.used.percent",
] as const;

function isDataDiskKey(key: string): boolean {
  return (DATA_DISK_KEYS as readonly string[]).includes(key);
}

/** Which hardware node answers a group's unsuffixed keys, by device id. */
function nodeFor(
  sensors: readonly LhmSensor[],
  group: HardwareGroup,
  assigned: string | undefined,
): string | undefined {
  const seen = new Map<string, string>();

  for (const sensor of sensors) {
    if (groupOf(sensor.hardwareType) === group) {
      seen.set(sensor.hardwareId, semanticId(sensor.hardwareType));
    }
  }

  const ids = [...seen.values()];
  if (ids.length === 0) {
    return undefined;
  }

  // With no assignment, the first node the machine reports answers — the same
  // rule the library provider uses, so one caption names one device whichever
  // provider is running. "Busiest" would be wrong here for the reason it is
  // wrong there: the caption would change text every sample.
  return assigned === undefined ? ids[0] : ids.find((id) => id === assigned);
}

/**
 * The name of the device a group's unsuffixed keys describe, or undefined when
 * no single device answers them.
 *
 * The GPU group is scoped to one node either way, so it always has a name. The
 * storage group is summed across every drive until one is assigned — a
 * legitimate host total, and a total no one drive's name describes.
 */
export function lhmDeviceName(
  sensors: readonly LhmSensor[],
  group: "gpu" | "storage",
  assignment: DeviceAssignment,
): string | undefined {
  const deviceId =
    group === "gpu"
      ? nodeFor(sensors, "gpu", assignment.gpu)
      : assignment.systemDisk;

  if (deviceId === undefined) {
    return undefined;
  }

  for (const sensor of sensors) {
    if (
      groupOf(sensor.hardwareType) === group &&
      semanticId(sensor.hardwareType) === deviceId
    ) {
      return sensor.hardwareType;
    }
  }

  return undefined;
}

export function matchLhmSensorsAssigned(
  sensors: readonly LhmSensor[],
  semanticKeys: readonly string[],
  assignment: DeviceAssignment,
): readonly LhmMatch[] {
  // The GPU group always answers from one node, so every `gpu.*` figure and
  // the `gpu.name` caption beside them come from the same card. Storage is
  // scoped only once a drive is chosen; until then it is the host's total.
  //
  // An assigned device this PC does not have scopes its group to nothing: a
  // fallback to the default would answer with a different card's readings under
  // the name the consumer chose for the one they removed.
  const gpuId = nodeFor(sensors, "gpu", assignment.gpu);
  // Scoped whenever a card answers, assigned or not: that is the whole point.
  const gpuWanted = gpuId !== undefined || assignment.gpu !== undefined;
  const diskWanted = assignment.systemDisk !== undefined;
  const diskId = assignment.systemDisk;

  const scoped =
    !gpuWanted && !diskWanted
      ? sensors
      : sensors.filter((sensor) => {
          const group = groupOf(sensor.hardwareType);
          const id = semanticId(sensor.hardwareType);

          // Keep everything that is not one of the selected groups.
          if (group === "gpu" && gpuWanted)
            return gpuId !== undefined && id === gpuId;
          if (group === "storage" && diskWanted) return id === diskId;
          return true;
        });

  const matched = matchLhmSensors(scoped, semanticKeys);

  // The data slot is a second disk: a theme binds one disk to the system keys
  // and one to the data keys, so neither names a drive on any machine.
  const dataId = assignment.dataDisk;

  if (dataId === undefined || !semanticKeys.some(isDataDiskKey)) {
    return matched;
  }

  const readings = diskDeviceReadings(sensors).find(
    (device) => device.deviceId === dataId,
  );

  if (readings === undefined) {
    return matched;
  }

  const dataValues: Record<string, number> = {
    "disk.data.used": readings.usedGb,
    "disk.data.total": readings.totalGb,
    "disk.data.used.percent": readings.usedPercent,
  };

  return [
    ...matched,
    ...Object.entries(dataValues)
      .filter(([key]) => semanticKeys.includes(key))
      .map(([semanticKey, value]) => ({
        semanticKey,
        sensor: {
          sensorId: `lhm:${semanticKey}`,
          hardwareId: "",
          hardwareType: "Storage",
          text: readings.name,
          type: "Data" as const,
          value,
        },
        value,
      })),
  ];
}
