import { hasClosedPath } from "@yunari/scene-fabric";
import { Path } from "fabric/es";

/** Which property a path preset's paint belongs on. An open curve is stroked;
 *  a closed path encloses a region and is filled. */
export type PathPresetPaint = "stroke" | "fill";

/** A custom shape the author added in Settings. Built-in presets are data in
 *  `new-object-defaults`; this is the one list the author owns. */
export interface UserPathPreset {
  /** Prefixed so it can never collide with a built-in id. */
  readonly id: `user:${string}`;
  readonly label: string;
  /** SVG path data, the same field the inspector edits. */
  readonly data: string;
  readonly paint: PathPresetPaint;
}

/** The one storage key. Absence means the built-in presets alone. */
export const USER_PATH_PRESETS_STORAGE_KEY = "yunari.editor.path-presets";

let active: readonly UserPathPreset[] = [];
let revision = 0;
const listeners = new Set<() => void>();

/** The live list. The **same array reference** between changes, because
 *  `useSyncExternalStore` compares snapshots. */
export function activeUserPathPresets(): readonly UserPathPreset[] {
  return active;
}

export function setActiveUserPathPresets(
  presets: readonly UserPathPreset[],
): void {
  if (samePresets(active, presets)) return;
  active = presets;
  revision += 1;
  for (const listener of listeners) listener();
}

export function subscribeUserPathPresets(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function userPathPresetsKey(): string {
  return String(revision);
}

/** The preset a `user:` insertion id names, if it is still in the list. */
export function userPathPreset(id: string): UserPathPreset | undefined {
  return active.find((preset) => preset.id === id);
}

export type UserPathPresetRefusal = "name" | "data" | "unreadable" | "empty";

/**
 * A candidate preset from the Settings form, or the reason it is refused.
 *
 * The data is parsed by Fabric's own `Path`, so what is stored is exactly what
 * the canvas would draw. An unreadable string and a drawing with no extent are
 * both refused rather than stored as an invisible tile. Paint follows geometry:
 * a closed path fills, an open one is stroked.
 */
export function userPathPresetFrom(
  label: string,
  data: string,
): UserPathPreset | { readonly reason: UserPathPresetRefusal } {
  const trimmedLabel = label.trim();
  const trimmedData = data.trim();
  if (trimmedLabel === "") return { reason: "name" };
  if (trimmedData === "") return { reason: "data" };

  let path: Path;
  try {
    path = new Path(trimmedData);
  } catch {
    return { reason: "unreadable" };
  }
  // Either axis may be zero — a horizontal or vertical line is still a
  // drawing; only a path with no extent on both, or a NaN measured from
  // malformed data, is refused.
  if (!(path.width > 0) && !(path.height > 0)) return { reason: "empty" };

  return {
    id: `user:${crypto.randomUUID()}`,
    label: trimmedLabel,
    data: trimmedData,
    paint: hasClosedPath(path) ? "fill" : "stroke",
  };
}

/** The stored list, or none where there is no store, the value cannot be read
 *  or an entry is malformed. */
export function readUserPathPresets(
  storage: Storage | undefined,
): readonly UserPathPreset[] {
  if (storage === undefined) return [];
  let raw: string | null;
  try {
    raw = storage.getItem(USER_PATH_PRESETS_STORAGE_KEY);
  } catch {
    return [];
  }
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isUserPathPreset) : [];
  } catch {
    return [];
  }
}

/** Writes the list, and answers whether it will survive the reload. A store
 *  that refuses the write leaves the session's list changed and says so. */
export function writeUserPathPresets(
  storage: Storage | undefined,
  presets: readonly UserPathPreset[],
): boolean {
  if (storage === undefined) return false;
  try {
    storage.setItem(USER_PATH_PRESETS_STORAGE_KEY, JSON.stringify(presets));
    return true;
  } catch {
    return false;
  }
}

function isUserPathPreset(value: unknown): value is UserPathPreset {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record["id"] === "string" &&
    record["id"].startsWith("user:") &&
    typeof record["label"] === "string" &&
    record["label"].trim() !== "" &&
    typeof record["data"] === "string" &&
    record["data"].trim() !== "" &&
    (record["paint"] === "stroke" || record["paint"] === "fill")
  );
}

function samePresets(
  left: readonly UserPathPreset[],
  right: readonly UserPathPreset[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (preset, index) =>
        preset.id === right[index]?.id &&
        preset.label === right[index]?.label &&
        preset.data === right[index]?.data &&
        preset.paint === right[index]?.paint,
    )
  );
}
