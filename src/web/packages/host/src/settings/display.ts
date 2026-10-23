import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  isMeasurementSystem,
  isTimeZoneName,
  type MeasurementSystem,
  normalizeUnitPreferences,
  type UnitPreferences,
} from "@yunari/renderer-core";

/**
 * How this PC's readings are displayed, where the choice is the consumer's
 * rather than the author's.
 *
 * The split matters: a theme decides how a clock *reads* (its tokens, and any
 * zone it pins to show another city), while which zone this PC's time is shown
 * in is a fact about the person reading it. A display never re-converts, so the
 * zone is applied where the reading is acquired (§116) and every screen then
 * agrees; the measurement system instead converts at presentation, because a
 * sample must stay what the provider measured (§97).
 */

export interface DisplaySettings {
  /** A zone name `Intl` resolves. Absent means this PC's own zone. */
  readonly timeZone?: string;
  /** Absent means metric, the unit providers report in. */
  readonly measurement?: MeasurementSystem;
  /** The consumer's per-family display units; absent means each family's own
   *  default. */
  readonly units?: UnitPreferences;
}

export const EMPTY_DISPLAY_SETTINGS: DisplaySettings = {};

export interface DisplaySettingsStore {
  read(): Promise<DisplaySettings>;
  write(input: unknown): Promise<DisplaySettings>;
}

const FILE = "display.json";

/**
 * Keeps a zone this runtime can resolve and a system it can display, and
 * nothing else. A value it cannot is refused rather than stored: the reading
 * would otherwise silently fall back and a consumer would be left with a
 * setting that appears to do nothing.
 */
export function normalizeDisplaySettings(input: unknown): DisplaySettings {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return EMPTY_DISPLAY_SETTINGS;
  }

  const record = input as Record<string, unknown>;
  const settings: {
    timeZone?: string;
    measurement?: MeasurementSystem;
    units?: UnitPreferences;
  } = {};

  const zone = record["timeZone"];

  if (typeof zone === "string") {
    // An emptied field is the consumer going back to this PC's own zone, which
    // is the absence of a choice rather than a choice of "".
    const timeZone = zone.trim();

    if (timeZone.length > 0) {
      if (!isTimeZoneName(timeZone)) {
        throw new Error(`"${timeZone}" is not a time zone this runtime knows.`);
      }

      settings.timeZone = timeZone;
    }
  }

  const measurement = record["measurement"];

  // An empty field is a form with nothing chosen, not a third system.
  if (measurement !== undefined && measurement !== "") {
    if (!isMeasurementSystem(measurement)) {
      throw new Error(
        `"${String(measurement)}" is not a measurement system this runtime can display.`,
      );
    }

    settings.measurement = measurement;
  }

  const units = record["units"];

  // Refused value-by-value, so a stored preference this build cannot display is
  // an answer to the writer rather than a setting that appears to do nothing.
  if (units !== undefined) {
    const normalized = normalizeUnitPreferences(units);

    if (Object.keys(normalized).length > 0) {
      settings.units = normalized;
    }
  }

  return settings;
}

export function createDisplaySettingsStore(
  directory: string,
): DisplaySettingsStore {
  const file = path.join(directory, FILE);

  return {
    async read(): Promise<DisplaySettings> {
      try {
        return normalizeDisplaySettings(
          JSON.parse(await readFile(file, "utf8")),
        );
      } catch {
        // No file, an unreadable one, or a zone this runtime has since dropped:
        // this PC's own zone. Never fail a poll over a stored setting.
        return EMPTY_DISPLAY_SETTINGS;
      }
    },

    async write(input: unknown): Promise<DisplaySettings> {
      const normalized = normalizeDisplaySettings(input);
      await mkdir(directory, { recursive: true });
      await writeFile(file, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
      return normalized;
    },
  };
}
