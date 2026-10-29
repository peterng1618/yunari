import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { LibraryItem } from "./library.js";
import type { WallpaperEngineInstall } from "./locate.js";
import { insideOf } from "./resolve.js";
import type { StoredItem } from "./wire.js";

/**
 * The on-disk form of a library scan.
 *
 * A scan reads every `project.json` and reads and classifies every scene
 * package, so paying it once per host start is the point of this file. The
 * fingerprint is the invalidation: it stats the install, its libraries,
 * `bin/workshopcache.json` and each item's descriptor/package, which is cheap
 * next to reading the packages themselves. Cached paths are re-checked against
 * the current libraries before use, so an edited cache cannot name a path
 * outside the library it claims.
 */

/** Bumped whenever the entry's shape or the scan's meaning changes. */
const CACHE_VERSION = 1;
const CACHE_FILE = "listing.json";
const SCENE_PACKAGE = "scene.pkg";

export interface ListingCacheEntry {
  readonly items: readonly LibraryItem[];
  readonly stored: readonly StoredItem[];
  readonly skipped: number;
}

interface CacheFile {
  readonly version: number;
  readonly installRoot: string;
  readonly libraries: readonly string[];
  readonly fingerprint: string;
  readonly items: readonly unknown[];
  readonly stored: readonly unknown[];
  readonly skipped: number;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function folded(value: string): string {
  return value.toLowerCase();
}

async function statKey(file: string): Promise<string> {
  try {
    const stat = await fs.stat(file);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return "-";
  }
}

/**
 * What the scan read, as a string that changes when anything it depends on
 * changes. Sorted so two listings of the same library agree.
 */
export async function fingerprintOf(
  install: WallpaperEngineInstall,
): Promise<string> {
  const rows: string[] = [folded(install.root)];
  rows.push(
    `cache:${await statKey(path.join(install.root, "bin", "workshopcache.json"))}`,
  );

  for (const library of [...install.libraries].sort((left, right) =>
    folded(left).localeCompare(folded(right)),
  )) {
    rows.push(`library:${folded(library)}:${await statKey(library)}`);

    let entries: readonly Dirent[];
    try {
      entries = await fs.readdir(library, { withFileTypes: true });
    } catch {
      continue;
    }

    const directories = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => folded(left).localeCompare(folded(right)));

    for (const name of directories) {
      const directory = path.join(library, name);
      rows.push(
        `item:${folded(directory)}:` +
          `${await statKey(path.join(directory, "project.json"))}:` +
          `${await statKey(path.join(directory, SCENE_PACKAGE))}`,
      );
    }
  }

  return rows.join("\n");
}

function itemOf(
  value: unknown,
  install: WallpaperEngineInstall,
): LibraryItem | undefined {
  if (!isRecord(value)) return undefined;

  const {
    workshopId,
    directory,
    title,
    payload,
    type,
    preview,
    filesize,
    tags,
    authorSteamId,
    workshopUrl,
    properties,
  } = value;

  if (
    typeof workshopId !== "string" ||
    workshopId === "" ||
    typeof directory !== "string" ||
    typeof title !== "string" ||
    typeof payload !== "string" ||
    (type !== "scene" && type !== "video" && type !== "web") ||
    (preview !== undefined && typeof preview !== "string") ||
    typeof filesize !== "number" ||
    !Number.isFinite(filesize) ||
    filesize < 0 ||
    !Array.isArray(tags) ||
    !tags.every((tag) => typeof tag === "string") ||
    (authorSteamId !== undefined && typeof authorSteamId !== "string") ||
    (workshopUrl !== undefined && typeof workshopUrl !== "string")
  ) {
    return undefined;
  }

  if (!install.libraries.some((library) => insideOf(library, directory))) {
    return undefined;
  }
  if (!insideOf(directory, payload)) return undefined;
  if (preview !== undefined && !insideOf(directory, preview)) return undefined;

  return {
    workshopId,
    directory,
    title,
    payload,
    type,
    filesize,
    tags,
    properties,
    preview,
    authorSteamId,
    workshopUrl,
  };
}

