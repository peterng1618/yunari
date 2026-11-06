import { pathPresetGeometry } from "@yunari/scene-fabric";
import {
  MAX_PATH_PRESET_COUNT,
  MAX_PATH_PRESET_DATA_LENGTH,
  MAX_PATH_PRESET_NAME_LENGTH,
  type PathPreset,
  type PathPresetPack,
  type PathPresetState,
  readPathPresetPack,
} from "@yunari/theme-package";
import { createJsonFile } from "../settings/json-file.js";

/** Pack bytes are refused before decoding, so a hostile body never reaches
 *  `JSON.parse`. Ten mebibytes is far above a real pack's list of path data. */
export const MAX_PATH_PRESET_PACK_BYTES = 10 * 1024 * 1024;

/** The one file this store owns beside the other settings. */
const STATE_FILE = "path-presets.json";
const VERSION = 1;

export interface PathPresetStore {
  read(): Promise<PathPresetState>;
  addUser(input: { label: string; data: string }): Promise<PathPreset>;
  addPack(bytes: Uint8Array): Promise<{
    readonly packId: string;
    readonly presets: readonly PathPreset[];
  }>;
  remove(id: string): Promise<void>;
  removeBuiltin(id: string): Promise<void>;
  restoreBuiltins(): Promise<void>;
  removePack(packId: string): Promise<void>;
  migrate(input: {
    presets: readonly PathPreset[];
    removedBuiltins: readonly string[];
  }): Promise<PathPresetState>;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function emptyState(): PathPresetState {
  return {
    version: VERSION,
    presets: [],
    removedBuiltins: [],
    migrated: false,
  };
}

/** One stored row: a user preset or one of an installed pack's presets. */
function storedPreset(value: unknown): PathPreset {
  if (!isRecord(value)) {
    throw new Error("A stored path preset must be an object.");
  }
  const id = value["id"];
  const label = value["label"];
  const data = value["data"];
  const paint = value["paint"];
  if (typeof id !== "string" || id.trim() === "") {
    throw new Error("A stored path preset needs an id.");
  }
  if (
    typeof label !== "string" ||
    label.trim() === "" ||
    label.trim().length > MAX_PATH_PRESET_NAME_LENGTH
  ) {
    throw new Error("A stored path preset needs a bounded label.");
  }
  if (
    typeof data !== "string" ||
    data.trim() === "" ||
    data.length > MAX_PATH_PRESET_DATA_LENGTH
  ) {
    throw new Error("A stored path preset needs bounded data.");
  }
  if (paint !== "stroke" && paint !== "fill") {
    throw new Error("A stored path preset needs a known paint.");
  }
  return { id: id.trim(), label: label.trim(), data: data.trim(), paint };
}

/** A row this file cannot read is dropped, not fatal: the rest still serves. */
function tryStoredPreset(value: unknown): PathPreset | undefined {
  try {
    return storedPreset(value);
  } catch {
    return undefined;
  }
}

/**
 * The file holds stored rows only: built-ins live in code, not on disk.
 *
 * A hand-edited row that cannot be read, or that repeats a built-in or an
 * earlier row, is dropped so the merged view can never show one id twice. The
 * file's own shape stays a refusal, so `read()` fails closed to the built-ins.
 */
function normalizeState(
  value: unknown,
  builtinIds: ReadonlySet<string>,
): PathPresetState {
  if (!isRecord(value)) {
    throw new Error("The path preset file is not an object.");
  }
  if (value["version"] !== VERSION) {
    throw new Error("Unsupported path preset file version.");
  }
  const declared = value["presets"];
  if (!Array.isArray(declared)) {
    throw new Error("The path preset file has no preset list.");
  }
  const presets: PathPreset[] = [];
  const seen = new Set<string>(builtinIds);
  for (const entry of declared) {
    const preset = tryStoredPreset(entry);
    if (preset === undefined || seen.has(preset.id)) continue;
    seen.add(preset.id);
    presets.push(preset);
  }

  const removed = value["removedBuiltins"];
  if (!Array.isArray(removed) || removed.some((id) => typeof id !== "string")) {
    throw new Error("The path preset file has an unusable removed list.");
  }
  if (typeof value["migrated"] !== "boolean") {
    throw new Error("The path preset file has no migration flag.");
  }
  return {
    version: VERSION,
    presets,
    removedBuiltins: [...new Set(removed as string[])],
    migrated: value["migrated"],
  };
}

function slugOf(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "preset" : slug;
}

function freshUserId(base: string, taken: ReadonlySet<string>): string {
  const first = `user:${base}`;
  if (!taken.has(first)) return first;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${first}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function readPack(bytes: Uint8Array): PathPresetPack {
  if (bytes.byteLength > MAX_PATH_PRESET_PACK_BYTES) {
    throw new Error("That path preset pack is too large.");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("That path preset pack is not UTF-8.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That path preset pack is not JSON.");
  }
  const result = readPathPresetPack(parsed);
  if (!result.ok) throw new Error(result.message);
  return result.pack;
}

/** The same geometry rule the editor applies, repeated because this is a trust boundary. */
function requireGeometry(data: string, name: string): "stroke" | "fill" {
  const geometry = pathPresetGeometry(data);
  if (geometry.ok) return geometry.paint;
  throw new Error(
    geometry.reason === "empty"
      ? `The path preset "${name}" draws nothing.`
      : `The path preset "${name}" cannot be read.`,
  );
}

/**
 * The installed path presets: built-ins from code, user rows and pack rows from
 * one settings file.
 *
 * A pack is read and every path parsed before the file is touched, so a refusal
 * leaves the stored state byte-for-byte unchanged. The file serialises writes
 * through `createJsonFile`, and `read()` merges the built-ins the author has not
 * removed ahead of the stored rows.
 */
export function createPathPresetStore(
  directory: string,
  builtins: readonly PathPreset[] = [],
): PathPresetStore {
  const builtinIds = new Set(builtins.map((preset) => preset.id));
  const file = createJsonFile<PathPresetState>(directory, STATE_FILE, {
    normalize: (value) => normalizeState(value, builtinIds),
    empty: emptyState,
  });

  const merged = (state: PathPresetState): PathPresetState => {
    const removed = new Set(state.removedBuiltins);
    return {
      version: VERSION,
      presets: [
        ...builtins.filter((preset) => !removed.has(preset.id)),
        ...state.presets,
      ],
      removedBuiltins: state.removedBuiltins,
      migrated: state.migrated,
    };
  };

  return {
    async read() {
      return merged(await file.read());
    },

    async addUser(input) {
      const label = input.label.trim();
      const data = input.data.trim();
      if (label === "" || label.length > MAX_PATH_PRESET_NAME_LENGTH) {
        throw new Error("A path preset needs a name.");
      }
      if (data === "" || data.length > MAX_PATH_PRESET_DATA_LENGTH) {
        throw new Error("A path preset needs path data.");
      }
      const paint = requireGeometry(data, label);

      return file.mutate((current) => {
        const taken = new Set<string>([
          ...builtinIds,
          ...current.presets.map((preset) => preset.id),
        ]);
        const preset: PathPreset = {
          id: freshUserId(slugOf(label), taken),
          label,
          data,
          paint,
        };
        return {
          next: { ...current, presets: [...current.presets, preset] },
          result: preset,
        };
      });
    },

    async addPack(bytes) {
      const pack = readPack(bytes);
      for (const preset of pack.presets) {
        const paint = requireGeometry(preset.data, preset.id);
        // Paint follows geometry, the same rule `userPathPresetFrom` applies;
        // a declared value that disagrees would draw a filled path as a line.
        if (paint !== preset.paint) {
          throw new Error(
            `The path preset "${preset.id}" declares ${preset.paint} paint, but its data is ${paint}.`,
          );
        }
      }
      const prefix = `pack:${pack.id}:`;

      return file.mutate((current) => {
        const rows = pack.presets.map(
          (preset): PathPreset => ({
            id: `${prefix}${preset.id}`,
            label: preset.label,
            data: preset.data,
            paint: preset.paint,
          }),
        );
        return {
          next: {
            ...current,
            presets: [
              ...current.presets.filter(
                (preset) => !preset.id.startsWith(prefix),
              ),
              ...rows,
            ],
          },
          result: { packId: pack.id, presets: rows },
        };
      });
    },

    async remove(id) {
      // A built-in is removed through `removeBuiltin`, which records the
      // removal rather than deleting a row that lives in code.
      if (builtinIds.has(id)) return;
      await file.mutate((current) => ({
        next: {
          ...current,
          presets: current.presets.filter((preset) => preset.id !== id),
        },
        result: undefined,
      }));
    },

    async removeBuiltin(id) {
      if (!builtinIds.has(id)) return;
      await file.mutate((current) => ({
        next: {
          ...current,
          removedBuiltins: current.removedBuiltins.includes(id)
            ? current.removedBuiltins
            : [...current.removedBuiltins, id],
        },
        result: undefined,
      }));
    },

    async restoreBuiltins() {
      await file.mutate((current) => ({
        next: { ...current, removedBuiltins: [] },
        result: undefined,
      }));
    },

    async removePack(packId) {
      const prefix = `pack:${packId}:`;
      await file.mutate((current) => ({
        next: {
          ...current,
          presets: current.presets.filter(
            (preset) => !preset.id.startsWith(prefix),
          ),
        },
        result: undefined,
      }));
    },

    async migrate(input) {
      const presets = readMigratedPresets(input.presets);
      const removed = readMigratedRemovedIds(input.removedBuiltins);

      const stored = await file.read();
      if (stored.migrated) return merged(stored);

      return file.mutate((current) => {
        // A concurrent migration won the queue; its answer stands.
        if (current.migrated) {
          return { next: current, result: merged(current) };
        }
        const removedBuiltins = [...current.removedBuiltins];
        for (const id of removed) {
          if (builtinIds.has(id) && !removedBuiltins.includes(id)) {
            removedBuiltins.push(id);
          }
        }
        const existing = new Set(current.presets.map((preset) => preset.id));
        const nextPresets = [...current.presets];
        for (const preset of presets) {
          if (existing.has(preset.id)) continue;
          nextPresets.push(preset);
          existing.add(preset.id);
        }
        const next: PathPresetState = {
          version: VERSION,
          presets: nextPresets,
          removedBuiltins,
          migrated: true,
        };
        return { next, result: merged(next) };
      });
    },
  };
}

/** Browser presets carry their own `user:` ids; anything else is not one. */
function readMigratedPresets(value: readonly PathPreset[]): PathPreset[] {
  if (!Array.isArray(value)) {
    throw new Error("A migration needs a list of presets.");
  }
  if (value.length > MAX_PATH_PRESET_COUNT) {
    throw new Error("A migration holds too many presets.");
  }
  const presets: PathPreset[] = [];
  const seen = new Set<string>();
  for (const row of value) {
    const preset = storedPreset(row);
    if (!preset.id.startsWith("user:")) {
      throw new Error(`The migrated id "${preset.id}" is not a user id.`);
    }
    if (preset.id.length > MAX_PATH_PRESET_NAME_LENGTH) {
      throw new Error("A migrated user id is too long.");
    }
    if (seen.has(preset.id)) {
      throw new Error(`The migrated id "${preset.id}" appears twice.`);
    }
    seen.add(preset.id);
    // Browser rows were written by an older editor rule; geometry owns paint.
    presets.push({
      ...preset,
      paint: requireGeometry(preset.data, preset.id),
    });
  }
  return presets;
}

function readMigratedRemovedIds(value: readonly string[]): string[] {
  if (!Array.isArray(value)) {
    throw new Error("A migration needs a list of removed built-in ids.");
  }
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      throw new Error("A removed built-in id must be text.");
    }
    const id = entry.trim();
    if (id !== "" && !ids.includes(id)) ids.push(id);
  }
  return ids;
}
