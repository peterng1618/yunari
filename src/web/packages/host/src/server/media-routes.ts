import fs from "node:fs/promises";
import type http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GameArtworkSource } from "../providers/game/box-art.js";
import {
  GAME_ARTWORK_KEY,
  GAME_ARTWORK_PREFIX,
  isCatalogueArtworkKey,
  readCachedCover,
} from "../providers/game/box-art.js";
import {
  ARTWORK_NAME,
  type ArtworkCache,
  artworkContentType,
} from "../providers/media/artwork.js";
import { isVendoredWeatherIcon } from "../providers/weather/icons.js";
import { sendText } from "./http.js";
import { displayFor, isLoopbackRemote } from "./identity.js";
import type { HostServerOptions } from "./options.js";

/** The committed Meteocons bytes. A request names a file here only when that
 *  exact slug is in the provider's allow-list; no request path reaches the
 *  filesystem. */
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

/** The vendor folder sits one level above the bundle and two above the source
 *  module: `dist/main.js` is the built host, `src/server/media-routes.ts` the
 *  unbundled one. Both are tried, because the directory of `import.meta.url`
 *  moves when the build flattens `server/` into `main.js`. */
export function weatherIconDirectories(moduleDir: string): readonly string[] {
  return [
    path.resolve(moduleDir, "..", "..", "vendor", "weather-icons"),
    path.resolve(moduleDir, "..", "vendor", "weather-icons"),
  ];
}

const WEATHER_ICON_DIRS = weatherIconDirectories(MODULE_DIR);
let weatherIconDir: string | undefined;

async function weatherIconDirectory(): Promise<string | undefined> {
  if (weatherIconDir !== undefined) return weatherIconDir;
  for (const candidate of WEATHER_ICON_DIRS) {
    try {
      await fs.access(candidate);
      weatherIconDir = candidate;
      return candidate;
    } catch {
      // The other layout is the answer; a missing one is an installation fault
      // the request turns into a 404, never a 500.
    }
  }
  return undefined;
}

export interface MediaRouteDeps {
  readonly options: HostServerOptions;
  readonly artwork: ArtworkCache | undefined;
  readonly gameArtwork: GameArtworkSource | undefined;
  readonly gameCoverCacheDir: string | undefined;
}

