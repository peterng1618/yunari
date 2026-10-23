/**
 * Canonical semantic-key vocabulary shared by host and editor (§93). Entries
 * define meaning/spelling, not runtime availability; providers report that.
 */

export type SensorTier = "baseline" | "extended";

export type SemanticFamily = string;

/** Picker/display grouping order; a provider may contribute others. */
export const BUILT_IN_FAMILIES: readonly string[] = [
  "cpu",
  "ram",
  "gpu",
  "vram",
  "disk",
  "network",
  // Time is read from the host, like any other reading, so two displays agree
  // and a device with a wrong clock still shows the right time (§116).
  "time",
  "date",
  "cooling",
  "motherboard",
  "battery",
  "psu",
  "system",
  "audio",
  "wifi",
  "weather",
  "media",
  "frame",
  "game",
  "custom",
];

/** The conversion contract; a unit without one is shown as measured. */
export type UnitKind =
  | "percent"
  | "temperature"
  | "clock"
  | "data"
  | "dataRate"
  | "power"
  | "voltage"
  | "current"
  | "rotation"
  | "duration"
  | "speed"
  | "pressure"
  | "count"
  | "text"
  | "boolean";

export type ValueKind = "number" | "text" | "boolean";

export interface SemanticKeyDescriptor {
  readonly key: string;
  readonly family: SemanticFamily;
  readonly label: string;
  readonly unit?: string;
  readonly unitKind?: UnitKind;
  /** Units this key may be displayed in, besides `unit`. */
  readonly displayUnits?: readonly string[];
  readonly valueKind?: ValueKind;
  /** The binding renders an image URL rather than a value. */
  readonly mediaKind?: "image";
  /** Authoring hint, not a claim about this machine. */
  readonly expectedTier: SensorTier;
  /**
   * The family a display's measurement preference converts, when it converts
   * this key. Absent means the reported unit is the only sensible one: a unit
   * preference must not pretend to cover families it cannot (spec 2026-09-24).
   */
  readonly converts?: "temperature";
  /**
   * A time/date reading: the provider's text is an ISO 8601 instant, so the
   * binding's `format` and `timeZone` decide how it reads rather than the
   * provider. Other text keys leave this off and are shown as sent.
   */
  readonly instant?: { readonly defaultFormat: string };
}

const TEMPERATURE_UNITS = ["°C", "°F"] as const;
const CLOCK_UNITS = ["MHz", "GHz"] as const;
const DATA_UNITS = ["MB", "GB", "TB"] as const;
const RATE_UNITS = ["kb/s", "Mb/s", "Gb/s"] as const;

