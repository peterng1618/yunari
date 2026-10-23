import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import type { WallpaperEngineInstall } from "./locate.js";

/**
 * The workshop library as a list (§1.2, §1.4). Two files disagree with the
 * disk and neither is trusted over it: `type` casing varies, and the cache can
 * lag, so an item with no row is listed with its attribution absent rather
 * than guessed. Every refusal is counted, never silently dropped.
 */

export interface LibraryItem {
  readonly workshopId: string;
  readonly directory: string;
  readonly title: string;
  /** Absolute path of the item's payload: `project.file`, except that a scene
   *  carrying `scene.pkg` is that package — today's descriptors name
   *  `scene.json`, which is not on disk (R3). */
  readonly payload: string;
  readonly type: "scene" | "video" | "web";
  readonly preview: string | undefined;
  readonly filesize: number;
  readonly tags: readonly string[];
  readonly authorSteamId: string | undefined;
  readonly workshopUrl: string | undefined;
  /** The descriptor's own `properties` schema, passed through unread. The user's
   *  chosen values live in Wallpaper Engine's root `config.json` (§1.3) and are
   *  never written by anything here (R1). */
  readonly properties: unknown;
}

export interface LibraryScan {
  readonly items: readonly LibraryItem[];
  readonly skipped: number;
}

type UnknownRecord = Record<string, unknown>;

export type ItemType = LibraryItem["type"];

const SCENE_PACKAGE = "scene.pkg";

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function numberOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function idOf(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value === "" ? undefined : value;
  }
  return typeof value === "number" ? String(value) : undefined;
}

async function sizeOf(file: string): Promise<number> {
  try {
    return (await fs.stat(file)).size;
  } catch {
    return 0;
  }
}

async function isFile(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isFile();
  } catch {
    return false;
  }
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return undefined;
  }
}

/** `bin/workshopcache.json`'s rows, keyed by `workshopid`. */
async function readCache(
  install: WallpaperEngineInstall,
): Promise<ReadonlyMap<string, UnknownRecord>> {
  const parsed = await readJson(
    path.join(install.root, "bin", "workshopcache.json"),
  );
  const rows = new Map<string, UnknownRecord>();
  if (!isRecord(parsed) || !Array.isArray(parsed.wallpapers)) {
    return rows;
  }

  for (const row of parsed.wallpapers) {
    if (!isRecord(row)) {
      continue;
    }
    const id = idOf(row.workshopid);
    if (id !== undefined) {
      rows.set(id, row);
    }
  }
  return rows;
}

function typeOf(value: unknown): ItemType | undefined {
  const type = stringOf(value)?.toLowerCase();
  return type === "scene" || type === "video" || type === "web"
    ? type
    : undefined;
}

/** One item, or `undefined` for every reason a directory is not one. */
async function readItem(
  name: string,
  directory: string,
  cache: ReadonlyMap<string, UnknownRecord>,
): Promise<LibraryItem | undefined> {
  const project = await readJson(path.join(directory, "project.json"));
  if (!isRecord(project)) {
    return undefined;
  }

  // A preset for another wallpaper carries no `type` and a `preset` object
  // (§1.2), so it is refused here along with every other unknown shape — the
  // point is that it never reaches a list with no payload behind it.
  const type = typeOf(project.type);
  if (type === undefined) {
    return undefined;
  }

  // Workshop directories are named by their id. Anything else has to carry one
  // in the descriptor, because the browser addresses an item by that id (§5.2).
  const numeric = /^\d+$/.test(name);
  const declared = isRecord(project.package)
    ? idOf(project.package.workshopId)
    : undefined;
  const workshopId = numeric ? name : declared;
  if (workshopId === undefined) {
    return undefined;
  }

  const file = stringOf(project.file);
  if (file === undefined) {
    return undefined;
  }

  // Today's descriptors name `scene.json`, which is not on disk; the package
  // beside it is the payload (R3: the disk is the truth). The name is fixed and
  // inside the item's own directory, so containment is unchanged.
  const named = path.resolve(directory, file);
  const packagePath = path.join(directory, SCENE_PACKAGE);
  const payload =
    type === "scene" && (await isFile(packagePath)) ? packagePath : named;
  const row = cache.get(workshopId);
  const preview = stringOf(project.preview);
  const tags = Array.isArray(row?.tags)
    ? row.tags.filter((tag): tag is string => typeof tag === "string")
    : [];

  return {
    workshopId,
    directory,
    title: stringOf(row?.title) ?? stringOf(project.title) ?? workshopId,
    payload,
    type,
    preview:
      preview === undefined ? undefined : path.resolve(directory, preview),
    filesize: numberOf(row?.filesize) ?? (await sizeOf(payload)),
    tags,
    authorSteamId: idOf(row?.authorsteamid),
    workshopUrl: stringOf(row?.workshopurl),
    properties: project.properties,
  };
}

/** Every listed wallpaper in the install's libraries, and how many were refused. */
export async function scanLibrary(
  install: WallpaperEngineInstall,
): Promise<LibraryScan> {
  const cache = await readCache(install);
  const items: LibraryItem[] = [];
  let skipped = 0;

  for (const library of install.libraries) {
    let entries: readonly Dirent[];
    try {
      entries = await fs.readdir(library, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const item = await readItem(
        entry.name,
        path.join(library, entry.name),
        cache,
      );
      if (item === undefined) {
        skipped += 1;
        continue;
      }
      items.push(item);
    }
  }

  return { items, skipped };
}