/** The display-readable picture routes: weather icons, media artwork, game art. */
export function createMediaRoutes(
  deps: MediaRouteDeps,
): (
  request: http.IncomingMessage,
  response: http.ServerResponse,
  url: URL,
) => Promise<boolean> {
  const { options, artwork, gameArtwork, gameCoverCacheDir } = deps;
  const displays = options.displays;

  return async function handleMediaRoutes(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    url: URL,
  ): Promise<boolean> {
    // Weather icons are committed bytes with a fixed allow-list. A display
    // reads them, so a remote request needs the same credential as theme asset
    // bytes; loopback is this PC and needs none. Any name not vendored is a
    // 404 — never a neighbouring picture and never a filesystem path.
    if (url.pathname.startsWith("/api/weather/icon/")) {
      if (request.method !== "GET") {
        sendText(response, 405, "Only GET is supported.");
        return true;
      }

      const requested = url.pathname.slice("/api/weather/icon/".length);
      const slug = requested.endsWith(".svg")
        ? requested.slice(0, -".svg".length)
        : "";

      if (!isVendoredWeatherIcon(slug)) {
        sendText(response, 404, "Not found.");
        return true;
      }

      if (
        !isLoopbackRemote(request.socket.remoteAddress) &&
        (await displayFor(request, displays)) === undefined
      ) {
        sendText(response, 403, "This display is not paired with the host.");
        return true;
      }

      let bytes: Buffer;

      try {
        const directory = await weatherIconDirectory();
        if (directory === undefined) throw new Error("No vendored icons.");
        bytes = await fs.readFile(path.join(directory, `${slug}.svg`));
      } catch {
        // A vendored name whose bytes are missing is an installation fault, but
        // the answer is still an absence rather than a 500 on a display.
        sendText(response, 404, "Not found.");
        return true;
      }

      response.writeHead(200, {
        "content-type": "image/svg+xml",
        "content-length": bytes.byteLength,
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
      });
      response.end(bytes);
      return true;
    }

    // Media artwork is a content-addressed cache file, so the name is the
    // whole allow-list: 64 lowercase hex digits and an image extension. A
    // display reads it through the same credential as theme asset bytes;
    // loopback is this PC and needs none. An unknown or malformed name is a
    // 404, never a neighbouring file and never a 500.
    if (url.pathname.startsWith("/api/media/artwork/")) {
      if (request.method !== "GET") {
        sendText(response, 405, "Only GET is supported.");
        return true;
      }

      const name = url.pathname.slice("/api/media/artwork/".length);

      if (!ARTWORK_NAME.test(name)) {
        sendText(response, 404, "Not found.");
        return true;
      }

      if (
        !isLoopbackRemote(request.socket.remoteAddress) &&
        (await displayFor(request, displays)) === undefined
      ) {
        sendText(response, 403, "This display is not paired with the host.");
        return true;
      }

      const stored =
        artwork === undefined ? undefined : await artwork.read(name);

      if (stored === undefined) {
        sendText(response, 404, "Not found.");
        return true;
      }

      response.writeHead(200, {
        "content-type": artworkContentType(stored.ext),
        "content-length": stored.bytes.byteLength,
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
      });
      response.end(stored.bytes);
      return true;
    }

    // The running game's art is local bytes, so the key is the whole allow-list:
    // an installed Steam app, a cover the store provider cached, or a catalogued
    // game that carries its launcher's icon. Anything else is a 404 rather than
    // a filesystem probe. A display reads it through the same credential as media
    // artwork; loopback is this PC. The name is not content-addressed, so the
    // cache is bounded rather than immutable. The downloaded cover is read only,
    // never fetched: the provider is the one owner of the store's CDN.
    if (url.pathname.startsWith(GAME_ARTWORK_PREFIX)) {
      if (request.method !== "GET") {
        sendText(response, 405, "Only GET is supported.");
        return true;
      }

      const name = url.pathname.slice(GAME_ARTWORK_PREFIX.length);
      const dot = name.lastIndexOf(".");
      const extension = dot === -1 ? undefined : name.slice(dot + 1);
      const appId = dot === -1 ? name : name.slice(0, dot);

      // Steam's box art and a launcher's icon are different sources, so the key
      // form and the extension must agree before either is read.
      if (
        (extension !== "jpg" && extension !== "png" && extension !== "ico") ||
        !GAME_ARTWORK_KEY.test(appId) ||
        (isCatalogueArtworkKey(appId)
          ? extension !== "ico"
          : extension === "ico")
      ) {
        sendText(response, 404, "Not found.");
        return true;
      }

      if (
        !isLoopbackRemote(request.socket.remoteAddress) &&
        (await displayFor(request, displays)) === undefined
      ) {
        sendText(response, 403, "This display is not paired with the host.");
        return true;
      }

      // Local library art first: it costs no network, and Steam only writes the
      // JPEG while a launcher's picture is served as it was installed. A cached
      // remote cover is the fallback for a non-Steam game, keyed by app id only.
      const local =
        (extension === "jpg" || extension === "ico") &&
        gameArtwork !== undefined
          ? await gameArtwork.read(appId)
          : undefined;
      let bytes = local;
      let contentType =
        extension === "png"
          ? "image/png"
          : extension === "ico"
            ? "image/x-icon"
            : "image/jpeg";

      if (bytes === undefined && !isCatalogueArtworkKey(appId)) {
        const cached = await readCachedCover(
          gameCoverCacheDir,
          appId,
          extension === "png" ? "png" : "jpg",
        );

        if (cached !== undefined) {
          bytes = cached.bytes;
          contentType = cached.contentType;
        }
      }

      if (bytes === undefined) {
        sendText(response, 404, "Not found.");
        return true;
      }

      response.writeHead(200, {
        "content-type": contentType,
        "content-length": bytes.byteLength,
        "cache-control": "private, max-age=3600",
        "x-content-type-options": "nosniff",
      });
      response.end(bytes);
      return true;
    }

    return false;
  };
}
