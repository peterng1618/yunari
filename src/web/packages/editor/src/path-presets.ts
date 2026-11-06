import { pathPresetGeometry } from "@yunari/scene-fabric";
import {
  BUILTIN_PATH_PRESETS,
  type PathPreset,
  type PathPresetPaint,
  type PathPresetState,
} from "@yunari/theme-package";

export type { PathPresetPaint } from "@yunari/theme-package";

/** A stored row is either the author's or an installed pack's. */
export type StoredPathPresetId = `user:${string}` | `pack:${string}`;

/** A custom shape the author added in Settings, or one an installed pack
 *  carries. Built-in presets are data in `new-object-defaults`; this is the
 *  one list the author and the host's packs own. */
export interface UserPathPreset {
  /** `user:` or `pack:` prefixed, so it can never collide with a built-in id. */
  readonly id: StoredPathPresetId;
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

const LIST_PATH = "/api/path-presets";

/** The fetcher this page's later writes use. `loadPathPresets` sets it from the
 *  one it was given, so a caller that injects a host into the boot keeps it. */
let clientFetcher: typeof fetch = (input, init) => fetch(input, init);

function defaultStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPresetRow(value: unknown): value is PathPreset {
  if (!isRecord(value)) return false;
  return (
    typeof value["id"] === "string" &&
    value["id"].trim() !== "" &&
    typeof value["label"] === "string" &&
    value["label"].trim() !== "" &&
    typeof value["data"] === "string" &&
    value["data"].trim() !== "" &&
    (value["paint"] === "stroke" || value["paint"] === "fill")
  );
}

/** A row the live list holds: the built-ins stay in their own catalogue. */
function isStoredPreset(preset: PathPreset): preset is UserPathPreset {
  return preset.id.startsWith("user:") || preset.id.startsWith("pack:");
}

/** The host's answer, refused rather than read as an empty list: "the host
 *  answered garbage" and "no presets are installed" are different facts. */
function stateOf(value: unknown): PathPresetState {
  if (!isRecord(value) || value["version"] !== 1) {
    throw new Error("The host did not answer a path preset list.");
  }
  const presets = value["presets"];
  const removed = value["removedBuiltins"];
  const migrated = value["migrated"];
  if (
    !Array.isArray(presets) ||
    !Array.isArray(removed) ||
    typeof migrated !== "boolean" ||
    !presets.every(isPresetRow) ||
    removed.some((id) => typeof id !== "string")
  ) {
    throw new Error("The host did not answer a path preset list.");
  }
  return {
    version: 1,
    presets: presets as PathPreset[],
    removedBuiltins: [...new Set(removed as string[])],
    migrated,
  };
}

/** The built-in ids live in code; the live list holds only stored rows. */
const BUILTIN_IDS = new Set<string>(
  BUILTIN_PATH_PRESETS.map((preset) => preset.id),
);

function applyState(state: PathPresetState): void {
  setActiveUserPathPresets(
    state.presets.filter(
      (preset): preset is UserPathPreset =>
        !BUILTIN_IDS.has(preset.id) && isStoredPreset(preset),
    ),
  );
  setActiveRemovedPathPresetIds(state.removedBuiltins);
}

function mergedFallback(
  host: PathPresetState | undefined,
  localPresets: readonly UserPathPreset[],
  localRemoved: readonly string[],
): PathPresetState {
  const presets = [...(host?.presets ?? [])];
  const seen = new Set(presets.map((preset) => preset.id));
  for (const preset of localPresets) {
    if (seen.has(preset.id)) continue;
    seen.add(preset.id);
    presets.push(preset);
  }
  return {
    version: 1,
    presets,
    removedBuiltins: [
      ...new Set([...(host?.removedBuiltins ?? []), ...localRemoved]),
    ],
    migrated: false,
  };
}

function clearBrowserPresets(storage: Storage | undefined): void {
  try {
    storage?.removeItem(USER_PATH_PRESETS_STORAGE_KEY);
    storage?.removeItem(REMOVED_PATH_PRESETS_STORAGE_KEY);
  } catch {
    // A store that refuses the removal keeps the rows for the next boot.
  }
}

/**
 * Reads the host's preset list at boot, migrating this browser's keys once.
 *
 * The browser's list is the migration source, never a second owner: a host
 * that answers `migrated` is the whole list, and the local keys are cleared
 * only after the host has accepted them. A host that cannot be reached keeps
 * the local rows — they are the only list this editor has — and the next boot
 * tries the same migration again.
 */
export async function loadPathPresets(
  fetcher: typeof fetch = fetch,
  storage: Storage | undefined = defaultStorage(),
): Promise<PathPresetState> {
  clientFetcher = fetcher;
  const localPresets = readUserPathPresets(storage);
  const localRemoved = readRemovedPathPresetIds(storage);
  const pending = localPresets.length > 0 || localRemoved.length > 0;

  let host: PathPresetState | undefined;
  try {
    const response = await fetcher(LIST_PATH);
    if (!response.ok) throw new Error("The host refused the preset list.");
    host = stateOf(await response.json());
  } catch {
    host = undefined;
  }

  if (host !== undefined && pending && !host.migrated) {
    try {
      const response = await fetcher(`${LIST_PATH}/migrate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          presets: localPresets,
          removedBuiltins: localRemoved,
        }),
      });
      if (!response.ok) throw new Error("The host refused the migration.");
      const migrated = stateOf(await response.json());
      clearBrowserPresets(storage);
      applyState(migrated);
      return migrated;
    } catch {
      // Fall through: the local rows stay and the merged list below is served.
    }
  }

  if (host !== undefined && (!pending || host.migrated)) {
    applyState(host);
    return host;
  }

  const fallback = mergedFallback(host, localPresets, localRemoved);
  applyState(fallback);
  return fallback;
}

async function requireOk(response: Response, what: string): Promise<void> {
  if (response.ok) return;
  let detail = "";
  try {
    detail = (await response.text()).trim();
  } catch {
    detail = "";
  }
  throw new Error(detail === "" ? `${what} (${response.status}).` : detail);
}

async function refreshPathPresets(): Promise<PathPresetState> {
  const response = await clientFetcher(LIST_PATH);
  await requireOk(response, "The path presets could not be read");
  const state = stateOf(await response.json());
  applyState(state);
  return state;
}

export async function addPathPreset(
  label: string,
  data: string,
): Promise<UserPathPreset> {
  const response = await clientFetcher(LIST_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ label, data }),
  });
  await requireOk(response, "The path preset could not be added");
  const preset: unknown = await response.json();
  if (!isPresetRow(preset) || !isStoredPreset(preset)) {
    throw new Error("The host did not answer a path preset.");
  }
  await refreshPathPresets();
  return preset;
}

async function mutatePathPresets(
  path: string,
  method: "POST" | "DELETE",
  what: string,
): Promise<void> {
  const response = await clientFetcher(path, { method });
  await requireOk(response, what);
  await refreshPathPresets();
}

export async function removePathPreset(id: string): Promise<void> {
  await mutatePathPresets(
    `${LIST_PATH}/${encodeURIComponent(id)}`,
    "DELETE",
    "The path preset could not be removed",
  );
}

export async function removeBuiltinPathPreset(id: string): Promise<void> {
  await mutatePathPresets(
    `${LIST_PATH}/builtins/${encodeURIComponent(id)}/remove`,
    "POST",
    "The shipped path preset could not be removed",
  );
}

export async function restoreBuiltinPathPresets(): Promise<void> {
  await mutatePathPresets(
    `${LIST_PATH}/builtins/restore`,
    "POST",
    "The shipped path presets could not be restored",
  );
}

export async function installPathPresetPack(bytes: Uint8Array): Promise<void> {
  const response = await clientFetcher(`${LIST_PATH}/packs`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: bytes as unknown as BodyInit,
  });
  await requireOk(response, "The path preset pack could not be installed");
  await refreshPathPresets();
}

export async function removePathPresetPack(packId: string): Promise<void> {
  await mutatePathPresets(
    `${LIST_PATH}/packs/${encodeURIComponent(packId)}`,
    "DELETE",
    "The path preset pack could not be removed",
  );
}
