import {
  describeSemanticKey,
  type SemanticKeyDescriptor,
} from "../data/semantic-keys.js";

/**
 * A consumer's unit preferences, applied when a value is displayed.
 *
 * Conversion happens here and never in the sample: a provider reports what it
 * measured, and a display derives the form the consumer reads. Storing a
 * converted value would put a derived number where a measurement belongs
 * (§97, and product goal 5).
 */

export type MeasurementSystem = "metric" | "imperial";

export const MEASUREMENT_SYSTEMS = ["metric", "imperial"] as const;

export const DEFAULT_MEASUREMENT_SYSTEM: MeasurementSystem = "metric";

/** Whether a stored preference names a system this build can display. */
export function isMeasurementSystem(
  value: unknown,
): value is MeasurementSystem {
  return (MEASUREMENT_SYSTEMS as readonly unknown[]).includes(value);
}

/**
 * The consumer's display choices. `measurement` stays the temperature owner;
 * every other field governs one family, and absent fields fall back to
 * `DEFAULT_UNIT_PREFERENCES`.
 */
export interface UnitPreferences {
  readonly measurement?: MeasurementSystem;
  readonly clock?: "mhz" | "ghz" | "auto";
  /** Binary keeps the stored 2^30 figure; decimal converts it to 10^9. */
  readonly data?: "binary" | "decimal";
  readonly dataScale?: "auto" | "mb" | "gb" | "tb";
  readonly rate?: "bits" | "bytes";
  readonly rateScale?: "auto" | "k" | "m" | "g";
  readonly windSpeed?: "kmh" | "mph" | "ms";
  readonly pressure?: "hpa" | "inhg";
}

export const DEFAULT_UNIT_PREFERENCES: Required<UnitPreferences> = {
  measurement: DEFAULT_MEASUREMENT_SYSTEM,
  clock: "auto",
  data: "binary",
  dataScale: "auto",
  rate: "bits",
  rateScale: "auto",
  windSpeed: "kmh",
  pressure: "hpa",
};

const PREFERENCE_VALUES = {
  measurement: MEASUREMENT_SYSTEMS,
  clock: ["mhz", "ghz", "auto"],
  data: ["binary", "decimal"],
  dataScale: ["auto", "mb", "gb", "tb"],
  rate: ["bits", "bytes"],
  rateScale: ["auto", "k", "m", "g"],
  windSpeed: ["kmh", "mph", "ms"],
  pressure: ["hpa", "inhg"],
} as const satisfies Record<keyof UnitPreferences, readonly string[]>;

/**
 * Keeps the preferences this build can display and nothing else. A value it
 * cannot is refused rather than stored, so a consumer is never left with a
 * setting that appears to do nothing.
 */
export function normalizeUnitPreferences(input: unknown): UnitPreferences {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return {};
  }

  const normalized: Record<string, unknown> = {};

  for (const [field, value] of Object.entries(input)) {
    // A `fan` preference existed before RPM was ruled unconvertible. It is
    // ignored rather than refused, so an old display.json keeps its other units.
    if (field === "fan") {
      continue;
    }

    const allowed = PREFERENCE_VALUES[field as keyof typeof PREFERENCE_VALUES];

    if (allowed === undefined) {
      throw new Error(`"${field}" is not a unit preference.`);
    }

    // An emptied field is a form with nothing chosen, not a third value.
    if (value === "") {
      continue;
    }

    if (!(allowed as readonly unknown[]).includes(value)) {
      throw new Error(
        `"${String(value)}" is not a value for the "${field}" unit preference.`,
      );
    }

    normalized[field] = value;
  }

  return normalized as UnitPreferences;
}

export interface ConvertedValue {
  readonly value: number;
  /** The symbol for the converted form; unchanged when nothing converted. */
  readonly unit: string | undefined;
  /**
   * The precision the chosen unit implies, when it implies one. An authored
   * `precision` wins; this only fills in when the author left it out.
   */
  readonly precision?: number;
}

/** An author's per-binding request, which wins over the display preference. */
export interface UnitOverrides {
  readonly unit?: string;
  readonly autoScale?: boolean;
}

const BYTES_PER_GIB = 2 ** 30;
const INHG_IN_HPA = 33.8638866667;
const MPH_PER_KMH = 0.621371192237334;

/** Whether a key can be shown in the requested unit at all. */
function isDisplayableUnit(
  displayUnits: readonly string[] | undefined,
  unit: string | undefined,
  target: string,
): boolean {
  return unit === target || displayUnits?.includes(target) === true;
}

/**
 * The value and unit a display shows for one sample.
 *
 * Conversion runs once, at presentation, after the binding's authored
 * scale/offset. A unit that does not match the key's canonical unit is left as
 * measured rather than guessed at.
 *
 * `descriptor` is the descriptor that supplied the key, when a caller has one:
 * a custom source's unit and `unitKind` live on the provider's descriptor, not
 * on the vocabulary's generic `custom.*` shape. One conversion still runs.
 */
