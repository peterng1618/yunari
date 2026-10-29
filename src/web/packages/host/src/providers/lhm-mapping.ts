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
  | "Current"
  | "Control"
  | "TimeSpan";

/** Which hardware node a binding applies to, matched against its identity. */
type HardwareGroup =
  | "cpu"
  | "cooling"
  | "gpu"
  | "storage"
  | "network"
  | "motherboard"
  | "psu"
  | "battery";

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
/** Board and super-I/O nodes. LHM names a board by its model ("Gigabyte Z590
 * GAMING X") and its super-I/O child by the chip ("ITE IT8689E"). */
const MOTHERBOARD_PATTERN =
  /motherboard|gigabyte|ite it|nuvoton|fintek|prime|aorus|tomahawk/i;
/** A liquid cooler (NZXT Kraken, Corsair, …) drives the CPU. */
const COOLING_PATTERN = /kraken|corsair|nzxt|coolit|aio|liquid|cooler/i;
const GPU_PATTERN = /nvidia|geforce|radeon|gpu|arc a\d/i;
/** Drive model designations vary widely: `Lexar 500GB SSD`, `ST4000DM004`,
 * `WDC WD30NMVW`, `Samsung SSD 970`, `CT1000MX500SSD1`. */
const STORAGE_PATTERN =
  /ssd|hdd|nvme|disk|wdc|wd\d|\bst\d|ct\d|micron|samsung|lexar|seagate|kingston|toshiba|crucial|sandisk|intel ssd/i;
const NETWORK_PATTERN = /ethernet|wi-?fi|wireless|network|802\.11/i;

/** LHM's hardware path root names the hardware type: `Identifier("psu", …)`
 * becomes `/psu/…` and `Identifier("battery", …)` becomes `/battery/…`. Those
 * roots are the documented type; the node's text is the product name. */
const PSU_ID = /^\/psu(\/|$)/;
const BATTERY_ID = /^\/battery(\/|$)/;

