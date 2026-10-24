import fs from "node:fs/promises";
import path from "node:path";
import {
  readSteamApps,
  resolveSteamRoot,
  type SteamApp,
} from "./steam-library.js";

/**
 * The running Steam game's box art, read from the cache Steam writes itself.
 *
 * The file lives at `<steam>/appcache/librarycache/<appId>/library_600x900.jpg`.
 * Only that name is served: the same folder holds a header, a hero and a logo,
 * and a route keyed by app id must not become a listing of Steam's cache
 * (decision 0108). The bytes never leave this machine, so a display's library
 * membership is not told to Steam's CDN.
 */

export const GAME_ARTWORK_PREFIX = "/api/game/artwork/";
/** A decimal app id of 1–10 digits; the path segment is the whole allow-list. */
export const GAME_APP_ID = /^\d{1,10}$/;
export const MAX_BOX_ART_BYTES = 5 * 1024 * 1024;
const BOX_ART_FILE = "library_600x900.jpg";

export function gameArtworkUrl(appId: string): string {
  return `${GAME_ARTWORK_PREFIX}${appId}.jpg`;
}

/**
 * True when the file resolves inside Steam's cache. A junction or symlink under
 * `<appId>` must not turn the fetch into a read of an arbitrary user file.
 */
async function insideCache(root: string, file: string): Promise<boolean> {
  try {
    const cache = await fs.realpath(
      path.win32.join(root, "appcache", "librarycache"),
    );
    const real = await fs.realpath(file);
    const relative = path.win32.relative(cache, real);

    return (
      relative !== "" &&
      !relative.startsWith("..") &&
      !path.win32.isAbsolute(relative)
    );
  } catch {
    return false;
  }
}

/** The cached file for this id under any of these Steam roots, or undefined. */
export async function locateBoxArt(
  appId: string,
  steamRoots: readonly string[],
): Promise<string | undefined> {
  if (!GAME_APP_ID.test(appId)) return undefined;

  for (const root of steamRoots) {
    const file = path.win32.join(
      root,
      "appcache",
      "librarycache",
      appId,
      BOX_ART_FILE,
    );

    try {
      if ((await fs.stat(file)).isFile() && (await insideCache(root, file))) {
        return file;
      }
    } catch {
      // No cache entry under this root; try the next one.
    }
  }

  return undefined;
}

/**
 * The reading's value: a host-relative URL when this game has local art, and
 * `undefined` when it does not. There is deliberately no CDN fallback.
 */
export async function findBoxArt(
  app: SteamApp,
  steamRoots: readonly string[],
): Promise<string | undefined> {
  const file = await locateBoxArt(app.appId, steamRoots);
  return file === undefined ? undefined : gameArtworkUrl(app.appId);
}

/**
 * Bytes under the bound, or undefined. `stat` refuses a large file before it is
 * read; the length check covers a file that grew between the two calls.
 * `readFile` is a test seam so a case can prove the stat refusal happens first.
 */
export async function readBoxArt(
  file: string,
  readFile: (file: string) => Promise<Uint8Array> = (target) =>
    fs.readFile(target),
): Promise<Uint8Array | undefined> {
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > MAX_BOX_ART_BYTES) return undefined;

    const bytes = await readFile(file);
    return bytes.byteLength > MAX_BOX_ART_BYTES ? undefined : bytes;
  } catch {
    return undefined;
  }
}

/** What the `/api/game/artwork/` route reads; bytes only, never a path. */
export interface GameArtworkSource {
  read(appId: string): Promise<Uint8Array | undefined>;
}

export type CoverExtension = "jpg" | "png";

export interface CachedCover {
  readonly bytes: Uint8Array;
  readonly contentType: "image/jpeg" | "image/png";
}

/** The extension the bytes themselves declare, never the file name's. */
function sniffImage(bytes: Uint8Array): CoverExtension | undefined {
  const at = (index: number): number => bytes[index] ?? -1;

  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "jpg";
  if (
    at(0) === 0x89 &&
    at(1) === 0x50 &&
    at(2) === 0x4e &&
    at(3) === 0x47 &&
    at(4) === 0x0d &&
    at(5) === 0x0a &&
    at(6) === 0x1a &&
    at(7) === 0x0a
  ) {
    return "png";
  }

  return undefined;
}

/**
 * True when the file resolves inside the cache directory. A junction or symlink
 * named `<appId>.<ext>` must not turn the route into a read of an arbitrary
 * user file.
 */
async function insideCoverCache(
  directory: string,
  file: string,
): Promise<boolean> {
  try {
    const cache = await fs.realpath(directory);
    const real = await fs.realpath(file);
    const relative = path.relative(cache, real);

    return (
      relative !== "" &&
      !relative.startsWith("..") &&
      !path.isAbsolute(relative)
    );
  } catch {
    return false;
  }
}

/**
 * A cover the store provider already downloaded, or undefined. The route serves
 * bytes only: a miss never starts a fetch, so the provider stays the one owner
 * of Valve's CDN (decision 0109). The id is validated before any path work, and
 * the bytes must match the extension they are served under.
 */
export async function readCachedCover(
  cacheDir: string | undefined,
  appId: string,
  extension: CoverExtension,
  readFile: (file: string) => Promise<Uint8Array> = (target) =>
    fs.readFile(target),
): Promise<CachedCover | undefined> {
  if (cacheDir === undefined || !GAME_APP_ID.test(appId)) return undefined;

  const id = Number(appId);
  if (!Number.isInteger(id) || id <= 0) return undefined;

  const file = path.join(cacheDir, `${id}.${extension}`);
  if (!(await insideCoverCache(cacheDir, file))) return undefined;

  const bytes = await readBoxArt(file, readFile);
  if (bytes === undefined || sniffImage(bytes) !== extension) return undefined;

  return {
    bytes,
    contentType: extension === "png" ? "image/png" : "image/jpeg",
  };
}

export interface GameArtworkOptions {
  readonly steamRoot?: () => Promise<string | undefined>;
  readonly loadSteamApps?: (root: string) => Promise<readonly SteamApp[]>;
}

/**
 * The route's view of the local library: an id must be an installed app before
 * its cache file is read, so an arbitrary id cannot probe the filesystem.
 */
export function createGameArtwork(
  options: GameArtworkOptions = {},
): GameArtworkSource {
  const resolveRoot = options.steamRoot ?? (() => resolveSteamRoot());
  const loadSteamApps = options.loadSteamApps ?? readSteamApps;
  // ponytail: the root and its apps are held for the process's life. A game
  // installed while the host runs appears after a restart; add a TTL here when
  // that matters.
  let root: string | undefined;
  let apps: readonly SteamApp[] | undefined;

  return {
    async read(appId) {
      if (!GAME_APP_ID.test(appId)) return undefined;

      root ??= await resolveRoot().catch(() => undefined);
      if (root === undefined) return undefined;

      if (apps === undefined) {
        try {
          apps = await loadSteamApps(root);
        } catch {
          // A failed read is not cached: the next request retries rather than
          // disabling box art for the rest of the process's life.
          return undefined;
        }
      }

      if (!apps.some((app) => app.appId === appId)) return undefined;

      const file = await locateBoxArt(appId, [root]);
      return file === undefined ? undefined : readBoxArt(file);
    },
  };
}
