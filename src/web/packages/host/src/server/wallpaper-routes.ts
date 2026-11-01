import type http from "node:http";
import { normalizeVideo } from "../themes/normalize-video.js";
import { MAX_ASSET_BYTES } from "../themes/store.js";
import { mobilePackage } from "../wallpaper-engine/pkg.js";
import type { WallpaperEngineSource } from "../wallpaper-engine/source.js";
import {
  LARGE_BODY_BUSY,
  LargeBodyBusyError,
  readBytes,
  sendJson,
  sendText,
} from "./http.js";
import { isForeignOrigin, isLoopbackRemote } from "./identity.js";
import { MAX_VIDEO_SOURCE_BYTES, VIDEO_OVER_ASSET_BOUND } from "./limits.js";

export interface WallpaperRouteDeps {
  readonly wallpaperEngine: WallpaperEngineSource | undefined;
  readonly largeBody: {
    run<T>(work: () => Promise<T>): Promise<T>;
  };
}

/** The Wallpaper Engine library, its item bytes, project unpack and import. */
export function createWallpaperRoutes(
  deps: WallpaperRouteDeps,
): (
  request: http.IncomingMessage,
  response: http.ServerResponse,
  url: URL,
) => Promise<boolean> {
  const { wallpaperEngine, largeBody } = deps;

  return async function handleWallpaperRoutes(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    url: URL,
  ): Promise<boolean> {
    // The Wallpaper Engine library this PC holds, and one item's bytes. The
    // browser names an item by its `workshopId`; every path stays in the host.
    if (url.pathname === "/api/wallpaper-engine") {
      if (request.method !== "GET") {
        sendText(response, 405, "Only GET is supported.");
        return true;
      }

      // The library names files on this PC. A paired display reads dashboards,
      // not this, so it stays admin like `/api/hosting`.
      if (!isLoopbackRemote(request.socket.remoteAddress)) {
        sendText(
          response,
          403,
          "Wallpaper Engine is available on this PC only.",
        );
        return true;
      }

      sendJson(
        response,
        200,
        wallpaperEngine === undefined
          ? { available: false, reason: "not-installed" }
          : await wallpaperEngine.listing(),
      );
      return true;
    }

    const wallpaperEngineMatch = url.pathname.match(
      /^\/api\/wallpaper-engine\/item\/([^/]+)\/(preview|asset)$/,
    );
    if (wallpaperEngineMatch) {
      if (request.method !== "GET") {
        sendText(response, 405, "Only GET is supported.");
        return true;
      }
      if (!isLoopbackRemote(request.socket.remoteAddress)) {
        sendText(
          response,
          403,
          "Wallpaper Engine is available on this PC only.",
        );
        return true;
      }

      let workshopId: string;
      try {
        workshopId = decodeURIComponent(wallpaperEngineMatch[1] ?? "");
      } catch {
        // Malformed percent-encoding names no item, so it is the same answer
        // as any other id the library does not hold.
        sendText(response, 404, "No such wallpaper.");
        return true;
      }
      const part = wallpaperEngineMatch[2] === "preview" ? "preview" : "asset";
      const bytes =
        wallpaperEngine === undefined
          ? undefined
          : await wallpaperEngine.bytesOf(workshopId, part);

      if (bytes === undefined) {
        sendText(response, 404, "No such wallpaper.");
        return true;
      }

      response.writeHead(200, {
        "content-type": bytes.contentType,
        "cache-control": "no-store",
      });
      response.end(bytes.bytes);
      return true;
    }

    // The one write in this surface (R8): unpack the item into an editable
    // project and stop. The item id is the whole request — there is no body —
    // so the selection itself is the trigger.
    const wallpaperEngineProject = url.pathname.match(
      /^\/api\/wallpaper-engine\/item\/([^/]+)\/project$/,
    );
    if (wallpaperEngineProject) {
      if (request.method !== "POST") {
        sendText(response, 405, "Only POST is supported.");
        return true;
      }

      // Creating a directory is admin work, and a page in another origin can
      // reach a loopback route without a credential.
      if (!isLoopbackRemote(request.socket.remoteAddress)) {
        sendText(response, 403, "Unpacking is available on this PC only.");
        return true;
      }
      if (isForeignOrigin(request)) {
        sendText(response, 403, "Unpacking is not available to another page.");
        return true;
      }

      let workshopId: string;
      try {
        workshopId = decodeURIComponent(wallpaperEngineProject[1] ?? "");
      } catch {
        sendText(response, 404, "No such wallpaper.");
        return true;
      }

      sendJson(
        response,
        200,
        wallpaperEngine === undefined
          ? { ok: false, reason: "no-install" }
          : await wallpaperEngine.project(workshopId),
      );
      return true;
    }

    // A mobile export the author saved by hand: the host reads
    // the package, extracts its video and normalizes it. Needs no install.
    if (url.pathname === "/api/wallpaper-engine/mpkg") {
      if (request.method !== "POST") {
        sendText(response, 405, "Only POST is supported.");
        return true;
      }
      if (!isLoopbackRemote(request.socket.remoteAddress)) {
        sendText(
          response,
          403,
          "Wallpaper Engine imports are available on this PC only.",
        );
        return true;
      }
      // Normalizing spawns the encoder, and any page can POST to loopback.
      if (isForeignOrigin(request)) {
        sendText(response, 403, "That request is from another origin.");
        return true;
      }

      let source: Uint8Array;
      try {
        source = await largeBody.run(() =>
          readBytes(request, MAX_VIDEO_SOURCE_BYTES),
        );
      } catch (error) {
        if (error instanceof LargeBodyBusyError) {
          sendText(response, 429, LARGE_BODY_BUSY);
          return true;
        }
        sendText(response, 413, "That package is too large to import.");
        return true;
      }

      const pkg = mobilePackage(source);
      if (pkg === undefined) {
        sendJson(response, 200, {
          ok: false,
          message:
            "That file is not a Wallpaper Engine mobile package with a video.",
        });
        return true;
      }

      const normalized = await normalizeVideo(pkg.video);
      if (!normalized.ok) {
        // The normalizer's own sentence, as the export route answers it.
        sendJson(response, 200, { ok: false, message: normalized.message });
        return true;
      }
      // The package and the theme have different ceilings: the package's
      // archive bound is not the theme's, but the video the theme carries must
      // fit the store's per-asset bound or the save would refuse it later.
      if (normalized.bytes.byteLength > MAX_ASSET_BYTES) {
        sendJson(response, 200, { ok: false, message: VIDEO_OVER_ASSET_BOUND });
        return true;
      }

      sendJson(response, 200, {
        ok: true,
        videoBase64: Buffer.from(normalized.bytes).toString("base64"),
        reencoded: normalized.reencoded,
        ...(pkg.title === undefined ? {} : { title: pkg.title }),
        ...(pkg.workshopId === undefined ? {} : { workshopId: pkg.workshopId }),
      });
      return true;
    }

    // The persona name behind a Steam id, so the editor can credit an item.
    // A read, so loopback-only like the listing; the global origin guard above
    // already refuses another page's request.
    const wallpaperEngineAuthor = url.pathname.match(
      /^\/api\/wallpaper-engine\/author\/([^/]+)$/,
    );
    if (wallpaperEngineAuthor) {
      if (request.method !== "GET") {
        sendText(response, 405, "Only GET is supported.");
        return true;
      }
      if (!isLoopbackRemote(request.socket.remoteAddress)) {
        sendText(
          response,
          403,
          "Wallpaper Engine is available on this PC only.",
        );
        return true;
      }

      let steamId: string;
      try {
        steamId = decodeURIComponent(wallpaperEngineAuthor[1] ?? "");
      } catch {
        sendText(response, 404, "No such author.");
        return true;
      }

      const name =
        wallpaperEngine === undefined
          ? undefined
          : await wallpaperEngine.authorName(steamId);

      // An absent name is absence, not a key holding undefined.
      sendJson(response, 200, name === undefined ? {} : { name });
      return true;
    }

    return false;
  };
}
