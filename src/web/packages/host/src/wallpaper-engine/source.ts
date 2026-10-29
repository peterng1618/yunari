import fs from "node:fs/promises";
import { contentTypeFor } from "../serve/static-path.js";
import { fetchAuthorName } from "./author.js";
import { readSceneFacts, type SceneFacts } from "./classify.js";
import { type LibraryItem, scanLibrary } from "./library.js";
import { locateInstall, type WallpaperEngineInstall } from "./locate.js";
import { insideOf, resolvePayload } from "./resolve.js";
import { type ProjectResult, unpackScene } from "./unpack.js";
import { type StoredItem, toStoredItem } from "./wire.js";

/**
 * The whole host surface behind one object the server takes as an option
 *. The browser names an item by its `workshopId`; every path lives here.
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
  readonly authorName: (steamId: string) => Promise<string | undefined>;
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

export function createWallpaperEngineSource(
  options: {
    readonly locate?: typeof locateInstall;
    readonly classify?: typeof readSceneFacts;
    readonly fetchImpl?: typeof fetch;
  } = {},
): WallpaperEngineSource {
  const locate = options.locate ?? locateInstall;
  const classify = options.classify ?? readSceneFacts;
  const fetchImpl = options.fetchImpl;
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
    // Kept before the library check: the project route needs the install's own
    // paths even when it holds no library.
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
   * Unpacks one item into an editable project and stops there. The id is
   * resolved through the scan before any path is built, so a request never
   * becomes a directory, and nothing is started.
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

    return unpackScene(install, item);
  }

  /** Answers a Steam persona name, remembering it for this process — including
   *  the absent answer, so a profile that refused is asked once rather than
   *  once per credit the editor writes. */
  const authors = new Map<string, string | undefined>();

  async function authorName(steamId: string): Promise<string | undefined> {
    if (authors.has(steamId)) {
      return authors.get(steamId);
    }

    const name = await fetchAuthorName(
      steamId,
      fetchImpl === undefined ? {} : { fetchImpl },
    );
    authors.set(steamId, name);
    return name;
  }

  return { listing, bytesOf, project, authorName };
}