function storedOf(value: unknown): StoredItem | undefined {
  if (!isRecord(value)) return undefined;

  const {
    workshopId,
    title,
    kind,
    previewUrl,
    filesize,
    tags,
    properties,
    stillAtRest,
    hasText,
    attribution,
  } = value;

  if (
    typeof workshopId !== "string" ||
    workshopId === "" ||
    typeof title !== "string" ||
    (kind !== "image" && kind !== "video" && kind !== "scene") ||
    (previewUrl !== undefined && typeof previewUrl !== "string") ||
    typeof filesize !== "number" ||
    !Number.isFinite(filesize) ||
    filesize < 0 ||
    !Array.isArray(tags) ||
    !tags.every((tag) => typeof tag === "string") ||
    (stillAtRest !== undefined && typeof stillAtRest !== "boolean") ||
    (hasText !== undefined && typeof hasText !== "boolean") ||
    (attribution !== undefined &&
      (!isRecord(attribution) ||
        (attribution.steamId !== undefined &&
          typeof attribution.steamId !== "string") ||
        (attribution.workshopUrl !== undefined &&
          typeof attribution.workshopUrl !== "string")))
  ) {
    return undefined;
  }

  return {
    workshopId,
    title,
    kind,
    filesize,
    tags,
    properties,
    ...(previewUrl === undefined ? {} : { previewUrl }),
    ...(stillAtRest === undefined ? {} : { stillAtRest }),
    ...(hasText === undefined ? {} : { hasText }),
    ...(attribution === undefined
      ? {}
      : {
          attribution: attribution as NonNullable<StoredItem["attribution"]>,
        }),
  };
}

/** The entry for this install and fingerprint, or `undefined` for every reason
 *  it cannot be trusted. */
export async function readListingCache(
  cacheDir: string,
  install: WallpaperEngineInstall,
  fingerprint: string,
): Promise<ListingCacheEntry | undefined> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      await fs.readFile(path.join(cacheDir, CACHE_FILE), "utf8"),
    );
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  const entry = parsed as Partial<CacheFile>;
  if (
    entry.version !== CACHE_VERSION ||
    entry.installRoot !== install.root ||
    entry.fingerprint !== fingerprint ||
    !Array.isArray(entry.libraries) ||
    entry.libraries.length !== install.libraries.length ||
    !Array.isArray(entry.items) ||
    !Array.isArray(entry.stored) ||
    typeof entry.skipped !== "number" ||
    !Number.isInteger(entry.skipped) ||
    entry.skipped < 0
  ) {
    return undefined;
  }

  const current = new Set(install.libraries.map(folded));
  if (
    entry.libraries.some(
      (library) => typeof library !== "string" || !current.has(folded(library)),
    )
  ) {
    return undefined;
  }

  const items: LibraryItem[] = [];
  for (const raw of entry.items) {
    const item = itemOf(raw, install);
    if (item === undefined) return undefined;
    items.push(item);
  }

  const stored: StoredItem[] = [];
  for (const raw of entry.stored) {
    const item = storedOf(raw);
    if (item === undefined) return undefined;
    stored.push(item);
  }

  return { items, stored, skipped: entry.skipped };
}

/** A cache that cannot be written is not a failed listing. */
export async function writeListingCache(
  cacheDir: string,
  install: WallpaperEngineInstall,
  fingerprint: string,
  entry: ListingCacheEntry,
): Promise<void> {
  const file: CacheFile = {
    version: CACHE_VERSION,
    installRoot: install.root,
    libraries: install.libraries,
    fingerprint,
    items: entry.items,
    stored: entry.stored,
    skipped: entry.skipped,
  };

  try {
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(path.join(cacheDir, CACHE_FILE), JSON.stringify(file));
  } catch {
    // A read-only cache directory costs the next scan, not this listing.
  }
}