/** `family.quantity[.qualifier]`; availability is discovered separately. */
export const SEMANTIC_KEYS: readonly SemanticKeyDescriptor[] = [
  // CPU
  {
    key: "cpu.load",
    family: "cpu",
    label: "CPU load",
    unit: "%",
    unitKind: "percent",
    expectedTier: "baseline",
  },
  {
    key: "cpu.temp",
    family: "cpu",
    label: "CPU temperature",
    unit: "°C",
    unitKind: "temperature",
    displayUnits: TEMPERATURE_UNITS,
    expectedTier: "extended",
    converts: "temperature",
  },
  {
    key: "cpu.temp.package",
    family: "cpu",
    label: "CPU package temperature",
    unit: "°C",
    unitKind: "temperature",
    displayUnits: TEMPERATURE_UNITS,
    expectedTier: "extended",
    converts: "temperature",
  },
  {
    key: "cpu.temp.core.max",
    family: "cpu",
    label: "CPU hottest core",
    unit: "°C",
    unitKind: "temperature",
    displayUnits: TEMPERATURE_UNITS,
    expectedTier: "extended",
    converts: "temperature",
  },
  {
    key: "cpu.temp.core.avg",
    family: "cpu",
    label: "CPU average core temperature",
    unit: "°C",
    unitKind: "temperature",
    displayUnits: TEMPERATURE_UNITS,
    expectedTier: "extended",
    converts: "temperature",
  },
  {
    key: "cpu.power",
    family: "cpu",
    label: "CPU power",
    unit: "W",
    unitKind: "power",
    expectedTier: "extended",
  },
  {
    key: "cpu.voltage",
    family: "cpu",
    label: "CPU voltage",
    unit: "V",
    unitKind: "voltage",
    expectedTier: "extended",
  },
  {
    key: "cpu.clock",
    family: "cpu",
    label: "CPU clock",
    unit: "MHz",
    unitKind: "clock",
    displayUnits: CLOCK_UNITS,
    expectedTier: "extended",
  },
  {
    key: "cpu.cores.physical",
    family: "cpu",
    label: "CPU physical cores",
    unitKind: "count",
    valueKind: "number",
    expectedTier: "baseline",
  },
  {
    key: "cpu.cores.logical",
    family: "cpu",
    label: "CPU logical cores",
    unitKind: "count",
    valueKind: "number",
    expectedTier: "baseline",
  },
  {
    key: "cpu.fan",
    family: "cpu",
    label: "CPU fan",
    unit: "RPM",
    unitKind: "rotation",
    expectedTier: "extended",
  },
  // Three separate keys, not one: the library reports a manufacturer, a brand
  // and a model that all differ ("Intel" / "Core™ i9-10850K" / "165"), and which
  // one reads best on a card is the theme author's choice.
  {
    key: "cpu.manufacturer",
    family: "cpu",
    label: "CPU manufacturer",
    valueKind: "text",
    expectedTier: "baseline",
  },
  {
    key: "cpu.brand",
    family: "cpu",
    label: "CPU brand",
    valueKind: "text",
    expectedTier: "baseline",
  },
  {
    key: "cpu.model",
    family: "cpu",
    label: "CPU model",
    valueKind: "text",
    expectedTier: "baseline",
  },

  // RAM absolute values and used share.
  {
    key: "ram.used",
    family: "ram",
    label: "RAM used",
    unit: "GB",
    unitKind: "data",
    displayUnits: DATA_UNITS,
    expectedTier: "baseline",
  },
  {
    key: "ram.used.percent",
    family: "ram",
    label: "RAM used (share of total)",
    unit: "%",
    unitKind: "percent",
    expectedTier: "baseline",
  },
  {
    key: "ram.total",
    family: "ram",
    label: "RAM total",
    unit: "GB",
    unitKind: "data",
    displayUnits: DATA_UNITS,
    expectedTier: "baseline",
  },

  // GPU
  {
    key: "gpu.load",
    family: "gpu",
    label: "GPU load",
    unit: "%",
    unitKind: "percent",
    expectedTier: "extended",
  },
  {
    key: "gpu.temp",
    family: "gpu",
    label: "GPU temperature",
    unit: "°C",
    unitKind: "temperature",
    displayUnits: TEMPERATURE_UNITS,
    expectedTier: "extended",
    converts: "temperature",
  },
  {
    key: "gpu.temp.core",
    family: "gpu",
    label: "GPU core temperature",
    unit: "°C",
    unitKind: "temperature",
    displayUnits: TEMPERATURE_UNITS,
    expectedTier: "extended",
    converts: "temperature",
  },
  {
    key: "gpu.temp.hotspot",
    family: "gpu",
    label: "GPU hotspot temperature",
    unit: "°C",
    unitKind: "temperature",
    displayUnits: TEMPERATURE_UNITS,
    expectedTier: "extended",
    converts: "temperature",
  },
  {
    key: "gpu.power",
    family: "gpu",
    label: "GPU power",
    unit: "W",
    unitKind: "power",
    expectedTier: "extended",
  },
  {
    key: "gpu.voltage",
    family: "gpu",
    label: "GPU voltage",
    unit: "V",
    unitKind: "voltage",
    expectedTier: "extended",
  },
  {
    key: "gpu.clock",
    family: "gpu",
    label: "GPU clock",
    unit: "MHz",
    unitKind: "clock",
    displayUnits: CLOCK_UNITS,
    expectedTier: "extended",
  },
  {
    key: "gpu.clock.memory",
    family: "gpu",
    label: "GPU memory clock",
    unit: "MHz",
    unitKind: "clock",
    displayUnits: CLOCK_UNITS,
    expectedTier: "extended",
  },
  {
    key: "gpu.fan",
    family: "gpu",
    label: "GPU fan",
    unit: "RPM",
    unitKind: "rotation",
    expectedTier: "extended",
  },
  // The assigned card's name. A text reading, not a measurement, and resolved
  // by the same device selection that answers the `gpu.*` figures beside it.
  {
    key: "gpu.name",
    family: "gpu",
    label: "GPU model",
    valueKind: "text",
    expectedTier: "baseline",
  },

  // VRAM is a separate family from system RAM.
  {
    key: "vram.used",
    family: "vram",
    label: "VRAM used",
    unit: "GB",
    unitKind: "data",
    displayUnits: DATA_UNITS,
    expectedTier: "extended",
  },
  {
    key: "vram.used.percent",
    family: "vram",
    label: "VRAM used (share of total)",
    unit: "%",
    unitKind: "percent",
    expectedTier: "extended",
  },
  {
    key: "vram.total",
    family: "vram",
    label: "VRAM total",
    unit: "GB",
    unitKind: "data",
    displayUnits: DATA_UNITS,
    expectedTier: "extended",
  },
  {
    key: "vram.temp",
    family: "vram",
    label: "VRAM temperature",
    unit: "°C",
    unitKind: "temperature",
    displayUnits: TEMPERATURE_UNITS,
    expectedTier: "extended",
    converts: "temperature",
  },

  // A clock is read from this PC, like any other reading, and the author decides
  // how it reads: the provider sends the instant, the binding's format and zone
  // render it.
  {
    key: "time.now",
    family: "time",
    label: "Time",
    valueKind: "text",
    expectedTier: "baseline",
    instant: { defaultFormat: "HH:mm" },
  },
  {
    key: "date.today",
    family: "date",
    label: "Date",
    valueKind: "text",
    expectedTier: "baseline",
    instant: { defaultFormat: "DD MMM YYYY" },
  },

  // Declared ahead of their providers so themes/editors share stable names.
  {
    key: "disk.used",
    family: "disk",
    label: "Disk used",
    unit: "GB",
    unitKind: "data",
    displayUnits: DATA_UNITS,
    expectedTier: "baseline",
  },
  // The second disk slot. A theme showing two disks binds one to the system
  // slot and one to this, so neither names a specific drive and the theme works
  // on any machine (§145's device assignments decide which drive answers each).
  {
    key: "disk.data.used",
    family: "disk",
    label: "Data disk used",
    unit: "GB",
    unitKind: "data",
    displayUnits: DATA_UNITS,
    expectedTier: "baseline",
  },
  {
    key: "disk.data.used.percent",
    family: "disk",
    label: "Data disk used (share of total)",
    unit: "%",
    unitKind: "percent",
    expectedTier: "baseline",
  },
  {
    key: "disk.data.total",
    family: "disk",
    label: "Data disk total",
    unit: "GB",
    unitKind: "data",
    displayUnits: DATA_UNITS,
    expectedTier: "baseline",
  },
  {
    key: "disk.used.percent",
    family: "disk",
    label: "Disk used (share of total)",
    unit: "%",
    unitKind: "percent",
    expectedTier: "baseline",
  },
  {
    key: "disk.total",
    family: "disk",
    label: "Disk total",
    unit: "GB",
    unitKind: "data",
    displayUnits: DATA_UNITS,
    expectedTier: "baseline",
  },
  // The selected volume's name, from the same selection that answers the
  // unsuffixed disk keys. It is a gap whenever those keys describe every
  // volume at once, because no one volume's name describes a sum.
  {
    key: "disk.name",
    family: "disk",
    label: "Volume name",
    valueKind: "text",
    expectedTier: "baseline",
  },
  {
    key: "network.download",
    family: "network",
    label: "Network download",
    unit: "Mb/s",
    unitKind: "dataRate",
    displayUnits: RATE_UNITS,
    expectedTier: "baseline",
  },
  {
    key: "network.upload",
    family: "network",
    label: "Network upload",
    unit: "Mb/s",
    unitKind: "dataRate",
    displayUnits: RATE_UNITS,
    expectedTier: "baseline",
  },

  // Cooling (an AIO or cooler); per-device fans and pumps are dynamic.
  {
    key: "cooling.temp",
    family: "cooling",
    label: "Coolant temperature",
    unit: "°C",
    unitKind: "temperature",
    displayUnits: TEMPERATURE_UNITS,
    expectedTier: "extended",
    converts: "temperature",
  },

  // Motherboard; per-device fans and voltages are dynamic.
  {
    key: "motherboard.temp",
    family: "motherboard",
    label: "Motherboard temperature",
    unit: "°C",
    unitKind: "temperature",
    displayUnits: TEMPERATURE_UNITS,
    expectedTier: "extended",
    converts: "temperature",
  },
  {
    key: "chipset.temp",
    family: "motherboard",
    label: "Chipset temperature",
    unit: "°C",
    unitKind: "temperature",
    displayUnits: TEMPERATURE_UNITS,
    expectedTier: "extended",
    converts: "temperature",
  },
  {
    key: "vrm.temp",
    family: "motherboard",
    label: "VRM temperature",
    unit: "°C",
    unitKind: "temperature",
    displayUnits: TEMPERATURE_UNITS,
    expectedTier: "extended",
    converts: "temperature",
  },

  // Battery
  {
    key: "battery.level",
    family: "battery",
    label: "Battery level",
    unit: "%",
    unitKind: "percent",
    expectedTier: "baseline",
  },
  {
    key: "battery.state",
    family: "battery",
    label: "Battery state",
    valueKind: "text",
    expectedTier: "baseline",
  },
  {
    key: "battery.charging",
    family: "battery",
    label: "Battery charging",
    valueKind: "boolean",
    expectedTier: "baseline",
  },
  {
    key: "battery.timeRemaining",
    family: "battery",
    label: "Battery time remaining",
    unit: "s",
    unitKind: "duration",
    expectedTier: "baseline",
  },
  {
    key: "battery.rate",
    family: "battery",
    label: "Battery rate",
    unit: "W",
    unitKind: "power",
    expectedTier: "baseline",
  },
  {
    key: "battery.voltage",
    family: "battery",
    label: "Battery voltage",
    unit: "V",
    unitKind: "voltage",
    expectedTier: "baseline",
  },
  {
    key: "battery.health",
    family: "battery",
    label: "Battery health",
    unit: "%",
    unitKind: "percent",
    expectedTier: "baseline",
  },
  {
    key: "battery.ac",
    family: "battery",
    label: "Battery on AC",
    valueKind: "boolean",
    expectedTier: "baseline",
  },

  // PSU; per-rail voltages are dynamic.
  {
    key: "psu.power",
    family: "psu",
    label: "PSU power",
    unit: "W",
    unitKind: "power",
    expectedTier: "extended",
  },
  {
    key: "psu.temp",
    family: "psu",
    label: "PSU temperature",
    unit: "°C",
    unitKind: "temperature",
    displayUnits: TEMPERATURE_UNITS,
    expectedTier: "extended",
    converts: "temperature",
  },
  {
    key: "psu.fan",
    family: "psu",
    label: "PSU fan",
    unit: "RPM",
    unitKind: "rotation",
    expectedTier: "extended",
  },

  // System
  {
    key: "system.uptime",
    family: "system",
    label: "Uptime",
    unit: "s",
    unitKind: "duration",
    expectedTier: "baseline",
  },
  {
    key: "system.processes",
    family: "system",
    label: "Process count",
    unitKind: "count",
    valueKind: "number",
    expectedTier: "baseline",
  },
  {
    key: "system.hostname",
    family: "system",
    label: "Host name",
    valueKind: "text",
    expectedTier: "baseline",
  },
  {
    key: "system.os",
    family: "system",
    label: "Operating system",
    valueKind: "text",
    expectedTier: "baseline",
  },
  {
    key: "system.osBuild",
    family: "system",
    label: "OS build",
    valueKind: "text",
    expectedTier: "baseline",
  },

  // Audio
  {
    key: "audio.volume",
    family: "audio",
    label: "Volume",
    unit: "%",
    unitKind: "percent",
    expectedTier: "baseline",
  },
  {
    key: "audio.muted",
    family: "audio",
    label: "Muted",
    valueKind: "boolean",
    expectedTier: "baseline",
  },

  // Wi-Fi
  {
    key: "wifi.ssid",
    family: "wifi",
    label: "Wi-Fi network",
    valueKind: "text",
    expectedTier: "baseline",
  },
  {
    key: "wifi.signal",
    family: "wifi",
    label: "Wi-Fi signal",
    unit: "%",
    unitKind: "percent",
    expectedTier: "baseline",
  },
  {
    key: "wifi.linkSpeed",
    family: "wifi",
    label: "Wi-Fi link speed",
    unit: "Mb/s",
    unitKind: "dataRate",
    displayUnits: RATE_UNITS,
    expectedTier: "baseline",
  },

  // Weather
  {
    key: "weather.location",
    family: "weather",
    label: "Weather location",
    valueKind: "text",
    expectedTier: "baseline",
  },
  {
    key: "weather.temp",
    family: "weather",
    label: "Temperature",
    unit: "°C",
    unitKind: "temperature",
    displayUnits: TEMPERATURE_UNITS,
    expectedTier: "baseline",
    converts: "temperature",
  },
  {
    key: "weather.feelsLike",
    family: "weather",
    label: "Feels like",
    unit: "°C",
    unitKind: "temperature",
    displayUnits: TEMPERATURE_UNITS,
    expectedTier: "baseline",
    converts: "temperature",
  },
  {
    key: "weather.high",
    family: "weather",
    label: "Daily high",
    unit: "°C",
    unitKind: "temperature",
    displayUnits: TEMPERATURE_UNITS,
    expectedTier: "baseline",
    converts: "temperature",
  },
  {
    key: "weather.low",
    family: "weather",
    label: "Daily low",
    unit: "°C",
    unitKind: "temperature",
    displayUnits: TEMPERATURE_UNITS,
    expectedTier: "baseline",
    converts: "temperature",
  },
  {
    key: "weather.conditionCode",
    family: "weather",
    label: "Condition code",
    unitKind: "count",
    valueKind: "number",
    expectedTier: "baseline",
  },
  {
    key: "weather.condition",
    family: "weather",
    label: "Condition",
    valueKind: "text",
    expectedTier: "baseline",
  },
  {
    key: "weather.icon",
    family: "weather",
    label: "Condition icon",
    valueKind: "text",
    mediaKind: "image",
    expectedTier: "baseline",
  },
  {
    key: "weather.humidity",
    family: "weather",
    label: "Humidity",
    unit: "%",
    unitKind: "percent",
    expectedTier: "baseline",
  },
  {
    key: "weather.windSpeed",
    family: "weather",
    label: "Wind speed",
    unit: "km/h",
    unitKind: "speed",
    displayUnits: ["km/h", "mph", "m/s"],
    expectedTier: "baseline",
  },
  {
    key: "weather.windDirection",
    family: "weather",
    label: "Wind direction",
    unit: "°",
    unitKind: "count",
    expectedTier: "baseline",
  },
  {
    key: "weather.windDirection.compass",
    family: "weather",
    label: "Wind direction (compass)",
    valueKind: "text",
    expectedTier: "baseline",
  },
  {
    key: "weather.pressure",
    family: "weather",
    label: "Pressure",
    unit: "hPa",
    unitKind: "pressure",
    displayUnits: ["hPa", "inHg"],
    expectedTier: "baseline",
  },
  {
    key: "weather.precipitation",
    family: "weather",
    label: "Precipitation",
    unit: "mm",
    unitKind: "count",
    expectedTier: "baseline",
  },
  {
    key: "weather.isDay",
    family: "weather",
    label: "Daylight",
    valueKind: "boolean",
    expectedTier: "baseline",
  },
  {
    key: "weather.sunrise",
    family: "weather",
    label: "Sunrise",
    valueKind: "text",
    expectedTier: "baseline",
  },
  {
    key: "weather.sunset",
    family: "weather",
    label: "Sunset",
    valueKind: "text",
    expectedTier: "baseline",
  },
  {
    key: "weather.attribution",
    family: "weather",
    label: "Weather attribution",
    valueKind: "text",
    expectedTier: "baseline",
  },

  // Media
  {
    key: "media.title",
    family: "media",
    label: "Title",
    valueKind: "text",
    expectedTier: "baseline",
  },
  {
    key: "media.artist",
    family: "media",
    label: "Artist",
    valueKind: "text",
    expectedTier: "baseline",
  },
  {
    key: "media.album",
    family: "media",
    label: "Album",
    valueKind: "text",
    expectedTier: "baseline",
  },
  {
    key: "media.artwork",
    family: "media",
    label: "Artwork",
    valueKind: "text",
    mediaKind: "image",
    expectedTier: "baseline",
  },
  {
    key: "media.state",
    family: "media",
    label: "Playback state",
    valueKind: "text",
    expectedTier: "baseline",
  },
  {
    key: "media.position",
    family: "media",
    label: "Playback position",
    unit: "s",
    unitKind: "duration",
    expectedTier: "baseline",
  },
  {
    key: "media.duration",
    family: "media",
    label: "Track duration",
    unit: "s",
    unitKind: "duration",
    expectedTier: "baseline",
  },
  {
    key: "media.app",
    family: "media",
    label: "Media app",
    valueKind: "text",
    expectedTier: "baseline",
  },

  // Frame timing
  {
    key: "fps.current",
    family: "frame",
    label: "FPS",
    unit: "fps",
    unitKind: "count",
    expectedTier: "extended",
  },
  {
    key: "frametime.current",
    family: "frame",
    label: "Frame time",
    unit: "ms",
    unitKind: "duration",
    expectedTier: "extended",
  },
  {
    key: "fps.low1",
    family: "frame",
    label: "1% low FPS",
    unit: "fps",
    unitKind: "count",
    expectedTier: "extended",
  },
  {
    key: "frame.app",
    family: "frame",
    label: "Game process",
    valueKind: "text",
    expectedTier: "extended",
  },

  // Game
  {
    key: "game.name",
    family: "game",
    label: "Game name",
    valueKind: "text",
    expectedTier: "extended",
  },
  {
    key: "game.artwork",
    family: "game",
    label: "Game artwork",
    valueKind: "text",
    mediaKind: "image",
    expectedTier: "extended",
  },
  {
    key: "game.running",
    family: "game",
    label: "Game running",
    valueKind: "boolean",
    expectedTier: "extended",
  },
  {
    key: "game.app",
    family: "game",
    label: "Game process",
    valueKind: "text",
    expectedTier: "extended",
  },
];

