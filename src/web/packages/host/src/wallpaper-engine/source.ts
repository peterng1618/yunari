import type { Stats } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { contentTypeFor } from "../serve/static-path.js";
import { readSceneFacts, type SceneFacts } from "./classify.js";
import { type LibraryItem, scanLibrary } from "./library.js";
import { locateInstall, type WallpaperEngineInstall } from "./locate.js";
import { insideOf, resolvePayload } from "./resolve.js";
import {
  type ExportFile,
  launchEditor,
  type ProjectResult,
  unpackScene,
} from "./unpack.js";
import { type StoredItem, toStoredItem } from "./wire.js";

/**
 * The whole host surface behind one object the server takes as an option
 * (§5.2). The browser names an item by its `workshopId`; every path lives here.
 */

export type UnavailableReason =
  | "not-installed"
  | "unsupported-platform"
  | "no-library";

export interface WallpaperEngineListing {
  readonly available: true;
  readonly install: string;
  readonly items: readonly StoredItem[];
  readonly skipped: number;
}

export type WallpaperEngineAnswer =
  | WallpaperEngineListing
  | { readonly available: false; readonly reason: UnavailableReason };

export interface WallpaperEngineSource {
  readonly listing: () => Promise<WallpaperEngineAnswer>;
  readonly bytesOf: (
    workshopId: string,
    part: "preview" | "asset",
  ) => Promise<
    { readonly bytes: Uint8Array; readonly contentType: string } | undefined
  >;
  readonly project: (workshopId: string) => Promise<ProjectResult>;
  readonly exportsSince: (since: number) => Promise<readonly ExportFile[]>;
  readonly exportBytes: (
    name: string,
  ) => Promise<
    { readonly bytes: Uint8Array; readonly contentType: string } | undefined
  >;
}

async function readOrUndefined(file: string): Promise<Uint8Array | undefined> {
  try {
    return await fs.readFile(file);
  } catch {
    return undefined;
  }
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await fs.stat(file)).isFile();
  } catch {
    return false;
  }
}

/** One regular file's stats, or `undefined`: a symlink is not an export this
 *  host wrote. */