export function convertForDisplay(
  semanticKey: string,
  value: number,
  unit: string | undefined,
  preferences: UnitPreferences,
  overrides: UnitOverrides = {},
  descriptor?: SemanticKeyDescriptor,
): ConvertedValue & { readonly unsupportedUnit?: true } {
  const resolved = descriptor ?? describeSemanticKey(semanticKey);

  if (overrides.unit !== undefined) {
    if (resolved === undefined) {
      return { value, unit, unsupportedUnit: true };
    }

    // A descriptor that declares no alternative units (a custom source's) is
    // proved by the conversion itself, below.
    if (
      resolved.displayUnits !== undefined &&
      !isDisplayableUnit(resolved.displayUnits, resolved.unit, overrides.unit)
    ) {
      // A plan-time issue, never a crash: the reading is still shown.
      return { value, unit, unsupportedUnit: true };
    }
  }

  if (resolved === undefined) {
    return { value, unit };
  }

  /** An undeclared target the kind could not reach is still unsupported. */
  const finish = (converted: ConvertedValue) =>
    overrides.unit !== undefined &&
    resolved.displayUnits === undefined &&
    converted.unit !== overrides.unit
      ? // The preference converted on the way; the measured form is what a
        // refused target leaves, the same as the early return above.
        { value, unit, unsupportedUnit: true as const }
      : converted;

  switch (resolved.unitKind) {
    case "temperature":
      return finish(convertTemperature(value, unit, preferences, overrides));
    case "clock":
      return finish(convertClock(value, unit, preferences, overrides));
    case "data":
      return finish(convertData(value, unit, preferences, overrides));
    case "dataRate":
      return finish(convertRate(value, unit, preferences, overrides));
    case "speed":
      return finish(convertWindSpeed(value, unit, preferences, overrides));
    case "pressure":
      return finish(convertPressure(value, unit, preferences, overrides));
    default:
      // Rotation and percent included: RPM is never guessed into a percentage.
      return finish({ value, unit });
  }
}

/** °F is a scale and an offset, so this is not a ratio like a byte unit. */
function toFahrenheit(celsius: number): number {
  return celsius * 1.8 + 32;
}

function convertTemperature(
  value: number,
  unit: string | undefined,
  preferences: UnitPreferences,
  overrides: UnitOverrides,
): ConvertedValue {
  if (unit !== "°C") {
    return { value, unit };
  }

  const system =
    overrides.unit === "°F"
      ? "imperial"
      : overrides.unit === "°C"
        ? "metric"
        : (preferences.measurement ?? DEFAULT_MEASUREMENT_SYSTEM);

  return system === "imperial"
    ? { value: toFahrenheit(value), unit: "°F" }
    : { value, unit };
}

function convertClock(
  value: number,
  unit: string | undefined,
  preferences: UnitPreferences,
  overrides: UnitOverrides,
): ConvertedValue {
  if (unit !== "MHz") {
    return { value, unit };
  }

  const target =
    overrides.unit === "GHz"
      ? "ghz"
      : overrides.unit === "MHz"
        ? "mhz"
        : overrides.autoScale === true
          ? "auto"
          : (preferences.clock ?? DEFAULT_UNIT_PREFERENCES.clock);

  if (target === "ghz" || (target === "auto" && value >= 1000)) {
    return gigahertz(value);
  }

  return { value, unit };
}

/**
 * GHz reads with two decimals below 10 GHz and one above; the value itself is
 * never rounded, so an authored precision can still take more decimals.
 */
function gigahertz(megahertz: number): ConvertedValue {
  const value = megahertz / 1000;
  return { value, unit: "GHz", precision: value < 10 ? 2 : 1 };
}

interface DataUnit {
  readonly bytesPerUnit: number;
  readonly label: string;
}

function dataUnitFor(label: string, decimal: boolean): DataUnit | undefined {
  switch (label) {
    case "MB":
      return { bytesPerUnit: decimal ? 1e6 : 2 ** 20, label };
    case "MiB":
      return { bytesPerUnit: 2 ** 20, label };
    case "GB":
      return { bytesPerUnit: decimal ? 1e9 : BYTES_PER_GIB, label };
    case "GiB":
      return { bytesPerUnit: BYTES_PER_GIB, label };
    case "TB":
      return { bytesPerUnit: decimal ? 1e12 : 2 ** 40, label };
    case "TiB":
      return { bytesPerUnit: 2 ** 40, label };
    default:
      return undefined;
  }
}