const BY_KEY = new Map(
  SEMANTIC_KEYS.map((descriptor) => [descriptor.key, descriptor]),
);

/**
 * A per-device disk key, e.g. `disk.nvme0.used`, `disk.volume-c.used.percent`.
 * A machine's drives are discovered at runtime, so these cannot be enumerated
 * in `SEMANTIC_KEYS`; the shape is still fixed, which is what themes and the
 * editor bind against. `<id>` is the device's own stable name, slugged.
 */
export interface DiskKeyDescriptor extends SemanticKeyDescriptor {
  readonly deviceId: string;
}

export const DISK_DEVICE_QUANTITIES = [
  "used",
  "used.percent",
  "total",
  "free",
  "temp",
  "health",
  "read",
  "write",
  "activity",
] as const;

export type DiskDeviceQuantity = (typeof DISK_DEVICE_QUANTITIES)[number];

const DISK_QUANTITY_LABEL = {
  used: { text: "used", unit: "GB", unitKind: "data" },
  "used.percent": { text: "used (share)", unit: "%", unitKind: "percent" },
  total: { text: "total", unit: "GB", unitKind: "data" },
  free: { text: "free", unit: "GB", unitKind: "data" },
  temp: { text: "temperature", unit: "°C", unitKind: "temperature" },
  health: { text: "health", unit: "%", unitKind: "percent" },
  read: { text: "read rate", unit: "MB/s", unitKind: "dataRate" },
  write: { text: "write rate", unit: "MB/s", unitKind: "dataRate" },
  activity: { text: "activity", unit: "%", unitKind: "percent" },
} as const satisfies Record<
  DiskDeviceQuantity,
  { readonly text: string; readonly unit: string; readonly unitKind: UnitKind }
