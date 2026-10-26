import type { Stats } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { contentTypeFor } from "../serve/static-path.js";
import { readSceneFacts, type SceneFacts } from "./classify.js";
import {
  type MobileExportFailure,
  requestMobileExport,
} from "./export-mobile.js";
import { type LibraryItem, scanLibrary } from "./library.js";
import { locateInstall, type WallpaperEngineInstall } from "./locate.js";
import { mobileVideo } from "./pkg.js";
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

/** Why a project route stopped before anything ran. */
export type ProjectFailure = "no-install" | "refused" | "unreadable";

/**
 * `ok` means the engine reached its own Save dialog and the author was asked to
 * save; the saved package arrives afterwards through `exportsSince`.
 */
export type MobileExportOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: ProjectFailure | MobileExportFailure;
    };

export interface WallpaperEngineSource {
  readonly listing: () => Promise<WallpaperEngineAnswer>;
  readonly bytesOf: (
    workshopId: string,
    part: "preview" | "asset",
  ) => Promise<
    { readonly bytes: Uint8Array; readonly contentType: string } | undefined
  >;
  readonly project: (workshopId: string) => Promise<ProjectResult>;
  readonly mobileExport: (workshopId: string) => Promise<MobileExportOutcome>;
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

/** How long the author's Save click is given to land after the dialog opens. */
const HARVEST_MS = 5 * 60_000;

const HARVEST_POLL_MS = 1_000;

export function createWallpaperEngineSource(
  options: {
    readonly locate?: typeof locateInstall;
    readonly classify?: typeof readSceneFacts;
    readonly launch?: typeof launchEditor;
    readonly requestExport?: typeof requestMobileExport;
    /** The Windows Videos folder. Supplied so a test reads a fixture rather
     *  than this PC's profile. */
    readonly videosDirectory?: string;
    /** Where the engine's Save dialog opens by default. Same reason. */
    readonly documentsDirectory?: string;
  } = {},
): WallpaperEngineSource {
  const locate = options.locate ?? locateInstall;
  const classify = options.classify ?? readSceneFacts;
  const launch = options.launch ?? launchEditor;
  const requestExport = options.requestExport ?? requestMobileExport;
  const videosDirectory =
    options.videosDirectory ?? path.join(os.homedir(), "Videos");
  const documentsDirectory =
    options.documentsDirectory ?? path.join(os.homedir(), "Documents");
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

    // The project directory is not passed: the UI lists everything in
    // `projects/myprojects`, and launching it with `-project` is refused.
    return { ...unpacked, launched: await launch() };
  }

  /** The title the engine lists an unpacked project under: the descriptor's
   *  own, which is the workshop title — the directory is the id. */
  async function projectTitle(
    directory: string,
    fallback: string,
  ): Promise<string> {
    try {
      const parsed: unknown = JSON.parse(
        await fs.readFile(path.join(directory, "project.json"), "utf8"),
      );
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        !Array.isArray(parsed)
      ) {
        const title = (parsed as Record<string, unknown>).title;
        if (typeof title === "string" && title !== "") {
          return title;
        }
      }
    } catch {
      // A descriptor we cannot read is one the engine shows by id too.
    }
    return fallback;
  }

  /** The newest `.mpkg` the Save dialog wrote into its default folder. */
  async function savedPackageSince(
    startedAt: number,
  ): Promise<string | undefined> {
    let entries;
    try {
      entries = await fs.readdir(documentsDirectory, { withFileTypes: true });
    } catch {
      return undefined;
    }

    let newest:
      | { readonly file: string; readonly modified: number }
      | undefined;
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      if (path.extname(entry.name).toLowerCase() !== ".mpkg") {
        continue;
      }
      const file = path.join(documentsDirectory, entry.name);
      const stats = await regularFileStats(file);
      if (stats === undefined || stats.mtimeMs <= startedAt - 1_000) {
        continue;
      }
      if (newest === undefined || stats.mtimeMs > newest.modified) {
        newest = { file, modified: stats.mtimeMs };
      }
    }
    return newest?.file;
  }

  /**
   * Turns the package the author saved into the video the editor imports.
   *
   * The engine writes its package as it encodes, so a file that parses can be a
   * truncated one: only a size that held across a poll is read. The video lands
   * in the engine's own export folder, which `exportsSince` already watches, so
   * the sheet picks it up by the same route as a manual export.
   */
  async function harvest(
    install: WallpaperEngineInstall,
    workshopId: string,
    startedAt: number,
  ): Promise<void> {
    const deadline = Date.now() + HARVEST_MS;
    let settled: { readonly file: string; readonly size: number } | undefined;

    while (Date.now() < deadline) {
      const file = await savedPackageSince(startedAt);
      const stats =
        file === undefined ? undefined : await regularFileStats(file);

      if (file !== undefined && stats !== undefined) {
        if (settled?.file === file && settled.size === stats.size) {
          const bytes = await readOrUndefined(file);
          const video = bytes === undefined ? undefined : mobileVideo(bytes);
          if (video !== undefined && video.length > 0) {
            const name = `yunari-${workshopId}-${startedAt}.mp4`;
            try {
              await fs.mkdir(path.join(install.root, "projects", "temp"), {
                recursive: true,
              });
              await fs.writeFile(
                path.join(install.root, "projects", "temp", name),
                video,
              );
            } catch {
              // The author still has the package; the sheet simply offers
              // nothing, which is the same answer as an unwatched folder.
            }
            return;
          }
        }
        settled = { file, size: stats.size };
      }

      await new Promise((resolve) => setTimeout(resolve, HARVEST_POLL_MS));
    }
  }

  /** One export at a time per item: a second run would stack Save dialogs. */
  const exporting = new Set<string>();

  /**
   * Unpacks one item and drives the engine to its mobile export dialog. The
   * author's Save click finishes the job; `harvest` waits for it in the
   * background and drops the video where the export watcher looks.
   */
  async function mobileExport(
    workshopId: string,
  ): Promise<MobileExportOutcome> {
    const item = await itemOf(workshopId);
    const install = located;

    if (install === undefined) {
      return { ok: false, reason: "no-install" };
    }
    if (item === undefined || exporting.has(workshopId)) {
      return { ok: false, reason: "refused" };
    }

    const unpacked = await unpackScene(install, item);
    if (!unpacked.ok) {
      return unpacked;
    }

    const title = await projectTitle(
      path.join(install.myProjects, unpacked.name),
      item.title,
    );

    exporting.add(workshopId);
    const startedAt = Date.now();
    const result = await requestExport({ title });
    if (!result.ok) {
      exporting.delete(workshopId);
      return result;
    }

    void harvest(install, workshopId, startedAt)
      .catch(() => undefined)
      .finally(() => exporting.delete(workshopId));
    return { ok: true };
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
    mobileExport,
    exportsSince,
    exportBytes,
  };
}