async function regularFileStats(file: string): Promise<Stats | undefined> {
  try {
    const stats = await fs.lstat(file);
    return stats.isFile() ? stats : undefined;
  } catch {
    return undefined;
  }
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

function formatOf(name: string): ExportFile["format"] | undefined {
  const extension = path.extname(name).toLowerCase();
  return extension === ".png"
    ? "png"
    : extension === ".mp4"
      ? "mp4"
      : undefined;
}

export function createWallpaperEngineSource(
  options: {
    readonly locate?: typeof locateInstall;
    readonly classify?: typeof readSceneFacts;
    readonly launch?: typeof launchEditor;
    /** The Windows Videos folder. Supplied so a test reads a fixture rather
     *  than this PC's profile. */
    readonly videosDirectory?: string;
  } = {},
): WallpaperEngineSource {
  const locate = options.locate ?? locateInstall;
  const classify = options.classify ?? readSceneFacts;
  const launch = options.launch ?? launchEditor;
  const videosDirectory =
    options.videosDirectory ?? path.join(os.homedir(), "Videos");
  // The real locator answers `undefined` on every non-Windows platform, which
  // is a different answer from "not installed". An injected locator is a
  // fixture, so the platform it runs on says nothing about the library.
  const supported =
    options.locate !== undefined || process.platform === "win32";

  /** The most recent scan, so a byte request is answered by id, never a path. */
  let scanned: ReadonlyMap<string, LibraryItem> | undefined;
  /** The install the last scan read, for the two paths that are not an item. */
  let located: WallpaperEngineInstall | undefined;

  async function listing(): Promise<WallpaperEngineAnswer> {
    // An unavailable answer also forgets the last scan: an item served from a
    // library that has since gone is a path the host no longer has.
    scanned = undefined;
    located = undefined;

    if (!supported) {
      return { available: false, reason: "unsupported-platform" };
    }

    // Located per listing, not once per process: a Steam library can appear
    // while the editor is open.
    const install = await locate(process.env, process.platform);
    if (install === undefined) {
      return { available: false, reason: "not-installed" };
    }
    // Kept before the library check: the unpack and export routes need the
    // install's own paths even when it holds no library.
    located = install;
    if (install.libraries.length === 0) {
      return { available: false, reason: "no-library" };
    }

    const scan = await scanLibrary(install);
    const items: StoredItem[] = [];
    const byId = new Map<string, LibraryItem>();
    let skipped = scan.skipped;

    for (const item of scan.items) {
      const payload = await resolvePayload(item);
      // A listed item with nothing behind it is refused the same way an
      // unreadable directory is, and counted rather than silently dropped.
      if (payload === undefined) {
        skipped += 1;
        continue;
      }

      // The package is read once here; only its facts are kept. The bytes are
      // read again on demand, so a large library costs the scan, not the RSS.
      let facts: SceneFacts | undefined;
      if (payload.kind === "scene") {
        const bytes = await readOrUndefined(payload.path);
        if (bytes !== undefined) {
          facts = classify(bytes);
        }
      }

      items.push(toStoredItem(item, payload, facts));
      byId.set(item.workshopId, item);
    }

    scanned = byId;

    return { available: true, install: install.root, items, skipped };
  }

  async function itemOf(workshopId: string): Promise<LibraryItem | undefined> {
    const found = scanned?.get(workshopId);
    if (found !== undefined) {
      return found;
    }
    // A byte request that arrives before the list, or from a page kept across a
    // host restart, scans once rather than trusting anything the caller named.
    await listing();
    return scanned?.get(workshopId);
  }

  /** The install the next route reads paths from, scanning once if needed. */
  async function installNow(): Promise<WallpaperEngineInstall | undefined> {
    if (located === undefined) {
      await listing();
    }
    return located;
  }

  async function bytesOf(
    workshopId: string,
    part: "preview" | "asset",
  ): Promise<
    { readonly bytes: Uint8Array; readonly contentType: string } | undefined
  > {
    const item = await itemOf(workshopId);
    if (item === undefined) {
      return undefined;
    }

    if (part === "preview") {
      // `project.json` is third-party content, so the preview is a file inside
      // this item's own directory or it is not served at all.
      const preview = item.preview;
      if (
        preview === undefined ||
        !insideOf(item.directory, preview) ||
        !(await isFile(preview))
      ) {
        return undefined;
      }

      const bytes = await readOrUndefined(preview);
      return bytes === undefined
        ? undefined
        : { bytes, contentType: contentTypeFor(preview) };
    }

    const payload = await resolvePayload(item);
    if (payload === undefined || payload.kind === "web") {
      return undefined;
    }

    const bytes = await readOrUndefined(payload.path);
    const contentType =
      payload.kind === "scene"
        ? contentTypeFor(payload.path)
        : payload.contentType;

    return bytes === undefined ? undefined : { bytes, contentType };
  }

  /**
   * Unpacks one item and starts the editor on it. The id is resolved through
   * the scan before any path is built, so a request never becomes a directory.
   */
  async function project(workshopId: string): Promise<ProjectResult> {
    const item = await itemOf(workshopId);
    const install = located;

    if (install === undefined) {
      return { ok: false, reason: "no-install" };
    }
    if (item === undefined) {
      return { ok: false, reason: "refused" };
    }

    const unpacked = await unpackScene(install, item);
    if (!unpacked.ok) {
      return unpacked;
    }

    const directory = path.join(install.myProjects, unpacked.name);
    return { ...unpacked, launched: await launch(install, directory) };
  }

  /** The three directories the export step watches (§8, step 5), and only
   *  those: this host does not roam the author's profile. */
  async function exportDirectories(): Promise<readonly string[]> {
    const install = await installNow();
    const directories: string[] = [];
    if (install !== undefined) {
      directories.push(
        path.join(install.root, "projects", "temp"),
        install.myProjects,
      );
    }
    if (await isDirectory(videosDirectory)) {
      directories.push(videosDirectory);
    }
    return directories;
  }

  async function exportsSince(since: number): Promise<readonly ExportFile[]> {
    const files: ExportFile[] = [];

    for (const directory of await exportDirectories()) {
      let entries;
      try {
        entries = await fs.readdir(directory, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!entry.isFile()) {
          continue;
        }
        const format = formatOf(entry.name);
        if (format === undefined) {
          continue;
        }
        const stats = await fs
          .stat(path.join(directory, entry.name))
          .catch(() => undefined);
        // `>`, not `>=`: "since it opened" is the window, and a file already
        // there when the sheet opened is not an export it can offer.
        if (stats === undefined || !stats.isFile() || stats.mtimeMs <= since) {
          continue;
        }
        files.push({
          name: entry.name,
          format,
          modified: stats.mtimeMs,
          size: stats.size,
        });
      }
    }

    files.sort((left, right) => right.modified - left.modified);

    // Two scoped directories can hold the same name. The sheet addresses an
    // export by name alone, so it is offered once — the newest copy — and
    // `exportBytes` resolves the same name the same way.
    const seen = new Set<string>();
    return files.filter((file) => {
      if (seen.has(file.name)) {
        return false;
      }
      seen.add(file.name);
      return true;
    });
  }

  async function exportBytes(
    name: string,
  ): Promise<
    { readonly bytes: Uint8Array; readonly contentType: string } | undefined
  > {
    // The name is a query value, so it names one file directly in a scoped
    // directory: a separator, a drive letter or a dot segment is refused
    // before `path.join` ever sees it.
    if (
      path.isAbsolute(name) ||
      path.basename(name) !== name ||
      formatOf(name) === undefined
    ) {
      return undefined;
    }

    let newest:
      | { readonly file: string; readonly modified: number }
      | undefined;
    for (const directory of await exportDirectories()) {
      const candidate = path.join(directory, name);
      if (!insideOf(directory, candidate)) {
        continue;
      }
      const stats = await regularFileStats(candidate);
      if (stats === undefined) {
        continue;
      }
      if (newest === undefined || stats.mtimeMs > newest.modified) {
        newest = { file: candidate, modified: stats.mtimeMs };
      }
    }

    if (newest === undefined) {
      return undefined;
    }

    const bytes = await readOrUndefined(newest.file);
    return bytes === undefined
      ? undefined
      : { bytes, contentType: contentTypeFor(newest.file) };
  }

  return {
    listing,
    bytesOf,
    project,
    exportsSince,
    exportBytes,
  };
}