>;

/** `<id>` is a slug: lowercase, hyphen-separated, at most 64 characters. */
const SLUG = "([a-z0-9][a-z0-9-]{0,63})";

const DISK_KEY_PATTERN = new RegExp(
  `^disk\\.${SLUG}\\.(${Object.keys(DISK_QUANTITY_LABEL).join("|")})$`,
);

/** The device id a per-device key names, or undefined for any other key. */
export function diskDeviceOf(key: string): string | undefined {
  return DISK_KEY_PATTERN.exec(key)?.[1];
}

/** Slug for a device's model/name so it can appear in a semantic key. */
export function semanticId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/** Builds the vocabulary descriptor for a discovered disk key. */
export function describeDiskKey(
  key: string,
  deviceName?: string,
): DiskKeyDescriptor | undefined {
  const match = DISK_KEY_PATTERN.exec(key);
  if (match === null) {
    return undefined;
  }

  const deviceId = match[1]!;
  const quantity = match[2] as DiskDeviceQuantity;
  const quantityLabel = DISK_QUANTITY_LABEL[quantity];

  return {
    key,
    family: "disk",
    deviceId,
    label: `${deviceName ?? deviceId} ${quantityLabel.text}`,
    unit: quantityLabel.unit,
    unitKind: quantityLabel.unitKind,
    expectedTier: "baseline",
    ...(quantity === "temp" ? { converts: "temperature" as const } : {}),
  };
}