function groupOf(
  hardwareName: string,
  hardwareId: string,
): HardwareGroup | undefined {
  // PSU and battery come first: their node text is a product name ("Corsair
  // HX1000i", "DELL 97WH"), so only the path root identifies the type.
  if (PSU_ID.test(hardwareId)) return "psu";
  if (BATTERY_ID.test(hardwareId)) return "battery";
  // Order matters. Network first (a "Bluetooth Network Connection" is a link),
  // then the specific device kinds before the board: a board-vendor GPU or SSD
  // ("Gigabyte GeForce", "AORUS NVMe") must keep its own group, a GPU named
  // "Intel Arc" must not be read as a CPU, and a super-I/O chip sits under a
  // board rather than a cooler.
  if (NETWORK_PATTERN.test(hardwareName)) return "network";
  if (STORAGE_PATTERN.test(hardwareName)) return "storage";
  if (GPU_PATTERN.test(hardwareName)) return "gpu";
  if (CPU_PATTERN.test(hardwareName)) return "cpu";
  if (MOTHERBOARD_PATTERN.test(hardwareName)) return "motherboard";
  if (COOLING_PATTERN.test(hardwareName)) return "cooling";
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
  // The super-I/O headers answered `cpu.fan` before the board got its own
  // group, so they still do: an aggregate key keeps its precedence.
  {
    semanticKey: "cpu.fan",
    group: "motherboard",
    type: "Fan",
    anyText: ["Fan #1", "Fan #2", "Fan #3", "Fan #4", "Fan #5", "Fan #6"],
  },

  // Motherboard and cooler. A board LHM cannot label reports its super-I/O
  // temperature sources as `Temperature #N`; the aggregate takes the highest,
  // like every other temperature key.
  {
    semanticKey: "motherboard.temp",
    group: "motherboard",
    type: "Temperature",
    anyText: [
      "Temperature #1",
      "Temperature #2",
      "Temperature #3",
      "Temperature #4",
      "Temperature #5",
      "Temperature #6",
    ],
  },
  {
    semanticKey: "cooling.temp",
    group: "cooling",
    type: "Temperature",
    anyText: ["Liquid"],
  },

  // PSU and battery. The hardware type comes from the path root above; the
  // sensor names are the ones LHM's `CorsairPsu` and `Battery` classes create
  // (LibreHardwareMonitorLib/Hardware/Psu/Corsair/CorsairPsu.cs and
  // Hardware/Battery/Battery.cs), not names invented for this fixture.
  {
    semanticKey: "psu.power",
    group: "psu",
    type: "Power",
    anyText: ["Total watts", "Total Output"],
  },
  {
    semanticKey: "psu.temp",
    group: "psu",
    type: "Temperature",
    anyText: ["VRM", "Case"],
  },
  {
    semanticKey: "psu.fan",
    group: "psu",
    type: "Fan",
    anyText: ["Case"],
  },
  {
    semanticKey: "battery.level",
    group: "battery",
    type: "Level",
    anyText: ["Charge Level"],
  },
  {
    semanticKey: "battery.voltage",
    group: "battery",
    type: "Voltage",
    anyText: ["Voltage"],
  },
  {
    semanticKey: "battery.rate",
    group: "battery",
    type: "Power",
    anyText: ["Charge/Discharge Rate"],
  },
  {
    semanticKey: "battery.timeRemaining",
    group: "battery",
    type: "TimeSpan",
    anyText: ["Remaining Time (Estimated)"],
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
  readonly key: (match: RegExpExecArray, sensor: LhmSensor) => string;
  /** Descriptor label from the sensor's own name; default is the vocabulary label. */
  readonly label?: (sensor: LhmSensor) => string;
  /** How repeated matches for one key combine. Default: highest. */
  readonly combine?: "mean";
  /** Leave the key alone when an earlier binding already answered it. */
  readonly whenAbsent?: boolean;
}

const DYNAMIC_BINDINGS: readonly LhmDynamicBinding[] = [
  {
    group: "cpu",
    type: "Load",
    // The vocabulary's per-core Load sensor, named directly by the mapping table.
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
  // Board headers: an RPM sensor and a Control sensor of the same name are two
  // readings of one fan, so each keeps its own key rather than collapsing to a
  // maximum. The label is the board's own ("Fan #2"), never a friendly rename.
  {
    group: "motherboard",
    type: "Fan",
    pattern: /^Fan #(\d+)$/,
    key: (_match, sensor) => `motherboard.fan.${semanticId(sensor.text)}.rpm`,
    label: (sensor) => sensor.text,
  },
  {
    group: "motherboard",
    type: "Control",
    pattern: /^Fan #(\d+)$/,
    key: (_match, sensor) =>
      `motherboard.fan.${semanticId(sensor.text)}.percent`,
    label: (sensor) => sensor.text,
  },
  {
    group: "motherboard",
    type: "Voltage",
    pattern: /^.+$/,
    key: (_match, sensor) => `motherboard.voltage.${semanticId(sensor.text)}`,
    label: (sensor) => sensor.text,
  },
  // A cooler's fan headers, when it exposes them; the pump is its own key.
  {
    group: "cooling",
    type: "Fan",
    pattern: /^Pump\b/i,
    key: (_match, sensor) => `cooling.pump.${semanticId(sensor.text)}.rpm`,
    label: (sensor) => sensor.text,
  },
  {
    group: "cooling",
    type: "Fan",
    pattern: /^Fan #(\d+)$/,
    key: (_match, sensor) => `cooling.fan.${semanticId(sensor.text)}.rpm`,
    label: (sensor) => sensor.text,
  },
  {
    group: "cooling",
    type: "Control",
    pattern: /^Fan #(\d+)$/,
    key: (_match, sensor) => `cooling.fan.${semanticId(sensor.text)}.percent`,
    label: (sensor) => sensor.text,
  },
  // A PSU's rails each carry their own id: `Input`, `+12V`, `+5V`, `+3.3V`.
  {
    group: "psu",
    type: "Voltage",
    pattern: /^.+$/,
    key: (_match, sensor) => `psu.voltage.${semanticId(sensor.text)}`,
    label: (sensor) => sensor.text,
  },
];

/**
 * A sensor that answers one key per device, under the device's own id rather
 * than an index. Stored separately from `DYNAMIC_BINDINGS` because the key
 * depends on the hardware node, not on the sensor's own name.
 */
interface LhmDeviceBinding {
  readonly group: "storage" | "network";
  readonly type: LhmSensorType;
  /** Quantity suffix after the device id. */
  readonly quantity: string;
  /** Accepted sensor names in priority order; the first present answers. */
  readonly anyText: readonly string[];
  /** A byte-per-second sensor lands in this vocabulary unit. */
  readonly scale?: "megabyte" | "megabit";
}

const DEVICE_BINDINGS: readonly LhmDeviceBinding[] = [
  // A drive's general temperature: NVMe calls it `Composite Temperature`, a
  // SATA drive simply `Temperature`. Warning/critical limits are not readings.
  {
    group: "storage",
    type: "Temperature",
    quantity: "temp",
    anyText: ["Composite Temperature", "Temperature"],
  },
  // LHM's storage life sensor is a `Level` named `Life`.
  {
    group: "storage",
    type: "Level",
    quantity: "health",
    anyText: ["Life"],
  },
  // Byte-native: the vocabulary declares MB/s for storage rates.
  {
    group: "storage",
    type: "Throughput",
    quantity: "read",
    anyText: ["Read Rate"],
    scale: "megabyte",
  },
  {
    group: "storage",
    type: "Throughput",
    quantity: "write",
    anyText: ["Write Rate"],
    scale: "megabyte",
  },
  {
    group: "storage",
    type: "Load",
    quantity: "activity",
    anyText: ["Total Activity"],
  },
  {
    group: "network",
    type: "Throughput",
    quantity: "download",
    anyText: ["Download Speed"],
    scale: "megabit",
  },
  {
    group: "network",
    type: "Throughput",
    quantity: "upload",
    anyText: ["Upload Speed"],
    scale: "megabit",
  },
];

/** Per-drive capacity keys, beside the per-drive sensor readings. */
const DISK_CAPACITY_KEYS = ["used", "used.percent", "total", "free"] as const;

/** Dynamic keys this provider owns by shape, discovered per machine. */
const SLUG = "[a-z0-9][a-z0-9-]{0,63}";
const NETWORK_INTERFACE_KEY = new RegExp(
  `^network\\.${SLUG}\\.(download|upload)$`,
);
const CPU_CORE_KEY = /^cpu\.core\.[1-9]\d*\.(load|temp|clock)$/;
const GPU_FAN_KEY = /^gpu\.fan\.[1-9]\d*$/;
const MOTHERBOARD_FAN_KEY = new RegExp(
  `^motherboard\\.fan\\.${SLUG}\\.(rpm|percent)$`,
);
const MOTHERBOARD_VOLTAGE_KEY = new RegExp(`^motherboard\\.voltage\\.${SLUG}$`);
const COOLING_FAN_KEY = new RegExp(`^cooling\\.fan\\.${SLUG}\\.(rpm|percent)$`);
const COOLING_PUMP_KEY = new RegExp(`^cooling\\.pump\\.${SLUG}\\.rpm$`);
const PSU_VOLTAGE_KEY = new RegExp(`^psu\\.voltage\\.${SLUG}$`);

export function isLhmDynamicKey(key: string): boolean {
  return (
    CPU_CORE_KEY.test(key) ||
    GPU_FAN_KEY.test(key) ||
    MOTHERBOARD_FAN_KEY.test(key) ||
    MOTHERBOARD_VOLTAGE_KEY.test(key) ||
    COOLING_FAN_KEY.test(key) ||
    COOLING_PUMP_KEY.test(key) ||
    PSU_VOLTAGE_KEY.test(key) ||
    NETWORK_INTERFACE_KEY.test(key)
  );
}

/** A discovered key and, when the sensor names itself, the label to show. */
export interface LhmDynamicReading {
  readonly key: string;
  readonly label?: string;
}

/**
 * Every dynamic key these sensors can answer, requested or not. The provider
 * advertises these so an editor can list per-core, per-fan and per-rail readings
 * exactly like built-ins.
 *
 * A Control sensor stays discoverable when LHM reports no number for it: the
 * captured board controls arrive as `" %"` (unit only), and the type documents
 * a percentage. Its sample is still a gap — the key exists, the value does not.
 */
export function dynamicKeyReadings(
  sensors: readonly LhmSensor[],
): readonly LhmDynamicReading[] {
  const readings = new Map<string, LhmDynamicReading>();

  for (const binding of DYNAMIC_BINDINGS) {
    for (const sensor of sensors) {
      if (
        (sensor.value === undefined && sensor.type !== "Control") ||
        sensor.type !== binding.type ||
        groupOf(sensor.hardwareType, sensor.hardwareId) !== binding.group
      ) {
        continue;
      }

      const match = binding.pattern.exec(sensor.text);
      if (match !== null) {
        const key = binding.key(match, sensor);
        const label = binding.label?.(sensor);
        readings.set(key, label === undefined ? { key } : { key, label });
      }
    }
  }

  // Per-device keys keep the vocabulary's default label, which carries the
  // device id: two identical models would otherwise advertise the same text.
  for (const reading of deviceReadings(sensors)) {
    readings.set(reading.key, { key: reading.key });
  }

  // Capacity keys come from the same per-drive derivation the sample uses, so
  // a discovered `disk.<id>.free` and its value cannot describe different sets.
  for (const device of diskDeviceReadings(sensors)) {
    for (const quantity of DISK_CAPACITY_KEYS) {
      const key = `disk.${device.deviceId}.${quantity}`;
      readings.set(key, { key });
    }
  }

  return [...readings.values()];
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
    groupOf(sensor.hardwareType, sensor.hardwareId) === binding.group &&
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
      groupOf(sensor.hardwareType, sensor.hardwareId) !== group ||
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

const BYTE_PER_SECOND_TO_MEGABYTE = 1 / 1_000_000;

/**
 * A stable id for every hardware node in a group, slugged from the provider's
 * own model name. Two nodes reporting the same model get a numeric suffix, so
 * their keys stay distinct; the suffix never comes from an array position.
 */
function deviceIdsOf(
  sensors: readonly LhmSensor[],
  group: HardwareGroup,
): ReadonlyMap<string, string> {
  const names = new Map<string, string>();

  for (const sensor of sensors) {
    if (
      groupOf(sensor.hardwareType, sensor.hardwareId) === group &&
      !names.has(sensor.hardwareId)
    ) {
      names.set(sensor.hardwareId, sensor.hardwareType);
    }
  }

  const taken = new Set<string>();
  const ids = new Map<string, string>();

  for (const [hardwareId, name] of names) {
    const base = semanticId(name) || semanticId(hardwareId) || "device";
    let id = base;

    for (let n = 2; taken.has(id); n += 1) {
      const suffix = `-${n}`;
      id = `${base.slice(0, 64 - suffix.length)}${suffix}`;
    }

    taken.add(id);
    ids.set(hardwareId, id);
  }

  return ids;
}

function scaleDeviceValue(
  scale: LhmDeviceBinding["scale"],
  value: number,
): number {
  switch (scale) {
    case "megabyte":
      return value * BYTE_PER_SECOND_TO_MEGABYTE;
    case "megabit":
      return value * MEGABIT_PER_BYTE_PER_SECOND;
    default:
      return value;
  }
}

interface LhmDeviceReading {
  readonly key: string;
  readonly sensor: LhmSensor;
  readonly value: number;
}

/** The per-device readings this machine reports, optionally only `wanted`. */
function deviceReadings(
  sensors: readonly LhmSensor[],
  wanted?: ReadonlySet<string>,
): readonly LhmDeviceReading[] {
  const readings: LhmDeviceReading[] = [];
  // Ids depend on the whole group, not on one binding, so derive them once.
  const idsByGroup = {
    storage: deviceIdsOf(sensors, "storage"),
    network: deviceIdsOf(sensors, "network"),
  } as const;

  for (const binding of DEVICE_BINDINGS) {
    const ids = idsByGroup[binding.group];
    const family = binding.group === "storage" ? "disk" : "network";

    for (const [hardwareId, deviceId] of ids) {
      const key = `${family}.${deviceId}.${binding.quantity}`;

      if (wanted !== undefined && !wanted.has(key)) {
        continue;
      }

      for (const name of binding.anyText) {
        const sensor = sensors.find(
          (candidate) =>
            candidate.hardwareId === hardwareId &&
            candidate.type === binding.type &&
            candidate.text === name &&
            candidate.value !== undefined,
        );

        if (sensor?.value === undefined) {
          continue;
        }

        readings.push({
          key,
          sensor,
          value: scaleDeviceValue(binding.scale, sensor.value),
        });
        break;
      }
    }
  }

  return readings;
}

/** A GPU this machine reports, so a consumer can choose between them. */
interface GpuDeviceReading {
  readonly deviceId: string;
  readonly name: string;
}

export function gpuDeviceReadings(
  sensors: readonly LhmSensor[],
): readonly GpuDeviceReading[] {
  const names = new Map<string, string>();

  for (const sensor of sensors) {
    if (groupOf(sensor.hardwareType, sensor.hardwareId) === "gpu") {
      names.set(sensor.hardwareId, sensor.hardwareType);
    }
  }

  return [...deviceIdsOf(sensors, "gpu")].map(([hardwareId, deviceId]) => ({
    deviceId,
    name: names.get(hardwareId) ?? hardwareId,
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
  readonly freeGb: number;
  readonly usedPercent: number;
}

export function diskDeviceReadings(
  sensors: readonly LhmSensor[],
): readonly DiskDeviceReading[] {
  const ids = deviceIdsOf(sensors, "storage");
  const readings: DiskDeviceReading[] = [];

  for (const [hardwareId, deviceId] of ids) {
    const own = sensors.filter((sensor) => sensor.hardwareId === hardwareId);
    const total = sumNamed(own, "storage", ["Total Space"]);
    const free = sumNamed(own, "storage", ["Free Space"]);

    if (total === undefined || free === undefined || total <= 0) {
      continue;
    }

    const usedGb = total - free;
    readings.push({
      deviceId,
      name: own[0]?.hardwareType ?? "",
      usedGb,
      totalGb: total,
      // Published only beside a used figure: total and free answer both keys.
      freeGb: free,
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
 * — so an unassigned group here is one device's reading, not the
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
        groupOf(sensor.hardwareType, sensor.hardwareId) !== binding.group
      ) {
        continue;
      }

      const match = binding.pattern.exec(sensor.text);
      if (match === null) {
        continue;
      }

      const semanticKey = binding.key(match, sensor);
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

  // Keys that name one device by id answer that device directly.
  for (const reading of deviceReadings(sensors, wanted)) {
    selectReading(chosen, reading.key, reading.sensor, reading.value, false);
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
 * — a caption that changes text every sample cannot be read.
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
  const ids = [...deviceIdsOf(sensors, group).values()];
  if (ids.length === 0) {
    return undefined;
  }

  // With no assignment, the first node the machine reports answers — the same
  // rule the library provider uses, so one caption names one device whichever
  // provider is running. "Busiest" would be wrong here for the reason it is
  // wrong there: the caption would change text every sample.
  return assigned === undefined ? ids[0] : ids.find((id) => id === assigned);
}

/** The device a caption describes, with both the id a saved name uses and the
 * model LHM reports. */
export interface LhmDeviceCaption {
  readonly deviceId: string;
  readonly name: string;
}

/**
 * The device a group's unsuffixed keys describe, or undefined when no single
 * device answers them.
 *
 * The GPU group is scoped to one node either way, so it always has a caption.
 * The storage group is summed across every drive until one is assigned — a
 * legitimate host total, and a total no one drive's name describes.
 */
export function lhmDeviceCaption(
  sensors: readonly LhmSensor[],
  group: "gpu" | "storage",
  assignment: DeviceAssignment,
): LhmDeviceCaption | undefined {
  const deviceId =
    group === "gpu"
      ? nodeFor(sensors, "gpu", assignment.gpu)
      : assignment.systemDisk;

  if (deviceId === undefined) {
    return undefined;
  }

  const ids = deviceIdsOf(sensors, group);

  for (const sensor of sensors) {
    if (
      groupOf(sensor.hardwareType, sensor.hardwareId) === group &&
      ids.get(sensor.hardwareId) === deviceId
    ) {
      return { deviceId, name: sensor.hardwareType };
    }
  }

  return undefined;
}

/** Whether a drive with this id is attached, so a gap can say what is missing. */
export function lhmStorageDeviceExists(
  sensors: readonly LhmSensor[],
  deviceId: string,
): boolean {
  return [...deviceIdsOf(sensors, "storage").values()].includes(deviceId);
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
  const gpuIds = deviceIdsOf(sensors, "gpu");
  const storageIds = deviceIdsOf(sensors, "storage");

  const scoped =
    !gpuWanted && !diskWanted
      ? sensors
      : sensors.filter((sensor) => {
          const group = groupOf(sensor.hardwareType, sensor.hardwareId);

          // Keep everything that is not one of the selected groups.
          if (group === "gpu" && gpuWanted) {
            return (
              gpuId !== undefined && gpuIds.get(sensor.hardwareId) === gpuId
            );
          }
          if (group === "storage" && diskWanted)
            return storageIds.get(sensor.hardwareId) === diskId;
          return true;
        });

  const scopedMatches = matchLhmSensors(scoped, semanticKeys);
  // A key naming a device by id is explicit, so the display's aggregate
  // assignment must not remove another device's reading from it.
  const matched =
    scoped === sensors
      ? scopedMatches
      : [
          ...scopedMatches,
          ...deviceReadings(sensors, new Set(semanticKeys))
            .filter(
              (reading) =>
                !scopedMatches.some(
                  (match) => match.semanticKey === reading.key,
                ),
            )
            .map((reading) => ({
              semanticKey: reading.key,
              sensor: reading.sensor,
              value: reading.value,
            })),
        ];

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
