import { pathPresetGeometry } from "@yunari/scene-fabric";
import type { PathPresetPaint } from "@yunari/theme-package";

export type { PathPresetPaint } from "@yunari/theme-package";

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

/** The built-in preset ids the author removed. A separate key from the user
 *  list, so restoring the defaults cannot touch what the author added. */
export const REMOVED_PATH_PRESETS_STORAGE_KEY =
  "yunari.editor.removed-path-presets";

let active: readonly UserPathPreset[] = [];
let revision = 0;
const listeners = new Set<() => void>();

/** The built-in ids the author has removed. Strings rather than `PathPresetId`s
 *  because this module reads browser storage and must not import the catalogue
 *  that imports it; a value naming no built-in changes nothing. */
let removedActive: readonly string[] = [];
let removedRevision = 0;
const removedListeners = new Set<() => void>();

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

/** The built-in ids the Add pane withholds. The **same array reference**
 *  between changes, because `useSyncExternalStore` compares snapshots. */
export function activeRemovedPathPresetIds(): readonly string[] {
  return removedActive;
}

export function setActiveRemovedPathPresetIds(ids: readonly string[]): void {
  const next = [...new Set(ids)];
  if (
    next.length === removedActive.length &&
    next.every((id, index) => id === removedActive[index])
  ) {
    return;
  }
  removedActive = next;
  removedRevision += 1;
  for (const listener of removedListeners) listener();
}

export function subscribeRemovedPathPresetIds(
  listener: () => void,
): () => void {
  removedListeners.add(listener);
  return () => {
    removedListeners.delete(listener);
  };
}

export function removedPathPresetIdsKey(): string {
  return String(removedRevision);
}

/** The stored removals, or none where there is no store, the value cannot be
 *  read or it is not a list. */
export function readRemovedPathPresetIds(
  storage: Storage | undefined,
): readonly string[] {
  if (storage === undefined) return [];
  let raw: string | null;
  try {
    raw = storage.getItem(REMOVED_PATH_PRESETS_STORAGE_KEY);
  } catch {
    return [];
  }
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? [
          ...new Set(
            parsed.filter((id): id is string => typeof id === "string"),
          ),
        ]
      : [];
  } catch {
    return [];
  }
}

/** Writes the removals, and answers whether they will survive the reload. */
export function writeRemovedPathPresetIds(
  storage: Storage | undefined,
  ids: readonly string[],
): boolean {
  if (storage === undefined) return false;
  try {
    storage.setItem(
      REMOVED_PATH_PRESETS_STORAGE_KEY,
      JSON.stringify([...new Set(ids)]),
    );
    return true;
  } catch {
    return false;
  }
}

/** Removing the key is "every built-in back", the same absence-means-defaults
 *  rule the preview catalogue uses. */
export function clearRemovedPathPresetIds(
  storage: Storage | undefined,
): boolean {
  if (storage === undefined) return false;
  try {
    storage.removeItem(REMOVED_PATH_PRESETS_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
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

  const geometry = pathPresetGeometry(trimmedData);
  if (!geometry.ok) return { reason: geometry.reason };

  return {
    id: `user:${crypto.randomUUID()}`,
    label: trimmedLabel,
    data: trimmedData,
    paint: geometry.paint,
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