interface DynamicKeyBody {
  readonly family: SemanticFamily;
  readonly label: string;
  readonly unit?: string;
  readonly unitKind?: UnitKind;
  readonly displayUnits?: readonly string[];
  readonly valueKind?: ValueKind;
  readonly mediaKind?: "image";
  readonly expectedTier: SensorTier;
  readonly converts?: "temperature";
}

interface DynamicKeyShape {
  readonly pattern: RegExp;
  readonly describe: (match: RegExpExecArray) => DynamicKeyBody;
}

/** Keys whose device identity is discovered at runtime. */
const DYNAMIC_KEY_SHAPES: readonly DynamicKeyShape[] = [
  {
    pattern: /^cpu\.core\.([1-9]\d*)\.(load|temp|clock)$/,
    describe: (match) => {
      const core = match[1]!;

      switch (match[2]) {
        case "load":
          return {
            family: "cpu",
            label: `CPU core ${core} load`,
            unit: "%",
            unitKind: "percent",
            expectedTier: "extended",
          };
        case "temp":
          return {
            family: "cpu",
            label: `CPU core ${core} temperature`,
            unit: "°C",
            unitKind: "temperature",
            displayUnits: TEMPERATURE_UNITS,
            expectedTier: "extended",
            converts: "temperature",
          };
        default:
          return {
            family: "cpu",
            label: `CPU core ${core} clock`,
            unit: "MHz",
            unitKind: "clock",
            displayUnits: CLOCK_UNITS,
            expectedTier: "extended",
          };
      }
    },
  },
  {
    pattern: new RegExp(`^cooling\\.fan\\.${SLUG}\\.(rpm|percent)$`),
    describe: (match) => ({
      family: "cooling",
      label: `Cooling fan ${match[1]} ${match[2] === "rpm" ? "speed" : "control"}`,
      unit: match[2] === "rpm" ? "RPM" : "%",
      unitKind: match[2] === "rpm" ? "rotation" : "percent",
      expectedTier: "extended",
    }),
  },
  {
    pattern: new RegExp(`^cooling\\.pump\\.${SLUG}\\.rpm$`),
    describe: (match) => ({
      family: "cooling",
      label: `Cooling pump ${match[1]} speed`,
      unit: "RPM",
      unitKind: "rotation",
      expectedTier: "extended",
    }),
  },
  {
    pattern: new RegExp(`^motherboard\\.fan\\.${SLUG}\\.(rpm|percent)$`),
    describe: (match) => ({
      family: "motherboard",
      label: `Motherboard fan ${match[1]} ${match[2] === "rpm" ? "speed" : "control"}`,
      unit: match[2] === "rpm" ? "RPM" : "%",
      unitKind: match[2] === "rpm" ? "rotation" : "percent",
      expectedTier: "extended",
    }),
  },
  {
    pattern: new RegExp(`^motherboard\\.voltage\\.${SLUG}$`),
    describe: (match) => ({
      family: "motherboard",
      label: `Motherboard voltage ${match[1]}`,
      unit: "V",
      unitKind: "voltage",
      expectedTier: "extended",
    }),
  },
  {
    pattern: /^gpu\.fan\.([1-9]\d*)$/,
    describe: (match) => ({
      family: "gpu",
      label: `GPU fan ${match[1]}`,
      unit: "RPM",
      unitKind: "rotation",
      expectedTier: "extended",
    }),
  },
  {
    pattern: DISK_KEY_PATTERN,
    describe: (match) => {
      const deviceId = match[1]!;
      const quantity = match[2] as DiskDeviceQuantity;
      const quantityLabel = DISK_QUANTITY_LABEL[quantity];

      return {
        family: "disk",
        label: `${deviceId} ${quantityLabel.text}`,
        unit: quantityLabel.unit,
        unitKind: quantityLabel.unitKind,
        expectedTier: "baseline",
        ...(quantity === "temp" ? { converts: "temperature" as const } : {}),
      };
    },
  },
  {
    pattern: new RegExp(`^network\\.${SLUG}\\.(download|upload)$`),
    describe: (match) => ({
      family: "network",
      label: `Network ${match[1]} ${match[2]}`,
      unit: "Mb/s",
      unitKind: "dataRate",
      displayUnits: RATE_UNITS,
      expectedTier: "baseline",
    }),
  },
  {
    pattern: new RegExp(`^psu\\.voltage\\.${SLUG}$`),
    describe: (match) => ({
      family: "psu",
      label: `PSU voltage ${match[1]}`,
      unit: "V",
      unitKind: "voltage",
      expectedTier: "extended",
    }),
  },
  {
    pattern:
      /^custom\.([a-z0-9][a-z0-9-]{0,63})\.([A-Za-z0-9][A-Za-z0-9_-]{0,63})$/,
    describe: (match) => ({
      family: "custom",
      label: `${match[1]} ${match[2]}`,
      valueKind: "number",
      expectedTier: "extended",
    }),
  },
];

