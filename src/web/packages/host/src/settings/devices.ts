import { ASSIGNABLE_GROUPS, type AssignableGroup } from "@yunari/renderer-core";
import { createJsonFile } from "./json-file.js";

/**
 * Which physical device answers a theme's abstract sensor (§145, "device
 * assignments"), and what each device is called on screen. A theme is authored
 * against `gpu.load`, but a machine may have two GPUs and several drives; the
 * settled choice lives here, not in the theme, so one theme works everywhere.
 *
 * Settings are per host, not per theme: a display is a view of this machine,
 * and "which GPU?" has one answer here.
 */

/** Device groups a consumer can assign, owned by `renderer-core`. */

interface DeviceSettings {
  /** Chosen device per group. An absent group means "the default device". */
  readonly assigned: Readonly<Partial<Record<AssignableGroup, string>>>;
  /**
   * Consumer-chosen display names, keyed by device id. A drive reports
   * "WDC WD30NMVW-11C3NS4", which is neither short nor descriptive; this is
   * where that becomes "Data drive".
   */
  readonly names: Readonly<Record<string, string>>;
}

export const EMPTY_DEVICE_SETTINGS: DeviceSettings = {
  assigned: {},
  names: {},
};

export interface DeviceSettingsStore {
  read(): Promise<DeviceSettings>;
  write(input: unknown): Promise<DeviceSettings>;
}

const FILE = "devices.json";
/** A display name is shown, not used as a key, so it is only length-bounded. */
const MAX_NAME_LENGTH = 48;
/** The host's one id shape: what a provider reports, a display mints and an answer names. */
export const DEVICE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

function isGroup(value: string): value is AssignableGroup {
  return (ASSIGNABLE_GROUPS as readonly string[]).includes(value);
}

/**
 * Keeps only known groups with a usable device id and printable names. A
 * hand-edited file must not be able to introduce a group no provider reads, or
 * a name long enough to break the display.
 */
export function normalizeDeviceSettings(input: unknown): DeviceSettings {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return EMPTY_DEVICE_SETTINGS;
  }

  const record = input as Record<string, unknown>;
  const assigned: Partial<Record<AssignableGroup, string>> = {};
  const names: Record<string, string> = {};

  const rawAssigned = record["assigned"];
  if (typeof rawAssigned === "object" && rawAssigned !== null) {
    for (const [key, value] of Object.entries(
      rawAssigned as Record<string, unknown>,
    )) {
      if (
        typeof value === "string" &&
        isGroup(key) &&
        DEVICE_ID_PATTERN.test(value)
      ) {
        assigned[key] = value;
      }
    }
  }

  const rawNames = record["names"];
  if (typeof rawNames === "object" && rawNames !== null) {
    for (const [key, value] of Object.entries(
      rawNames as Record<string, unknown>,
    )) {
      if (typeof value !== "string" || !DEVICE_ID_PATTERN.test(key)) {
        continue;
      }

      // Trimmed and shortened; an empty name means "use the detected one".
      const trimmed = value.trim().slice(0, MAX_NAME_LENGTH);
      if (trimmed.length > 0) {
        names[key] = trimmed;
      }
    }
  }

  return { assigned, names };
}

export function createDeviceSettingsStore(
  directory: string,
): DeviceSettingsStore {
  const stored = createJsonFile(directory, FILE, {
    normalize: normalizeDeviceSettings,
    empty: () => EMPTY_DEVICE_SETTINGS,
  });

  return {
    read: () => stored.read(),

    async write(input) {
      const normalized = normalizeDeviceSettings(input);
      await stored.write(normalized);
      return normalized;
    },
  };
}

/**
 * The name to show for a device: the consumer's choice, else the detected one.
 *
 * Takes the names map rather than the whole settings, because the provider that
 * acquired a reading knows which device it read and needs only this.
 */
export function displayNameFor(
  names: Readonly<Record<string, string>>,
  deviceId: string,
  detectedName: string,
): string {
  return names[deviceId] ?? detectedName;
}