function convertData(
  value: number,
  unit: string | undefined,
  preferences: UnitPreferences,
  overrides: UnitOverrides,
): ConvertedValue {
  if (unit !== "GB") {
    return { value, unit };
  }

  const decimal =
    (preferences.data ?? DEFAULT_UNIT_PREFERENCES.data) === "decimal";
  const bytes = value * BYTES_PER_GIB;

  if (overrides.unit !== undefined) {
    const target = dataUnitFor(overrides.unit, decimal);
    return target === undefined
      ? { value, unit }
      : { value: bytes / target.bytesPerUnit, unit: target.label };
  }

  const scale =
    overrides.autoScale === true
      ? "auto"
      : (preferences.dataScale ?? DEFAULT_UNIT_PREFERENCES.dataScale);

  let label: string;
  if (scale === "auto") {
    // Binary crosses at 1024, decimal at 1000: the stored figure is 2^30-based.
    const megabyte = decimal ? 1e9 : BYTES_PER_GIB;
    const gigabyte = decimal ? 1e12 : 2 ** 40;
    label = bytes < megabyte ? "MB" : bytes < gigabyte ? "GB" : "TB";
  } else {
    label = scale === "mb" ? "MB" : scale === "gb" ? "GB" : "TB";
  }

  const target = dataUnitFor(label, decimal);
  return target === undefined
    ? { value, unit }
    : { value: bytes / target.bytesPerUnit, unit: target.label };
}

interface RateTarget {
  readonly bytes: boolean;
  readonly scale: "auto" | "k" | "m" | "g";
}

function rateTarget(
  unit: "Mb/s" | "MB/s",
  preferences: UnitPreferences,
  overrides: UnitOverrides,
): RateTarget {
  const explicit = overrides.unit;

  if (explicit !== undefined) {
    // `kb/s` is bits, `kB/s` is bytes; the leading letter is the magnitude.
    const scale = explicit.startsWith("k")
      ? "k"
      : explicit.startsWith("M")
        ? "m"
        : "g";
    return { bytes: explicit[1] === "B", scale };
  }

  return {
    // A byte-native family (disk throughput) stays in bytes; `rate` chooses the
    // form of a bit-native one (network link speed), not the other way round.
    bytes:
      unit === "MB/s" ||
      (preferences.rate ?? DEFAULT_UNIT_PREFERENCES.rate) === "bytes",
    scale:
      overrides.autoScale === true
        ? "auto"
        : (preferences.rateScale ?? DEFAULT_UNIT_PREFERENCES.rateScale),
  };
}

function convertRate(
  value: number,
  unit: string | undefined,
  preferences: UnitPreferences,
  overrides: UnitOverrides,
): ConvertedValue {
  if (unit !== "Mb/s" && unit !== "MB/s") {
    return { value, unit };
  }

  // Canonical rates are decimal bits or bytes per second, whichever the family
  // reports; bring both to bits so one scale rule can govern them.
  const bits = unit === "MB/s" ? value * 8 : value;
  const target = rateTarget(unit, preferences, overrides);
  const magnitude = target.bytes ? bits / 8 : bits;
  const chosen =
    target.scale === "auto"
      ? magnitude < 1
        ? "k"
        : magnitude < 1000
          ? "m"
          : "g"
      : target.scale;
  const shown =
    chosen === "m"
      ? magnitude
      : chosen === "k"
        ? magnitude * 1000
        : magnitude / 1000;
  const prefix = chosen === "k" ? "k" : chosen === "m" ? "M" : "G";

  return { value: shown, unit: `${prefix}${target.bytes ? "B" : "b"}/s` };
}

function convertWindSpeed(
  value: number,
  unit: string | undefined,
  preferences: UnitPreferences,
  overrides: UnitOverrides,
): ConvertedValue {
  if (unit !== "km/h") {
    return { value, unit };
  }

  const target =
    overrides.unit === "mph"
      ? "mph"
      : overrides.unit === "m/s"
        ? "ms"
        : overrides.unit === "km/h"
          ? "kmh"
          : (preferences.windSpeed ?? DEFAULT_UNIT_PREFERENCES.windSpeed);

  switch (target) {
    case "mph":
      return { value: value * MPH_PER_KMH, unit: "mph" };
    case "ms":
      return { value: value / 3.6, unit: "m/s" };
    default:
      return { value, unit };
  }
}

function convertPressure(
  value: number,
  unit: string | undefined,
  preferences: UnitPreferences,
  overrides: UnitOverrides,
): ConvertedValue {
  if (unit !== "hPa") {
    return { value, unit };
  }

  const target =
    overrides.unit === "inHg"
      ? "inhg"
      : overrides.unit === "hPa"
        ? "hpa"
        : (preferences.pressure ?? DEFAULT_UNIT_PREFERENCES.pressure);

  return target === "inhg"
    ? { value: value / INHG_IN_HPA, unit: "inHg" }
    : { value, unit };
}