/**
 * Resolves a built-in key or a runtime-discovered key. Unknown keys remain
 * valid for newer/custom sensors; callers can fall back to the raw key.
 */
export function describeDynamicKey(
  key: string,
): SemanticKeyDescriptor | undefined {
  const builtIn = BY_KEY.get(key);
  if (builtIn !== undefined) {
    return builtIn;
  }

  for (const shape of DYNAMIC_KEY_SHAPES) {
    const match = shape.pattern.exec(key);
    if (match !== null) {
      return { key, ...shape.describe(match) };
    }
  }

  return undefined;
}

export function describeSemanticKey(
  key: string,
): SemanticKeyDescriptor | undefined {
  return describeDynamicKey(key);
}

export function isKnownSemanticKey(key: string): boolean {
  return describeDynamicKey(key) !== undefined;
}

/** Preserve unknown-key information by showing the raw key. */
export function labelForSemanticKey(key: string): string {
  return BY_KEY.get(key)?.label ?? key;
}

/** Groups any descriptor list by family, keeping the order it was given. */
export function groupDescriptorsByFamily(
  descriptors: readonly SemanticKeyDescriptor[],
): ReadonlyMap<string, readonly SemanticKeyDescriptor[]> {
  const grouped = new Map<string, SemanticKeyDescriptor[]>();

  for (const descriptor of descriptors) {
    const existing = grouped.get(descriptor.family);

    if (existing === undefined) {
      grouped.set(descriptor.family, [descriptor]);
    } else {
      existing.push(descriptor);
    }
  }

  return grouped;
}

export function semanticKeysByFamily(): ReadonlyMap<
  SemanticFamily,
  readonly SemanticKeyDescriptor[]
> {
  return groupDescriptorsByFamily(SEMANTIC_KEYS);
}
